import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

// communities 도메인 에러 코드 카탈로그.
// 사용 예: throw new GeneralException(CommunityErrorCode.NOT_FOUND);
export const CommunityErrorCode = {
  NOT_FOUND: {
    httpStatus: HttpStatus.NOT_FOUND,
    code: 'COMMUNITY.NOT_FOUND',
    title: 'Community Not Found',
    detail: '커뮤니티를 찾을 수 없습니다.',
  },
  THEME_NOT_FOUND: {
    httpStatus: HttpStatus.NOT_FOUND,
    code: 'COMMUNITY.THEME_NOT_FOUND',
    title: 'Theme Not Found',
    detail: '존재하지 않는 카테고리입니다.',
  },
  DELETE_FORBIDDEN: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'COMMUNITY.DELETE_FORBIDDEN',
    title: 'Delete Forbidden',
    detail: '커뮤니티 삭제 권한이 없습니다.',
  },
  HOST_CANNOT_LEAVE: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'COMMUNITY.HOST_CANNOT_LEAVE',
    title: 'Host Cannot Leave',
    detail: '방장은 커뮤니티를 나갈 수 없습니다. 커뮤니티를 삭제해 주세요.',
  },
  PARTICIPANT_NOT_FOUND: {
    httpStatus: HttpStatus.NOT_FOUND,
    code: 'COMMUNITY.PARTICIPANT_NOT_FOUND',
    title: 'Participant Not Found',
    detail: '참여자를 찾을 수 없습니다.',
  },
} as const satisfies Record<string, AppError>;
