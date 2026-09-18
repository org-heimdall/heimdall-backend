// 게이트웨이 데코레이터는 import 시점에 평가되어 ConfigService를 쓸 수 없으므로 포트만 process.env로 읽는다.
// (main.ts가 dotenv를 먼저 로드한다.) 형식 검증은 app.module의 Joi 스키마가 한다.
// 계약상 채팅 WS는 단일 포트 하나뿐이라 환경변수 이름(DEBATE_CHAT_WS_PORT)은 그대로 둔다.
export const CHAT_WS_PORT = Number(process.env.DEBATE_CHAT_WS_PORT ?? 8080);

// 같은 포트에서 게이트웨이를 가르는 경로 접두사. CommandEnvelopeWsAdapter가 접두사로 매칭한다.
// 계약 경로: /debates/:debateId/chat, /communities/:communityId/chat
export const DEBATE_CHAT_WS_PATH = '/debates';
export const COMMUNITY_CHAT_WS_PATH = '/communities';
