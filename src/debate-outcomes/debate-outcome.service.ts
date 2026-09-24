import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CommunitiesService } from '../communities/communities.service';
import { CommunityMessagesService } from '../communities/community-messages.service';
import { CommunityMessageDto } from '../communities/dto/community-message.dto';
import { CommunityChatPublisher } from '../community-chat/community-chat.publisher';
import { DebateChatPublisher } from '../debate-chat/debate-chat.publisher';
import { DebatesService } from '../debates/debates.service';
import { MembersService } from '../members/members.service';
import { DebateOutcome, DebateOutcomeKind } from './debate-outcome.types';
import { DebateSystemMessageFactory } from './debate-system-message.factory';

// debate.ended로 알리는 종류. 전원 발언 완료(ALL_TURNS_FINALIZED)는 이 서비스를 거치지 않고 채팅이 직접 알린다.
// 판정 완료·실패는 stage 이벤트와 시스템 메시지로 알리므로 debate.ended를 두 번째로 보내지 않는다.
const ENDED_ANNOUNCED_KINDS: ReadonlySet<DebateOutcomeKind> = new Set([
  DebateOutcomeKind.FORFEIT,
  DebateOutcomeKind.TOTAL_TIMEOUT,
]);

@Injectable()
export class DebateOutcomeService {
  private readonly logger = new Logger(DebateOutcomeService.name);

  constructor(
    private readonly communitiesService: CommunitiesService,
    private readonly communityMessagesService: CommunityMessagesService,
    private readonly debatesService: DebatesService,
    private readonly membersService: MembersService,
    private readonly messageFactory: DebateSystemMessageFactory,
    private readonly communityPublisher: CommunityChatPublisher,
    private readonly debatePublisher: DebateChatPublisher,
  ) {}

  /**
   * 토론 결과를 호출자 트랜잭션 안에서 반영한다: 승리 보상 → 시스템 메시지 저장 → 커뮤니티 상태 동기화.
   *
   * 호출자가 토론 상태의 조건부 전이를 성공시킨 직후에만 불러야 한다 — 그 전이가 멱등성의 1차 방어선이라
   * 보상은 한 번만 들어간다(시스템 메시지는 결정적 clientMessageId로 한 번 더 막힌다).
   * 여기서 던지면 호출자 트랜잭션 전체가 롤백되므로, 점수가 반영되지 않은 종료는 확정되지 않는다.
   */
  async applyWithin(
    manager: EntityManager,
    outcome: DebateOutcome,
  ): Promise<void> {
    if (outcome.winnerId !== null) {
      await this.membersService.rewardWin(outcome.winnerId, manager);
    }

    const debate = await this.debatesService.findOneOrThrow(
      outcome.debateId,
      manager,
    );
    const message = this.messageFactory.create(outcome, debate);
    if (message !== null) {
      await this.communityMessagesService.create(message, manager);
    }

    await this.syncCommunityState(outcome.communityId, manager);
  }

  /**
   * 커밋된 결과를 방에 알린다: 저장된 시스템 메시지(message.created) → 필요하면 debate.ended.
   * 저장이 먼저, 발행은 그 뒤라는 순서를 지키려고 커밋된 행을 다시 읽어 보낸다.
   * 발행은 부가 동작이라 실패해도 던지지 않는다(이미 커밋된 결과를 되돌릴 수 없다).
   */
  async announce(outcome: DebateOutcome): Promise<void> {
    try {
      await this.announceMessage(outcome);
    } catch (error: unknown) {
      this.logger.error(
        `시스템 메시지 발행 실패: debateId=${outcome.debateId}, kind=${outcome.kind}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    if (ENDED_ANNOUNCED_KINDS.has(outcome.kind) && outcome.reason !== null) {
      this.debatePublisher.debateEnded({
        communityId: outcome.communityId,
        debateId: outcome.debateId,
        status: outcome.status,
        reason: outcome.reason,
      });
    }
  }

  // 저장된 시스템 메시지를 커뮤니티 방에 보낸다. 알리지 않는 종류거나 행이 없으면 보내지 않는다.
  private async announceMessage(outcome: DebateOutcome): Promise<void> {
    const clientMessageId = this.messageFactory.clientMessageIdOf(outcome);
    if (clientMessageId === null) {
      return;
    }

    const stored = await this.communityMessagesService.findByClientMessageId(
      outcome.communityId,
      clientMessageId,
    );
    if (stored === null) {
      this.logger.warn(
        `발행할 시스템 메시지가 없음: debateId=${outcome.debateId}, clientMessageId=${clientMessageId}`,
      );
      return;
    }

    this.communityPublisher.messageCreated(
      outcome.communityId,
      CommunityMessageDto.from(stored, stored.member),
    );
  }

  /**
   * 커뮤니티 진행 상태를 활성 토론 유무로 다시 정한다(있으면 ACTIVE, 없으면 WAITING).
   * 커뮤니티 행을 먼저 잠가 초대 수락과 직렬화하고, 같은 트랜잭션에서 방금 바뀐 이 토론의 상태까지 보고 결정한다.
   * 무조건 WAITING으로 덮어쓰지 않으므로 다른 활성 토론이 있으면 ACTIVE로 남는다. 몇 번 불러도 결과가 같다.
   */
  private async syncCommunityState(
    communityId: string,
    manager: EntityManager,
  ): Promise<void> {
    await this.communitiesService.lockForUpdate(communityId, manager);

    const hasActiveDebate = await this.debatesService.existsActiveByCommunity(
      communityId,
      manager,
    );
    if (hasActiveDebate) {
      await this.communitiesService.markActive(communityId, manager);
    } else {
      await this.communitiesService.markWaiting(communityId, manager);
    }
  }
}
