// 계약(frontend-api-contract.md) 열거형·이벤트·payload와 1:1. 값을 바꾸면 프론트 mapper가 깨진다.

export enum DebatePhase {
  OPENING = 'OPENING',
  REBUTTAL_QUESTION = 'REBUTTAL_QUESTION',
  CLOSING = 'CLOSING',
}

export enum DebateSide {
  SIDE_A = 'SIDE_A',
  SIDE_B = 'SIDE_B',
}

// 계약 DebateStatus 중 채팅이 전이시키는 구간. JUDGING 이후는 처리 파이프라인(Phase 3) 담당.
export enum DebateChatStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  DEBATE_FINALIZED = 'DEBATE_FINALIZED',
}

export enum DebateEndReason {
  ALL_TURNS_FINALIZED = 'ALL_TURNS_FINALIZED',
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

export interface DraftMessage {
  id: string;
  debateId: string;
  clientMessageId?: string;
  speakerId: string;
  speakerSide: DebateSide;
  phase: DebatePhase;
  round: number;
  content: string;
  createdAt: string;
}

export interface DebateChatTurn extends DraftMessage {
  sequence: number;
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
  status: DebateChatStatus;
  reason: DebateEndReason;
}

export interface DebateChatErrorPayload {
  debateId?: string;
  commandId?: string;
  code: string;
  message: string;
}
