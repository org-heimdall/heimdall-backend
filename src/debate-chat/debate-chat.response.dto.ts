import { ApiProperty } from '@nestjs/swagger';
import { DebateTurnDto, DraftMessageDto } from '../debates/dto/debate-turn.dto';
import { DebatePhase, DebateSide } from './debate-chat.types';
// 데코레이터가 붙은 프로퍼티의 타입은 isolatedModules + emitDecoratorMetadata 조합에서
// 반드시 type-only로 가져와야 한다.
import type { DraftAppendResult } from './debate-chat-state';
import type {
  ConnectionRestoredPayload,
  CurrentTurn,
  DraftAppendStatus,
} from './debate-chat.types';

// HTTP snapshot API의 응답 문서. 계약 타입을 implements해 문서와 실제 응답이 어긋나지 않게 한다.
// 발언(draft·확정 턴)의 모양은 debates 도메인의 DTO를 그대로 쓴다(REST 조회와 같은 문서).
export { DebateTurnDto, DraftMessageDto };

export class CurrentTurnDto implements CurrentTurn {
  @ApiProperty({ enum: DebatePhase, example: DebatePhase.OPENING })
  phase: DebatePhase;

  @ApiProperty({ example: 1 })
  round: number;

  @ApiProperty({ enum: DebateSide, example: DebateSide.SIDE_A })
  turnSide: DebateSide;

  @ApiProperty({
    example: '2026-09-06T12:00:00.000Z',
    description:
      '이 차례가 시작된 시각. 여기서 maxDurationSeconds가 지나면 토론이 종료된다.',
  })
  startedAt: string;

  @ApiProperty({ example: 180 })
  maxDurationSeconds: number;

  @ApiProperty({ example: 1500 })
  maxTotalCharacters: number;
}

export class DebateChatSnapshotDto implements ConnectionRestoredPayload {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61' })
  debateId: string;

  @ApiProperty({
    type: CurrentTurnDto,
    nullable: true,
    description: '현재 발언 차례. 토론이 끝났으면 null.',
  })
  currentTurn: CurrentTurnDto | null;

  @ApiProperty({ type: [DebateTurnDto] })
  turns: DebateTurnDto[];

  @ApiProperty({
    type: [DraftMessageDto],
    description: '현재 차례에서 아직 확정되지 않은 메시지',
  })
  draftMessages: DraftMessageDto[];
}

export class DebateTurnMessageAppendResultDto implements DraftAppendResult {
  @ApiProperty({
    enum: ['APPENDED', 'DUPLICATE'],
    example: 'APPENDED',
    description: '같은 clientMessageId를 다시 보내면 저장 없이 DUPLICATE.',
  })
  status: DraftAppendStatus;

  @ApiProperty({ type: DraftMessageDto })
  message: DraftMessageDto;
}
