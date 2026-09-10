import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import {
  DebateSpeakers,
  DebateTurnSchedule,
  toDebateTurn,
} from '../debates/debate-turn';
import {
  DebateChatState,
  DebateChatStateChanges,
  toSpeakers,
} from './debate-chat-state';
import { DebateChatConfig } from './debate-chat.config';
import {
  DebateChatTurn,
  DebateStatus,
  DraftMessage,
} from './debate-chat.types';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

export const DEBATE_CHAT_STATE_STORE = Symbol('DEBATE_CHAT_STATE_STORE');

/**
 * 토론 채팅 상태 저장소. 저장된 사실로 상태를 복원해 work에 넘기고, work가 남긴 변경을 반영한다.
 * 같은 debateId에 대한 호출은 직렬화되어 append/finalize/타임아웃이 겹치지 않는다는 것이 계약이다.
 */
export interface DebateChatStateStore {
  withState<T>(
    debateId: string,
    work: (state: DebateChatState) => T | Promise<T>,
  ): Promise<T>;
}

// 토론 단위 락의 만료. 명령 하나(조회 + DB 트랜잭션)가 끝나기에 충분하면서, 프로세스가 죽어도
// 이 시간 뒤에는 다음 명령이 진행될 수 있을 만큼 짧게 둔다.
export const LOCK_TTL_SECONDS = 10;
// 락 재시도 간격. 여기까지 실패하면 FINALIZE_IN_PROGRESS로 거절한다.
export const LOCK_RETRY_DELAYS_MS = [20, 40, 80, 160];
// draft·중복 방지 키의 TTL은 턴 제한 시간의 배수로 두고 쓸 때마다 갱신한다.
// 확정되지 않은 채 잊힌 토론의 키가 영원히 남지 않게 하는 안전장치다.
export const DRAFT_TTL_TURN_MULTIPLIER = 10;

// 내 토큰일 때만 락을 푼다(만료 뒤 다른 명령이 잡은 락을 지우지 않기 위해).
const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

/**
 * Phase 2 저장소: 확정 턴·토론 상태는 Postgres, draft·중복 방지·직렬화 락은 Redis(P2-1·P2-7).
 * 프로세스 메모리에 상태를 남기지 않으므로 서버를 재시작해도 같은 자리에서 이어진다.
 */
@Injectable()
export class RedisDebateChatStateStore implements DebateChatStateStore {
  private readonly logger = new Logger(RedisDebateChatStateStore.name);
  private readonly draftTtlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly debatesService: DebatesService,
    @InjectRepository(DebateMessage)
    private readonly messageRepository: Repository<DebateMessage>,
    private readonly dataSource: DataSource,
    private readonly config: DebateChatConfig,
  ) {
    this.draftTtlSeconds =
      this.config.limits.maxDurationSeconds * DRAFT_TTL_TURN_MULTIPLIER;
  }

  async withState<T>(
    debateId: string,
    work: (state: DebateChatState) => T | Promise<T>,
  ): Promise<T> {
    const token = await this.acquireLock(debateId);
    try {
      const state = await this.load(debateId);
      // 첫 접근이 토론을 시작시킨다(P2-3). 이미 시작·종료된 토론에서는 아무 일도 하지 않는다.
      state.start();
      const result = await work(state);
      await this.persist(debateId, state);
      return result;
    } finally {
      await this.releaseLock(debateId, token);
    }
  }

  // 토론 단위 락. 짧게 몇 번 기다려 보고 그래도 잡히지 않으면 요청을 거절한다.
  private async acquireLock(debateId: string): Promise<string> {
    const token = randomUUID();
    for (let attempt = 0; ; attempt++) {
      const acquired = await this.redis.set(
        this.key(debateId, 'lock'),
        token,
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
      );
      if (acquired) {
        return token;
      }
      if (attempt >= LOCK_RETRY_DELAYS_MS.length) {
        throw new GeneralException(DebateChatErrorCode.FINALIZE_IN_PROGRESS);
      }
      await sleep(LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }

  // 락 해제 실패는 TTL이 대신 처리하므로 명령 결과를 뒤집지 않고 로그만 남긴다.
  private async releaseLock(debateId: string, token: string): Promise<void> {
    try {
      await this.redis.eval(
        RELEASE_LOCK_SCRIPT,
        1,
        this.key(debateId, 'lock'),
        token,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `락 해제 실패(TTL로 만료됨): debateId=${debateId}, ${String(error)}`,
      );
    }
  }

  // 토론·확정 턴(Postgres)과 draft·중복 방지 기록(Redis)을 읽어 상태를 복원한다.
  private async load(debateId: string): Promise<DebateChatState> {
    const debate = await this.debatesService.findOneOrThrow(debateId);
    const speakers = toSpeakers(debate);
    // 라운드 수는 토론이 소유한다(R-1). 커뮤니티 설정이 뒤에 바뀌어도 진행 중인 토론은 흔들리지 않는다.
    const schedule = new DebateTurnSchedule(debate.rebuttalQuestionRounds);
    const turns = await this.loadTurns(debate.id, speakers, schedule);
    const { drafts, clientMessages } = await this.loadDraftState(
      debateId,
      turns.length,
    );

    return DebateChatState.rehydrate({
      debateId: debate.id,
      communityId: debate.communityId,
      speakers,
      schedule,
      limits: this.config.limits,
      // 아직 시작 전인 토론(시드 포함)은 컬럼이 null이며 READY와 같이 취급한다.
      debateStatus: debate.debateStatus ?? DebateStatus.READY,
      startedAt: debate.startedAt,
      endedAt: debate.endedAt,
      expiresAt: debate.expiresAt,
      winnerId: debate.winnerId,
      turns,
      drafts,
      clientMessages,
    });
  }

  // 채팅이 확정한 턴만 읽는다. 시드 행은 sequence가 null이라 자연히 제외된다.
  private async loadTurns(
    debateId: string,
    speakers: DebateSpeakers,
    schedule: DebateTurnSchedule,
  ): Promise<DebateChatTurn[]> {
    const rows = await this.messageRepository.find({
      where: {
        debateId,
        status: ResourceStatus.NORMAL,
        sequence: Not(IsNull()),
      },
      order: { sequence: 'ASC' },
    });
    return rows.map((row) => toDebateTurn(row, speakers, schedule));
  }

  // 현재 차례의 draft와 토론 단위 clientMessageId 기록.
  private async loadDraftState(
    debateId: string,
    turnIndex: number,
  ): Promise<{
    drafts: DraftMessage[];
    clientMessages: Map<string, DraftMessage>;
  }> {
    const [rawDrafts, rawClientMessages] = await Promise.all([
      this.redis.lrange(this.draftsKey(debateId, turnIndex), 0, -1),
      this.redis.hgetall(this.key(debateId, 'cmids')),
    ]);

    return {
      drafts: rawDrafts.map((raw) => JSON.parse(raw) as DraftMessage),
      clientMessages: new Map(
        Object.entries(rawClientMessages).map(([id, raw]) => [
          id,
          JSON.parse(raw) as DraftMessage,
        ]),
      ),
    };
  }

  /**
   * 상태가 남긴 변경을 반영한다. 확정 턴과 토론 행은 한 트랜잭션으로 커밋하고,
   * 커밋된 뒤에야 Redis의 draft를 지운다(지우기가 실패해도 다음 차례의 키가 달라 섞이지 않는다).
   */
  private async persist(
    debateId: string,
    state: DebateChatState,
  ): Promise<void> {
    const changes = state.drainChanges();
    if (changes.finalizedTurn !== null || changes.debate !== null) {
      await this.commit(debateId, changes);
    }

    const pipeline = this.redis.pipeline();
    const clientMessagesKey = this.key(debateId, 'cmids');
    for (const { turnIndex, message } of changes.appendedDrafts) {
      const draftsKey = this.draftsKey(debateId, turnIndex);
      pipeline.rpush(draftsKey, JSON.stringify(message));
      pipeline.expire(draftsKey, this.draftTtlSeconds);
      if (message.clientMessageId !== undefined) {
        pipeline.hset(
          clientMessagesKey,
          message.clientMessageId,
          JSON.stringify(message),
        );
        pipeline.expire(clientMessagesKey, this.draftTtlSeconds);
      }
    }
    if (changes.clearedDraftTurnIndex !== null) {
      pipeline.del(this.draftsKey(debateId, changes.clearedDraftTurnIndex));
    }
    await pipeline.exec();
  }

  private async commit(
    debateId: string,
    changes: DebateChatStateChanges,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const turn = changes.finalizedTurn;
      if (turn !== null) {
        await manager.getRepository(DebateMessage).insert({
          id: turn.id,
          memberId: turn.speakerId,
          debateId,
          body: turn.content,
          sequence: turn.sequence,
          createdAt: new Date(turn.createdAt),
        });
      }
      if (changes.debate !== null) {
        await manager.getRepository(Debate).update(debateId, changes.debate);
      }
    });
  }

  private draftsKey(debateId: string, turnIndex: number): string {
    return this.key(debateId, `drafts:${turnIndex}`);
  }

  // 키 접두사는 내부 설계 문서와 같은 debate-chat:{debateId}:*.
  private key(debateId: string, suffix: string): string {
    return `debate-chat:${debateId}:${suffix}`;
  }
}
