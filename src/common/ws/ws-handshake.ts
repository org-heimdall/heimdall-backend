import { isUUID } from 'class-validator';
import { IncomingMessage } from 'node:http';
import { AuthErrorCode } from '../../auth/exceptions/auth-error-code';
import { ErrorCode } from '../exceptions/error-code';
import { GeneralException } from '../exceptions/general.exception';

// 계약: handshake의 Authorization: Bearer <accessToken> 헤더. 토큰 검증은 호출자(TokenService)가 한다.
export function parseBearerToken(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header) {
    throw new GeneralException(AuthErrorCode.UNAUTHORIZED);
  }
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new GeneralException(AuthErrorCode.INVALID_TOKEN);
  }
  return token;
}

// 접속 URL에서 방 식별자(UUID)를 꺼낸다. 패턴은 게이트웨이가 자기 계약 경로로 준다.
export function parseRoomId(url: string | undefined, pattern: RegExp): string {
  const pathname = new URL(url ?? '/', 'ws://placeholder').pathname;
  const matched = pattern.exec(pathname);
  if (!matched) {
    throw new GeneralException(ErrorCode.NOT_FOUND);
  }
  const roomId = decodeURIComponent(matched[1]);
  if (!isUUID(roomId)) {
    throw new GeneralException(ErrorCode.INVALID_INPUT);
  }
  return roomId;
}
