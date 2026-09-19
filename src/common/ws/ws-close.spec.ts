import { IncomingMessage } from 'node:http';
import {
  ClosableSocket,
  describeClose,
  describePeer,
  describeUptime,
  openSession,
} from './ws-close';

// 소켓 자체는 필요 없고 어댑터가 채우는 closeInfo만 읽으므로 그 부분만 세운다.
function socket(closeInfo?: ClosableSocket['closeInfo']): ClosableSocket {
  return { closeInfo } as ClosableSocket;
}

describe('describeClose', () => {
  it('아는 코드는 원인 꼬리표를 붙인다', () => {
    expect(describeClose(socket({ code: 1001, reason: '' }))).toBe(
      'code=1001(떠남(백그라운드 전환·화면 이탈))',
    );
  });

  it('클라이언트가 스스로 닫은 것과 네트워크가 끊은 것이 구분된다', () => {
    expect(describeClose(socket({ code: 1000, reason: '' }))).toContain('1000');
    expect(describeClose(socket({ code: 1006, reason: '' }))).toContain(
      'close 프레임 없이 끊김',
    );
  });

  it('reason이 있으면 함께 남긴다(서버가 거절한 경우 에러 코드가 들어온다)', () => {
    expect(describeClose(socket({ code: 1008, reason: 'UNAUTHORIZED' }))).toBe(
      'code=1008(정책 위반(서버가 거절)), reason=UNAUTHORIZED',
    );
  });

  it('모르는 코드는 숫자만 남긴다', () => {
    expect(describeClose(socket({ code: 4000, reason: '' }))).toBe('code=4000');
  });

  it('close 이벤트 없이 정리된 소켓도 로그를 만들 수 있다', () => {
    expect(describeClose(socket())).toBe('code=?');
  });
});

// handshake 요청 중 openSession이 읽는 TCP 정보만 세운다.
function request(remoteAddress?: string, remotePort?: number): IncomingMessage {
  return { socket: { remoteAddress, remotePort } } as IncomingMessage;
}

describe('openSession', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('기기(주소·포트)를 접속·종료 로그에 남길 수 있게 한다', () => {
    const client = socket();
    openSession(client, request('10.0.2.2', 39112));

    expect(describePeer(client)).toBe('peer=10.0.2.2:39112');
  });

  it('연결이 살아 있던 시간을 초 단위로 남긴다', () => {
    const client = socket();
    openSession(client, request('10.0.2.2', 39112));

    jest.advanceTimersByTime(20_100);
    expect(describeUptime(client)).toBe('유지=20.1s');
  });

  it('주소를 알 수 없어도 로그를 만들 수 있다', () => {
    const client = socket();
    openSession(client, request());

    expect(describePeer(client)).toBe('peer=?:?');
  });

  it('handshake 전에 끊긴 소켓도 로그를 만들 수 있다', () => {
    expect(describePeer(socket())).toBe('peer=?');
    expect(describeUptime(socket())).toBe('유지=?');
  });
});
