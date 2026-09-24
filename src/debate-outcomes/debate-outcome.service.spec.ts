import { Test, TestingModule } from '@nestjs/testing';
import { CommunitiesService } from '../communities/communities.service';
import { CommunityMessagesService } from '../communities/community-messages.service';
import { SYSTEM_AUTHOR_NAME } from '../communities/dto/community-message.dto';
import {
  CommunityChatMessageType,
  CommunityMessage,
  SYSTEM_CLIENT_MESSAGE_ID_PATTERN,
} from '../communities/entities/community-message.entity';
import { CommunityChatPublisher } from '../community-chat/community-chat.publisher';
import { DebateChatPublisher } from '../debate-chat/debate-chat.publisher';
import { DebatesService } from '../debates/debates.service';
import { DebateEndReason } from '../debates/entities/debate-end-reason.enum';
import { DebateStatus } from '../debates/entities/debate-status.enum';
import { Debate } from '../debates/entities/debate.entity';
import { MembersService } from '../members/members.service';
import { DebateOutcomeService } from './debate-outcome.service';
import { DebateOutcome, DebateOutcomeKind } from './debate-outcome.types';
import { DebateSystemMessageFactory } from './debate-system-message.factory';

describe('DebateOutcomeService', () => {
  let service: DebateOutcomeService;
  let communitiesService: {
    lockForUpdate: jest.Mock;
    markActive: jest.Mock;
    markWaiting: jest.Mock;
  };
  let communityMessagesService: {
    create: jest.Mock;
    findByClientMessageId: jest.Mock;
  };
  let debatesService: {
    findOneOrThrow: jest.Mock;
    existsActiveByCommunity: jest.Mock;
  };
  let membersService: { rewardWin: jest.Mock };
  let communityPublisher: { messageCreated: jest.Mock };
  let debatePublisher: { debateEnded: jest.Mock };

  const DEBATE_ID = 'debate-uuid';
  const COMMUNITY_ID = 'community-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  const NOW = new Date('2026-09-24T12:00:00.000Z');
  const manager = { name: 'tx-manager' } as never;

  const debate = Object.assign(new Debate(), {
    id: DEBATE_ID,
    communityId: COMMUNITY_ID,
    hostId: HOST_ID,
    hostNickname: '방장',
    opponentId: OPPONENT_ID,
    opponentNickname: '상대',
  });

  const outcomeOf = (overrides: Partial<DebateOutcome>): DebateOutcome => ({
    debateId: DEBATE_ID,
    communityId: COMMUNITY_ID,
    kind: DebateOutcomeKind.FORFEIT,
    status: DebateStatus.FAILED,
    reason: DebateEndReason.FORFEIT,
    winnerId: OPPONENT_ID,
    ...overrides,
  });

  // create에 넘어간 시스템 메시지
  const createdMessage = (): CommunityMessage =>
    (communityMessagesService.create.mock.calls[0] as [CommunityMessage])[0];

  beforeEach(async () => {
    communitiesService = {
      lockForUpdate: jest.fn().mockResolvedValue({ id: COMMUNITY_ID }),
      markActive: jest.fn().mockResolvedValue(undefined),
      markWaiting: jest.fn().mockResolvedValue(undefined),
    };
    communityMessagesService = {
      create: jest.fn().mockResolvedValue({ status: 'STORED' }),
      findByClientMessageId: jest.fn().mockResolvedValue(null),
    };
    debatesService = {
      findOneOrThrow: jest.fn().mockResolvedValue(debate),
      existsActiveByCommunity: jest.fn().mockResolvedValue(false),
    };
    membersService = { rewardWin: jest.fn().mockResolvedValue(undefined) };
    communityPublisher = { messageCreated: jest.fn() };
    debatePublisher = { debateEnded: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebateOutcomeService,
        { provide: CommunitiesService, useValue: communitiesService },
        {
          provide: CommunityMessagesService,
          useValue: communityMessagesService,
        },
        { provide: DebatesService, useValue: debatesService },
        { provide: MembersService, useValue: membersService },
        {
          provide: DebateSystemMessageFactory,
          useValue: new DebateSystemMessageFactory(
            () => NOW,
            () => 'message-uuid',
          ),
        },
        { provide: CommunityChatPublisher, useValue: communityPublisher },
        { provide: DebateChatPublisher, useValue: debatePublisher },
      ],
    }).compile();

    service = module.get(DebateOutcomeService);
  });

  describe('applyWithin', () => {
    it('승자가 있으면 같은 manager로 보상한다', async () => {
      await service.applyWithin(manager, outcomeOf({}));

      expect(membersService.rewardWin).toHaveBeenCalledTimes(1);
      expect(membersService.rewardWin).toHaveBeenCalledWith(
        OPPONENT_ID,
        manager,
      );
    });

    it('승자가 없으면(무승부·양쪽 무발언) 보상하지 않는다', async () => {
      await service.applyWithin(
        manager,
        outcomeOf({
          kind: DebateOutcomeKind.RESULT,
          status: DebateStatus.COMPLETED,
          reason: DebateEndReason.ALL_TURNS_FINALIZED,
          winnerId: null,
        }),
      );

      expect(membersService.rewardWin).not.toHaveBeenCalled();
      expect(createdMessage().body).toBe(
        '토론 판정이 완료되었습니다. 무승부입니다.',
      );
    });

    it.each([
      [
        DebateOutcomeKind.STARTED,
        CommunityChatMessageType.DEBATE_STARTED,
        `debate_started:${DEBATE_ID}`,
        '방장 vs 상대 토론이 시작되었습니다.',
      ],
      [
        DebateOutcomeKind.RESULT,
        CommunityChatMessageType.DEBATE_RESULT,
        `debate_result:${DEBATE_ID}`,
        '토론 판정이 완료되었습니다. 승자: 상대',
      ],
      [
        DebateOutcomeKind.FORFEIT,
        CommunityChatMessageType.DEBATE_FORFEIT,
        `debate_forfeit:${DEBATE_ID}`,
        '방장님이 기권하여 토론이 종료되었습니다.',
      ],
      [
        DebateOutcomeKind.TOTAL_TIMEOUT,
        CommunityChatMessageType.DEBATE_TIMEOUT,
        `debate_timeout:${DEBATE_ID}`,
        '발언 시간이 모두 지나 토론이 종료되었습니다.',
      ],
    ])(
      '%s는 결정적 clientMessageId의 작성자 없는 시스템 메시지를 같은 manager로 저장한다',
      async (kind, messageType, clientMessageId, text) => {
        await service.applyWithin(manager, outcomeOf({ kind }));

        const message = createdMessage();
        expect(communityMessagesService.create).toHaveBeenCalledWith(
          message,
          manager,
        );
        expect(message).toMatchObject({
          communityId: COMMUNITY_ID,
          debateId: DEBATE_ID,
          memberId: null,
          messageType,
          clientMessageId,
          body: text,
          createdAt: NOW,
        });
        expect(debatesService.findOneOrThrow).toHaveBeenCalledWith(
          DEBATE_ID,
          manager,
        );
        // 사용자 입력이 거절하는 예약 형식과 어긋나면 사용자가 시스템 키를 선점할 수 있다.
        expect(message.clientMessageId).toMatch(
          SYSTEM_CLIENT_MESSAGE_ID_PATTERN,
        );
      },
    );

    it('판정 실패는 시스템 메시지를 만들지 않고 커뮤니티 상태만 동기화한다', async () => {
      await service.applyWithin(
        manager,
        outcomeOf({
          kind: DebateOutcomeKind.JUDGMENT_FAILED,
          reason: DebateEndReason.JUDGMENT_FAILED,
          winnerId: null,
        }),
      );

      expect(communityMessagesService.create).not.toHaveBeenCalled();
      expect(communitiesService.markWaiting).toHaveBeenCalledWith(
        COMMUNITY_ID,
        manager,
      );
    });

    it('활성 토론이 없으면 커뮤니티 행을 잠근 뒤 WAITING으로 되돌린다', async () => {
      await service.applyWithin(manager, outcomeOf({}));

      expect(communitiesService.lockForUpdate).toHaveBeenCalledWith(
        COMMUNITY_ID,
        manager,
      );
      expect(debatesService.existsActiveByCommunity).toHaveBeenCalledWith(
        COMMUNITY_ID,
        manager,
      );
      expect(communitiesService.markWaiting).toHaveBeenCalledWith(
        COMMUNITY_ID,
        manager,
      );
      expect(communitiesService.markActive).not.toHaveBeenCalled();
      // 락이 상태 판단보다 먼저여야 초대 수락과 엇갈리지 않는다.
      expect(
        communitiesService.lockForUpdate.mock.invocationCallOrder[0],
      ).toBeLessThan(
        debatesService.existsActiveByCommunity.mock.invocationCallOrder[0],
      );
    });

    it('다른 활성 토론이 있으면 WAITING으로 덮어쓰지 않고 ACTIVE로 둔다', async () => {
      debatesService.existsActiveByCommunity.mockResolvedValue(true);

      await service.applyWithin(manager, outcomeOf({}));

      expect(communitiesService.markActive).toHaveBeenCalledWith(
        COMMUNITY_ID,
        manager,
      );
      expect(communitiesService.markWaiting).not.toHaveBeenCalled();
    });

    it('보상이 실패하면 예외를 전파하고 메시지·커뮤니티 전이를 하지 않는다', async () => {
      membersService.rewardWin.mockRejectedValue(new Error('db down'));

      await expect(service.applyWithin(manager, outcomeOf({}))).rejects.toThrow(
        'db down',
      );
      expect(communityMessagesService.create).not.toHaveBeenCalled();
      expect(communitiesService.markWaiting).not.toHaveBeenCalled();
      expect(communitiesService.markActive).not.toHaveBeenCalled();
    });
  });

  describe('announce', () => {
    const stored = CommunityMessage.system({
      id: 'message-uuid',
      communityId: COMMUNITY_ID,
      debateId: DEBATE_ID,
      messageType: CommunityChatMessageType.DEBATE_FORFEIT,
      clientMessageId: `debate_forfeit:${DEBATE_ID}`,
      text: '방장님이 기권하여 토론이 종료되었습니다.',
      createdAt: NOW,
    });

    it('저장된 시스템 메시지를 message.created로 보낸 뒤 debate.ended를 보낸다', async () => {
      communityMessagesService.findByClientMessageId.mockResolvedValue(
        Object.assign(stored, { member: null }),
      );

      await service.announce(outcomeOf({}));

      expect(
        communityMessagesService.findByClientMessageId,
      ).toHaveBeenCalledWith(COMMUNITY_ID, `debate_forfeit:${DEBATE_ID}`);
      expect(communityPublisher.messageCreated).toHaveBeenCalledWith(
        COMMUNITY_ID,
        expect.objectContaining({
          id: 'message-uuid',
          authorId: '',
          authorName: SYSTEM_AUTHOR_NAME,
          messageType: CommunityChatMessageType.DEBATE_FORFEIT,
          debateId: DEBATE_ID,
        }),
      );
      expect(debatePublisher.debateEnded).toHaveBeenCalledTimes(1);
      expect(debatePublisher.debateEnded).toHaveBeenCalledWith({
        communityId: COMMUNITY_ID,
        debateId: DEBATE_ID,
        status: DebateStatus.FAILED,
        reason: DebateEndReason.FORFEIT,
      });
      expect(
        communityPublisher.messageCreated.mock.invocationCallOrder[0],
      ).toBeLessThan(debatePublisher.debateEnded.mock.invocationCallOrder[0]);
    });

    it('전체 시간 초과도 원인과 함께 debate.ended를 보낸다', async () => {
      await service.announce(
        outcomeOf({
          kind: DebateOutcomeKind.TOTAL_TIMEOUT,
          reason: DebateEndReason.TOTAL_TIME_EXPIRED,
        }),
      );

      expect(debatePublisher.debateEnded).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: DebateEndReason.TOTAL_TIME_EXPIRED,
        }),
      );
    });

    it('저장된 메시지를 찾지 못하면 message.created는 보내지 않는다', async () => {
      communityMessagesService.findByClientMessageId.mockResolvedValue(null);

      await service.announce(outcomeOf({}));

      expect(communityPublisher.messageCreated).not.toHaveBeenCalled();
    });

    it('판정 완료·시작은 debate.ended를 보내지 않는다(한 번만 보내는 규칙)', async () => {
      await service.announce(
        outcomeOf({
          kind: DebateOutcomeKind.RESULT,
          status: DebateStatus.COMPLETED,
          reason: DebateEndReason.ALL_TURNS_FINALIZED,
        }),
      );
      await service.announce(
        outcomeOf({
          kind: DebateOutcomeKind.STARTED,
          status: DebateStatus.READY,
          reason: null,
        }),
      );

      expect(debatePublisher.debateEnded).not.toHaveBeenCalled();
    });

    it('판정 실패는 아무것도 발행하지 않는다', async () => {
      await service.announce(
        outcomeOf({
          kind: DebateOutcomeKind.JUDGMENT_FAILED,
          reason: DebateEndReason.JUDGMENT_FAILED,
        }),
      );

      expect(
        communityMessagesService.findByClientMessageId,
      ).not.toHaveBeenCalled();
      expect(debatePublisher.debateEnded).not.toHaveBeenCalled();
    });

    it('메시지 조회가 실패해도 debate.ended는 보낸다(발행은 커밋 결과를 되돌리지 않는다)', async () => {
      communityMessagesService.findByClientMessageId.mockRejectedValue(
        new Error('db down'),
      );

      await expect(service.announce(outcomeOf({}))).resolves.toBeUndefined();
      expect(debatePublisher.debateEnded).toHaveBeenCalledTimes(1);
    });
  });
});
