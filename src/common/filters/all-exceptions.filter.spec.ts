import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ErrorCode } from '../exceptions/error-code';
import { GeneralException } from '../exceptions/general.exception';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  const createHost = (url = '/members') => {
    const json = jest.fn<void, [Record<string, unknown>]>();
    const type = jest.fn().mockReturnValue({ json });
    const status = jest.fn().mockReturnValue({ type });
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: url, url }),
        getResponse: () => ({ status }),
      }),
    } as ArgumentsHost;

    return { host, status, type, json };
  };

  it('GeneralException의 additionalInfo를 ProblemDetail로 전달한다', () => {
    const { host, status, type, json } = createHost('/api/members');
    const additionalInfo = { email: 'must be an email' };
    const exception = new GeneralException(ErrorCode.INVALID_INPUT, {
      additionalInfo,
    });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(type).toHaveBeenCalledWith('application/problem+json');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: ErrorCode.INVALID_INPUT.code,
        detail: ErrorCode.INVALID_INPUT.detail,
        instance: '/api/members',
        additionalInfo,
      }),
    );
  });

  it('cause는 응답 JSON에 노출되지 않는다', () => {
    const { host, json } = createHost();
    const cause = new Error('internal driver detail');
    const exception = new GeneralException(ErrorCode.INVALID_INPUT, {
      additionalInfo: { field: 'bad' },
      cause,
    });

    filter.catch(exception, host);

    const body = json.mock.calls[0][0];
    expect(body).toHaveProperty('additionalInfo', { field: 'bad' });
    expect(body).not.toHaveProperty('cause');
    expect(JSON.stringify(body)).not.toContain('internal driver detail');
  });
});
