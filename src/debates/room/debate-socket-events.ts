import { Server, Socket } from 'socket.io';
import { DebateTurn } from '../entities/debate.entity';
import {
  JoinDebateDto,
  NextTurnDto,
  SendDebateMessageDto,
} from './dto/debate-socket.dto';

// 턴 전환 시 소켓으로 나가는 payload.
export interface TurnChangedPayload {
  debateId: string;
  turn: DebateTurn;
  currentSpeakerId: string | null;
  currentSpeakerNickname: string | null;
  endsAt: number | null;
}

// 토론 요청(REST POST /api/debates) 발생 시 상대에게 보내는 payload.
export interface DebateRequestedPayload {
  debateId: string;
  communityId: string;
  hostId: string;
  hostNickname: string;
}

// 토론 요청 수락/거절(REST PATCH) 시 host에게 보내는 payload.
export interface DebateRequestRespondedPayload {
  debateId: string;
  opponentId: string;
  opponentNickname: string;
}

// 발언 메시지 저장 성공 시 방 전체로 나가는 payload.
export interface ReceiveDebateMessagePayload {
  senderId: string;
  senderNickname: string;
  debateMessageId: string;
  msg: string;
}

// 토론방 소켓 처리 중 발생한 오류를 해당 소켓에만 알리는 payload.
export interface ErrorFromDebateRoomPayload {
  msg: string;
}

// 서버 → 클라이언트로 나가는 이벤트 계약
export interface DebateServerToClientEvents {
  debate_turn_changed: (payload: TurnChangedPayload) => void;
  receive_debate_message: (payload: ReceiveDebateMessagePayload) => void;
  debate_requested: (payload: DebateRequestedPayload) => void;
  debate_request_accepted: (payload: DebateRequestRespondedPayload) => void;
  debate_request_rejected: (payload: DebateRequestRespondedPayload) => void;
  error_from_debate_room: (payload: ErrorFromDebateRoomPayload) => void;
}

// 클라이언트 → 서버 이벤트 계약. 런타임 검증은 게이트웨이의 class-validator DTO가 담당하고,
// 이 맵은 계약 명세와 타입 체크용이다.
export interface DebateClientToServerEvents {
  join_debate: (dto: JoinDebateDto) => void;
  send_debate_message: (dto: SendDebateMessageDto) => void;
  next_turn: (dto: NextTurnDto) => void;
}

// 토론방 소켓 인스턴스 타입(핸들러/헬퍼 파라미터용)
export type DebateSocket = Socket<
  DebateClientToServerEvents,
  DebateServerToClientEvents
>;

// 토론방 소켓 서버 타입(@WebSocketServer()용)
export type DebateSocketServer = Server<
  DebateClientToServerEvents,
  DebateServerToClientEvents
>;
