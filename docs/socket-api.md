# Socket API — 토론방(Debate)

socket.io 기반 토론방 실시간 이벤트 명세입니다. 커뮤니티 채팅·리액션·AI 판정 이벤트는 **미구현(후속)**입니다.

## 0. 전체 흐름

토론은 host가 REST로 상대에게 **요청**하고, 상대가 **수락**해야 시작됩니다.

1. host가 `POST /api/debates`로 토론을 요청한다 → 토론이 `PENDING` 상태로 생성된다.
2. 상대에게 소켓 이벤트 `debate_requested`가 전달된다.
3. 상대가 `PATCH /api/debates/:debateId/accept`로 수락한다 → 토론이 `STARTING` 상태로 전환된다.
   (거절 시 `PATCH /api/debates/:debateId/reject`, 토론 행이 soft delete된다. 같은 host가 같은 상대에게든 다른 상대에게든 재요청하면 새 행을 만들지 않고 이 거절된 행이 재사용된다.)
4. host에게 소켓 이벤트 `debate_request_accepted`(또는 `debate_request_rejected`)가 전달된다.
5. 양측이 `join_room`으로 입장하면(아래 3번) 첫 턴(`OPENING`, host 차례)이 시작된다.

`debate_requested` / `debate_request_accepted` / `debate_request_rejected`는 REST 처리 결과에 대한 알림이며, 수신 대상 회원에게만 전달됩니다(서버 내부적으로 연결 시 개인 알림용 room에 자동 join되어 있어 별도 구독 절차는 없습니다).

---

## 1. 연결 · 인증

- 네임스페이스: 기본(`/`)
- 인증: `handshake.auth.jwt_token`에 액세스 토큰을 담아 연결합니다.
  - 토큰이 없거나 유효하지 않으면 서버가 연결을 거부하고, 클라이언트는 `connect_error`를 받습니다.
  - 검증에 성공하면 이후 모든 이벤트에서 소켓의 사용자(memberId)가 고정됩니다(이벤트 payload에 memberId를 싣지 않습니다).

```js
const socket = io(SERVER_URL, {
  auth: { jwt_token: accessToken },
});
socket.on('connect_error', (err) => {
  // 인증 실패: err.message에 카탈로그 detail이 담겨 있지 않을 수 있음(소켓 미들웨어 단계)
});
```

---

## 2. 수신 이벤트 (클라이언트 → 서버)

### `join_room`

토론방(관전 포함) 입장. `roomId`는 **debateId**입니다.

```json
{ "roomId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60" }
```

- 토론자(host/opponent)면 참여로 기록됩니다. **양측 토론자가 모두 입장하고 토론 상태가 `STARTING`이면, 이 시점에 자동으로 `OPENING`(host 차례)으로 전환**되고 `debate_turn_changed`가 브로드캐스트됩니다.
- 토론자가 아니면 해당 토론이 속한 커뮤니티의 멤버인지만 확인합니다(관전).
- **수락 전(`PENDING`)에는 입장할 수 없습니다.** 토론자든 관전자든 `REQUEST_NOT_ACCEPTED` 에러를 받습니다. 먼저 상대가 REST로 수락해야 합니다(위 0번 흐름 참고).
- **성공 시 별도 응답 이벤트가 없습니다.** 실패하면 `error_from_debate_room`을 받습니다.

### `send_debate_message`

발언 메시지 전송.

```json
{ "roomId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60", "msg": "저는 찬성합니다." }
```

- 현재 발언 차례(`currentSpeakerId`)인 사람만 보낼 수 있습니다.
- `OPENING` / `FREETALKING` / `CLOSING` 단계에서만 가능합니다(그 외 단계는 `INVALID_PHASE`).
- 한 턴에 누적 **1000자**까지 발언할 수 있습니다(초과 시 `MESSAGE_BUDGET_EXCEEDED`, 정확히 1000자는 허용).
- 성공 시 방 전체(발신자 본인 포함)에 `receive_debate_message`가 브로드캐스트됩니다.

### `next_turn`

발언 차례를 명시적으로 다음으로 넘깁니다(예: 발언을 마쳤을 때).

```json
{ "roomId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60" }
```

- 현재 발언 차례인 사람만 호출할 수 있습니다(아니면 `NOT_YOUR_TURN`).
- 명시 호출이 없어도 턴 제한시간(3분, 아래 참고)이 지나면 서버가 자동으로 다음 턴으로 넘깁니다.

---

## 3. 발신 이벤트 (서버 → 클라이언트)

### `debate_turn_changed`

턴이 바뀔 때마다 방 전체에 브로드캐스트됩니다.

```json
{
  "roomId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60",
  "turn": "OPENING",
  "currentSpeakerId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61",
  "currentSpeakerNickname": "헤임달",
  "endsAt": 1755600000000
}
```

- `turn`: `DebateTurn` 단계 enum. `STARTING`(대기) → `OPENING`(입론, host→opponent) → `FREETALKING`(자유발언, host↔opponent를 커뮤니티 `debateRoundCount`회 반복) → `CLOSING`(최종발언, host→opponent) → `JUDGING`(판정) → `FINISHED`.
- `STARTING`(양측 join 전)과 `JUDGING`(발언자 없음, 타이머 없음) 단계에서는 `currentSpeakerId`/`currentSpeakerNickname`/`endsAt`이 모두 **null**입니다.
- `endsAt`: 해당 턴의 발언 제한시간 종료 시각(UTC epoch **ms**, `number`). 서버 기준 `Date.now() + DEBATE_TURN_SECONDS(기본 180)*1000`.
- `JUDGING` 진입 이후 AI 판정 연동은 **후속 작업**입니다(현재는 여기서 멈춥니다).

### `receive_debate_message`

발언 메시지가 저장되면 방 전체(발신자 포함)에 브로드캐스트됩니다.

```json
{
  "senderId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61",
  "senderNickname": "헤임달",
  "debateMessageId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62",
  "msg": "저는 찬성합니다."
}
```

- `debateMessageId`는 **uuid 문자열**입니다.

### `debate_requested` `debate_request_accepted` `debate_request_rejected` (프론트 합의 필요, 제안)

> 아래 3개 이벤트는 턴 상태머신과 무관한 REST 결과 알림이며, 프론트와 스펙 합의가 아직 되지 않은 **제안** 상태입니다. 확정 전까지 필드/이벤트명이 바뀔 수 있습니다.

토론 요청 생성/수락/거절 시 관련 당사자에게만 전달됩니다.

**`debate_requested`** — 상대(opponent)에게 전달. host가 `POST /api/debates`로 토론을 요청하면 발생합니다.

```json
{
  "debateId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60",
  "communityId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61",
  "hostId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62",
  "hostNickname": "헤임달"
}
```

**`debate_request_accepted`** — host에게 전달. 상대가 `PATCH /api/debates/:debateId/accept`로 수락하면 발생합니다.

```json
{
  "debateId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60",
  "opponentId": "3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61",
  "opponentNickname": "토르"
}
```

**`debate_request_rejected`** — host에게 전달. 상대가 `PATCH /api/debates/:debateId/reject`로 거절하면 발생합니다. payload 형태는 `debate_request_accepted`와 동일합니다.

### `error_from_debate_room`

`join_room` / `send_debate_message` / `next_turn` 처리 중 발생한 모든 오류(payload 검증 실패 포함)를 **해당 소켓에만** 전달합니다.

```json
{ "msg": "현재 발언할 차례가 아닙니다." }
```

- `msg`는 도메인 에러 카탈로그(`src/debates/exceptions/debate-error-code.ts`, 공통은 `src/common/exceptions/error-code.ts`)의 한국어 `detail` 문구입니다(REST의 `ProblemDetail.detail`과 동일 출처).

---

## 4. 에러 코드 (요약)

| 코드 | 상황 | 문구 |
|------|------|------|
| `DEBATE.NOT_FOUND` | 존재하지 않는(또는 삭제된) 토론 | 토론방을 찾을 수 없습니다. |
| `DEBATE.NOT_COMMUNITY_MEMBER` | 토론자가 아닌데 커뮤니티 멤버도 아님 | 해당 커뮤니티에 참여한 회원만 이용할 수 있습니다. |
| `DEBATE.INVALID_PHASE` | 발언 불가 단계(STARTING/JUDGING 등)에서 발언 시도 | 지금은 발언할 수 있는 단계가 아닙니다. |
| `DEBATE.NOT_YOUR_TURN` | 발언 차례가 아닌 사람이 발언/턴 넘기기 시도 | 현재 발언할 차례가 아닙니다. |
| `DEBATE.MESSAGE_BUDGET_EXCEEDED` | 턴 누적 1000자 초과 | 이번 턴에 발언할 수 있는 글자 수를 초과했습니다. |
| `DEBATE.REQUEST_NOT_ACCEPTED` | 수락 전(`PENDING`)인 토론에 `join_room` 시도 | 아직 수락되지 않은 토론입니다. |
| `COMMON.INVALID_INPUT` | payload class-validator 검증 실패 | 입력값이 올바르지 않습니다. |

토론 요청/수락/거절(REST) 관련 에러 코드(`DEBATE.NOT_HOST`, `DEBATE.OPPONENT_NOT_IN_COMMUNITY`, `DEBATE.OPPONENT_KEYNOTE_REQUIRED`, `DEBATE.DEBATE_ALREADY_ACTIVE`, `DEBATE.REQUEST_NOT_PENDING`, `DEBATE.NOT_REQUEST_OPPONENT`)는 REST 응답(`ProblemDetail`)으로 내려가며 이 문서(소켓 API) 범위 밖입니다. Swagger 문서를 참고하세요.

---

## 5. 구현 메모

- 서버 프로세스 1대를 전제로 참여자 join 여부·턴 타이머를 인메모리로 관리합니다. 스케일아웃 시 Redis adapter(및 상태 공유 스토어)로 교체가 필요합니다(`src/debates/room/debate-room.service.ts`, `src/debates/room/debate-timer.service.ts` 주석 참고).
- `DebateMessage.status = NORMAL` 등 조회 규칙은 [`docs/soft-delete.md`](./soft-delete.md)를 따릅니다.
- 커뮤니티 채팅, 메시지 리액션(좋아요), AI 판정(`JUDGING` 이후) 이벤트는 이 문서 범위 밖이며 **미구현(후속)**입니다.
