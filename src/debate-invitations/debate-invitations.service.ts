import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import { AppError } from '../common/exceptions/app-error.interface';
import { GeneralException } from '../common/exceptions/general.exception';
import { getUniqueViolationConstraint } from '../common/exceptions/unique-violation.util';
import { CLOCK } from '../common/scheduling/clock';
import type { Clock } from '../common/scheduling/clock';
import { CommunitiesService } from '../communities/communities.service';
import { CommunityChatPublisher } from '../community-chat/community-chat.publisher';
import { DebateChatService } from '../debate-chat/debate-chat.service';
import { DebateOutcomeService } from '../debate-outcomes/debate-outcome.service';
import {
  DebateOutcome,
  DebateOutcomeKind,
} from '../debate-outcomes/debate-outcome.types';
import { DebatesService } from '../debates/debates.service';
import { DebateDetailDto } from '../debates/dto/debate.dto';
import { DebateStatus } from '../debates/entities/debate-status.enum';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import { CommunityDebateIntent } from '../member-communities/entities/member-community.entity';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { MembersService } from '../members/members.service';
import { DebateInvitationExpiryScheduler } from './debate-invitation-expiry.scheduler';
import { DebateInvitationsConfig } from './debate-invitations.config';
import { DebateInvitationDto } from './dto/debate-invitation.dto';
import {
  DEBATE_INVITATION_PENDING_UNIQUE,
  DebateInvitation,
  DebateInvitationStatus,
} from './entities/debate-invitation.entity';
import { DebateInvitationErrorCode } from './exceptions/debate-invitation-error-code';

// 조건부 UPDATE에 붙일 마감 조건. 응답은 마감 전에만, 만료는 마감 후에만 성립한다.
type DeadlineCondition = 'BEFORE_EXPIRY' | 'AFTER_EXPIRY';

/**
 * 조건부 UPDATE에서 진 경우를 트랜잭션 밖으로 알리는 내부 신호.
 * 실제 에러는 트랜잭션이 끝난 뒤 현재 상태를 다시 읽어 만든다 — 롤백될 트랜잭션 안에서
 * 만료 처리(이벤트 발행 포함)까지 하면 남는 결과와 보낸 이벤트가 어긋나기 때문이다.
 */
class InvitationTransitionLost extends Error {}

/**
 * 커뮤니티 토론 초대 응용 서비스. 소켓은 모르고 커뮤니티 방 이벤트만 발행한다
 * (만료는 타이머가 부르므로 "요청 소켓"이라는 것이 아예 없다).
 *
 * accept/reject/expire는 모두 "PENDING인 초대만 옮기는" 한 문장의 조건부 UPDATE로 경쟁한다.
 * 동시에 들어와도 하나만 성공하고, 진 쪽은 실제 상태를 다시 읽어 에러를 만든다.
 */
@Injectable()
export class DebateInvitationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DebateInvitationsService.name);

  constructor(
    @InjectRepository(DebateInvitation)
    private readonly invitationRepository: Repository<DebateInvitation>,
    private readonly dataSource: DataSource,
    private readonly communitiesService: CommunitiesService,
    private readonly memberCommunitiesService: MemberCommunitiesService,
    private readonly membersService: MembersService,
    private readonly debatesService: DebatesService,
    private readonly debateChatService: DebateChatService,
    private readonly outcomes: DebateOutcomeService,
    private readonly publisher: CommunityChatPublisher,
    private readonly expiry: DebateInvitationExpiryScheduler,
    private readonly config: DebateInvitationsConfig,
    @Inject(CLOCK) private readonly now: Clock,
  ) {
    // 타이머가 도메인을 모르도록 만료 시 실행할 동작을 여기서 걸어 준다.
    this.expiry.register((invitationId) => this.expire(invitationId));
  }

  // 재시작 복구: 아직 대기 중인 초대의 만료 타이머를 다시 건다. 이미 지난 마감은 곧바로 처리된다.
  async onApplicationBootstrap(): Promise<void> {
    let pending: DebateInvitation[];
    try {
      pending = await this.repo().findBy({
        status: DebateInvitationStatus.PENDING,
      });
    } catch (error: unknown) {
      // 복구 실패로 부팅을 막지는 않는다. 다음 start가 stale 초대를 정리한다(expireDue).
      this.logger.error('대기 중 초대 타이머 복구 실패', this.describe(error));
      return;
    }

    for (const invitation of pending) {
      this.expiry.arm(invitation.id, invitation.expiresAt);
    }
    if (pending.length > 0) {
      this.logger.log(`대기 중 초대 ${pending.length}건의 만료 타이머 복구`);
    }
  }

  /**
   * 방장이 상대를 토론에 초대한다(계약 POST …/debates/start).
   * 응답은 방장이 받고, 초대받은 사람은 커뮤니티 WS의 debate.requested로 같은 내용을 받는다.
   */
  async start(
    communityId: string,
    hostMemberId: string,
    opponentMemberId: string,
  ): Promise<DebateInvitationDto> {
    const community = await this.communitiesService.findOneOrThrow(communityId);
    if (community.hostId !== hostMemberId) {
      throw new GeneralException(DebateInvitationErrorCode.HOST_ONLY);
    }
    if (opponentMemberId === hostMemberId) {
      throw new GeneralException(DebateInvitationErrorCode.SELF_INVITATION);
    }

    await this.assertOpenToDebate(
      hostMemberId,
      communityId,
      DebateInvitationErrorCode.HOST_NOT_OPEN_TO_DEBATE,
    );
    await this.assertOpenToDebate(
      opponentMemberId,
      communityId,
      DebateInvitationErrorCode.OPPONENT_NOT_OPEN_TO_DEBATE,
    );

    if (await this.debatesService.findActiveByCommunity(communityId)) {
      throw new GeneralException(
        DebateInvitationErrorCode.DEBATE_ALREADY_ACTIVE,
      );
    }

    // 타이머가 돌지 못한 초대(재시작 직후 등)를 먼저 만료시킨다. 남겨 두면 부분 유니크 인덱스가
    // 새 초대를 막아, 아무도 기다리지 않는 초대 때문에 토론을 시작할 수 없게 된다.
    await this.expireDue(communityId);

    const invitation = await this.insert(
      DebateInvitation.issue({
        communityId,
        hostMemberId,
        opponentMemberId,
        ttlSeconds: this.config.ttlSeconds,
        now: this.now(),
      }),
    );

    this.expiry.arm(invitation.id, invitation.expiresAt);

    const host = await this.membersService.findOneOrThrow(hostMemberId);
    const dto = DebateInvitationDto.from(invitation, host);
    this.publisher.debateRequested({ communityId, invitation: dto });
    return dto;
  }

  /**
   * 초대받은 사람이 수락한다(계약 POST …/:invitationId/accept).
   * 초대를 ACCEPTED로 옮기는 것과 토론 생성, 시작 알림 저장, 커뮤니티 ACTIVE 전이는 한 트랜잭션이다 —
   * 하나만 남으면 영원히 시작되지 않는 초대나 아무도 모르는 토론이 된다.
   */
  async accept(
    communityId: string,
    invitationId: string,
    memberId: string,
  ): Promise<DebateDetailDto> {
    const invitation = await this.findOneOrThrow(invitationId, communityId);
    this.assertInvitee(invitation, memberId);

    const community = await this.communitiesService.findOneOrThrow(communityId);
    const now = this.now();

    let started: DebateOutcome;
    try {
      started = await this.dataSource.transaction(async (manager) => {
        const moved = await this.transition(
          invitationId,
          DebateInvitationStatus.ACCEPTED,
          now,
          'BEFORE_EXPIRY',
          manager,
        );
        if (!moved) {
          throw new InvitationTransitionLost();
        }

        // 양쪽 소속은 create가 다시 확인한다(초대 뒤 커뮤니티를 나갔을 수 있다).
        // 주제·라운드 수는 커뮤니티 설정을 복사한다 — 진행 중인 토론이 설정 변경으로 흔들리면 안 된다.
        const debate = await this.debatesService.create(
          {
            communityId,
            topic: community.topic,
            sideASpeakerId: invitation.hostMemberId,
            sideBSpeakerId: invitation.opponentMemberId,
            rebuttalQuestionRounds: community.debateRoundCount,
          },
          memberId,
          manager,
        );

        await this.repo(manager).update(invitationId, { debateId: debate.id });
        // 시작 알림(시스템 메시지)을 남기고, 활성 토론이 생겼으니 커뮤니티를 진행 중으로 옮긴다.
        const outcome: DebateOutcome = {
          debateId: debate.id,
          communityId,
          kind: DebateOutcomeKind.STARTED,
          status: DebateStatus.READY,
          reason: null,
          winnerId: null,
        };
        await this.outcomes.applyWithin(manager, outcome);
        return outcome;
      });
    } catch (error: unknown) {
      if (error instanceof InvitationTransitionLost) {
        await this.throwResponseFailure(invitationId);
      }
      throw error;
    }

    this.expiry.clear(invitationId);
    const debateId = started.debateId;

    // 수락과 동시에 토론을 시작한다 — 대기 화면에서 토론 화면으로 바로 넘어가므로
    // 응답의 startedAt/expiresAt이 확정된 값이어야 한다.
    await this.debateChatService.start(debateId, memberId);
    const detail = await this.debatesService.findDetail(debateId, memberId);

    // 커밋된 시작 알림을 커뮤니티 방에 보낸다(저장이 먼저, 발행은 그 뒤).
    await this.outcomes.announce(started);
    this.publisher.debateStarted({
      communityId,
      debateId,
      sideASpeaker: detail.sideASpeaker,
      sideBSpeaker: detail.sideBSpeaker,
      // 방금 시작시켰으므로 startedAt은 채워져 있다. 뒤의 값은 타입을 맞추기 위한 대비다.
      startedAt: detail.startedAt ?? now.toISOString(),
      expiresAt: detail.expiresAt,
    });
    return detail;
  }

  // 초대받은 사람이 거절한다(계약 POST …/:invitationId/reject). 결과는 방장만 WS로 받는다.
  async reject(
    communityId: string,
    invitationId: string,
    memberId: string,
  ): Promise<void> {
    const invitation = await this.findOneOrThrow(invitationId, communityId);
    this.assertInvitee(invitation, memberId);

    const moved = await this.transition(
      invitationId,
      DebateInvitationStatus.REJECTED,
      this.now(),
      'BEFORE_EXPIRY',
    );
    if (!moved) {
      await this.throwResponseFailure(invitationId);
    }

    this.expiry.clear(invitationId);
    this.publisher.debateRequestRejected(
      {
        communityId,
        invitationId,
        opponentMemberId: invitation.opponentMemberId,
      },
      invitation.hostMemberId,
    );
  }

  /**
   * 마감 시각에 타이머가 부른다. 멱등하다 — 조건부 UPDATE가 성공한 흐름만 이벤트를 보내므로
   * 중복 발화나 수락/거절과의 경쟁에서 진 경우에는 아무 일도 일어나지 않는다.
   * 타이머 콜백이라 예외를 밖으로 던지지 않는다(unhandled rejection이 된다).
   */
  async expire(invitationId: string): Promise<void> {
    try {
      const invitation = await this.repo().findOneBy({ id: invitationId });
      if (invitation === null) {
        return;
      }

      const moved = await this.transition(
        invitationId,
        DebateInvitationStatus.EXPIRED,
        this.now(),
        'AFTER_EXPIRY',
      );
      if (!moved) {
        return;
      }

      this.publisher.debateRequestExpired(
        { communityId: invitation.communityId, invitationId },
        invitation.hostMemberId,
        invitation.opponentMemberId,
      );
    } catch (error: unknown) {
      this.logger.error(
        `초대 만료 처리 실패: invitationId=${invitationId}`,
        this.describe(error),
      );
    }
  }

  /**
   * 커뮤니티에서 지금 진행 중인 토론(계약 GET …/debates/active).
   * 참여자는 토론 화면으로, 관전자는 관전 화면으로 복귀할 때 쓴다.
   */
  async findActive(
    communityId: string,
    viewerId: string,
  ): Promise<DebateDetailDto | null> {
    await this.communitiesService.findOneOrThrow(communityId);

    const debate = await this.debatesService.findActiveByCommunity(communityId);
    return debate === null
      ? null
      : this.debatesService.findDetail(debate.id, viewerId);
  }

  // 트랜잭션 참여용: manager가 있으면 그 안의 레포지토리를, 없으면 기본 레포지토리를 사용한다.
  private repo(manager?: EntityManager): Repository<DebateInvitation> {
    return manager
      ? manager.getRepository(DebateInvitation)
      : this.invitationRepository;
  }

  /**
   * PENDING인 초대만 다음 상태로 옮긴다(조건부 UPDATE). 실제로 옮겼으면 true.
   * 지금 상태를 읽고 나서 쓰면 그 사이에 다른 응답이 끼어들 수 있으므로 한 문장으로 끝낸다.
   */
  private async transition(
    invitationId: string,
    next: DebateInvitationStatus,
    now: Date,
    deadline: DeadlineCondition,
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await this.repo(manager)
      .createQueryBuilder()
      .update(DebateInvitation)
      .set({ status: next, respondedAt: now })
      .where('id = :invitationId', { invitationId })
      .andWhere('status = :pending', {
        pending: DebateInvitationStatus.PENDING,
      })
      .andWhere(
        deadline === 'BEFORE_EXPIRY'
          ? 'expires_at > :now'
          : 'expires_at <= :now',
        { now },
      )
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * 응답(수락/거절)의 조건부 UPDATE가 실패한 이유를 실제 상태에서 찾아 에러로 옮긴다.
   * 아직 PENDING이면 마감만 지난 것이므로 여기서 만료까지 끝내, 타이머가 돌았을 때와 결과를 같게 만든다.
   */
  private async throwResponseFailure(invitationId: string): Promise<never> {
    const current = await this.repo().findOneBy({ id: invitationId });
    if (current === null) {
      throw new GeneralException(DebateInvitationErrorCode.NOT_FOUND);
    }

    if (current.status === DebateInvitationStatus.PENDING) {
      await this.expire(invitationId);
      throw new GeneralException(DebateInvitationErrorCode.EXPIRED);
    }

    throw new GeneralException(
      current.status === DebateInvitationStatus.EXPIRED
        ? DebateInvitationErrorCode.EXPIRED
        : DebateInvitationErrorCode.ALREADY_RESPONDED,
    );
  }

  // 마감이 지났는데도 대기 중으로 남은 초대를 정리한다(양쪽에 만료 이벤트도 나간다).
  private async expireDue(communityId: string): Promise<void> {
    const due = await this.repo().findBy({
      communityId,
      status: DebateInvitationStatus.PENDING,
      expiresAt: LessThanOrEqual(this.now()),
    });

    for (const invitation of due) {
      await this.expire(invitation.id);
    }
  }

  // 대기 중 초대는 커뮤니티당 하나뿐이라는 규칙을 부분 유니크 인덱스가 지킨다.
  // 동시 start 중 진 쪽은 여기서 도메인 에러가 된다(원인을 다 분류했으므로 cause는 붙이지 않는다).
  private async insert(
    invitation: DebateInvitation,
  ): Promise<DebateInvitation> {
    try {
      return await this.repo().save(invitation);
    } catch (error: unknown) {
      if (
        getUniqueViolationConstraint(error) === DEBATE_INVITATION_PENDING_UNIQUE
      ) {
        throw new GeneralException(DebateInvitationErrorCode.ALREADY_PENDING);
      }
      throw error;
    }
  }

  private async findOneOrThrow(
    invitationId: string,
    communityId: string,
  ): Promise<DebateInvitation> {
    const invitation = await this.repo().findOneBy({
      id: invitationId,
      communityId,
    });
    if (invitation === null) {
      throw new GeneralException(DebateInvitationErrorCode.NOT_FOUND);
    }
    return invitation;
  }

  // 초대에 응답할 수 있는 사람은 초대받은 본인뿐이다.
  private assertInvitee(invitation: DebateInvitation, memberId: string): void {
    if (invitation.opponentMemberId !== memberId) {
      throw new GeneralException(DebateInvitationErrorCode.NOT_INVITEE);
    }
  }

  // 커뮤니티 참여자이면서 토론 의사가 열려 있어야 한다(방장도 같은 조건).
  private async assertOpenToDebate(
    memberId: string,
    communityId: string,
    notOpenError: AppError,
  ): Promise<void> {
    const participation = await this.memberCommunitiesService.findOne(
      memberId,
      communityId,
    );
    if (participation === null) {
      throw new GeneralException(DebateErrorCode.SPEAKER_NOT_IN_COMMUNITY);
    }
    if (participation.debateIntent !== CommunityDebateIntent.OPEN_TO_DEBATE) {
      throw new GeneralException(notOpenError);
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);
  }
}
