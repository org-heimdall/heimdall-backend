import { wsEvent } from './ws-event';

describe('wsEvent', () => {
  it('데이터를 payload로 감싸지 않고 최상위에 펼친다', () => {
    const event = wsEvent('community.message.ack', {
      communityId: 'community-uuid',
      commandId: 'command-uuid',
      status: 'STORED',
    });

    expect(event).toEqual({
      id: expect.any(String) as string,
      type: 'community.message.ack',
      communityId: 'community-uuid',
      commandId: 'command-uuid',
      status: 'STORED',
    });
    expect(event).not.toHaveProperty('payload');
  });

  it('identity가 같으면 몇 번을 만들어도 같은 id다(재접속 replay 중복 제거)', () => {
    const live = wsEvent('message.created', { message: { seq: 1 } }, [
      'message-uuid',
    ]);
    const replayed = wsEvent('message.created', { message: { seq: 1 } }, [
      'message-uuid',
    ]);

    expect(replayed.id).toBe(live.id);
  });

  it('identity가 다르면 다른 id다', () => {
    const first = wsEvent('message.created', {}, ['message-1']);
    const second = wsEvent('message.created', {}, ['message-2']);

    expect(second.id).not.toBe(first.id);
  });

  it('identity가 같아도 type이 다르면 다른 id다', () => {
    const requested = wsEvent('debate.requested', {}, ['invitation-uuid']);
    const expired = wsEvent('debate.request.expired', {}, ['invitation-uuid']);

    expect(expired.id).not.toBe(requested.id);
  });

  it('identity를 생략하면 매번 새 id다(토글성 이벤트가 중복으로 버려지지 않게)', () => {
    const first = wsEvent('community.member.debate-intent.changed', {});
    const second = wsEvent('community.member.debate-intent.changed', {});

    expect(second.id).not.toBe(first.id);
  });

  it('id는 UUID 문자열이다', () => {
    const derived = wsEvent('message.created', {}, ['message-uuid']);
    const random = wsEvent('connection.restored', {});

    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(derived.id).toMatch(uuid);
    expect(random.id).toMatch(uuid);
  });
});
