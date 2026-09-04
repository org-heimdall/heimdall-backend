import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { ErrorCode } from '../common/exceptions/error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import { MembersService } from '../members/members.service';
import {
  createFailedSolution,
  createJudgedSolution,
  createPendingSolution,
  isPendingOwnedBy,
  toDebateSolution,
} from './debate-solution';
import type { JudgmentWinner, ParticipantSolution } from './debate-solution';
import { DebateJudgmentDto } from './dto/debate-judgment.dto';
import { JudgeErrorCode } from './exceptions/judge-error-code';
import { JUDGE } from './judge.interface';
import { toSocialCreditPenalty } from './violation-penalty';
// 데코레이터가 붙은 시그니처의 타입은 isolatedModules + emitDecoratorMetadata 조합에서
// 반드시 type-only로 가져와야 한다.
import type {
  DebateSide,
  DebateTranscriptTurn,
  DebateViolation,
  Judge,
  JudgeRequest,
  JudgeResult,
  ParticipantJudgment,
} from './judge.interface';

@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  constructor(
    @InjectRepository(Debate)
    private readonly debateRepository: Repository<Debate>,
    @InjectRepository(DebateMessage)
    private readonly debateMessageRepository: Repository<DebateMessage>,
    @Inject(JUDGE)
    private readonly judge: Judge,
    private readonly membersService: MembersService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 판정 요청. 검증 후 solution을 PENDING으로 표시하고 즉시 반환하며,
   * 실제 LLM 호출은 백그라운드로 넘긴다(클라이언트는 폴링으로 결과를 받는다).
   *
   * PENDING 선점은 조건부 UPDATE 한 번으로 처리한다(read-then-write가 아니므로
   * 동시 요청이 둘 다 통과할 수 없고, 영향받은 행이 없으면 이미 선점된 것이다).
   */
  async requestJudgment(debateId: string, memberId: string): Promise<void> {
    const debate = await this.getDebateOrThrow(debateId);
    this.assertParticipant(debate, memberId);

    // 상대가 없는 토론은 양측을 비교할 수 없다.
    if (debate.opponentId === null) {
      throw new GeneralException(JudgeErrorCode.NOT_JUDGEABLE);
    }

    // 이 시도만의 식별자. PENDING 선점부터 결과 저장까지 같은 값을 들고 다니며, 다른
    // 시도가 선점해 갔거나 이미 결과가 저장된 뒤에는 내 결과를 적용하지 않도록 막는다.
    const requestId = randomUUID();
    const acquired = await this.tryAcquirePendingSolution(debate.id, requestId);
    if (!acquired) {
      throw new GeneralException(JudgeErrorCode.ALREADY_REQUESTED);
    }

    void this.executeJudgment(debate.id, requestId);
  }

  /**
   * solution이 없거나 FAILED이거나, PENDING인데 LLM 호출이 정상적으로 끝날 수 없는
   * 시간(=OpenAI 타임아웃 * 재시도 포함 시도 횟수)을 넘긴 경우에만 PENDING으로 선점한다.
   * 갓 요청된 PENDING과 JUDGED는 계속 거부한다.
   *
   * read-then-write 대신 조건부 UPDATE 하나로 처리해 동시 요청 중 하나만 성공시킨다.
   */
  private async tryAcquirePendingSolution(
    debateId: string,
    requestId: string,
  ): Promise<boolean> {
    const expiredBefore = new Date(
      Date.now() - this.resolveJudgmentExpirationMs(),
    ).toISOString();

    const result = await this.debateRepository
      .createQueryBuilder()
      .update(Debate)
      .set({ solution: createPendingSolution(requestId) })
      .where('id = :debateId', { debateId })
      .andWhere('status = :status', { status: ResourceStatus.NORMAL })
      .andWhere(
        `(
          solution IS NULL
          OR solution ->> 'status' = 'FAILED'
          OR (
            solution ->> 'status' = 'PENDING'
            AND (solution ->> 'requestedAt')::timestamptz < :expiredBefore
          )
        )`,
        { expiredBefore },
      )
      .execute();

    return (result.affected ?? 0) > 0;
  }

  // 판정 1건은 성능/위반 평가를 병렬로 호출하므로(각각 SDK 자체 재시도 포함), 이 시간을
  // 넘겨도 여전히 PENDING이면 프로세스 재시작 등으로 결과를 영영 못 받은 것으로 간주한다.
  private resolveJudgmentExpirationMs(): number {
    const timeoutMs =
      this.configService.getOrThrow<number>('OPENAI_TIMEOUT_MS');
    const maxRetries =
      this.configService.getOrThrow<number>('OPENAI_MAX_RETRIES');
    return timeoutMs * (maxRetries + 1);
  }

  /**
   * 백그라운드 판정 본체. 호출자가 응답을 기다리지 않으므로 예외를 밖으로 내보내지 않고,
   * 실패는 solution을 FAILED로 남겨 재요청할 수 있게 한다.
   *
   * requestId는 이 실행이 선점했던 PENDING의 식별자다. LLM 호출이 오래 걸리는 동안
   * 만료된 것으로 간주되어 다른 요청이 새 PENDING을 선점했을 수 있으므로, 결과를 저장하기
   * 직전 "지금도 내가 선점한 PENDING이 맞는지"를 확인해 stale한 결과가 최신 시도를
   * 덮어쓰지 않도록 한다.
   */
  async executeJudgment(debateId: string, requestId: string): Promise<void> {
    try {
      const debate = await this.getDebateOrThrow(debateId);
      const result = await this.judge.judge(await this.buildRequest(debate));

      // 판정 저장과 신뢰도 차감은 원자적. 동시 실행(재시도 등)이 신뢰도를 이중 차감하거나
      // 서로의 결과를 덮어쓰지 않도록, 트랜잭션 안에서 비관적 쓰기 락으로 다시 읽어
      // 내가 선점한 PENDING이 아니면(이미 JUDGED됐거나 다른 요청이 선점) 적용을 건너뛴다.
      await this.dataSource.transaction(async (manager) => {
        const locked = await manager.findOne(Debate, {
          where: { id: debate.id },
          lock: { mode: 'pessimistic_write' },
        });

        if (
          locked === null ||
          !isPendingOwnedBy(toDebateSolution(locked.solution), requestId)
        ) {
          return;
        }

        await this.applyJudgment(locked, result, manager);
      });
    } catch (error) {
      this.logger.error(`토론 판정 실패: debateId=${debateId}`, error);
      await this.markFailed(debateId, requestId);
    }
  }

  // 판정 상태 조회(폴링). 요청된 적이 없으면 NOT_REQUESTED.
  async getJudgment(debateId: string): Promise<DebateJudgmentDto> {
    const debate = await this.getDebateOrThrow(debateId);

    const solution = toDebateSolution(debate.solution);
    if (solution === null) {
      throw new GeneralException(JudgeErrorCode.NOT_REQUESTED);
    }

    return DebateJudgmentDto.from(debate, solution);
  }

  // 토론 내역을 판정기 입력 계약으로 조립한다.
  private async buildRequest(debate: Debate): Promise<JudgeRequest> {
    const turns = await this.loadTranscript(debate);

    // 발화가 하나도 없으면 판정할 근거가 없다.
    if (turns.length === 0) {
      throw new GeneralException(JudgeErrorCode.NOT_JUDGEABLE);
    }

    return {
      topic: debate.community.topic,
      host: { nickname: debate.hostNickname },
      opponent: { nickname: debate.opponentNickname ?? '' },
      turns,
    };
  }

  // DB로부터 debate_turn 오름차순으로 메시지를 조회하여 발화자를 host/opponent로 표시한다.
  private async loadTranscript(
    debate: Debate,
  ): Promise<DebateTranscriptTurn[]> {
    const messages = await this.debateMessageRepository.find({
      where: { debateId: debate.id, status: ResourceStatus.NORMAL },
      order: { debate_turn: 'ASC' },
    });

    return messages
      .map((message) => {
        const speaker = this.resolveSide(debate, message.memberId);
        // 참가자가 아닌 회원의 메시지는 판정 대상이 아니다(데이터 이상).
        if (speaker === null) {
          this.logger.warn(
            `토론 참가자가 아닌 발화를 제외: debateId=${debate.id}, memberId=${message.memberId}`,
          );
          return null;
        }

        return {
          speaker,
          turn: message.debate_turn,
          body: message.body,
          imageUrl: message.imageUrl,
        };
      })
      .filter((turn): turn is DebateTranscriptTurn => turn !== null);
  }

  private async applyJudgment(
    debate: Debate,
    result: JudgeResult,
    manager: EntityManager,
  ): Promise<void> {
    const { winner } = result.performance;
    const penalties: Record<DebateSide, number> = {
      host: toSocialCreditPenalty(result.violation.host),
      opponent: toSocialCreditPenalty(result.violation.opponent),
    };

    debate.winnerId = this.resolveWinnerId(debate, winner);
    debate.solution = createJudgedSolution(result.model, winner, {
      host: this.toParticipantSolution(
        result.performance.host,
        result.violation.host,
        penalties.host,
      ),
      opponent: this.toParticipantSolution(
        result.performance.opponent,
        result.violation.opponent,
        penalties.opponent,
      ),
    });

    await manager.save(debate);
    await this.deductPenalties(debate, penalties, manager);
  }

  // 판정 결과와 위반 내역을 solution에 남길 형태로 묶는다(차감 근거를 되짚기 위한 감사 기록).
  private toParticipantSolution(
    judgment: ParticipantJudgment,
    violations: DebateViolation[],
    socialCreditPenalty: number,
  ): ParticipantSolution {
    return {
      score: judgment.score,
      judgeReason: judgment.judgeReason,
      violations,
      socialCreditPenalty,
    };
  }

  // 양측의 신뢰도를 차감한다. 차감량이 0이면 MembersService가 조회 없이 넘긴다.
  private async deductPenalties(
    debate: Debate,
    penalties: Record<DebateSide, number>,
    manager: EntityManager,
  ): Promise<void> {
    await this.membersService.deductSocialCredit(
      debate.hostId,
      penalties.host,
      manager,
    );

    // 판정까지 온 토론은 상대가 반드시 있지만, 타입상 null이 가능하므로 방어한다.
    if (debate.opponentId !== null) {
      await this.membersService.deductSocialCredit(
        debate.opponentId,
        penalties.opponent,
        manager,
      );
    }
  }

  // 무승부는 winnerId를 비워 둔다. 판정 여부는 solution의 winner로 구분되므로 모호하지 않다.
  private resolveWinnerId(
    debate: Debate,
    winner: JudgmentWinner,
  ): string | null {
    if (winner === 'host') {
      return debate.hostId;
    }
    return winner === 'opponent' ? debate.opponentId : null;
  }

  /**
   * 실패 기록. 백그라운드 흐름이라 기록마저 실패해도 예외를 올리지 않고 로그만 남긴다.
   *
   * tryAcquirePendingSolution과 마찬가지로 조건부 UPDATE 한 번으로 처리한다: 지금도
   * 내가 선점한(requestId 일치) PENDING일 때만 FAILED로 바꾼다. 이미 다른 요청이
   * 선점해 갔거나(다른 requestId) 결과가 저장된 뒤라면(JUDGED) 조건이 맞지 않아
   * 아무 행도 바뀌지 않으므로, 최신 시도의 결과를 stale한 실패로 덮어쓰지 않는다.
   */
  private async markFailed(debateId: string, requestId: string): Promise<void> {
    try {
      await this.debateRepository
        .createQueryBuilder()
        .update(Debate)
        .set({ solution: createFailedSolution() })
        .where('id = :debateId', { debateId })
        .andWhere(`solution ->> 'status' = 'PENDING'`)
        .andWhere(`solution ->> 'requestId' = :requestId`, { requestId })
        .execute();
    } catch (error) {
      this.logger.error(
        `판정 실패 상태 기록 실패: debateId=${debateId}`,
        error,
      );
    }
  }

  private resolveSide(debate: Debate, memberId: string): DebateSide | null {
    if (memberId === debate.hostId) {
      return 'host';
    }
    return memberId === debate.opponentId ? 'opponent' : null;
  }

  // 판정을 요청할 수 있는 사람은 토론 당사자(host/opponent)뿐이다.
  private assertParticipant(debate: Debate, memberId: string): void {
    if (this.resolveSide(debate, memberId) === null) {
      throw new GeneralException(ErrorCode.FORBIDDEN);
    }
  }

  // 토론 조회. 주제(topic)는 community에 있으므로 함께 읽고, 조인 대상의 soft-delete도 제외한다.
  private async getDebateOrThrow(debateId: string): Promise<Debate> {
    const debate = await this.debateRepository.findOne({
      where: {
        id: debateId,
        status: ResourceStatus.NORMAL,
        community: { status: ResourceStatus.NORMAL },
      },
      relations: { community: true },
    });

    if (!debate) {
      throw new GeneralException(DebateErrorCode.NOT_FOUND);
    }
    return debate;
  }
}
