import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { AppError } from './app-error.interface';
import { ProblemDetail } from './problem-detail.dto';

// 카탈로그 항목으로부터 Swagger 에러 응답 문서를 생성한다.
// OpenAPI는 status당 응답이 하나뿐이므로 같은 status의 에러들은 하나로 묶는다.
export function ApiErrorResponses(...errors: AppError[]) {
  const byStatus = new Map<number, AppError[]>();
  for (const error of errors) {
    byStatus.set(error.httpStatus, [
      ...(byStatus.get(error.httpStatus) ?? []),
      error,
    ]);
  }

  return applyDecorators(
    ...[...byStatus.entries()].map(([status, group]) =>
      ApiResponse({
        status,
        description: group.map((e) => `${e.detail} (${e.code})`).join(' | '),
        type: ProblemDetail,
      }),
    ),
  );
}
