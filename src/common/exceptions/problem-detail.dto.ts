import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppError } from './app-error.interface';
import { GeneralException } from './general.exception';

export class ProblemDetail {
  @ApiProperty({ description: '오류 제목', example: 'Not Your Turn' })
  title: string;

  @ApiProperty({ description: 'HTTP 상태 코드', example: 409 })
  status: number;

  @ApiProperty({
    description: '오류 상세 설명',
    example: '나의 발언 턴이 아닙니다.',
  })
  detail: string;

  @ApiProperty({
    description: '오류가 발생한 URI',
    example: '/debates/12/messages',
  })
  instance: string;

  @ApiProperty({
    description: '클라이언트 분기용 오류 코드',
    example: 'DEBATE.NOT_YOUR_TURN',
  })
  errorCode: string;

  @ApiPropertyOptional({ description: '부가 정보 (검증 오류 필드 등)' })
  additionalInfo?: Record<string, string>;

  // AppError 기반으로 오류 응답 생성
  static of(
    error: AppError,
    detail: string,
    instance: string,
    additionalInfo?: Record<string, string>,
  ): ProblemDetail {
    const problem = new ProblemDetail();
    problem.title = error.title;
    problem.status = error.httpStatus;
    problem.detail = detail;
    problem.instance = instance;
    problem.errorCode = error.code;
    if (additionalInfo) problem.additionalInfo = additionalInfo;
    return problem;
  }

  // GeneralException으로부터 오류 응답 생성
  static from(exception: GeneralException, instance: string): ProblemDetail {
    return ProblemDetail.of(
      exception.appError,
      exception.detail,
      instance,
      exception.additionalInfo,
    );
  }
}
