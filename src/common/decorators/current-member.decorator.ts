import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

export const CURRENT_MEMBER_HEADER = 'x-member-id';

// X-Member-Id 헤더에서 현재 회원 id를 추출한다. 헤더가 없거나 UUID가 아니면 401.
export const CurrentMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const memberId = request.headers[CURRENT_MEMBER_HEADER];

    if (typeof memberId !== 'string' || !isUUID(memberId)) {
      throw new UnauthorizedException('유효한 X-Member-Id 헤더가 필요합니다.');
    }

    return memberId;
  },
);
