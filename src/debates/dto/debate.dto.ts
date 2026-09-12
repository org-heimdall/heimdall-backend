import { ApiProperty } from '@nestjs/swagger';
import { MemberCommunity } from '../../member-communities/entities/member-community.entity';
import { Member } from '../../members/entities/member.entity';
import {
  DebatePhase,
  DebateSide,
  DebateTurnSchedule,
  deriveCurrentTurn,
  resolveSide,
  resolveSpeakers,
} from '../debate-turn';
import { DebateStatus } from '../entities/debate-status.enum';
import { Debate } from '../entities/debate.entity';
import type { DebateSpeakers } from '../debate-turn';
import { DebateTurnWithVotesDto } from './debate-turn.dto';

/**
 * 토론의 진행 정도. 현재 차례(phase/round/side)는 저장하지 않고 확정 턴에서 파생하므로(P2-8),
 * DTO를 만들려면 확정 턴 수와 마지막 턴의 시각이 필요하다.
 */
export interface DebateProgress {
  finalizedTurnCount: number;
  lastTurnCreatedAt: Date | null;
}

export const NO_PROGRESS: DebateProgress = {
  finalizedTurnCount: 0,
  lastTurnCreatedAt: null,
};

export class DebateDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61' })
  communityId: string;

  @ApiProperty({ example: 'AI 규제, 필요한가?' })
  topic: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62' })
  sideASpeakerId: string;

  @ApiProperty({
    example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f63',
    nullable: true,
    description: '상대가 아직 정해지지 않은 토론에서만 null이다.',
  })
  sideBSpeakerId: string | null;

  @ApiProperty({ example: 3, description: '반론·질의 라운드 수' })
  rebuttalQuestionRounds: number;

  @ApiProperty({ enum: DebateStatus, example: DebateStatus.IN_PROGRESS })
  status: DebateStatus;

  @ApiProperty({
    enum: DebatePhase,
    nullable: true,
    description: '현재 차례. 진행 중이 아니거나 모든 차례가 끝났으면 null.',
  })
  currentPhase: DebatePhase | null;

  @ApiProperty({ example: 1, nullable: true })
  currentRound: number | null;

  @ApiProperty({ enum: DebateSide, nullable: true })
  currentTurnSide: DebateSide | null;

  @ApiProperty({ example: '2026-09-07T12:00:00.000Z', nullable: true })
  currentTurnStartedAt: string | null;

  @ApiProperty({ example: '2026-09-07T11:59:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-09-07T12:00:00.000Z', nullable: true })
  startedAt: string | null;

  @ApiProperty({ example: null, nullable: true })
  endedAt: string | null;

  @ApiProperty({
    example: '2026-09-07T12:12:30.000Z',
    nullable: true,
    description: '판정이 시작된 시각. Judge 작업이 만들어질 때 기록된다.',
  })
  judgingStartedAt: string | null;

  @ApiProperty({
    example: '2026-09-07T12:12:00.000Z',
    nullable: true,
    description: '토론 전체가 늦어도 끝나는 시각. 시작할 때 기록된다.',
  })
  expiresAt: string | null;

  static from(debate: Debate, progress: DebateProgress): DebateDto {
    const status = debate.debateStatus ?? DebateStatus.READY;
    const current = deriveCurrentTurn({
      debateStatus: status,
      schedule: new DebateTurnSchedule(debate.rebuttalQuestionRounds),
      finalizedTurnCount: progress.finalizedTurnCount,
      lastTurnCreatedAt: progress.lastTurnCreatedAt,
      startedAt: debate.startedAt,
    });

    return Object.assign(new DebateDto(), {
      id: debate.id,
      communityId: debate.communityId,
      topic: debate.topic,
      // 컬럼 이름은 host/opponent 그대로 두고 계약 이름으로만 바꿔 내보낸다(D3).
      sideASpeakerId: debate.hostId,
      sideBSpeakerId: debate.opponentId,
      rebuttalQuestionRounds: debate.rebuttalQuestionRounds,
      status,
      currentPhase: current?.slot.phase ?? null,
      currentRound: current?.slot.round ?? null,
      currentTurnSide: current?.slot.side ?? null,
      currentTurnStartedAt: current?.startedAt?.toISOString() ?? null,
      createdAt: debate.createdAt.toISOString(),
      startedAt: debate.startedAt?.toISOString() ?? null,
      endedAt: debate.endedAt?.toISOString() ?? null,
      judgingStartedAt: debate.judgingStartedAt?.toISOString() ?? null,
      expiresAt: debate.expiresAt?.toISOString() ?? null,
    });
  }
}

export class DebateSpeakerDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62' })
  id: string;

  @ApiProperty({ example: '메시' })
  displayName: string;

  @ApiProperty({ example: 'https://cdn.example.com/1.png', nullable: true })
  profileImageUrl: string | null;

  @ApiProperty({ example: 0, description: '회원이 영구적으로 갖는 점수(R-5)' })
  score: number;

  @ApiProperty({
    example: 'AI 규제는 필요하다',
    description: '커뮤니티 기조 발언. 작성하지 않았으면 빈 문자열.',
  })
  claim: string;

  @ApiProperty({ example: ['안전', '신뢰'] })
  reasons: string[];

  // 회원 정보 + 그 커뮤니티에서의 기조 발언(member_community)을 합친다.
  static from(
    member: Member,
    keynote: MemberCommunity | null,
  ): DebateSpeakerDto {
    return Object.assign(new DebateSpeakerDto(), {
      id: member.id,
      displayName: member.nickname,
      profileImageUrl: member.profileImageUrl,
      score: member.rating,
      claim: keynote?.opinion ?? '',
      reasons: keynote?.reasons ?? [],
    });
  }
}

export interface DebateDetailSources {
  speakers: Record<DebateSide, DebateSpeakerDto>;
  viewerId: string;
  turns: DebateTurnWithVotesDto[];
}

export class DebateDetailDto extends DebateDto {
  @ApiProperty({ type: DebateSpeakerDto })
  sideASpeaker: DebateSpeakerDto;

  @ApiProperty({ type: DebateSpeakerDto })
  sideBSpeaker: DebateSpeakerDto;

  @ApiProperty({
    enum: DebateSide,
    nullable: true,
    description: '요청한 회원의 편. 관전자는 null.',
  })
  viewerSide: DebateSide | null;

  @ApiProperty({ type: [DebateTurnWithVotesDto] })
  turns: DebateTurnWithVotesDto[];

  static fromDetail(
    debate: Debate,
    progress: DebateProgress,
    sources: DebateDetailSources,
  ): DebateDetailDto {
    const speakers: DebateSpeakers | null = resolveSpeakers(debate);

    return Object.assign(
      new DebateDetailDto(),
      DebateDto.from(debate, progress),
      {
        sideASpeaker: sources.speakers[DebateSide.SIDE_A],
        sideBSpeaker: sources.speakers[DebateSide.SIDE_B],
        viewerSide: resolveSide(speakers, sources.viewerId),
        turns: sources.turns,
      },
    );
  }
}
