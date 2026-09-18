import { HttpStatus } from '@nestjs/common';

export interface AppError {
  readonly httpStatus: HttpStatus;
  readonly code: string; // 오류 코드 (클라이언트 분기용)
  readonly title: string; // 오류 제목
  readonly detail: string; // 오류 상세 설명
}
