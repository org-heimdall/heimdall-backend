import { ApiProperty } from '@nestjs/swagger';
import { DebateSide } from '../../debates/debate-turn';
import { DebateDto } from '../../debates/dto/debate.dto';
import { ClaimType, JudgmentWinner, VerificationStatus } from '../judge.types';
import { DebateArgumentComponent } from '../entities/debate-argument.entity';
import { DebateFactCheckResult } from '../entities/debate-fact-check.entity';
import { DebateJudgmentResult } from '../entities/debate-judgment-result.entity';

// 계약(frontend-api-contract.md) 판정 API의 응답 3종. 결과 화면 한 장이 함께 쓰는 것들이다.

// 판정 승자 → 편. 무승부는 편이 없다.
const WINNER_SIDE: Record<JudgmentWinner, DebateSide | null> = {
  [JudgmentWinner.SIDE_A]: DebateSide.SIDE_A,
  [JudgmentWinner.SIDE_B]: DebateSide.SIDE_B,
  [JudgmentWinner.DRAW]: null,
};

// 판정 결과 화면에서 편 하나를 그리는 데 필요한 참여자 정보. 회원의 현재 프로필에서 채운다.
export class JudgmentParticipantDto {
  @ApiProperty({ enum: DebateSide, example: DebateSide.SIDE_A })
  side: DebateSide;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62' })
  memberId: string;

  @ApiProperty({ example: '메시' })
  nickname: string;

  @ApiProperty({ example: 'https://cdn.example.com/1.png', nullable: true })
  profileImageUrl: string | null;
}

// 판정 결과를 화면용으로 가공한 값. 문장은 side 표기를 참여자 이름으로 바꾼 것이다.
export interface JudgmentView {
  participants: Record<DebateSide, JudgmentParticipantDto>;
  overallReason: string;
  sideAFeedback: string;
  sideBFeedback: string;
}

// 계약 JudgmentResult. 편별 세 축은 LLM 점수, 총점·승자는 서버 계산 결과다.
export class JudgmentResultDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61' })
  debateId: string;

  @ApiProperty({
    enum: JudgmentWinner,
    example: JudgmentWinner.SIDE_A,
    description:
      '분기용 내부 값. 화면에는 winnerMemberId와 sideA/sideBParticipant로 참여자를 표시한다.',
  })
  winner: JudgmentWinner;

  @ApiProperty({
    example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62',
    nullable: true,
    description: '승자 회원 id. 무승부면 null.',
  })
  winnerMemberId: string | null;

  @ApiProperty({ type: JudgmentParticipantDto })
  sideAParticipant: JudgmentParticipantDto;

  @ApiProperty({ type: JudgmentParticipantDto })
  sideBParticipant: JudgmentParticipantDto;

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

  @ApiProperty({
    example: '메시와 호날두 모두 주제를 벗어나지 않았다.',
    description: '참여자를 닉네임으로 지칭한 총평',
  })
  overallReason: string;

  @ApiProperty({ example: '메시는 근거를 더 구체적으로 제시하면 좋겠다.' })
  sideAFeedback: string;

  @ApiProperty({ example: '호날두는 상대 질문에 직접 답하면 좋겠다.' })
  sideBFeedback: string;

  @ApiProperty({ example: '2026-09-07T12:20:00.000Z' })
  judgedAt: string;

  // 원문 대신 화면용으로 가공한 문장(view)을 싣는다. 가공은 presenter가 하고 여기서는 옮겨 담기만 한다.
  static from(
    result: DebateJudgmentResult,
    view: JudgmentView,
  ): JudgmentResultDto {
    const { participants } = view;
    const winnerSide = WINNER_SIDE[result.winner];
    return Object.assign(new JudgmentResultDto(), {
      id: result.id,
      debateId: result.debateId,
      winner: result.winner,
      winnerMemberId:
        winnerSide === null ? null : participants[winnerSide].memberId,
      sideAParticipant: participants[DebateSide.SIDE_A],
      sideBParticipant: participants[DebateSide.SIDE_B],
      sideAArgumentationScore: result.sideAArgumentationScore,
      sideAInteractionScore: result.sideAInteractionScore,
      sideAFactualReliabilityScore: result.sideAFactualReliabilityScore,
      sideATotalScore: result.sideATotalScore,
      sideBArgumentationScore: result.sideBArgumentationScore,
      sideBInteractionScore: result.sideBInteractionScore,
      sideBFactualReliabilityScore: result.sideBFactualReliabilityScore,
      sideBTotalScore: result.sideBTotalScore,
      overallReason: view.overallReason,
      sideAFeedback: view.sideAFeedback,
      sideBFeedback: view.sideBFeedback,
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
 * 프론트가 바로 보여 줄 수 있도록 발언자·원본 턴·문장은 논증 컴포넌트에서 채운다.
 */
export class FactCheckResultDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({
    example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61',
    description: '검증 대상이 된 논증 컴포넌트',
  })
  componentId: string;

  @ApiProperty({
    example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f63',
    description: '검증 대상 주장이 나온 확정 턴(원본 발언)',
  })
  turnId: string;

  @ApiProperty({
    enum: ClaimType,
    nullable: true,
    example: ClaimType.STATISTIC,
    description: '주장 유형. 이 필드가 생기기 전에 검증된 결과는 null.',
  })
  claimType: ClaimType | null;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62' })
  speakerId: string;

  @ApiProperty({ enum: DebateSide, example: DebateSide.SIDE_A })
  speakerSide: DebateSide;

  @ApiProperty({
    example: '2025년 EU가 AI법을 시행했다',
    description: '검증한 명제(발언자·메타 표현을 뺀 문장)',
  })
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
      turnId: component.turnId,
      claimType: component.claimType,
      speakerId: component.speakerId,
      speakerSide: component.speakerSide,
      // 검증 명제가 없는 레거시 행은 논증 문장으로 대신한다.
      statement: component.factCheckStatement ?? component.statement,
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
