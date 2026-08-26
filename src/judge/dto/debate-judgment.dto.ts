import { ApiProperty } from '@nestjs/swagger';
import { Debate } from '../../debates/entities/debate.entity';
import { isJudged } from '../debate-solution';
import type {
  DebateSolution,
  JudgmentStatus,
  JudgmentWinner,
  ParticipantSolution,
} from '../debate-solution';
import type { ViolationSeverity, ViolationType } from '../judge.interface';

export class ViolationDto {
  @ApiProperty({ example: 'personal_attack' })
  type: ViolationType;

  @ApiProperty({ example: 'moderate' })
  severity: ViolationSeverity;
}

export class ParticipantJudgmentDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  memberId: string;

  @ApiProperty({ example: '메시' })
  nickname: string;

  @ApiProperty({ example: 87, description: '0~100 정수' })
  score: number;

  @ApiProperty({
    example: ['근거를 통계로 뒷받침했다', '상대 반론에 직접 답했다'],
    type: [String],
    description: '판정 이유 1~3개',
  })
  judgeReason: string[];

  @ApiProperty({
    type: [ViolationDto],
    description: '적발된 위반 목록. 위반이 없으면 빈 배열',
  })
  violations: ViolationDto[];

  @ApiProperty({
    example: 3,
    description: '이 판정으로 차감된 신뢰도(social credit)',
  })
  socialCreditPenalty: number;

  static from(
    memberId: string,
    nickname: string,
    participant: ParticipantSolution,
  ): ParticipantJudgmentDto {
    return {
      memberId,
      nickname,
      score: participant.score,
      judgeReason: participant.judgeReason,
      // evidence는 상대 발언 원문이라 응답에 싣지 않는다(solution에만 감사 기록으로 남는다).
      violations: participant.violations.map((violation) => ({
        type: violation.type,
        severity: violation.severity,
      })),
      socialCreditPenalty: participant.socialCreditPenalty,
    };
  }
}

export class DebateJudgmentDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  debateId: string;

  @ApiProperty({
    example: 'JUDGED',
    enum: ['PENDING', 'JUDGED', 'FAILED'],
    description: 'PENDING이면 폴링을 이어가고, FAILED면 재요청할 수 있다',
  })
  status: JudgmentStatus;

  @ApiProperty({
    example: 'host',
    enum: ['host', 'opponent', 'draw'],
    nullable: true,
    description: '승부 결과. JUDGED가 아니면 null',
  })
  winner: JudgmentWinner | null;

  @ApiProperty({
    example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60',
    nullable: true,
    description: '승자 memberId. 무승부이거나 JUDGED가 아니면 null',
  })
  winnerId: string | null;

  @ApiProperty({
    example: 'gpt-5.6-luna',
    nullable: true,
    description: '판정에 사용된 모델. JUDGED가 아니면 null',
  })
  model: string | null;

  @ApiProperty({
    example: '2026-08-26T12:34:56.789Z',
    nullable: true,
    description: '판정 완료 시각. JUDGED가 아니면 null',
  })
  judgedAt: string | null;

  @ApiProperty({ type: ParticipantJudgmentDto, nullable: true })
  host: ParticipantJudgmentDto | null;

  @ApiProperty({ type: ParticipantJudgmentDto, nullable: true })
  opponent: ParticipantJudgmentDto | null;

  static from(debate: Debate, solution: DebateSolution): DebateJudgmentDto {
    // PENDING/FAILED는 상태만 전달한다(점수·승자는 아직 없다).
    if (!isJudged(solution)) {
      return {
        debateId: debate.id,
        status: solution.status,
        winner: null,
        winnerId: null,
        model: null,
        judgedAt: null,
        host: null,
        opponent: null,
      };
    }

    return {
      debateId: debate.id,
      status: solution.status,
      winner: solution.winner,
      winnerId: debate.winnerId,
      model: solution.model,
      judgedAt: solution.judgedAt,
      host: ParticipantJudgmentDto.from(
        debate.hostId,
        debate.hostNickname,
        solution.host,
      ),
      opponent: ParticipantJudgmentDto.from(
        debate.opponentId!,
        debate.opponentNickname!,
        solution.opponent,
      ),
    };
  }
}
