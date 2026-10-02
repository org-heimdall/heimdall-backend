import { QueryFailedError, Repository } from 'typeorm';
import { DebatePhase, DebateSide } from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate, DebateTurn } from '../debates/entities/debate.entity';
import {
  ArgumentGraphValidationError,
  ArgumentAnalyzerService,
  ClaimHashConflictError,
  MAX_FACT_CHECKS_PER_ROUND,
  MAX_STATEMENT_LENGTH,
} from './argument-analyzer.service';
import { hashClaim } from './claim-normalizer';
import { FactCheckTargetPolicy } from './fact-check-target.policy';
import { JudgeTaskQueue, NonRetryableTaskError } from './judge-task.worker';
import {
  GraphComponentInput,
  JudgeResultRepository,
  ReplaceRoundGraphInput,
} from './judge-result.repository';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  ClaimType,
  FactCheckExclusionReason,
  JudgeTaskKind,
  JudgeTaskStatus,
} from './judge.types';
import {
  ARGUMENT_COMPONENT_CLAIM_HASH_UNIQUE,
  DebateArgumentComponent,
} from './entities/debate-argument.entity';
import { JudgeTask } from './entities/judge-task.entity';
import type {
  AnalyzedComponent,
  AnalyzerRequest,
  AnalyzerResult,
} from './llm/judge-llm';

describe('ArgumentAnalyzerService', () => {
  const DEBATE_ID = 'debate-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  // 반론·질의 0라운드: OPENING(1, 2) → CLOSING(3, 4). OPENING 라운드를 닫는 턴은 2번이다.
  const TURN_A_ID = 'turn-1';
  const TURN_B_ID = 'turn-2';

  let analyzer: { analyze: jest.Mock };
  let messages: { findOneBy: jest.Mock; find: jest.Mock };
  let graph: {
    findComponentsBefore: jest.Mock;
    replaceRoundGraph: jest.Mock;
  };
  let debates: { findOneOrThrow: jest.Mock };
  let queue: { reschedule: jest.Mock };
  let service: ArgumentAnalyzerService;

  const task = Object.assign(new JudgeTask(), {
    id: 'task-uuid',
    debateId: DEBATE_ID,
    kind: JudgeTaskKind.ANALYZER,
    targetId: TURN_B_ID,
    status: JudgeTaskStatus.PROCESSING,
    attempt: 1,
    maxAttempts: 3,
  });

  const buildTurn = (
    sequence: number,
    body: string,
    overrides: Partial<DebateMessage> = {},
  ): DebateMessage =>
    Object.assign(new DebateMessage(), {
      id: `turn-${sequence}`,
      debateId: DEBATE_ID,
      memberId: sequence % 2 === 1 ? HOST_ID : OPPONENT_ID,
      body,
      sequence,
      createdAt: new Date(),
      ...overrides,
    });

  const turnA = buildTurn(
    1,
    'AI 규제는 필요하다. 2025년 EU가 AI법을 시행했다.',
  );
  const turnB = buildTurn(2, '규제는 혁신을 막는다.');

  const buildDebate = (): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      topic: 'AI 규제, 필요한가?',
      hostId: HOST_ID,
      hostNickname: '메시',
      opponentId: OPPONENT_ID,
      opponentNickname: '호날두',
      currentTurn: DebateTurn.HOST,
      rebuttalQuestionRounds: 0,
    });

  const component = (
    ref: string,
    overrides: Partial<AnalyzedComponent> = {},
  ): AnalyzedComponent => ({
    ref,
    turnRef: 't1',
    kind: ArgumentComponentKind.CLAIM,
    statement: '문장',
    claimType: ClaimType.OPINION,
    needsFactCheck: false,
    factCheckStatement: null,
    duplicateOfRef: null,
    ...overrides,
  });

  const analyzed = (
    overrides: Partial<AnalyzerResult> = {},
  ): AnalyzerResult => ({
    components: [
      component('c1', { statement: 'AI 규제가 필요하다' }),
      component('c2', {
        kind: ArgumentComponentKind.EVIDENCE,
        statement: '2025년 EU가 AI법을 시행했다고 주장한다',
        claimType: ClaimType.LAW_INSTITUTION,
        needsFactCheck: true,
        factCheckStatement: '2025년 EU가 AI법을 시행했다.',
      }),
      component('c3', {
        turnRef: 't2',
        kind: ArgumentComponentKind.REBUTTAL,
        statement: '규제는 혁신을 막는다',
      }),
    ],
    relations: [
      { fromRef: 'c2', toRef: 'c1', kind: ArgumentRelationKind.SUPPORT },
      { fromRef: 'c3', toRef: 'c1', kind: ArgumentRelationKind.ATTACK },
    ],
    ...overrides,
  });

  const savedInput = (): ReplaceRoundGraphInput =>
    (graph.replaceRoundGraph.mock.calls[0] as [ReplaceRoundGraphInput])[0];

  const savedComponent = (ref: string): GraphComponentInput =>
    savedInput().components.find(
      (candidate) => candidate.ref === ref,
    ) as GraphComponentInput;

  beforeEach(() => {
    analyzer = { analyze: jest.fn().mockResolvedValue(analyzed()) };
    messages = {
      findOneBy: jest.fn().mockResolvedValue(turnB),
      find: jest.fn().mockResolvedValue([turnA, turnB]),
    };
    graph = {
      findComponentsBefore: jest.fn().mockResolvedValue([]),
      replaceRoundGraph: jest.fn().mockResolvedValue([]),
    };
    debates = { findOneOrThrow: jest.fn().mockResolvedValue(buildDebate()) };
    queue = { reschedule: jest.fn().mockResolvedValue(undefined) };

    service = new ArgumentAnalyzerService(
      analyzer,
      messages as unknown as Repository<DebateMessage>,
      graph as unknown as JudgeResultRepository,
      debates as unknown as DebatesService,
      queue as unknown as JudgeTaskQueue,
      new FactCheckTargetPolicy(),
    );
  });

  it('라운드의 발언을 함께 넘겨 분석하고, 컴포넌트를 나온 턴의 발언자에게 귀속해 저장한다', async () => {
    await service.handle(task);

    const [request] = analyzer.analyze.mock.calls[0] as [AnalyzerRequest];
    expect(request.topic).toBe('AI 규제, 필요한가?');
    expect(request.round).toEqual({
      phase: DebatePhase.OPENING,
      round: 1,
      turns: [
        {
          ref: 't1',
          sequence: 1,
          speakerSide: DebateSide.SIDE_A,
          speakerNickname: '메시',
          content: turnA.body,
        },
        {
          ref: 't2',
          sequence: 2,
          speakerSide: DebateSide.SIDE_B,
          speakerNickname: '호날두',
          content: turnB.body,
        },
      ],
    });
    // 호출 로그에 붙는 도메인 컨텍스트. 필드 순서가 로그 순서다.
    expect(Object.entries(request.logContext)).toEqual([
      ['debateId', DEBATE_ID],
      ['turnIds', [TURN_A_ID, TURN_B_ID]],
      ['phase', DebatePhase.OPENING],
      ['round', 1],
    ]);

    expect(savedInput()).toMatchObject({
      debateId: DEBATE_ID,
      turnIds: [TURN_A_ID, TURN_B_ID],
      relations: analyzed().relations,
    });
    expect(savedComponent('c1')).toMatchObject({
      turnId: TURN_A_ID,
      turnSequence: 1,
      speakerId: HOST_ID,
      speakerSide: DebateSide.SIDE_A,
    });
    expect(savedComponent('c3')).toMatchObject({
      turnId: TURN_B_ID,
      turnSequence: 2,
      speakerId: OPPONENT_ID,
      speakerSide: DebateSide.SIDE_B,
    });
  });

  it('라운드 이전 컴포넌트를 별칭과 검증 명제와 함께 넘기고, 저장할 때 실제 id로 되돌린다', async () => {
    messages.findOneBy.mockResolvedValue(buildTurn(4, '마무리'));
    messages.find.mockResolvedValue([
      buildTurn(3, '정리합니다'),
      buildTurn(4, '마무리'),
    ]);
    analyzer.analyze.mockResolvedValue(
      analyzed({ components: [component('c1')], relations: [] }),
    );
    graph.findComponentsBefore.mockResolvedValue([
      Object.assign(new DebateArgumentComponent(), {
        id: 'old-claim',
        speakerSide: DebateSide.SIDE_B,
        kind: ArgumentComponentKind.CLAIM,
        statement: '규제는 혁신을 막는다',
        needsFactCheck: false,
        factCheckStatement: null,
      }),
      Object.assign(new DebateArgumentComponent(), {
        id: 'old-evidence',
        speakerSide: DebateSide.SIDE_A,
        kind: ArgumentComponentKind.EVIDENCE,
        statement: 'EU가 AI법을 시행했다고 말했다',
        needsFactCheck: true,
        factCheckStatement: '2025년 EU가 AI법을 시행했다.',
      }),
    ]);

    await service.handle({ ...task, targetId: 'turn-4' });

    // CLOSING 라운드의 첫 턴(3번) 이전 컴포넌트를 본다.
    expect(graph.findComponentsBefore).toHaveBeenCalledWith(DEBATE_ID, 3);
    const [request] = analyzer.analyze.mock.calls[0] as [AnalyzerRequest];
    expect(request.previousComponents).toEqual([
      expect.objectContaining({ ref: 'p1', factCheckStatement: null }),
      expect.objectContaining({
        ref: 'p2',
        factCheckStatement: '2025년 EU가 AI법을 시행했다.',
      }),
    ]);
    expect(savedInput().knownRefToId.get('p2')).toBe('old-evidence');
  });

  it('검증 대상이 있으면 라운드를 닫는 턴으로 FactCheck batch 작업 하나를 (다시) 돌린다', async () => {
    await service.handle(task);

    expect(queue.reschedule).toHaveBeenCalledTimes(1);
    expect(queue.reschedule).toHaveBeenCalledWith(
      DEBATE_ID,
      JudgeTaskKind.FACT_CHECK,
      TURN_B_ID,
    );
  });

  it('검증 대상이 없으면 FactCheck 작업을 만들지 않는다', async () => {
    analyzer.analyze.mockResolvedValue(
      analyzed({ components: [component('c1')], relations: [] }),
    );

    await service.handle(task);

    expect(queue.reschedule).not.toHaveBeenCalled();
  });

  it('라운드 중간 턴을 가리키는 이전 작업이 와도 같은 라운드를 분석하고 앵커는 라운드를 닫는 턴이다', async () => {
    messages.findOneBy.mockResolvedValue(turnA);

    await service.handle({ ...task, targetId: TURN_A_ID });

    expect(savedInput().turnIds).toEqual([TURN_A_ID, TURN_B_ID]);
    expect(queue.reschedule).toHaveBeenCalledWith(
      DEBATE_ID,
      JudgeTaskKind.FACT_CHECK,
      TURN_B_ID,
    );
  });

  it('비어 있는 턴은 분석에 넣지 않지만 교체 범위에는 포함한다', async () => {
    messages.find.mockResolvedValue([turnA, buildTurn(2, '')]);
    analyzer.analyze.mockResolvedValue(
      analyzed({ components: [component('c1')], relations: [] }),
    );

    await service.handle(task);

    const [request] = analyzer.analyze.mock.calls[0] as [AnalyzerRequest];
    expect(request.round.turns.map((turn) => turn.ref)).toEqual(['t1']);
    expect(savedInput().turnIds).toEqual([TURN_A_ID, TURN_B_ID]);
  });

  describe('검증 대상 선별(정책 적용)', () => {
    it('정책이 정리한 검증 명제·hash·유형을 저장한다', async () => {
      await service.handle(task);

      expect(savedComponent('c2')).toMatchObject({
        needsFactCheck: true,
        claimType: ClaimType.LAW_INSTITUTION,
        factCheckStatement: '2025년 EU가 AI법을 시행했다.',
        claimHash: hashClaim('2025년 EU가 AI법을 시행했다.'),
        factCheckExclusionReason: null,
      });
      // 검증을 요청하지 않은 조각은 대상도, 사유도 없다.
      expect(savedComponent('c1')).toMatchObject({
        needsFactCheck: false,
        factCheckExclusionReason: null,
      });
    });

    it('이전 라운드에서 검증 대상이 된 주장과 같으면 중복으로 빼고 그 컴포넌트를 가리킨다', async () => {
      graph.findComponentsBefore.mockResolvedValue([
        Object.assign(new DebateArgumentComponent(), {
          id: 'old-evidence',
          speakerSide: DebateSide.SIDE_A,
          kind: ArgumentComponentKind.EVIDENCE,
          statement: '근거',
          needsFactCheck: true,
          factCheckStatement: '2025년 EU가 AI법을 시행했다.',
          claimHash: hashClaim('2025년 EU가 AI법을 시행했다.'),
        }),
      ]);

      await service.handle(task);

      expect(savedComponent('c2')).toMatchObject({
        needsFactCheck: false,
        factCheckExclusionReason: FactCheckExclusionReason.DUPLICATE,
        duplicateOfRef: 'p1',
      });
      expect(queue.reschedule).not.toHaveBeenCalled();
    });

    it('검증 대상이 라운드 상한을 넘으면 넘친 것은 OVER_LIMIT으로 남기고 그래프에는 모두 저장한다', async () => {
      const components = Array.from(
        { length: MAX_FACT_CHECKS_PER_ROUND + 2 },
        (_, index) =>
          component(`c${index + 1}`, {
            kind: ArgumentComponentKind.EVIDENCE,
            claimType: ClaimType.STATISTIC,
            needsFactCheck: true,
            factCheckStatement: `${2000 + index}년 지표는 ${index}%였다.`,
          }),
      );
      analyzer.analyze.mockResolvedValue(
        analyzed({ components, relations: [] }),
      );

      await service.handle(task);

      const saved = savedInput().components;
      expect(saved).toHaveLength(components.length);
      expect(saved.map((item) => item.needsFactCheck)).toEqual(
        components.map((_, index) => index < MAX_FACT_CHECKS_PER_ROUND),
      );
      expect(saved.at(-1)?.factCheckExclusionReason).toBe(
        FactCheckExclusionReason.OVER_LIMIT,
      );
    });
  });

  it('다른 분석이 같은 주장을 먼저 저장했으면(claim hash unique 위반) 재시도 가능한 예외로 올린다', async () => {
    const violation = new QueryFailedError('INSERT', [], new Error('dup'));
    Object.assign(violation, {
      driverError: {
        code: '23505',
        constraint: ARGUMENT_COMPONENT_CLAIM_HASH_UNIQUE,
      },
    });
    graph.replaceRoundGraph.mockRejectedValue(violation);

    await expect(service.handle(task)).rejects.toThrow(ClaimHashConflictError);
    expect(queue.reschedule).not.toHaveBeenCalled();
  });

  describe('Graph Validator', () => {
    const rejects = async (result: AnalyzerResult) => {
      analyzer.analyze.mockResolvedValue(result);

      await expect(service.handle(task)).rejects.toThrow(
        ArgumentGraphValidationError,
      );
      // 거부된 결과는 저장되지 않고 예외가 올라가 worker가 재시도한다.
      expect(graph.replaceRoundGraph).not.toHaveBeenCalled();
    };

    beforeEach(() => {
      // 이전 라운드 컴포넌트 p1이 있는 상태로 둔다.
      graph.findComponentsBefore.mockResolvedValue([
        Object.assign(new DebateArgumentComponent(), {
          id: 'old-component-uuid',
          speakerSide: DebateSide.SIDE_B,
          kind: ArgumentComponentKind.CLAIM,
          statement: '이전 주장',
          needsFactCheck: false,
        }),
      ]);
    });

    it('이전 라운드 컴포넌트를 가리키는 관계는 통과시킨다', async () => {
      analyzer.analyze.mockResolvedValue(
        analyzed({
          relations: [
            { fromRef: 'c1', toRef: 'p1', kind: ArgumentRelationKind.ATTACK },
          ],
        }),
      );

      await service.handle(task);

      expect(graph.replaceRoundGraph).toHaveBeenCalled();
    });

    it('존재하지 않는 컴포넌트를 가리키면 거부한다', async () => {
      await rejects(
        analyzed({
          relations: [
            { fromRef: 'c1', toRef: 'p9', kind: ArgumentRelationKind.ATTACK },
          ],
        }),
      );
    });

    it('이전 라운드 컴포넌트가 관계를 거는(from) 것은 거부한다', async () => {
      await rejects(
        analyzed({
          relations: [
            { fromRef: 'p1', toRef: 'c1', kind: ArgumentRelationKind.ATTACK },
          ],
        }),
      );
    });

    it('자기 자신을 가리키는 관계를 거부한다', async () => {
      await rejects(
        analyzed({
          relations: [
            { fromRef: 'c1', toRef: 'c1', kind: ArgumentRelationKind.SUPPORT },
          ],
        }),
      );
    });

    it('같은 라운드에서 먼저 한 발언이 나중 발언을 가리키면 거부한다', async () => {
      await rejects(
        analyzed({
          relations: [
            { fromRef: 'c1', toRef: 'c3', kind: ArgumentRelationKind.ATTACK },
          ],
        }),
      );
    });

    it.each([
      ['ref가 중복되면', [component('c1'), component('c1')]],
      ['ref가 이전 라운드 것과 겹치면', [component('p1')]],
      ['문장이 비어 있으면', [component('c1', { statement: '  ' })]],
      [
        '문장이 너무 길면',
        [component('c1', { statement: 'ㄱ'.repeat(MAX_STATEMENT_LENGTH + 1) })],
      ],
      ['라운드에 없는 발언을 가리키면', [component('c1', { turnRef: 't9' })]],
    ])('%s 거부한다', async (_name, components) => {
      await rejects(analyzed({ components, relations: [] }));
    });
  });

  it('확정 턴이 없으면 재시도 불가로 끝낸다', async () => {
    messages.findOneBy.mockResolvedValue(null);

    await expect(service.handle(task)).rejects.toThrow(NonRetryableTaskError);
  });

  it('stage 메시지 접두사로 몇 번째 라운드인지 알린다', async () => {
    messages.findOneBy.mockResolvedValue(buildTurn(4, '마무리'));

    // 반론·질의 0라운드에서 4번째 턴은 CLOSING = 2번째 라운드다.
    await expect(service.describe(task)).resolves.toBe('round #2');
  });
});
