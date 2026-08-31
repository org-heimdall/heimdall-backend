import { DebateTurn } from '../entities/debate.entity';

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

// DebateRoomService/DebatesService가 브로드캐스트 수단을 모르게 하기 위한 경계.
// 게이트웨이가 이 인터페이스를 구현해 afterInit에서 자신을 등록한다(서비스→게이트웨이 순환 DI 회피).
export interface DebateEventsPublisher {
  // roomName: server.to()에 넘길 내부 room 이름('debate:'+id). payload.debateId와는 별개다.
  emitTurnChanged(roomName: string, payload: TurnChangedPayload): void;

  // 아래 3개는 개인 룸('member:'+memberId)으로 보낸다. 인자의 memberId가 수신 대상이다.
  emitDebateRequested(
    opponentId: string,
    payload: DebateRequestedPayload,
  ): void;
  emitDebateRequestAccepted(
    hostId: string,
    payload: DebateRequestRespondedPayload,
  ): void;
  emitDebateRequestRejected(
    hostId: string,
    payload: DebateRequestRespondedPayload,
  ): void;
}
