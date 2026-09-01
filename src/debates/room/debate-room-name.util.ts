// socket.io room 이름 규칙(debateId → 'debate:'+id)의 단일 출처.
// 게이트웨이와 서비스가 각자 문자열을 조립하면 규칙이 갈라질 수 있어 여기로 모은다.
export function debateRoomName(debateId: string): string {
  return `debate:${debateId}`;
}

// 개인 알림용 socket.io room 이름 규칙(memberId → 'member:'+id)의 단일 출처.
// REST 요청(토론 요청/수락/거절) 발생 시 특정 회원에게만 이벤트를 보내기 위해 쓴다.
export function memberRoomName(memberId: string): string {
  return `member:${memberId}`;
}
