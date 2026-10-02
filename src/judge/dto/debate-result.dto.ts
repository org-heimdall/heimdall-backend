import { ApiProperty } from '@nestjs/swagger';
import { DebateSide } from '../../debates/debate-turn';
import { DebateDto } from '../../debates/dto/debate.dto';
import { JudgmentWinner, VerificationStatus } from '../judge.types';
import { DebateArgumentComponent } from '../entities/debate-argument.entity';
import { DebateFactCheckResult } from '../entities/debate-fact-check.entity';
import { DebateJudgmentResult } from '../entities/debate-judgment-result.entity';

// 계약(frontend-api-contract.md) 판정 API의 응답 3종. 결과 화면 한 장이 함께 쓰는 것들이다.

// 계약 JudgmentResult. 편별 세 축은 LLM 점수, 총점·승자는 서버 계산 결과다.
export class JudgmentResultDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61' })
  debateId: string;

  @ApiProperty({ enum: JudgmentWinner, example: JudgmentWinner.SIDE_A })
  winner: JudgmentWinner;

  @ApiProperty({ example: 80, description: '논증 점수(0~100)' })
  sideAArgumentationScore: number;

  @ApiProperty({ example: 70, description: '상호작용 점수(0~100)' })
  sideAInteractionScore: number;

  @ApiProperty({ example: 60, description: '사실 신뢰도 점수(0~100)' })
  sideAFactualReliabilityScore: number;

  @ApiProperty({ example: 71, description: '세 점수의 가중합(서버 계산)' })
  sideATotalScore: number;

  @ApiProperty({ example: 70 })
  sideBArgumentationScore: number;

  @ApiProperty({ example: 80 })
  sideBInteractionScore: number;

  @ApiProperty({ example: 70 })
  sideBFactualReliabilityScore: number;

  @ApiProperty({ example: 73 })
  sideBTotalScore: number;

  @ApiProperty({ example: '양측 모두 주제를 벗어나지 않았다.' })
  overallReason: string;

  @ApiProperty({ example: '근거를 더 구체적으로 제시하면 좋겠다.' })
  sideAFeedback: string;

  @ApiProperty({ example: '상대 질문에 직접 답하면 좋겠다.' })
  sideBFeedback: string;

  @ApiProperty({ example: '2026-09-07T12:20:00.000Z' })
  judgedAt: string;

  static from(result: DebateJudgmentResult): JudgmentResultDto {
    return Object.assign(new JudgmentResultDto(), {
      id: result.id,
      debateId: result.debateId,
      winner: result.winner,
      sideAArgumentationScore: result.sideAArgumentationScore,
      sideAInteractionScore: result.sideAInteractionScore,
      sideAFactualReliabilityScore: result.sideAFactualReliabilityScore,
      sideATotalScore: result.sideATotalScore,
      sideBArgumentationScore: result.sideBArgumentationScore,
      sideBInteractionScore: result.sideBInteractionScore,
      sideBFactualReliabilityScore: result.sideBFactualReliabilityScore,
      sideBTotalScore: result.sideBTotalScore,
      overallReason: result.overallReason,
      sideAFeedback: result.sideAFeedback,
      sideBFeedback: result.sideBFeedback,
      judgedAt: result.judgedAt.toISOString(),
    });
  }
}

export class FactCheckSourceDto {
  @ApiProperty({ example: 'EU AI Act' })
  title: string;

  @ApiProperty({ example: 'European Commission' })
  publisher: string;

  @ApiProperty({ example: 'https://digital-strategy.ec.europa.eu/ai-act' })
  url: string;
}

/**
 * 계약 FactCheckResult. 검증 결과 자체는 컴포넌트 id만 갖고 있으므로,
 * 프론트가 바로 보여 줄 수 있도록 발언자·문장은 논증 컴포넌트에서 채운다.
 */
export class FactCheckResultDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({
    example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61',
    description: '검증 대상이 된 논증 컴포넌트',
  })
  componentId: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62' })
  speakerId: string;

  @ApiProperty({ enum: DebateSide, example: DebateSide.SIDE_A })
  speakerSide: DebateSide;

  @ApiProperty({ example: '2025년 EU가 AI법을 시행했다' })
  statement: string;

  @ApiProperty({
    enum: VerificationStatus,
    example: VerificationStatus.PARTIALLY_SUPPORTED,
  })
  status: VerificationStatus;

  @ApiProperty({ example: '2024년 발효, 2025년부터 단계적 시행이다.' })
  reason: string;

  @ApiProperty({ type: [FactCheckSourceDto] })
  sources: FactCheckSourceDto[];

  @ApiProperty({ example: '2026-09-07T12:15:00.000Z' })
  checkedAt: string;

  static from(
    result: DebateFactCheckResult,
    component: DebateArgumentComponent,
  ): FactCheckResultDto {
    return Object.assign(new FactCheckResultDto(), {
      id: result.id,
      componentId: result.componentId,
      speakerId: component.speakerId,
      speakerSide: component.speakerSide,
      statement: component.statement,
      status: result.status,
      reason: result.reason,
      sources: (result.sources ?? []).map((source) => ({
        title: source.title,
        publisher: source.publisher,
        url: source.url,
      })),
      checkedAt: result.checkedAt.toISOString(),
    });
  }
}

// 계약 DebateResult. 결과 화면 한 장에 필요한 것을 한 번에 준다.
export class DebateResultDto {
  @ApiProperty({ type: DebateDto })
  debate: DebateDto;

  @ApiProperty({
    enum: DebateSide,
    nullable: true,
    description: '요청한 회원이 어느 편이었는지. 관전자는 null.',
  })
  viewerSide: DebateSide | null;

  @ApiProperty({ type: JudgmentResultDto })
  judgmentResult: JudgmentResultDto;

  @ApiProperty({ type: [FactCheckResultDto] })
  factChecks: FactCheckResultDto[];
}
