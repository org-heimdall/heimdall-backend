import { Debate, DebateTurn } from '../debates/entities/debate.entity';
import { DebateSide } from '../debates/debate-turn';
import { Member } from '../members/entities/member.entity';
import { MembersService } from '../members/members.service';
import { DebateResultPresenter } from './debate-result.presenter';
import { JudgeResultRepository } from './judge-result.repository';
import {
  ArgumentComponentKind,
  ClaimType,
  JudgmentWinner,
  VerificationStatus,
} from './judge.types';
import { DebateArgumentComponent } from './entities/debate-argument.entity';
import { DebateFactCheckResult } from './entities/debate-fact-check.entity';
import { DebateJudgmentResult } from './entities/debate-judgment-result.entity';

describe('DebateResultPresenter', () => {
  const DEBATE_ID = 'debate-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';

  let members: { findByIds: jest.Mock };
  let results: { findFactChecks: jest.Mock; findComponents: jest.Mock };
  let presenter: DebateResultPresenter;

  const debate = Object.assign(new Debate(), {
    id: DEBATE_ID,
    hostId: HOST_ID,
    hostNickname: '옛닉네임A',
    opponentId: OPPONENT_ID,
    opponentNickname: '옛닉네임B',
    currentTurn: DebateTurn.HOST,
    rebuttalQuestionRounds: 0,
  });

  const member = (
    id: string,
    nickname: string,
    profileImageUrl: string | null,
  ) => Object.assign(new Member(), { id, nickname, profileImageUrl });

  const judgment = (overrides: Partial<DebateJudgmentResult> = {}) =>
    Object.assign(new DebateJudgmentResult(), {
      id: 'judgment-uuid',
      debateId: DEBATE_ID,
      winner: JudgmentWinner.SIDE_A,
      overallReason:
        '{{SIDE_A}}는 근거가 구체적이었고 {{SIDE_B}}는 질문에 답하지 못했다.',
      sideAFeedback: '{{SIDE_A}}는 반박을 더 다듬으면 좋겠다.',
      sideBFeedback: '{{SIDE_B}}는 근거를 보강하면 좋겠다.',
      judgedAt: new Date('2026-09-07T12:20:00.000Z'),
      ...overrides,
    });

  beforeEach(() => {
    members = {
      findByIds: jest
        .fn()
        .mockResolvedValue([
          member(HOST_ID, '메시', 'https://cdn.example.com/a.png'),
          member(OPPONENT_ID, '호날두', null),
        ]),
    };
    results = {
      findFactChecks: jest.fn().mockResolvedValue([]),
      findComponents: jest.fn().mockResolvedValue([]),
    };
    presenter = new DebateResultPresenter(
      members as unknown as MembersService,
      results as unknown as JudgeResultRepository,
    );
  });

  it('회원의 현재 프로필로 참여자 블록을 채우고 승자 회원 id를 싣는다', async () => {
    const result = await presenter.presentJudgment(debate, judgment());

    expect(members.findByIds).toHaveBeenCalledWith([HOST_ID, OPPONENT_ID]);
    expect(result.sideAParticipant).toEqual({
      side: DebateSide.SIDE_A,
      memberId: HOST_ID,
      nickname: '메시',
      profileImageUrl: 'https://cdn.example.com/a.png',
    });
    expect(result.sideBParticipant).toMatchObject({
      memberId: OPPONENT_ID,
      nickname: '호날두',
      profileImageUrl: null,
    });
    expect(result.winner).toBe(JudgmentWinner.SIDE_A);
    expect(result.winnerMemberId).toBe(HOST_ID);
  });

  it('총평·피드백의 side 표기를 현재 닉네임으로 렌더링한다', async () => {
    const result = await presenter.presentJudgment(debate, judgment());

    expect(result.overallReason).toBe(
      '메시는 근거가 구체적이었고 호날두는 질문에 답하지 못했다.',
    );
    expect(result.sideAFeedback).toBe('메시는 반박을 더 다듬으면 좋겠다.');
    expect(result.sideBFeedback).toBe('호날두는 근거를 보강하면 좋겠다.');
  });

  it('이 규칙 이전에 저장된 원문(SIDE_A 노출분)도 렌더링 결과에 side 토큰이 남지 않는다', async () => {
    const result = await presenter.presentJudgment(
      debate,
      judgment({
        overallReason:
          'SIDE_A가 SIDE_B보다 근거가 강했다. 측면 B는 답변이 약했다.',
      }),
    );

    expect(result.overallReason).toBe(
      '메시가 호날두보다 근거가 강했다. 호날두는 답변이 약했다.',
    );
    expect(result.overallReason).not.toMatch(/SIDE/);
  });

  it('회원을 찾지 못하면 토론에 복사해 둔 닉네임을 쓰고 아바타는 비운다', async () => {
    members.findByIds.mockResolvedValue([member(HOST_ID, '메시', null)]);

    const result = await presenter.presentJudgment(debate, judgment());

    expect(result.sideBParticipant).toMatchObject({
      memberId: OPPONENT_ID,
      nickname: '옛닉네임B',
      profileImageUrl: null,
    });
    expect(result.overallReason).toContain('옛닉네임B는');
  });

  it('무승부면 승자 회원 id가 없다', async () => {
    const result = await presenter.presentJudgment(
      debate,
      judgment({ winner: JudgmentWinner.DRAW }),
    );

    expect(result.winner).toBe(JudgmentWinner.DRAW);
    expect(result.winnerMemberId).toBeNull();
  });

  describe('presentFactChecks', () => {
    const component = (
      id: string,
      turnSequence: number,
      overrides: Partial<DebateArgumentComponent> = {},
    ) =>
      Object.assign(new DebateArgumentComponent(), {
        id,
        debateId: DEBATE_ID,
        turnId: `turn-${turnSequence}`,
        turnSequence,
        speakerId: HOST_ID,
        speakerSide: DebateSide.SIDE_A,
        kind: ArgumentComponentKind.EVIDENCE,
        statement: `${id} 논증 문장이라고 발언자는 주장한다`,
        needsFactCheck: true,
        claimType: ClaimType.STATISTIC,
        factCheckStatement: `${id} 검증 명제`,
        claimHash: `hash-${id}`,
        ...overrides,
      });

    const check = (
      componentId: string,
      status = VerificationStatus.SUPPORTED,
    ) =>
      Object.assign(new DebateFactCheckResult(), {
        id: `check-${componentId}`,
        debateId: DEBATE_ID,
        componentId,
        status,
        reason: '근거',
        sources: [],
        checkedAt: new Date('2026-09-07T12:15:00.000Z'),
      });

    it('발언 순서대로 검증 명제·원본 턴·주장 유형을 실어 내보낸다', async () => {
      // 검증 결과는 저장된 순서(나중 턴이 먼저)와 무관하게 발언 순서로 나간다.
      results.findFactChecks.mockResolvedValue([check('c2'), check('c1')]);
      results.findComponents.mockResolvedValue([
        component('c1', 1),
        component('c2', 3),
      ]);

      const cards = await presenter.presentFactChecks(DEBATE_ID);

      expect(cards.map((card) => card.componentId)).toEqual(['c1', 'c2']);
      expect(cards[0]).toMatchObject({
        id: 'check-c1',
        turnId: 'turn-1',
        claimType: ClaimType.STATISTIC,
        statement: 'c1 검증 명제',
        speakerId: HOST_ID,
        speakerSide: DebateSide.SIDE_A,
        status: VerificationStatus.SUPPORTED,
      });
    });

    it('NOT_VERIFIABLE 결과는 카드로 내보내지 않는다', async () => {
      results.findFactChecks.mockResolvedValue([
        check('c1', VerificationStatus.NOT_VERIFIABLE),
        check('c2'),
      ]);
      results.findComponents.mockResolvedValue([
        component('c1', 1),
        component('c2', 2),
      ]);

      const cards = await presenter.presentFactChecks(DEBATE_ID);

      expect(cards.map((card) => card.componentId)).toEqual(['c2']);
    });

    it('같은 주장(claim hash)의 카드는 처음 것만 남긴다', async () => {
      results.findFactChecks.mockResolvedValue([check('c1'), check('c2')]);
      results.findComponents.mockResolvedValue([
        component('c1', 1, { claimHash: 'same' }),
        component('c2', 2, { claimHash: 'same' }),
      ]);

      const cards = await presenter.presentFactChecks(DEBATE_ID);

      expect(cards.map((card) => card.componentId)).toEqual(['c1']);
    });

    it('레거시 행은 논증 문장으로 대신하고, 정규화가 같은 문장끼리 중복을 거른다', async () => {
      const legacy = {
        claimType: null,
        factCheckStatement: null,
        claimHash: null,
      };
      results.findFactChecks.mockResolvedValue([check('c1'), check('c2')]);
      results.findComponents.mockResolvedValue([
        component('c1', 1, {
          ...legacy,
          statement: 'NPT 탈퇴는 자동 제재가 아니다.',
        }),
        component('c2', 2, {
          ...legacy,
          statement: 'NPT 탈퇴는  자동 제재가 아니다',
        }),
      ]);

      const cards = await presenter.presentFactChecks(DEBATE_ID);

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        statement: 'NPT 탈퇴는 자동 제재가 아니다.',
        claimType: null,
      });
    });

    it('컴포넌트가 사라진 결과는 보여 줄 문장이 없어 뺀다', async () => {
      results.findFactChecks.mockResolvedValue([check('gone')]);
      results.findComponents.mockResolvedValue([]);

      await expect(presenter.presentFactChecks(DEBATE_ID)).resolves.toEqual([]);
    });
  });
});
