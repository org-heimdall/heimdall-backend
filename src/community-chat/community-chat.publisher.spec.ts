import { CommunityMessageDto } from '../communities/dto/community-message.dto';
import { CommunityOpinionDto } from '../communities/dto/community-opinion.dto';
import { CommunityChatMessageType } from '../communities/entities/community-message.entity';
import { CommunityChatPublisher } from './community-chat.publisher';
import { CommunityChatEvent } from './community-chat.types';

describe('CommunityChatPublisher', () => {
  let publisher: CommunityChatPublisher;

  const buildMessage = (
    overrides: Partial<CommunityMessageDto> = {},
  ): CommunityMessageDto => ({
    id: 'message-uuid',
    communityId: 'community-uuid',
    clientMessageId: 'client-uuid',
    authorId: 'member-uuid',
    authorName: '헤임달',
    text: '안녕하세요',
    messageType: CommunityChatMessageType.TEXT,
    debateId: null,
    createdAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  });

  const buildOpinion = (
    overrides: Partial<CommunityOpinionDto> = {},
  ): CommunityOpinionDto => ({
    id: 'opinion-uuid',
    communityId: 'community-uuid',
    authorId: 'member-uuid',
    authorName: '헤임달',
    claim: '찬성',
    reasons: ['이유1'],
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    publisher = new CommunityChatPublisher();
  });

  describe('messageCreatedEvent', () => {
    it('계약대로 데이터를 최상위에 펼친 이벤트를 만든다', () => {
      const message = buildMessage();

      expect(publisher.messageCreatedEvent('community-uuid', message)).toEqual({
        id: expect.any(String) as string,
        type: CommunityChatEvent.MESSAGE_CREATED,
        communityId: 'community-uuid',
        message,
      });
    });

    it('같은 메시지는 실시간이든 replay든 같은 id로 나간다', () => {
      const message = buildMessage();

      const live = publisher.messageCreatedEvent('community-uuid', message);
      const replayed = publisher.messageCreatedEvent('community-uuid', message);

      expect(replayed.id).toBe(live.id);
    });

    it('다른 메시지는 다른 id로 나간다', () => {
      const first = publisher.messageCreatedEvent(
        'community-uuid',
        buildMessage(),
      );
      const second = publisher.messageCreatedEvent(
        'community-uuid',
        buildMessage({ id: 'other-message-uuid' }),
      );

      expect(second.id).not.toBe(first.id);
    });
  });

  describe('opinionSubmittedEvent', () => {
    it('같은 의견을 같은 상태로 다시 보내면 같은 id다(replay 중복 제거)', () => {
      const opinion = buildOpinion();

      const live = publisher.opinionSubmittedEvent('community-uuid', opinion);
      const replayed = publisher.opinionSubmittedEvent(
        'community-uuid',
        opinion,
      );

      expect(replayed.id).toBe(live.id);
    });

    it('의견이 수정되면 다른 id다 — 갱신 시각이 identity에 들어간다', () => {
      const before = publisher.opinionSubmittedEvent(
        'community-uuid',
        buildOpinion(),
      );
      const after = publisher.opinionSubmittedEvent(
        'community-uuid',
        buildOpinion({
          claim: '반대',
          updatedAt: '2026-09-18T12:05:00.000Z',
        }),
      );

      expect(after.id).not.toBe(before.id);
    });
  });
});
