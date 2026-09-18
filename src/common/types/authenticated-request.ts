import { Request } from 'express';

/**
 * 인증 가드가 request.user에 채워 넣는 값.
 * 토큰 페이로드를 그대로 노출하지 않고 애플리케이션이 쓰는 형태만 담는다.
 */
export interface AuthenticatedMember {
  memberId: string;
}

/**
 * 옵셔널 전역 가드를 쓰므로 user는 없을 수 있다(비인증 요청).
 * 인증 강제는 @CurrentMember()가 담당한다.
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedMember;
}
