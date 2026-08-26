import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { ErrorCode } from '../common/exceptions/error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import {
  createFailedSolution,
  createJudgedSolution,
  createPendingSolution,
  toDebateSolution,
} from './debate-solution';
import { DebateJudgmentDto } from './dto/debate-judgment.dto';
import { JudgeErrorCode } from './exceptions/judge-error-code';
import { JUDGE } from './judge.interface';
// 데코레이터가 붙은 시그니처의 타입은 isolatedModules + emitDecoratorMetadata 조합에서
// 반드시 type-only로 가져와야 한다.
import type {
  DebateSide,
  DebateTranscriptTurn,
  Judge,
  JudgeRequest,
  JudgeResult,
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
  ) {}

  /**
   * 판정 요청. 검증 후 solution을 PENDING으로 표시하고 즉시 반환하며,
   * 실제 LLM 호출은 백그라운드로 넘긴다(클라이언트는 폴링으로 결과를 받는다).
   *
   * 검증과 PENDING 기록은 read-then-write라 동시 요청이 둘 다 통과할 수 있으나,
   * 최악의 결과가 LLM 중복 호출뿐이라 락은 두지 않는다.
   */
  async requestJudgment(debateId: string, memberId: string): Promise<void> {
    const debate = await this.getDebateOrThrow(debateId);
    this.assertParticipant(debate, memberId);

    // 상대가 없는 토론은 양측을 비교할 수 없다.
    if (debate.opponentId === null) {
      throw new GeneralException(JudgeErrorCode.NOT_JUDGEABLE);
    }

    // FAILED만 재요청을 허용한다(PENDING은 진행 중, JUDGED는 이미 완료).
    const solution = toDebateSolution(debate.solution);
    if (solution !== null && solution.status !== 'FAILED') {
      throw new GeneralException(JudgeErrorCode.ALREADY_REQUESTED);
    }

    debate.solution = createPendingSolution();
    await this.debateRepository.save(debate);

    void this.executeJudgment(debate.id);
  }

  /**
   * 백그라운드 판정 본체. 호출자가 응답을 기다리지 않으므로 예외를 밖으로 내보내지 않고,
   * 실패는 solution을 FAILED로 남겨 재요청할 수 있게 한다.
   */
  async executeJudgment(debateId: string): Promise<void> {
    try {
      const debate = await this.getDebateOrThrow(debateId);
      const result = await this.judge.judge(await this.buildRequest(debate));

      this.applyJudgment(debate, result);
      await this.debateRepository.save(debate);
    } catch (error) {
      this.logger.error(`토론 판정 실패: debateId=${debateId}`, error);
      await this.markFailed(debateId);
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

  // 판정 결과를 엔티티에 반영한다. 승자는 host 판정만 사용하고 opponent.winner는 무시한다.
  private applyJudgment(debate: Debate, result: JudgeResult): void {
    if (result.performance.winner === 'host') debate.winnerId = debate.hostId;
    if (result.performance.winner === 'opponent')
      debate.winnerId = debate.opponentId;
    // TODO: result.winner === 'draw' 일 땐?

    debate.solution = createJudgedSolution(result.model, {
      host: {
        score: result.performance.host.score,
        judgeReason: result.performance.host.judgeReason,
      },
      opponent: {
        score: result.performance.opponent.score,
        judgeReason: result.performance.opponent.judgeReason,
      },
    });
  }

  // 실패 기록. 백그라운드 흐름이라 기록마저 실패해도 예외를 올리지 않고 로그만 남긴다.
  private async markFailed(debateId: string): Promise<void> {
    try {
      await this.debateRepository.update(
        { id: debateId },
        { solution: createFailedSolution() },
      );
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
