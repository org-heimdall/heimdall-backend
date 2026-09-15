import { Repository } from 'typeorm';
import { DebateSide } from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import {
  FactCheckerService,
  FactCheckSourceValidationError,
} from './fact-checker.service';
import { NonRetryableTaskError } from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import {
  ArgumentComponentKind,
  JudgeTaskKind,
  JudgeTaskStatus,
  VerificationStatus,
} from './judge.types';
import { DebateArgumentComponent } from './entities/debate-argument.entity';
import { JudgeTask } from './entities/judge-task.entity';
import type { FactCheckOutcome } from './llm/judge-llm';

describe('FactCheckerService', () => {
  const DEBATE_ID = 'debate-uuid';
  const COMPONENT_ID = 'component-uuid';
  const TURN_ID = 'turn-uuid';

  let factChecker: { check: jest.Mock };
  let messages: { findOneBy: jest.Mock };
  let results: {
    findComponentById: jest.Mock;
    replaceFactCheck: jest.Mock;
  };
  let debates: { findOneOrThrow: jest.Mock };
  let service: FactCheckerService;

  const task = Object.assign(new JudgeTask(), {
    id: 'task-uuid',
    debateId: DEBATE_ID,
    kind: JudgeTaskKind.FACT_CHECK,
    targetId: COMPONENT_ID,
    status: JudgeTaskStatus.PROCESSING,
    attempt: 1,
    maxAttempts: 3,
  });

  const component = Object.assign(new DebateArgumentComponent(), {
    id: COMPONENT_ID,
    debateId: DEBATE_ID,
    turnId: TURN_ID,
    turnSequence: 2,
    speakerSide: DebateSide.SIDE_A,
    kind: ArgumentComponentKind.EVIDENCE,
    statement: '2025년 EU가 AI법을 시행했다',
    needsFactCheck: true,
  });

  const outcome: FactCheckOutcome = {
    status: VerificationStatus.PARTIALLY_SUPPORTED,
    reason: '2024년 발효, 2025년부터 단계적 시행이다.',
    sources: [
      {
        title: 'EU AI Act',
        publisher: 'European Commission',
        url: 'https://digital-strategy.ec.europa.eu/ai-act',
      },
    ],
    groundedDomains: ['digital-strategy.ec.europa.eu'],
  };

  beforeEach(() => {
    factChecker = { check: jest.fn().mockResolvedValue(outcome) };
    messages = {
      findOneBy: jest.fn().mockResolvedValue(
        Object.assign(new DebateMessage(), {
          id: TURN_ID,
          body: 'AI 규제는 필요하다. 2025년 EU가 AI법을 시행했다.',
        }),
      ),
    };
    results = {
      findComponentById: jest.fn().mockResolvedValue(component),
      replaceFactCheck: jest.fn().mockResolvedValue(undefined),
    };
    debates = {
      findOneOrThrow: jest.fn().mockResolvedValue(
        Object.assign(new Debate(), {
          id: DEBATE_ID,
          topic: 'AI 규제, 필요한가?',
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

  it('발언 원문을 맥락으로 넘겨 검증하고 결과·출처를 저장한다', async () => {
    await service.handle(task);

    expect(factChecker.check).toHaveBeenCalledWith({
      topic: 'AI 규제, 필요한가?',
      statement: '2025년 EU가 AI법을 시행했다',
      context: 'AI 규제는 필요하다. 2025년 EU가 AI법을 시행했다.',
    });
    expect(results.replaceFactCheck).toHaveBeenCalledWith({
      debateId: DEBATE_ID,
      componentId: COMPONENT_ID,
      status: VerificationStatus.PARTIALLY_SUPPORTED,
      reason: '2024년 발효, 2025년부터 단계적 시행이다.',
      sources: outcome.sources,
    });
  });

  describe('Source Validator', () => {
    const rejects = async (overrides: Partial<FactCheckOutcome>) => {
      factChecker.check.mockResolvedValue({ ...outcome, ...overrides });

      await expect(service.handle(task)).rejects.toThrow(
        FactCheckSourceValidationError,
      );
      // 거부된 결과는 저장되지 않고 예외가 올라가 worker가 재시도한다.
      expect(results.replaceFactCheck).not.toHaveBeenCalled();
    };

    it('www가 붙거나 하위 도메인이어도 같은 출처로 본다', async () => {
      factChecker.check.mockResolvedValue({
        ...outcome,
        sources: [
          {
            title: '기사',
            publisher: '연합뉴스',
            url: 'https://www.news.yna.co.kr/view/1',
          },
        ],
        groundedDomains: ['yna.co.kr'],
      });

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
      ['검색 근거가 없으면', { groundedDomains: [] }],
      ['출처가 검색 결과와 무관하면', { groundedDomains: ['example.com'] }],
      ['판정 근거 설명이 비어 있으면', { reason: '  ' }],
    ])('%s 거부한다', async (_name, overrides) => {
      await rejects(overrides);
    });

    it.each([
      VerificationStatus.INSUFFICIENT_EVIDENCE,
      VerificationStatus.NOT_VERIFIABLE,
    ])('%s 판정은 출처가 없어도 저장된다', async (status) => {
      factChecker.check.mockResolvedValue({
        ...outcome,
        status,
        sources: [],
        groundedDomains: [],
      });

      await service.handle(task);

      expect(results.replaceFactCheck).toHaveBeenCalledWith(
        expect.objectContaining({ status, sources: [] }),
      );
    });
  });

  it('컴포넌트가 사라졌으면 재시도 불가로 끝낸다', async () => {
    results.findComponentById.mockResolvedValue(null);

    await expect(service.handle(task)).rejects.toThrow(NonRetryableTaskError);
  });

  it('stage 메시지 접두사로 컴포넌트가 나온 턴을 알린다', async () => {
    await expect(service.describe(task)).resolves.toBe('turn #2');
  });
});
