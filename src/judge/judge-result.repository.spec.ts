import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { DebateSide } from '../debates/debate-turn';
import { Debate } from '../debates/entities/debate.entity';
import {
  GraphComponentInput,
  JudgeResultRepository,
} from './judge-result.repository';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  ClaimType,
  FactCheckExclusionReason,
} from './judge.types';
import {
  DebateArgumentComponent,
  DebateArgumentRelation,
} from './entities/debate-argument.entity';
import { DebateFactCheckResult } from './entities/debate-fact-check.entity';
import { DebateJudgmentResult } from './entities/debate-judgment-result.entity';

describe('JudgeResultRepository', () => {
  const DEBATE_ID = 'debate-uuid';

  // 트랜잭션 안에서 쓰는 저장소. create는 받은 값을 그대로 돌려준다.
  const repositoryMock = () => ({
    findBy: jest.fn().mockResolvedValue([]),
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((value: unknown) => value),
  });

  let txComponents: ReturnType<typeof repositoryMock>;
  let txRelations: ReturnType<typeof repositoryMock>;
  let components: ReturnType<typeof repositoryMock>;
  let factChecks: ReturnType<typeof repositoryMock>;
  let repository: JudgeResultRepository;

  const graphComponent = (
    ref: string,
    overrides: Partial<GraphComponentInput> = {},
  ): GraphComponentInput => ({
    ref,
    turnId: 'turn-1',
    turnSequence: 1,
    speakerId: 'host-uuid',
    speakerSide: DebateSide.SIDE_A,
    kind: ArgumentComponentKind.EVIDENCE,
    statement: `${ref} 문장`,
    claimType: ClaimType.STATISTIC,
    needsFactCheck: false,
    factCheckStatement: null,
    claimHash: null,
    factCheckExclusionReason: null,
    duplicateOfRef: null,
    ...overrides,
  });

  beforeEach(() => {
    txComponents = repositoryMock();
    txRelations = repositoryMock();
    components = repositoryMock();
    factChecks = repositoryMock();

    const manager = {
      getRepository: (entity: unknown) =>
        entity === DebateArgumentComponent ? txComponents : txRelations,
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(
        (run: (manager: EntityManager) => Promise<unknown>) => run(manager),
      ),
    } as unknown as DataSource;

    repository = new JudgeResultRepository(
      components as unknown as Repository<DebateArgumentComponent>,
      repositoryMock() as unknown as Repository<DebateArgumentRelation>,
      factChecks as unknown as Repository<DebateFactCheckResult>,
      repositoryMock() as unknown as Repository<DebateJudgmentResult>,
      repositoryMock() as unknown as Repository<Debate>,
      dataSource,
    );
  });

  describe('replaceRoundGraph', () => {
    it('라운드 턴들의 기존 컴포넌트·관계를 지우고 새로 넣는다', async () => {
      txComponents.findBy.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);

      await repository.replaceRoundGraph({
        debateId: DEBATE_ID,
        turnIds: ['turn-1', 'turn-2'],
        components: [graphComponent('c1')],
        relations: [],
        knownRefToId: new Map(),
      });

      expect(txComponents.findBy).toHaveBeenCalledWith({
        debateId: DEBATE_ID,
        turnId: In(['turn-1', 'turn-2']),
      });
      expect(txRelations.delete).toHaveBeenCalledWith({
        fromComponentId: In(['old-1', 'old-2']),
      });
      expect(txRelations.delete).toHaveBeenCalledWith({
        toComponentId: In(['old-1', 'old-2']),
      });
      expect(txComponents.delete).toHaveBeenCalledWith({
        id: In(['old-1', 'old-2']),
      });
      expect(txComponents.insert).toHaveBeenCalledTimes(1);
    });

    it('관계와 중복 참조를 이번 라운드·이전 라운드의 실제 id로 잇는다', async () => {
      const saved = await repository.replaceRoundGraph({
        debateId: DEBATE_ID,
        turnIds: ['turn-1', 'turn-2'],
        components: [
          graphComponent('c1', {
            needsFactCheck: true,
            factCheckStatement: '국민 70%가 찬성했다.',
            claimHash: 'hash-1',
          }),
          graphComponent('c2', {
            turnId: 'turn-2',
            turnSequence: 2,
            speakerSide: DebateSide.SIDE_B,
            factCheckExclusionReason: FactCheckExclusionReason.DUPLICATE,
            duplicateOfRef: 'c1',
          }),
          graphComponent('c3', {
            factCheckExclusionReason: FactCheckExclusionReason.DUPLICATE,
            duplicateOfRef: 'p1',
          }),
        ],
        relations: [
          { fromRef: 'c2', toRef: 'c1', kind: ArgumentRelationKind.ATTACK },
          { fromRef: 'c3', toRef: 'p1', kind: ArgumentRelationKind.SUPPORT },
        ],
        knownRefToId: new Map([['p1', 'old-component']]),
      });

      const [c1, c2, c3] = saved;
      expect(c1).toMatchObject({
        debateId: DEBATE_ID,
        turnId: 'turn-1',
        needsFactCheck: true,
        factCheckStatement: '국민 70%가 찬성했다.',
        claimHash: 'hash-1',
        duplicateOfComponentId: null,
      });
      expect(c2).toMatchObject({
        turnId: 'turn-2',
        speakerSide: DebateSide.SIDE_B,
        duplicateOfComponentId: c1.id,
      });
      expect(c3.duplicateOfComponentId).toBe('old-component');

      expect(txRelations.save).toHaveBeenCalledWith([
        expect.objectContaining({
          fromComponentId: c2.id,
          toComponentId: c1.id,
        }),
        expect.objectContaining({
          fromComponentId: c3.id,
          toComponentId: 'old-component',
        }),
      ]);
    });

    it('뽑아낸 것이 없으면 지우기만 한다', async () => {
      await repository.replaceRoundGraph({
        debateId: DEBATE_ID,
        turnIds: ['turn-1'],
        components: [],
        relations: [],
        knownRefToId: new Map(),
      });

      expect(txComponents.insert).not.toHaveBeenCalled();
      expect(txRelations.save).not.toHaveBeenCalled();
    });
  });

  describe('findUnresolvedTargets', () => {
    it('라운드 턴들의 검증 대상 가운데 결과가 없는 것만 발언 순서대로 돌려준다', async () => {
      const targets = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
      components.find.mockResolvedValue(targets);
      factChecks.findBy.mockResolvedValue([{ componentId: 'c2' }]);

      const unresolved = await repository.findUnresolvedTargets(DEBATE_ID, [
        'turn-3',
        'turn-4',
      ]);

      expect(components.find).toHaveBeenCalledWith({
        where: {
          debateId: DEBATE_ID,
          turnId: In(['turn-3', 'turn-4']),
          needsFactCheck: true,
        },
        order: { turnSequence: 'ASC', createdAt: 'ASC' },
      });
      expect(unresolved.map((target) => target.id)).toEqual(['c1', 'c3']);
    });

    it('검증 대상이 없으면 결과를 조회하지 않는다', async () => {
      await expect(
        repository.findUnresolvedTargets(DEBATE_ID, ['turn-1']),
      ).resolves.toEqual([]);
      expect(factChecks.findBy).not.toHaveBeenCalled();
    });
  });
});
