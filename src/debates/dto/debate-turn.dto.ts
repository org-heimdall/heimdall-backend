import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DebatePhase, DebateSide } from '../debate-turn';
// 데코레이터가 붙은 프로퍼티의 타입은 isolatedModules + emitDecoratorMetadata 조합에서
// 반드시 type-only로 가져와야 한다.
import type { DebateChatTurn, DraftMessage } from '../debate-turn';

// 계약의 발언 모양. 채팅(HTTP snapshot·WS)과 REST 조회가 같은 문서를 쓴다.

export class DraftMessageDto implements DraftMessage {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61' })
  debateId: string;

  @ApiPropertyOptional({ example: 'c-1' })
  clientMessageId?: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62' })
  speakerId: string;

  @ApiProperty({ enum: DebateSide, example: DebateSide.SIDE_A })
  speakerSide: DebateSide;

  @ApiProperty({ enum: DebatePhase, example: DebatePhase.OPENING })
  phase: DebatePhase;

  @ApiProperty({ example: 1 })
  round: number;

  @ApiProperty({ example: '저는 이 주제에 찬성합니다.' })
  content: string;

  @ApiProperty({ example: '2026-09-06T12:00:00.000Z' })
  createdAt: string;
}

export class DebateTurnDto extends DraftMessageDto implements DebateChatTurn {
  @ApiProperty({ example: 1, description: '토론 안에서의 확정 순서(1부터)' })
  sequence: number;
}

// 확정 턴 + 관전자 투표 집계(계약 DebateTurnWithVotes).
export class DebateTurnWithVotesDto extends DebateTurnDto {
  @ApiProperty({ example: 3 })
  likeCount: number;

  @ApiProperty({ example: 1 })
  dislikeCount: number;

  static from(turn: DebateChatTurn, votes: VoteCount): DebateTurnWithVotesDto {
    return Object.assign(new DebateTurnWithVotesDto(), turn, {
      likeCount: votes.likeCount,
      dislikeCount: votes.dislikeCount,
    });
  }
}

export interface VoteCount {
  likeCount: number;
  dislikeCount: number;
}

export const NO_VOTES: VoteCount = { likeCount: 0, dislikeCount: 0 };
