import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceStatus } from '../../common/entities/resource-status.enum';
import { GeneralException } from '../../common/exceptions/general.exception';
import { CommunitiesService } from '../../communities/communities.service';
import { MemberCommunitiesService } from '../../member-communities/member-communities.service';
import { DebateTimerService } from './debate-timer.service';
import { debateRoomName } from './debate-room-name.util';
import {
  DebateEventsPublisher,
  TurnChangedPayload,
} from './debate-events-publisher.interface';
import { DebateMessage } from '../entities/debate-message.entity';
import { Debate, DebateTurn } from '../entities/debate.entity';
import { DebateErrorCode } from '../exceptions/debate-error-code';

// 턴당 발언 가능한 누적 글자 수
const MESSAGE_CHAR_BUDGET = 1000;
// 발언권(차례)이 있는 단계. STARTING도 타이머·endsAt은 있지만 발언권 없는 자유 발언
// 시간이라 이 집합에 넣지 않고 sendMessage에서 별도 분기로 처리한다(STARTING 전용 검증 참고).
// JUDGING/FINISHED는 타이머도 발언권도 없다.
const SPEAKING_TURNS: ReadonlySet<DebateTurn> = new Set([
  DebateTurn.OPENING,
  DebateTurn.FREETALKING,
  DebateTurn.CLOSING,
]);

// 서버 프로세스 1대 전제의 인메모리 런타임 상태. 스케일아웃 시 이 Map을 Redis 등 공유 스토어로
// 옮기고 DebateTimerService도 분산 스케줄러로 교체해야 한다(참여자 join 여부, 턴 발언 카운터는
// DB 왕복 없이 소켓 이벤트마다 확인해야 하므로 in-memory로 둔다).
interface DebateRuntimeState {
  joinedDebaterIds: Set<string>;
  turnUsedChars: number;
  turnSeq: number;
}

// 서비스 내부 반환 타입: socketRoom은 실제 socket.io room 이름(debateRoomName() 결과)
export interface JoinResult {
  socketRoom: string;
}

export interface SendMessageResult {
  debateMessageId: string;
  senderId: string;
  senderNickname: string;
}

@Injectable()
export class DebateRoomService {
  private readonly runtimeStates = new Map<string, DebateRuntimeState>();
  private readonly turnSeconds: number;
  private readonly startingSeconds: number;
  private publisher: DebateEventsPublisher | null = null;

  constructor(
    @InjectRepository(Debate)
    private readonly debateRepository: Repository<Debate>,
    @InjectRepository(DebateMessage)
    private readonly debateMessageRepository: Repository<DebateMessage>,
    private readonly memberCommunitiesService: MemberCommunitiesService,
    private readonly communitiesService: CommunitiesService,
    private readonly timerService: DebateTimerService,
    configService: ConfigService,
  ) {
    this.turnSeconds = configService.get<number>('DEBATE_TURN_SECONDS', 180);
    this.startingSeconds = configService.get<number>(
      'DEBATE_STARTING_SECONDS',
      10,
    );
  }

  // 게이트웨이가 afterInit에서 자신을 등록한다(서비스가 게이트웨이를 직접 주입받지 않기 위한 경계).
  bindPublisher(publisher: DebateEventsPublisher): void {
    this.publisher = publisher;
  }

  // 토론방 입장. 토론자(host/opponent)면 참여 기록을 남기고, 양측이 다 모이면 첫 턴을 시작한다.
  //TODO 주석 점검 (관전자는 해당 커뮤니티 멤버인지만 확인한다.)
  async join(memberId: string, debateId: string): Promise<JoinResult> {
    const debate = await this.getDebateOrThrow(debateId);
    if (debate.currentTurn === DebateTurn.PENDING) {
      throw new GeneralException(DebateErrorCode.REQUEST_NOT_ACCEPTED);
    }

    const isDebater = this.isDebater(debate, memberId);

    if (!isDebater) {
      const membership = await this.memberCommunitiesService.findOne(
        memberId,
        debate.communityId,
      );
      if (!membership) {
        throw new GeneralException(DebateErrorCode.NOT_COMMUNITY_MEMBER);
      }
      //TODO 관전자
      return { socketRoom: debateRoomName(debateId) };
    }

    //TODO 만약 1대1 토론방이라면, State에서 Id Set(즉, joinedDebaterIds) 저장할 필요가 있을지..?
    const state = this.getOrCreateState(debateId);
    state.joinedDebaterIds.add(memberId);

    const bothDebatersJoined =
      state.joinedDebaterIds.has(debate.hostId) &&
      state.joinedDebaterIds.has(debate.opponentId);

    // 양측이 다 모이면 STARTING 인사 카운트다운을 시작한다. 재-join(재접속)으로 이 조건이
    // 다시 참이 되어도 이미 타이머가 돌고 있으면(has) 중복 브로드캐스트·재예약을 하지 않는다.
    if (
      bothDebatersJoined &&
      debate.currentTurn === DebateTurn.STARTING &&
      !this.timerService.has(debate.id)
    ) {
      this.startStartingCountdown(debate);
    }

    return { socketRoom: debateRoomName(debateId) };
  }

  // STARTING 인사 시간 시작: DB 상태(currentTurn)는 STARTING 그대로 두고 타이머만 예약한 뒤,
  // endsAt이 채워진 turn_changed를 브로드캐스트한다. 만료되면 advance()가 STARTING→OPENING(host)로 전환한다.
  private startStartingCountdown(debate: Debate): void {
    const ms = this.startingSeconds * 1000;
    const endsAt = Date.now() + ms;

    this.timerService.schedule(debate.id, ms, () => {
      void this.handleTurnTimeout(debate.id);
    });

    const payload: TurnChangedPayload = {
      debateId: debate.id,
      turn: DebateTurn.STARTING,
      currentSpeakerId: null,
      currentSpeakerNickname: null,
      endsAt,
    };
    this.publisher?.emitTurnChanged(debateRoomName(debate.id), payload);
  }

  // 발언 메시지 처리: 단계/차례/글자 예산을 검증한 뒤 저장한다.
  async sendMessage(
    memberId: string,
    debateId: string,
    msg: string,
  ): Promise<SendMessageResult> {
    const debate = await this.getDebateOrThrow(debateId);

    // STARTING은 발언권 없는 자유 인사 시간이라 발언자(currentSpeakerId)/예산 규칙이 아닌
    // 별도 검증(토론자 여부만)을 탄다.
    if (debate.currentTurn === DebateTurn.STARTING) {
      return this.sendStartingGreeting(debate, memberId, msg);
    }

    if (!SPEAKING_TURNS.has(debate.currentTurn)) {
      throw new GeneralException(DebateErrorCode.INVALID_PHASE);
    }
    if (debate.currentSpeakerId !== memberId) {
      throw new GeneralException(DebateErrorCode.NOT_YOUR_TURN);
    }

    const state = this.getOrCreateState(debateId);
    const usedChars = state.turnUsedChars + msg.length;
    if (usedChars > MESSAGE_CHAR_BUDGET) {
      throw new GeneralException(DebateErrorCode.MESSAGE_BUDGET_EXCEEDED);
    }
    state.turnUsedChars = usedChars;

    const message = this.debateMessageRepository.create({
      memberId,
      debateId,
      body: msg,
      debateTurn: state.turnSeq,
    });
    const saved = await this.debateMessageRepository.save(message);

    return {
      debateMessageId: saved.id,
      senderId: memberId,
      senderNickname: this.resolveNickname(debate, memberId) ?? '',
    };
  }

  // STARTING 발언 처리: 발언권 순서가 없으므로 host/opponent 여부만 확인한다(관전자는 NOT_YOUR_TURN).
  // 턴 누적 1000자 예산은 발언권 있는 턴(SPEAKING_TURNS)의 규칙이라 STARTING에는 적용하지 않는다
  // (메시지 1건당 1000자 제한은 DTO의 @MaxLength가 이미 보장한다). turnSeq는 STARTING 동안 그대로(0)다.
  private async sendStartingGreeting(
    debate: Debate,
    memberId: string,
    msg: string,
  ): Promise<SendMessageResult> {
    if (!this.isDebater(debate, memberId)) {
      throw new GeneralException(DebateErrorCode.NOT_YOUR_TURN);
    }

    const state = this.getOrCreateState(debate.id);
    const message = this.debateMessageRepository.create({
      memberId,
      debateId: debate.id,
      body: msg,
      debateTurn: state.turnSeq,
    });
    const saved = await this.debateMessageRepository.save(message);

    return {
      debateMessageId: saved.id,
      senderId: memberId,
      senderNickname: this.resolveNickname(debate, memberId) ?? '',
    };
  }

  // 발언 차례인 사람의 명시적 턴 넘기기. 검증 후 상태머신을 한 칸 진행한다.
  async nextTurn(memberId: string, debateId: string): Promise<void> {
    const debate = await this.getDebateOrThrow(debateId);
    if (debate.currentSpeakerId !== memberId) {
      throw new GeneralException(DebateErrorCode.NOT_YOUR_TURN);
    }
    await this.advance(debate);
  }

  // 타이머 만료로 인한 자동 턴 넘기기. next_turn과 동일한 advance 경로를 탄다(발신자 검증 없음).
  private async handleTurnTimeout(debateId: string): Promise<void> {
    const debate = await this.debateRepository.findOneBy({
      id: debateId,
      status: ResourceStatus.NORMAL,
    });
    // 그 사이 토론이 삭제되었거나 이미 다른 경로로 턴이 넘어간 경우 방어적으로 무시한다.
    if (!debate) {
      return;
    }
    await this.advance(debate);
  }

  // 턴 상태머신의 다음 슬롯을 계산하고, DB 반영/타이머 재예약/브로드캐스트까지 한 번에 처리한다.
  private async advance(debate: Debate): Promise<void> {
    const community = await this.communitiesService.findOneOrThrow(
      debate.communityId,
    );
    const next = this.computeNextTurn(debate, community.debateRoundCount);

    debate.currentTurn = next.turn;
    debate.currentSpeakerId = next.speakerId;
    debate.freetalkingRound = next.freetalkingRound;

    const state = this.getOrCreateState(debate.id);
    state.turnUsedChars = 0;
    if (SPEAKING_TURNS.has(next.turn)) {
      state.turnSeq += 1;
    }

    await this.debateRepository.save(debate);

    this.timerService.cancel(debate.id);

    let endsAt: number | null = null;
    if (SPEAKING_TURNS.has(next.turn)) {
      const ms = this.turnSeconds * 1000;
      endsAt = Date.now() + ms;
      this.timerService.schedule(debate.id, ms, () => {
        void this.handleTurnTimeout(debate.id);
      });
    }

    const payload: TurnChangedPayload = {
      debateId: debate.id,
      turn: next.turn,
      currentSpeakerId: next.speakerId,
      currentSpeakerNickname: this.resolveNickname(debate, next.speakerId),
      endsAt,
    };
    this.publisher?.emitTurnChanged(debateRoomName(debate.id), payload);
  }

  // 슬롯 시퀀스: STARTING → OPENING(host)→OPENING(opp)
  //   → [FREETALKING(host)→FREETALKING(opp)] × community.debateRoundCount
  //   → CLOSING(host)→CLOSING(opp) → JUDGING(발언자 없음, 타이머 없음).
  // JUDGING 이후 AI 판정 연동은 후속 작업 TODO.
  private computeNextTurn(
    debate: Debate,
    debateRoundCount: number,
  ): { turn: DebateTurn; speakerId: string | null; freetalkingRound: number } {
    const {
      currentTurn,
      currentSpeakerId,
      hostId,
      opponentId,
      freetalkingRound,
    } = debate;
    const isHostSpeaking = currentSpeakerId === hostId;

    switch (currentTurn) {
      case DebateTurn.STARTING:
        return {
          turn: DebateTurn.OPENING,
          speakerId: hostId,
          freetalkingRound: 0,
        };

      case DebateTurn.OPENING:
        if (isHostSpeaking) {
          return {
            turn: DebateTurn.OPENING,
            speakerId: opponentId,
            freetalkingRound: 0,
          };
        }
        return debateRoundCount > 0
          ? {
              turn: DebateTurn.FREETALKING,
              speakerId: hostId,
              freetalkingRound: 1,
            }
          : {
              turn: DebateTurn.CLOSING,
              speakerId: hostId,
              freetalkingRound: 0,
            };

      case DebateTurn.FREETALKING:
        if (isHostSpeaking) {
          return {
            turn: DebateTurn.FREETALKING,
            speakerId: opponentId,
            freetalkingRound,
          };
        }
        return freetalkingRound < debateRoundCount
          ? {
              turn: DebateTurn.FREETALKING,
              speakerId: hostId,
              freetalkingRound: freetalkingRound + 1,
            }
          : { turn: DebateTurn.CLOSING, speakerId: hostId, freetalkingRound };

      case DebateTurn.CLOSING:
        return isHostSpeaking
          ? {
              turn: DebateTurn.CLOSING,
              speakerId: opponentId,
              freetalkingRound,
            }
          : { turn: DebateTurn.JUDGING, speakerId: null, freetalkingRound };

      case DebateTurn.JUDGING:
      case DebateTurn.FINISHED:
      default:
        // TODO: AI 판정 연동 후 JUDGING → FINISHED 전환 구현
        return { turn: currentTurn, speakerId: null, freetalkingRound };
    }
  }

  private isDebater(debate: Debate, memberId: string): boolean {
    return debate.hostId === memberId || debate.opponentId === memberId;
  }

  private resolveNickname(
    debate: Debate,
    memberId: string | null,
  ): string | null {
    if (memberId === null) {
      return null;
    }
    if (memberId === debate.hostId) {
      return debate.hostNickname;
    }
    if (memberId === debate.opponentId) {
      return debate.opponentNickname;
    }
    return null;
  }

  private getOrCreateState(debateId: string): DebateRuntimeState {
    let state = this.runtimeStates.get(debateId);
    if (!state) {
      state = { joinedDebaterIds: new Set(), turnUsedChars: 0, turnSeq: 0 };
      this.runtimeStates.set(debateId, state);
    }
    return state;
  }

  private async getDebateOrThrow(debateId: string): Promise<Debate> {
    const debate = await this.debateRepository.findOneBy({
      id: debateId,
      status: ResourceStatus.NORMAL,
    });
    if (!debate) {
      throw new GeneralException(DebateErrorCode.NOT_FOUND);
    }
    return debate;
  }
}
