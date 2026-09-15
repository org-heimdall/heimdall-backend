import { Repository } from 'typeorm';
import { DebateSide } from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate, DebateTurn } from '../debates/entities/debate.entity';
import {
  ArgumentGraphValidationError,
  ArgumentAnalyzerService,
  MAX_STATEMENT_LENGTH,
} from './argument-analyzer.service';
import { JudgeTaskQueue, NonRetryableTaskError } from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  JudgeTaskKind,
  JudgeTaskStatus,
} from './judge.types';
import { DebateArgumentComponent } from './entities/debate-argument.entity';
import { JudgeTask } from './entities/judge-task.entity';
import type { AnalyzerRequest, AnalyzerResult } from './llm/judge-llm';

describe('ArgumentAnalyzerService', () => {
  const DEBATE_ID = 'debate-uuid';
  const TURN_ID = 'turn-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';

  let analyzer: { analyze: jest.Mock };
  let messages: { findOneBy: jest.Mock };
  let graph: {
    findComponentsBefore: jest.Mock;
    replaceTurnGraph: jest.Mock;
  };
  let debates: { findOneOrThrow: jest.Mock };
  let queue: { schedule: jest.Mock };
  let service: ArgumentAnalyzerService;

  const task = Object.assign(new JudgeTask(), {
    id: 'task-uuid',
    debateId: DEBATE_ID,
    kind: JudgeTaskKind.ANALYZER,
    targetId: TURN_ID,
    status: JudgeTaskStatus.PROCESSING,
    attempt: 1,
    maxAttempts: 3,
  });

  const buildTurn = (overrides: Partial<DebateMessage> = {}): DebateMessage =>
    Object.assign(new DebateMessage(), {
      id: TURN_ID,
      debateId: DEBATE_ID,
      memberId: HOST_ID,
      body: 'AI 규제는 필요하다. 2025년 EU가 AI법을 시행했다.',
      sequence: 1,
      createdAt: new Date(),
      ...overrides,
    });

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

  const analyzed = (
    overrides: Partial<AnalyzerResult> = {},
  ): AnalyzerResult => ({
    components: [
      {
        ref: 'c1',
        kind: ArgumentComponentKind.CLAIM,
        statement: 'AI 규제가 필요하다',
        needsFactCheck: false,
      },
      {
        ref: 'c2',
        kind: ArgumentComponentKind.EVIDENCE,
        statement: '2025년 EU가 AI법을 시행했다',
        needsFactCheck: true,
      },
    ],
    relations: [
      { fromRef: 'c2', toRef: 'c1', kind: ArgumentRelationKind.SUPPORT },
    ],
    ...overrides,
  });

  const savedComponents = (): DebateArgumentComponent[] =>
    analyzed().components.map((component, index) =>
      Object.assign(new DebateArgumentComponent(), {
        id: `component-${index + 1}`,
        debateId: DEBATE_ID,
        turnId: TURN_ID,
        turnSequence: 1,
        speakerId: HOST_ID,
        speakerSide: DebateSide.SIDE_A,
        kind: component.kind,
        statement: component.statement,
        needsFactCheck: component.needsFactCheck,
      }),
    );

  beforeEach(() => {
    analyzer = { analyze: jest.fn().mockResolvedValue(analyzed()) };
    messages = { findOneBy: jest.fn().mockResolvedValue(buildTurn()) };
    graph = {
      findComponentsBefore: jest.fn().mockResolvedValue([]),
      replaceTurnGraph: jest.fn().mockResolvedValue(savedComponents()),
    };
    debates = { findOneOrThrow: jest.fn().mockResolvedValue(buildDebate()) };
    queue = { schedule: jest.fn().mockResolvedValue(undefined) };

    service = new ArgumentAnalyzerService(
      analyzer,
      messages as unknown as Repository<DebateMessage>,
      graph as unknown as JudgeResultRepository,
      debates as unknown as DebatesService,
      queue as unknown as JudgeTaskQueue,
    );
  });

  it('턴을 분석해 컴포넌트·관계를 저장한다', async () => {
    await service.handle(task);

    const [request] = analyzer.analyze.mock.calls[0] as [AnalyzerRequest];
    expect(request.topic).toBe('AI 규제, 필요한가?');
    expect(request.turn).toMatchObject({
      sequence: 1,
      speakerSide: DebateSide.SIDE_A,
      speakerNickname: '메시',
    });
    expect(graph.replaceTurnGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        debateId: DEBATE_ID,
        turnId: TURN_ID,
        turnSequence: 1,
        speakerSide: DebateSide.SIDE_A,
      }),
    );
  });

  it('이전 턴 컴포넌트를 별칭으로 넘기고 저장할 때 실제 id로 되돌린다', async () => {
    graph.findComponentsBefore.mockResolvedValue([
      Object.assign(new DebateArgumentComponent(), {
        id: 'old-component-uuid',
        speakerSide: DebateSide.SIDE_B,
        kind: ArgumentComponentKind.CLAIM,
        statement: '규제는 혁신을 막는다',
      }),
    ]);

    await service.handle(task);

    const [request] = analyzer.analyze.mock.calls[0] as [AnalyzerRequest];
    expect(request.previousComponents).toEqual([
      expect.objectContaining({ ref: 'p1', statement: '규제는 혁신을 막는다' }),
    ]);
    const [input] = graph.replaceTurnGraph.mock.calls[0] as [
      { knownRefToId: Map<string, string> },
    ];
    expect(input.knownRefToId.get('p1')).toBe('old-component-uuid');
  });

  it('needs_fact_check인 컴포넌트마다 FactCheck 작업을 만든다', async () => {
    await service.handle(task);

    expect(queue.schedule).toHaveBeenCalledTimes(1);
    expect(queue.schedule).toHaveBeenCalledWith(
      DEBATE_ID,
      JudgeTaskKind.FACT_CHECK,
      'component-2',
    );
  });

  it('검증이 필요한 컴포넌트가 없으면 FactCheck 작업을 만들지 않는다', async () => {
    const withoutFactCheck = savedComponents().map((component) =>
      Object.assign(component, { needsFactCheck: false }),
    );
    graph.replaceTurnGraph.mockResolvedValue(withoutFactCheck);

    await service.handle(task);

    expect(queue.schedule).not.toHaveBeenCalled();
  });

  describe('Graph Validator', () => {
    const rejects = async (result: AnalyzerResult) => {
      analyzer.analyze.mockResolvedValue(result);

      await expect(service.handle(task)).rejects.toThrow(
        ArgumentGraphValidationError,
      );
      // 거부된 결과는 저장되지 않고 예외가 올라가 worker가 재시도한다.
      expect(graph.replaceTurnGraph).not.toHaveBeenCalled();
    };

    const component = (ref: string, statement = '문장') => ({
      ref,
      kind: ArgumentComponentKind.CLAIM,
      statement,
      needsFactCheck: false,
    });

    beforeEach(() => {
      // 이전 턴 컴포넌트 p1이 있는 상태로 둔다.
      graph.findComponentsBefore.mockResolvedValue([
        Object.assign(new DebateArgumentComponent(), {
          id: 'old-component-uuid',
          speakerSide: DebateSide.SIDE_B,
          kind: ArgumentComponentKind.CLAIM,
          statement: '이전 주장',
        }),
      ]);
    });

    it('이전 턴 컴포넌트를 가리키는 관계는 통과시킨다', async () => {
      analyzer.analyze.mockResolvedValue(
        analyzed({
          relations: [
            { fromRef: 'c1', toRef: 'p1', kind: ArgumentRelationKind.ATTACK },
          ],
        }),
      );

      await service.handle(task);

      expect(graph.replaceTurnGraph).toHaveBeenCalled();
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

    it('이전 턴 컴포넌트가 관계를 거는(from) 것은 거부한다', async () => {
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

    it.each([
      ['ref가 중복되면', [component('c1'), component('c1')]],
      ['ref가 이전 턴 것과 겹치면', [component('p1')]],
      ['문장이 비어 있으면', [component('c1', '  ')]],
      [
        '문장이 너무 길면',
        [component('c1', 'ㄱ'.repeat(MAX_STATEMENT_LENGTH + 1))],
      ],
    ])('%s 거부한다', async (_name, components) => {
      await rejects(analyzed({ components, relations: [] }));
    });
  });

  it('확정 턴이 없으면 재시도 불가로 끝낸다', async () => {
    messages.findOneBy.mockResolvedValue(null);

    await expect(service.handle(task)).rejects.toThrow(NonRetryableTaskError);
  });

  it('stage 메시지 접두사로 몇 번째 턴인지 알린다', async () => {
    messages.findOneBy.mockResolvedValue(buildTurn({ sequence: 3 }));

    await expect(service.describe(task)).resolves.toBe('turn #3');
  });
});
