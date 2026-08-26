import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { ErrorCode } from '../common/exceptions/error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { Community } from '../communities/entities/community.entity';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate, DebateTurn } from '../debates/entities/debate.entity';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import { MembersService } from '../members/members.service';
import { DebateSolution } from './debate-solution';
import { JudgeErrorCode } from './exceptions/judge-error-code';
import { JUDGE, JudgeResult } from './judge.interface';
import { JudgeService } from './judge.service';

describe('JudgeService', () => {
  let service: JudgeService;
  let debateRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let debateMessageRepository: { find: jest.Mock };
  let judge: { judge: jest.Mock };
  let membersService: { deductSocialCredit: jest.Mock };
  // 트랜잭션 콜백에 넘길 가짜 manager. 판정 저장은 이 manager로 이뤄진다.
  let manager: { save: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  const DEBATE_ID = 'debate-uuid';

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      communityId: 'community-uuid',
      hostId: HOST_ID,
      hostNickname: '메시',
      opponentId: OPPONENT_ID,
      opponentNickname: '호날두',
      currentTurn: DebateTurn.HOST,
      winnerId: null,
      solution: null,
      status: ResourceStatus.NORMAL,
      community: Object.assign(new Community(), {
        id: 'community-uuid',
        topic: 'AI 규제, 필요한가?',
        status: ResourceStatus.NORMAL,
      }),
      ...overrides,
    });

  const buildMessage = (
    overrides: Partial<DebateMessage> = {},
  ): DebateMessage =>
    Object.assign(new DebateMessage(), {
      id: 'message-uuid',
      memberId: HOST_ID,
      debateId: DEBATE_ID,
      body: '규제가 필요하다.',
      debate_turn: 1,
      remaining_length: null,
      remaining_images_count: null,
      imageUrl: null,
      status: ResourceStatus.NORMAL,
      ...overrides,
    });

  const buildResult = (overrides: Partial<JudgeResult> = {}): JudgeResult => ({
    performance: {
      host: { score: 90, judgeReason: ['근거가 구체적이다'] },
      opponent: { score: 70, judgeReason: ['반론이 약하다'] },
      winner: 'host',
    },
    violation: { host: [], opponent: [] },
    model: 'gpt-5.6-luna',
    ...overrides,
  });

  // 저장된 엔티티의 solution을 읽어 상태를 검증하기 위한 헬퍼.
  // PENDING은 레포지토리로, 판정 결과는 트랜잭션 manager로 저장된다.
  const savedDebate = (): Debate => {
    const call = (debateRepository.save.mock.calls[0] ??
      manager.save.mock.calls[0]) as [Debate];
    return call[0];
  };
  const savedSolution = (): DebateSolution =>
    savedDebate().solution as DebateSolution;

  beforeEach(async () => {
    debateRepository = {
      findOne: jest.fn(),
      save: jest.fn((entity: Debate) => Promise.resolve(entity)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    debateMessageRepository = { find: jest.fn().mockResolvedValue([]) };
    judge = { judge: jest.fn() };
    membersService = {
      deductSocialCredit: jest.fn().mockResolvedValue(undefined),
    };
    manager = { save: jest.fn((entity: Debate) => Promise.resolve(entity)) };
    dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JudgeService,
        {
          provide: getRepositoryToken(Debate),
          useValue: debateRepository,
        },
        {
          provide: getRepositoryToken(DebateMessage),
          useValue: debateMessageRepository,
        },
        { provide: JUDGE, useValue: judge },
        { provide: MembersService, useValue: membersService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<JudgeService>(JudgeService);
  });

  describe('requestJudgment', () => {
    it('토론을 PENDING으로 표시하고 판정을 백그라운드로 넘긴다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
      const execute = jest
        .spyOn(service, 'executeJudgment')
        .mockResolvedValue(undefined);

      await service.requestJudgment(DEBATE_ID, HOST_ID);

      expect(savedSolution()).toEqual({
        status: 'PENDING',
        requestedAt: expect.any(String) as string,
      });
      expect(execute).toHaveBeenCalledWith(DEBATE_ID);
    });

    it('soft-delete된 토론은 조회되지 않아 NOT_FOUND를 던진다', async () => {
      debateRepository.findOne.mockResolvedValue(null);

      await expect(service.requestJudgment(DEBATE_ID, HOST_ID)).rejects.toThrow(
        new GeneralException(DebateErrorCode.NOT_FOUND),
      );
      // status = NORMAL 필터가 빠지면 삭제된 토론도 판정된다.
      expect(debateRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: DEBATE_ID,
          status: ResourceStatus.NORMAL,
          community: { status: ResourceStatus.NORMAL },
        },
        relations: { community: true },
      });
    });

    it('토론 당사자가 아니면 FORBIDDEN을 던진다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());

      await expect(
        service.requestJudgment(DEBATE_ID, 'spectator-uuid'),
      ).rejects.toThrow(new GeneralException(ErrorCode.FORBIDDEN));
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('상대가 없는 토론은 NOT_JUDGEABLE을 던진다', async () => {
      debateRepository.findOne.mockResolvedValue(
        buildDebate({ opponentId: null, opponentNickname: null }),
      );

      await expect(service.requestJudgment(DEBATE_ID, HOST_ID)).rejects.toThrow(
        new GeneralException(JudgeErrorCode.NOT_JUDGEABLE),
      );
    });

    it.each([
      [
        'PENDING',
        { status: 'PENDING', requestedAt: '2026-08-26T00:00:00.000Z' },
      ],
      [
        'JUDGED',
        {
          status: 'JUDGED',
          judgedAt: '2026-08-26T00:00:00.000Z',
          model: 'gpt-5.6-luna',
          winner: 'host',
          host: {
            score: 90,
            judgeReason: ['a'],
            violations: [],
            socialCreditPenalty: 0,
          },
          opponent: {
            score: 70,
            judgeReason: ['b'],
            violations: [],
            socialCreditPenalty: 0,
          },
        },
      ],
    ])(
      '%s 상태의 토론을 재요청하면 ALREADY_REQUESTED를 던진다',
      async (_, solution) => {
        debateRepository.findOne.mockResolvedValue(buildDebate({ solution }));

        await expect(
          service.requestJudgment(DEBATE_ID, HOST_ID),
        ).rejects.toThrow(
          new GeneralException(JudgeErrorCode.ALREADY_REQUESTED),
        );
        expect(debateRepository.save).not.toHaveBeenCalled();
      },
    );

    it('FAILED 상태의 토론은 다시 요청할 수 있다', async () => {
      debateRepository.findOne.mockResolvedValue(
        buildDebate({
          solution: { status: 'FAILED', failedAt: '2026-08-26T00:00:00.000Z' },
        }),
      );
      jest.spyOn(service, 'executeJudgment').mockResolvedValue(undefined);

      await service.requestJudgment(DEBATE_ID, OPPONENT_ID);

      expect(savedSolution().status).toBe('PENDING');
    });
  });

  describe('executeJudgment', () => {
    it('판정 결과를 winnerId와 solution(JUDGED)에 반영한다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
      debateMessageRepository.find.mockResolvedValue([buildMessage()]);
      judge.judge.mockResolvedValue(buildResult());

      await service.executeJudgment(DEBATE_ID);

      expect(savedDebate().winnerId).toBe(HOST_ID);
      expect(savedSolution()).toEqual({
        status: 'JUDGED',
        judgedAt: expect.any(String) as string,
        model: 'gpt-5.6-luna',
        winner: 'host',
        host: {
          score: 90,
          judgeReason: ['근거가 구체적이다'],
          violations: [],
          socialCreditPenalty: 0,
        },
        opponent: {
          score: 70,
          judgeReason: ['반론이 약하다'],
          violations: [],
          socialCreditPenalty: 0,
        },
      });
    });

    it('winner가 opponent면 상대가 승자로 기록된다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
      debateMessageRepository.find.mockResolvedValue([buildMessage()]);
      judge.judge.mockResolvedValue(
        buildResult({
          performance: {
            host: { score: 70, judgeReason: ['근거가 부족하다'] },
            opponent: { score: 90, judgeReason: ['반론이 날카롭다'] },
            winner: 'opponent',
          },
        }),
      );

      await service.executeJudgment(DEBATE_ID);

      expect(savedDebate().winnerId).toBe(OPPONENT_ID);
    });

    it('무승부면 winnerId를 비우고 solution에 draw로 남긴다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
      debateMessageRepository.find.mockResolvedValue([buildMessage()]);
      judge.judge.mockResolvedValue(
        buildResult({
          performance: {
            host: { score: 80, judgeReason: ['팽팽했다'] },
            opponent: { score: 80, judgeReason: ['팽팽했다'] },
            winner: 'draw',
          },
        }),
      );

      await service.executeJudgment(DEBATE_ID);

      expect(savedDebate().winnerId).toBeNull();
      expect(savedSolution()).toMatchObject({
        status: 'JUDGED',
        winner: 'draw',
      });
    });

    it('위반 severity를 합산해 양측의 신뢰도를 차감한다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
      debateMessageRepository.find.mockResolvedValue([buildMessage()]);
      judge.judge.mockResolvedValue(
        buildResult({
          violation: {
            // minor(1) + high(7) = 8
            host: [
              {
                type: 'disrespect',
                severity: 'minor',
                evidence: '무례한 표현',
              },
              { type: 'profanity', severity: 'high', evidence: '욕설' },
            ],
            opponent: [],
          },
        }),
      );

      await service.executeJudgment(DEBATE_ID);

      expect(membersService.deductSocialCredit).toHaveBeenCalledWith(
        HOST_ID,
        8,
        manager,
      );
      expect(membersService.deductSocialCredit).toHaveBeenCalledWith(
        OPPONENT_ID,
        0,
        manager,
      );
      // 차감 근거는 solution에 감사 기록으로 남는다.
      expect(savedSolution()).toMatchObject({
        host: { socialCreditPenalty: 8 },
        opponent: { socialCreditPenalty: 0 },
      });
    });

    it('판정 저장과 신뢰도 차감을 한 트랜잭션에서 처리한다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
      debateMessageRepository.find.mockResolvedValue([buildMessage()]);
      judge.judge.mockResolvedValue(buildResult());

      await service.executeJudgment(DEBATE_ID);

      // 따로 커밋되면 한쪽만 성공했을 때 이중 차감되거나 차감이 누락된다.
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledWith(expect.any(Debate));
    });

    it('삭제되지 않은 메시지만 debate_turn 오름차순으로 읽어 발화자를 표시한다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
      debateMessageRepository.find.mockResolvedValue([
        buildMessage({ memberId: HOST_ID, debate_turn: 1, body: '찬성한다' }),
        buildMessage({
          memberId: OPPONENT_ID,
          debate_turn: 2,
          body: '반대한다',
          imageUrl: 'https://cdn.example.com/a.png',
        }),
        // 참가자가 아닌 회원의 발화(데이터 이상)는 판정 입력에서 제외한다.
        buildMessage({ memberId: 'spectator-uuid', debate_turn: 3 }),
      ]);
      judge.judge.mockResolvedValue(buildResult());

      await service.executeJudgment(DEBATE_ID);

      expect(debateMessageRepository.find).toHaveBeenCalledWith({
        where: { debateId: DEBATE_ID, status: ResourceStatus.NORMAL },
        order: { debate_turn: 'ASC' },
      });
      expect(judge.judge).toHaveBeenCalledWith({
        topic: 'AI 규제, 필요한가?',
        host: { nickname: '메시' },
        opponent: { nickname: '호날두' },
        turns: [
          { speaker: 'host', turn: 1, body: '찬성한다', imageUrl: null },
          {
            speaker: 'opponent',
            turn: 2,
            body: '반대한다',
            imageUrl: 'https://cdn.example.com/a.png',
          },
        ],
      });
    });

    it('판정기가 실패하면 예외를 밖으로 내보내지 않고 FAILED로 기록한다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
      debateMessageRepository.find.mockResolvedValue([buildMessage()]);
      judge.judge.mockRejectedValue(
        new GeneralException(JudgeErrorCode.UNAVAILABLE),
      );

      await expect(service.executeJudgment(DEBATE_ID)).resolves.toBeUndefined();

      expect(debateRepository.save).not.toHaveBeenCalled();
      expect(debateRepository.update).toHaveBeenCalledWith(
        { id: DEBATE_ID },
        {
          solution: {
            status: 'FAILED',
            failedAt: expect.any(String) as string,
          },
        },
      );
    });

    it('발언이 하나도 없으면 FAILED로 기록한다', async () => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
      debateMessageRepository.find.mockResolvedValue([]);

      await service.executeJudgment(DEBATE_ID);

      expect(judge.judge).not.toHaveBeenCalled();
      expect(debateRepository.update).toHaveBeenCalledWith(
        { id: DEBATE_ID },
        {
          solution: {
            status: 'FAILED',
            failedAt: expect.any(String) as string,
          },
        },
      );
    });
  });

  describe('getJudgment', () => {
    it('판정을 요청한 적이 없으면 NOT_REQUESTED를 던진다', async () => {
      debateRepository.findOne.mockResolvedValue(
        buildDebate({ solution: null }),
      );

      await expect(service.getJudgment(DEBATE_ID)).rejects.toThrow(
        new GeneralException(JudgeErrorCode.NOT_REQUESTED),
      );
    });

    it('알아볼 수 없는 solution 값도 NOT_REQUESTED로 다룬다', async () => {
      debateRepository.findOne.mockResolvedValue(
        buildDebate({ solution: { status: 'UNKNOWN' } }),
      );

      await expect(service.getJudgment(DEBATE_ID)).rejects.toThrow(
        new GeneralException(JudgeErrorCode.NOT_REQUESTED),
      );
    });

    it.each([
      [
        'PENDING',
        { status: 'PENDING', requestedAt: '2026-08-26T00:00:00.000Z' },
      ],
      ['FAILED', { status: 'FAILED', failedAt: '2026-08-26T00:00:00.000Z' }],
    ])('%s면 상태만 응답한다', async (status, solution) => {
      debateRepository.findOne.mockResolvedValue(
        buildDebate({ solution, winnerId: null }),
      );

      await expect(service.getJudgment(DEBATE_ID)).resolves.toEqual({
        debateId: DEBATE_ID,
        status,
        winner: null,
        winnerId: null,
        model: null,
        judgedAt: null,
        host: null,
        opponent: null,
      });
    });

    it('JUDGED면 점수·승부·판정이유·위반을 응답한다', async () => {
      debateRepository.findOne.mockResolvedValue(
        buildDebate({
          winnerId: HOST_ID,
          solution: {
            status: 'JUDGED',
            judgedAt: '2026-08-26T00:00:00.000Z',
            model: 'gpt-5.6-luna',
            winner: 'host',
            host: {
              score: 90,
              judgeReason: ['근거가 구체적이다'],
              violations: [],
              socialCreditPenalty: 0,
            },
            opponent: {
              score: 70,
              judgeReason: ['반론이 약하다'],
              violations: [
                {
                  type: 'personal_attack',
                  severity: 'moderate',
                  evidence: '상대를 비하하는 발언',
                },
              ],
              socialCreditPenalty: 3,
            },
          },
        }),
      );

      await expect(service.getJudgment(DEBATE_ID)).resolves.toEqual({
        debateId: DEBATE_ID,
        status: 'JUDGED',
        winner: 'host',
        winnerId: HOST_ID,
        model: 'gpt-5.6-luna',
        judgedAt: '2026-08-26T00:00:00.000Z',
        host: {
          memberId: HOST_ID,
          nickname: '메시',
          score: 90,
          judgeReason: ['근거가 구체적이다'],
          violations: [],
          socialCreditPenalty: 0,
        },
        opponent: {
          memberId: OPPONENT_ID,
          nickname: '호날두',
          score: 70,
          judgeReason: ['반론이 약하다'],
          // evidence는 상대 발언 원문이라 응답에 실리지 않는다.
          violations: [{ type: 'personal_attack', severity: 'moderate' }],
          socialCreditPenalty: 3,
        },
      });
    });
  });
});
