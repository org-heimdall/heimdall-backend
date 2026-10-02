import { Repository } from 'typeorm';
import { DebatePhase, DebateSide } from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import {
  FactCheckBatchIncompleteError,
  FactCheckerService,
  MAX_SOURCES,
} from './fact-checker.service';
import { NonRetryableTaskError } from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import {
  ArgumentComponentKind,
  ClaimType,
  JudgeTaskKind,
  JudgeTaskStatus,
  VerificationStatus,
} from './judge.types';
import { DebateArgumentComponent } from './entities/debate-argument.entity';
import { JudgeTask } from './entities/judge-task.entity';
import type {
  FactCheckBatchOutcome,
  FactCheckBatchRequest,
  FactCheckItemOutcome,
} from './llm/judge-llm';

describe('FactCheckerService', () => {
  const DEBATE_ID = 'debate-uuid';
  // 반론·질의 1라운드 토론: OPENING(1, 2) → 반론·질의 1(3, 4) → CLOSING(5, 6). 앵커는 4번 턴이다.
  const ANCHOR_ID = 'turn-4';

  let factChecker: { checkBatch: jest.Mock };
  let messages: { findOneBy: jest.Mock; find: jest.Mock };
  let results: {
    findUnresolvedTargets: jest.Mock;
    replaceFactCheck: jest.Mock;
  };
  let debates: { findOneOrThrow: jest.Mock };
  let service: FactCheckerService;

  const task = Object.assign(new JudgeTask(), {
    id: 'task-uuid',
    debateId: DEBATE_ID,
    kind: JudgeTaskKind.FACT_CHECK,
    targetId: ANCHOR_ID,
    status: JudgeTaskStatus.PROCESSING,
    attempt: 1,
    maxAttempts: 3,
  });

  const turn = (sequence: number, body: string): DebateMessage =>
    Object.assign(new DebateMessage(), {
      id: `turn-${sequence}`,
      debateId: DEBATE_ID,
      body,
      sequence,
    });

  const target = (
    id: string,
    overrides: Partial<DebateArgumentComponent> = {},
  ): DebateArgumentComponent =>
    Object.assign(new DebateArgumentComponent(), {
      id,
      debateId: DEBATE_ID,
      turnId: 'turn-3',
      turnSequence: 3,
      speakerSide: DebateSide.SIDE_A,
      kind: ArgumentComponentKind.EVIDENCE,
      statement: `${id} 논증 문장이라고 주장한다`,
      needsFactCheck: true,
      claimType: ClaimType.LAW_INSTITUTION,
      factCheckStatement: `${id} 검증 명제`,
      ...overrides,
    });

  const item = (
    ref: string,
    overrides: Partial<FactCheckItemOutcome> = {},
  ): FactCheckItemOutcome => ({
    ref,
    status: VerificationStatus.PARTIALLY_SUPPORTED,
    reason: '2024년 발효, 2025년부터 단계적 시행이다.',
    sources: [
      {
        title: 'EU AI Act',
        publisher: 'European Commission',
        url: 'https://digital-strategy.ec.europa.eu/ai-act',
      },
    ],
    ...overrides,
  });

  const batch = (
    items: FactCheckItemOutcome[],
    groundedDomains = ['digital-strategy.ec.europa.eu'],
  ): FactCheckBatchOutcome => ({ results: items, groundedDomains });

  beforeEach(() => {
    factChecker = {
      checkBatch: jest.fn().mockResolvedValue(batch([item('f1'), item('f2')])),
    };
    messages = {
      findOneBy: jest.fn().mockResolvedValue(turn(4, 'EU 사례는 다르다.')),
      find: jest
        .fn()
        .mockResolvedValue([
          turn(3, 'AI 규제는 필요하다. 2025년 EU가 AI법을 시행했다.'),
          turn(4, 'EU 사례는 다르다.'),
        ]),
    };
    results = {
      findUnresolvedTargets: jest
        .fn()
        .mockResolvedValue([target('c1'), target('c2')]),
      replaceFactCheck: jest.fn().mockResolvedValue(undefined),
    };
    debates = {
      findOneOrThrow: jest.fn().mockResolvedValue(
        Object.assign(new Debate(), {
          id: DEBATE_ID,
          topic: 'AI 규제, 필요한가?',
          rebuttalQuestionRounds: 1,
        }),
      ),
    };

    service = new FactCheckerService(
      factChecker,
      messages as unknown as Repository<DebateMessage>,
      results as unknown as JudgeResultRepository,
      debates as unknown as DebatesService,
    );
  });

  const request = (): FactCheckBatchRequest =>
    (factChecker.checkBatch.mock.calls[0] as [FactCheckBatchRequest])[0];

  it('라운드의 미해결 검증 대상을 한 번의 batch로 검증하고 명제마다 결과를 저장한다', async () => {
    await service.handle(task);

    expect(results.findUnresolvedTargets).toHaveBeenCalledWith(DEBATE_ID, [
      'turn-3',
      'turn-4',
    ]);
    expect(factChecker.checkBatch).toHaveBeenCalledTimes(1);
    expect(request()).toMatchObject({
      topic: 'AI 규제, 필요한가?',
      context:
        'AI 규제는 필요하다. 2025년 EU가 AI법을 시행했다.\n\nEU 사례는 다르다.',
      // 논증 문장이 아니라 정리된 검증 명제를 넘긴다.
      targets: [
        {
          ref: 'f1',
          statement: 'c1 검증 명제',
          claimType: ClaimType.LAW_INSTITUTION,
        },
        {
          ref: 'f2',
          statement: 'c2 검증 명제',
          claimType: ClaimType.LAW_INSTITUTION,
        },
      ],
    });
    expect(results.replaceFactCheck).toHaveBeenCalledTimes(2);
    expect(results.replaceFactCheck).toHaveBeenCalledWith({
      debateId: DEBATE_ID,
      componentId: 'c1',
      status: VerificationStatus.PARTIALLY_SUPPORTED,
      reason: '2024년 발효, 2025년부터 단계적 시행이다.',
      sources: item('f1').sources,
    });
  });

  it('검증 명제가 없는 레거시 컴포넌트는 논증 문장으로 검증한다', async () => {
    results.findUnresolvedTargets.mockResolvedValue([
      target('c1', { factCheckStatement: null, claimType: null }),
    ]);
    factChecker.checkBatch.mockResolvedValue(batch([item('f1')]));

    await service.handle(task);

    expect(request().targets).toEqual([
      { ref: 'f1', statement: 'c1 논증 문장이라고 주장한다', claimType: null },
    ]);
  });

  it('호출 로그 컨텍스트에 라운드의 phase·round와 검증 대상 컴포넌트들을 싣는다', async () => {
    await service.handle(task);

    // 필드 순서가 로그 순서다.
    expect(Object.entries(request().logContext)).toEqual([
      ['stage', 'grounded_check'],
      ['debateId', DEBATE_ID],
      ['phase', DebatePhase.REBUTTAL_QUESTION],
      ['round', 1],
      ['targets', ['c1', 'c2']],
    ]);
  });

  it('남은 검증 대상이 없으면 호출하지 않고 성공으로 끝낸다(멱등)', async () => {
    results.findUnresolvedTargets.mockResolvedValue([]);

    await service.handle(task);

    expect(factChecker.checkBatch).not.toHaveBeenCalled();
  });

  it('일부 명제의 결과가 빠지면 받은 것은 저장하고 재시도 가능한 예외로 남은 것을 알린다', async () => {
    factChecker.checkBatch.mockResolvedValue(batch([item('f1')]));

    await expect(service.handle(task)).rejects.toThrow(
      FactCheckBatchIncompleteError,
    );
    expect(results.replaceFactCheck).toHaveBeenCalledTimes(1);
    expect(results.replaceFactCheck).toHaveBeenCalledWith(
      expect.objectContaining({ componentId: 'c1' }),
    );
  });

  it('요청하지 않은 ref와 같은 ref의 두 번째 답은 무시한다', async () => {
    factChecker.checkBatch.mockResolvedValue(
      batch([
        item('f1'),
        item('f1', { status: VerificationStatus.CONTRADICTED }),
        item('f2'),
        item('f9'),
      ]),
    );

    await service.handle(task);

    expect(results.replaceFactCheck).toHaveBeenCalledTimes(2);
    expect(results.replaceFactCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: 'c1',
        status: VerificationStatus.PARTIALLY_SUPPORTED,
      }),
    );
  });

  it('출처가 상한을 넘으면 검색 결과와 일치하는 출처를 먼저 두고 잘라 저장한다', async () => {
    const source = (host: string) => ({
      title: host,
      publisher: host,
      url: `https://${host}/a`,
    });
    // 검색 결과와 무관한 출처가 앞에 와도 일치하는 출처가 먼저 남는다.
    const ungrounded = ['a.com', 'b.com', 'c.com'].map(source);
    const grounded = ['x.com', 'y.com'].map(source);
    results.findUnresolvedTargets.mockResolvedValue([target('c1')]);
    factChecker.checkBatch.mockResolvedValue(
      batch(
        [item('f1', { sources: [...ungrounded, ...grounded] })],
        ['x.com', 'y.com'],
      ),
    );

    await service.handle(task);

    expect(results.replaceFactCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [...grounded, ungrounded[0]].slice(0, MAX_SOURCES),
      }),
    );
  });

  describe('명제별 검증(Source Validator · 근거 설명 규칙)', () => {
    beforeEach(() => {
      results.findUnresolvedTargets.mockResolvedValue([target('c1')]);
    });

    const rejects = async (
      overrides: Partial<FactCheckItemOutcome>,
      groundedDomains?: string[],
    ) => {
      factChecker.checkBatch.mockResolvedValue(
        batch([item('f1', overrides)], groundedDomains),
      );

      await expect(service.handle(task)).rejects.toThrow(
        FactCheckBatchIncompleteError,
      );
      // 거부된 결과는 저장되지 않고 예외가 올라가 worker가 재시도한다.
      expect(results.replaceFactCheck).not.toHaveBeenCalled();
    };

    it('www가 붙거나 하위 도메인이어도 같은 출처로 본다', async () => {
      factChecker.checkBatch.mockResolvedValue(
        batch(
          [
            item('f1', {
              sources: [
                {
                  title: '기사',
                  publisher: '연합뉴스',
                  url: 'https://www.news.yna.co.kr/view/1',
                },
              ],
            }),
          ],
          ['yna.co.kr'],
        ),
      );

      await service.handle(task);

      expect(results.replaceFactCheck).toHaveBeenCalled();
    });

    it.each([
      ['출처가 없으면', { sources: [] }],
      [
        'URL 형식이 잘못됐으면',
        { sources: [{ title: 'x', publisher: 'y', url: 'not-a-url' }] },
      ],
      [
        'http(s)가 아니면',
        {
          sources: [{ title: 'x', publisher: 'y', url: 'ftp://example.com/a' }],
        },
      ],
      ['판정 근거 설명이 비어 있으면', { reason: '  ' }],
      [
        '근거 설명이 발언자를 언급하면',
        { reason: '발언자는 출처를 정확히 인용하지 않았다.' },
      ],
      [
        '근거 설명이 토론 평가를 담으면',
        { reason: '사실이지만 이 주장만으로는 설득력이 약하다.' },
      ],
      [
        '근거 설명에 참여자 표기가 있으면',
        { reason: 'SIDE_A의 말은 사실이다.' },
      ],
    ])('%s 거부한다', async (_name, overrides) => {
      await rejects(overrides);
    });

    it('검색 근거가 없으면 거부한다', async () => {
      await rejects({}, []);
    });

    it('출처가 검색 결과와 무관하면 거부한다', async () => {
      await rejects({}, ['example.com']);
    });

    it.each([
      VerificationStatus.INSUFFICIENT_EVIDENCE,
      VerificationStatus.NOT_VERIFIABLE,
    ])('%s 판정은 출처가 없어도 저장된다', async (status) => {
      factChecker.checkBatch.mockResolvedValue(
        batch([item('f1', { status, sources: [] })], []),
      );

      await service.handle(task);

      expect(results.replaceFactCheck).toHaveBeenCalledWith(
        expect.objectContaining({ status, sources: [] }),
      );
    });
  });

  it('앵커 턴이 없으면(레거시 컴포넌트 단위 작업 포함) 재시도 불가로 끝낸다', async () => {
    messages.findOneBy.mockResolvedValue(null);

    await expect(service.handle(task)).rejects.toThrow(NonRetryableTaskError);
  });

  it('stage 메시지 접두사로 몇 번째 라운드인지 알린다', async () => {
    await expect(service.describe(task)).resolves.toBe('round #2');
  });
});
