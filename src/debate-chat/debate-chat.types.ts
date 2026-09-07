// 계약(frontend-api-contract.md) 열거형·이벤트·payload와 1:1. 값을 바꾸면 프론트 mapper가 깨진다.

// 턴 모양(phase/side/turn)은 debate_message를 소유한 debates 도메인에 있고, 채팅은 그대로 쓴다.
// REST(Debate DTO)와 채팅이 같은 정의를 쓰게 하는 것이 목적이다.
import {
  DebateChatTurn,
  DebatePhase,
  DebateSide,
  DraftMessage,
} from '../debates/debate-turn';

export { DebatePhase, DebateSide };
export type { DebateChatTurn, DraftMessage };

// 토론 진행 단계는 debate 행의 컬럼이므로 소유 도메인(debates)에 두고 여기서는 그대로 쓴다.
// 채팅이 전이시키는 구간은 READY → IN_PROGRESS → DEBATE_FINALIZED(전원 발언) 또는 FAILED(시간 초과)이며,
// JUDGING 이후는 처리 파이프라인(Phase 3) 담당이다.
import { DebateStatus } from '../debates/entities/debate-status.enum';

export { DebateStatus };

// 토론이 끝난 이유. 시간 초과는 토론이 아니라 차례만 넘기므로(P2-4) 여기에 들어가지 않는다.
export enum DebateEndReason {
  ALL_TURNS_FINALIZED = 'ALL_TURNS_FINALIZED',
  // 발언자가 POST /debates/:id/forfeit으로 기권했다(R-3). 상태는 FAILED, 승자는 상대다.
  FORFEIT = 'FORFEIT',
}

export enum DebateProcessingStage {
  ANALYZER = 'ANALYZER',
  FACT_CHECK = 'FACT_CHECK',
  JUDGE = 'JUDGE',
}

export enum DebateProcessingStageStatus {
  STARTED = 'STARTED',
  RETRYING = 'RETRYING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// 클라이언트 → 서버 명령 이름. 두 send 이름은 계약상 동의어.
export const DebateChatCommand = {
  TURN_SEND: 'debate.turn.send',
  TURN_MESSAGE_SEND: 'debate.turn.message.send',
  TURN_FINALIZE: 'debate.turn.finalize',
} as const;

// 서버 → 클라이언트 이벤트 이름.
export const DebateChatEvent = {
  CONNECTION_RESTORED: 'connection.restored',
  TURN_MESSAGE_ACK: 'debate.turn.message.ack',
  TURN_MESSAGE_CREATED: 'debate.turn.message.created',
  TURN_FINALIZED: 'debate.turn.finalized',
  PROCESSING_STAGE: 'debate.processing.stage',
  DEBATE_ENDED: 'debate.ended',
  ERROR: 'error',
} as const;

export interface WsServerEvent<TPayload = unknown> {
  type: string;
  payload: TPayload;
}

export interface CurrentTurn {
  phase: DebatePhase;
  round: number;
  turnSide: DebateSide;
  startedAt: string;
  maxDurationSeconds: number;
  maxTotalCharacters: number;
}

export interface DebateChatSnapshot {
  currentTurn: CurrentTurn | null;
  turns: DebateChatTurn[];
  draftMessages: DraftMessage[];
}

export interface ConnectionRestoredPayload extends DebateChatSnapshot {
  debateId: string;
}

export type DraftAppendStatus = 'APPENDED' | 'DUPLICATE';

export interface TurnMessageAckPayload {
  debateId: string;
  commandId: string;
  clientMessageId?: string;
  status: DraftAppendStatus;
  message: DraftMessage;
}

export interface TurnMessageCreatedPayload {
  debateId: string;
  message: DraftMessage;
}

export interface TurnFinalizedPayload {
  debateId: string;
  turn: DebateChatTurn;
}

export interface ProcessingStagePayload {
  debateId: string;
  stage: DebateProcessingStage;
  status: DebateProcessingStageStatus;
  attempt: number;
  message: string;
  occurredAt: string;
}

export interface DebateEndedPayload {
  communityId: string;
  debateId: string;
  status: DebateStatus;
  reason: DebateEndReason;
}

export interface DebateChatErrorPayload {
  debateId?: string;
  commandId?: string;
  code: string;
  message: string;
}
