import { HttpStatus } from '@nestjs/common';
import { AppError } from './app-error.interface';
import { GeneralException } from './general.exception';

const templateError = (detail: string): AppError => ({
  httpStatus: HttpStatus.BAD_REQUEST,
  code: 'TEST.FORMAT',
  title: 'Test',
  detail,
});

describe('GeneralException', () => {
  it('additionalInfo를 인스턴스에 보관한다', () => {
    const additionalInfo = { email: 'must be an email' };
    const exception = new GeneralException(templateError('입력 오류'), {
      additionalInfo,
    });

    expect(exception.additionalInfo).toEqual(additionalInfo);
  });

  it('cause는 HttpException cause로만 두고 getResponse()에는 넣지 않는다', () => {
    const cause = new Error('db unique violation');
    const exception = new GeneralException(templateError('중복'), { cause });

    expect(exception.cause).toBe(cause);
    expect(exception.getResponse()).toEqual({
      errorCode: 'TEST.FORMAT',
      detail: '중복',
    });
    expect(exception.getResponse()).not.toHaveProperty('cause');
    expect(exception.getResponse()).not.toHaveProperty('additionalInfo');
  });
});
