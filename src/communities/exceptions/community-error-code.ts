import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

// communities 도메인 에러 코드 카탈로그.
// 사용 예: throw new GeneralException(CommunityErrorCode.DELETE_FORBIDDEN);
export const CommunityErrorCode = {
  DELETE_FORBIDDEN: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'COMMUNITY.DELETE_FORBIDDEN',
    title: 'Community Delete Forbidden',
    detail: '커뮤니티 삭제 권한이 없습니다.',
  },
} as const satisfies Record<string, AppError>;
