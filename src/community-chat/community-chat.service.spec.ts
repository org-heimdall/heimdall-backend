import { Test, TestingModule } from '@nestjs/testing';
import { GeneralException } from '../common/exceptions/general.exception';
import { CommunitiesService } from '../communities/communities.service';
import { CommunityMessagesService } from '../communities/community-messages.service';
import { CommunityOpinionAction } from '../communities/dto/community-opinion.dto';
import { CommunityMessage } from '../communities/entities/community-message.entity';
import { CommunityErrorCode } from '../communities/exceptions/community-error-code';
import { MemberCommunity } from '../member-communities/entities/member-community.entity';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { Member } from '../members/entities/member.entity';
import { MembersService } from '../members/members.service';
import {
  CommunityChatService,
  REPLAY_MESSAGE_LIMIT,
} from './community-chat.service';
import { CommunityChatErrorCode } from './exceptions/community-chat-error-code';

describe('CommunityChatService', () => {
  let service: CommunityChatService;
  let communitiesService: { findOneOrThrow: jest.Mock };
  let communityMessagesService: { findRecent: jest.Mock; create: jest.Mock };
  let memberCommunitiesService: {
    findOne: jest.Mock;
    updateKeynote: jest.Mock;
    findOpinions: jest.Mock;
  };
  let membersService: { findOneOrThrow: jest.Mock; findByIds: jest.Mock };

  const COMMUNITY_ID = 'community-uuid';
  const MEMBER_ID = 'member-uuid';
  const NOW = new Date('2026-09-18T12:00:00.000Z');

  const buildMember = (overrides: Partial<Member> = {}): Member =>
    Object.assign(new Member(), {
      id: MEMBER_ID,
      nickname: '헤임달',
      ...overrides,
    });

  const buildMessage = (
    overrides: Partial<CommunityMessage> = {},
  ): CommunityMessage =>
    Object.assign(
      CommunityMessage.write({
        id: 'message-uuid',
        communityId: COMMUNITY_ID,
        memberId: MEMBER_ID,
        clientMessageId: 'client-key',
        text: '안녕하세요',
        createdAt: NOW,
      }),
      overrides,
    );

  const buildParticipation = (
    overrides: Partial<MemberCommunity> = {},
  ): MemberCommunity =>
    Object.assign(new MemberCommunity(), {
      id: 'mc-uuid',
      memberId: MEMBER_ID,
      communityId: COMMUNITY_ID,
      opinion: null,
      reasons: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    });

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toBeInstanceOf(GeneralException);
    await expect(promise).rejects.toMatchObject({ appError: { code } });
  };

  beforeEach(async () => {
    communitiesService = { findOneOrThrow: jest.fn().mockResolvedValue({}) };
    communityMessagesService = {
      findRecent: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    };
    memberCommunitiesService = {
      findOne: jest.fn().mockResolvedValue(buildParticipation()),
      updateKeynote: jest.fn(),
      findOpinions: jest.fn().mockResolvedValue([]),
    };
    membersService = {
      findOneOrThrow: jest.fn().mockResolvedValue(buildMember()),
      findByIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityChatService,
        { provide: CommunitiesService, useValue: communitiesService },
        {
          provide: CommunityMessagesService,
          useValue: communityMessagesService,
        },
        {
          provide: MemberCommunitiesService,
          useValue: memberCommunitiesService,
        },
        { provide: MembersService, useValue: membersService },
      ],
    }).compile();

    service = module.get(CommunityChatService);
  });

  describe('assertJoinable', () => {
    it('삭제됐거나 없는 커뮤니티면 NOT_FOUND를 던진다', async () => {
      communitiesService.findOneOrThrow.mockRejectedValue(
        new GeneralException(CommunityErrorCode.NOT_FOUND),
      );

      await expectCode(
        service.assertJoinable(COMMUNITY_ID),
        CommunityErrorCode.NOT_FOUND.code,
      );
    });
  });

  describe('replay', () => {
    it('최근 메시지(계약상 50개)와 의견 목록을 작성자 이름과 함께 돌려준다', async () => {
      const author = buildMember({ nickname: '작성자' });
      communityMessagesService.findRecent.mockResolvedValue([
        buildMessage({ id: 'older', member: author }),
        buildMessage({ id: 'newer', member: author }),
      ]);
      memberCommunitiesService.findOpinions.mockResolvedValue([
        buildParticipation({ opinion: '찬성', reasons: ['이유'] }),
      ]);
      membersService.findByIds.mockResolvedValue([author]);

      const result = await service.replay(COMMUNITY_ID);

      expect(communityMessagesService.findRecent).toHaveBeenCalledWith(
        COMMUNITY_ID,
        REPLAY_MESSAGE_LIMIT,
      );
      // 저장소가 오래된 순으로 주는 순서를 그대로 유지한다.
      expect(result.messages.map((message) => message.id)).toEqual([
        'older',
        'newer',
      ]);
      expect(result.messages[0]).toMatchObject({
        authorId: MEMBER_ID,
        authorName: '작성자',
        text: '안녕하세요',
        createdAt: NOW.toISOString(),
      });
      expect(result.opinions).toEqual([
        expect.objectContaining({
          claim: '찬성',
          reasons: ['이유'],
          authorName: '작성자',
        }),
      ]);
      // replay는 action 없이 현재 상태만 보낸다.
      expect(result.opinions[0].action).toBeUndefined();
    });

    it('탈퇴해 이름을 채울 수 없는 의견은 목록에서 빠진다', async () => {
      memberCommunitiesService.findOpinions.mockResolvedValue([
        buildParticipation({ memberId: 'gone-uuid', opinion: '찬성' }),
      ]);
      membersService.findByIds.mockResolvedValue([]);

      await expect(service.replay(COMMUNITY_ID)).resolves.toMatchObject({
        opinions: [],
      });
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      // 기조 발언을 작성한 참여자가 기본이다.
      memberCommunitiesService.findOne.mockResolvedValue(
        buildParticipation({ opinion: '찬성', reasons: ['이유'] }),
      );
    });

    it('참여자의 메시지를 저장하고 STORED를 그대로 전달한다', async () => {
      communityMessagesService.create.mockImplementation(
        (message: CommunityMessage) =>
          Promise.resolve({ status: 'STORED', message }),
      );

      const result = await service.sendMessage(
        COMMUNITY_ID,
        MEMBER_ID,
        '안녕하세요',
        'client-key',
      );

      expect(result.status).toBe('STORED');
      expect(result.message).toMatchObject({
        communityId: COMMUNITY_ID,
        clientMessageId: 'client-key',
        authorId: MEMBER_ID,
        authorName: '헤임달',
        text: '안녕하세요',
        debateId: null,
      });
    });

    it('재전송이면 저장소의 DUPLICATE와 기존 메시지를 그대로 전달한다', async () => {
      const stored = buildMessage({
        id: 'stored-uuid',
        member: buildMember({ nickname: '먼저 보낸 사람' }),
      });
      communityMessagesService.create.mockResolvedValue({
        status: 'DUPLICATE',
        message: stored,
      });

      const result = await service.sendMessage(
        COMMUNITY_ID,
        MEMBER_ID,
        '안녕하세요',
        'client-key',
      );

      expect(result.status).toBe('DUPLICATE');
      // 중복 키 범위가 커뮤니티 단위라 기존 메시지의 작성자를 그대로 쓴다.
      expect(result.message).toMatchObject({
        id: 'stored-uuid',
        authorName: '먼저 보낸 사람',
      });
    });

    it('참여자가 아니면 NOT_PARTICIPANT를 던지고 저장하지 않는다', async () => {
      memberCommunitiesService.findOne.mockResolvedValue(null);

      await expectCode(
        service.sendMessage(COMMUNITY_ID, MEMBER_ID, '안녕하세요', 'key'),
        CommunityChatErrorCode.NOT_PARTICIPANT.code,
      );
      expect(communityMessagesService.create).not.toHaveBeenCalled();
    });

    it('기조 발언을 작성하지 않은 참여자면 OPINION_REQUIRED를 던지고 저장하지 않는다', async () => {
      memberCommunitiesService.findOne.mockResolvedValue(
        buildParticipation({ opinion: null }),
      );

      await expectCode(
        service.sendMessage(COMMUNITY_ID, MEMBER_ID, '안녕하세요', 'key'),
        CommunityChatErrorCode.OPINION_REQUIRED.code,
      );
      expect(communityMessagesService.create).not.toHaveBeenCalled();
      expect(CommunityChatErrorCode.OPINION_REQUIRED.httpStatus).toBe(403);
    });

    it('없는 커뮤니티면 NOT_FOUND를 던진다', async () => {
      communitiesService.findOneOrThrow.mockRejectedValue(
        new GeneralException(CommunityErrorCode.NOT_FOUND),
      );

      await expectCode(
        service.sendMessage(COMMUNITY_ID, MEMBER_ID, '안녕하세요', 'key'),
        CommunityErrorCode.NOT_FOUND.code,
      );
    });
  });

  describe('submitOpinion', () => {
    it('처음 작성하면 action=CREATED로 돌려준다', async () => {
      memberCommunitiesService.updateKeynote.mockResolvedValue({
        row: buildParticipation({ opinion: '찬성', reasons: ['이유'] }),
        created: true,
      });

      const result = await service.submitOpinion(COMMUNITY_ID, MEMBER_ID, {
        claim: '찬성',
        reasons: ['이유'],
      });

      expect(result).toMatchObject({
        communityId: COMMUNITY_ID,
        authorId: MEMBER_ID,
        authorName: '헤임달',
        claim: '찬성',
        reasons: ['이유'],
        action: CommunityOpinionAction.CREATED,
      });
    });

    it('이미 있던 의견을 고치면 action=UPDATED로 돌려준다', async () => {
      memberCommunitiesService.updateKeynote.mockResolvedValue({
        row: buildParticipation({ opinion: '반대', reasons: [] }),
        created: false,
      });

      await expect(
        service.submitOpinion(COMMUNITY_ID, MEMBER_ID, {
          claim: '반대',
          reasons: [],
        }),
      ).resolves.toMatchObject({ action: CommunityOpinionAction.UPDATED });
    });

    it('참여자가 아니면 NOT_PARTICIPANT를 던진다', async () => {
      memberCommunitiesService.updateKeynote.mockResolvedValue(null);

      await expectCode(
        service.submitOpinion(COMMUNITY_ID, MEMBER_ID, {
          claim: '찬성',
          reasons: [],
        }),
        CommunityChatErrorCode.NOT_PARTICIPANT.code,
      );
    });
  });

  describe('findRecentMessages', () => {
    it('커뮤니티를 확인한 뒤 limit·before를 저장소에 그대로 넘긴다', async () => {
      const before = new Date('2026-09-18T11:00:00.000Z');

      await service.findRecentMessages(COMMUNITY_ID, 20, before);

      expect(communitiesService.findOneOrThrow).toHaveBeenCalledWith(
        COMMUNITY_ID,
      );
      expect(communityMessagesService.findRecent).toHaveBeenCalledWith(
        COMMUNITY_ID,
        20,
        before,
      );
    });
  });
});
