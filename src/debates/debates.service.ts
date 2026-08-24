import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { getUniqueViolationConstraint } from '../common/exceptions/unique-violation.util';
import { CommunitiesService } from '../communities/communities.service';
import { CommunityErrorCode } from '../communities/exceptions/community-error-code';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { MembersService } from '../members/members.service';
import { AcceptDebateResultDto } from './dto/accept-debate.dto';
import {
  CreateDebateDto,
  CreateDebateResultDto,
} from './dto/create-debate.dto';
import { UpdateDebateDto } from './dto/update-debate.dto';
import {
  DEBATE_PENDING_REQUEST_UNIQUE,
  Debate,
  DebateTurn,
} from './entities/debate.entity';
import { DebateErrorCode } from './exceptions/debate-error-code';
import { DebateEventsPublisher } from './room/debate-events-publisher.interface';

@Injectable()
export class DebatesService {
  private publisher: DebateEventsPublisher | null = null;

  constructor(
    @InjectRepository(Debate)
    private readonly debateRepository: Repository<Debate>,
    private readonly communitiesService: CommunitiesService,
    private readonly memberCommunitiesService: MemberCommunitiesService,
    private readonly membersService: MembersService,
  ) {}

  // 게이트웨이가 afterInit에서 자신을 등록한다(서비스가 게이트웨이를 직접 주입받지 않기 위한 경계).
  bindPublisher(publisher: DebateEventsPublisher): void {
    this.publisher = publisher;
  }

  // 토론 요청 생성: 커뮤니티 호스트만 가능하며, 상대 토론자는 해당 커뮤니티 멤버이면서
  // 기조발언을 작성했어야 한다. 통과 시 PENDING 상태로 저장하고 상대에게 소켓으로 알린다.
  // 실제 토론 시작은 상대가 accept()로 수락해야 이루어진다.
  async create(
    dto: CreateDebateDto,
    hostId: string,
  ): Promise<CreateDebateResultDto> {
    const { opponentId, communityId } = dto;
    const community = await this.communitiesService.findOneOrThrow(communityId);
    if (community.hostId !== hostId) {
      throw new GeneralException(DebateErrorCode.NOT_HOST);
    }

    const opponentMembership = await this.memberCommunitiesService.findOne(
      opponentId,
      communityId,
    );
    if (!opponentMembership) {
      throw new GeneralException(DebateErrorCode.OPPONENT_NOT_IN_COMMUNITY);
    }

    // 기조발언 미작성 회원에게는 토론을 요청할 수 없다. KEYNOTE_NOT_FOUND는 이미
    // 분류가 끝난 기대 가능한 에러이므로 cause 없이 도메인 에러로 재던진다.
    try {
      await this.communitiesService.getMemberKeynote(communityId, opponentId);
    } catch (error) {
      if (
        error instanceof GeneralException &&
        error.appError === CommunityErrorCode.KEYNOTE_NOT_FOUND
      ) {
        throw new GeneralException(DebateErrorCode.OPPONENT_KEYNOTE_REQUIRED);
      }
      throw error;
    }

    // 미응답 요청은 REQUEST_ALREADY_PENDING, 진행 중 토론은 DEBATE_ALREADY_ACTIVE로 분기
    const active = await this.debateRepository.findOne({
      where: {
        communityId,
        status: ResourceStatus.NORMAL,
        currentTurn: Not(DebateTurn.FINISHED),
      },
    });
    if (active) {
      throw new GeneralException(
        active.currentTurn === DebateTurn.PENDING
          ? DebateErrorCode.REQUEST_ALREADY_PENDING
          : DebateErrorCode.DEBATE_ALREADY_ACTIVE,
      );
    }

    const [host, opponent] = await Promise.all([
      this.membersService.findOneOrThrow(hostId),
      this.membersService.findOneOrThrow(opponentId),
    ]);

    // status 필터를 의도적으로 걸지 않는다: 위 활성 차단 검사를 통과했다면 이 (community, host)
    // PENDING 행은 존재하더라도 거절되어 DELETED 상태인 것뿐이므로, 그 행을 되살려 재사용한다.
    // (soft-delete.md의 조회 규칙에 대한 의도적 예외.)
    const reusable = await this.debateRepository.findOne({
      where: { communityId, hostId, currentTurn: DebateTurn.PENDING },
    });

    let debate: Debate;
    if (reusable) {
      reusable.reopenRequest(host.nickname, opponentId, opponent.nickname);
      debate = reusable;
    } else {
      debate = Debate.open({
        communityId: communityId,
        hostId,
        hostNickname: host.nickname,
        opponentId,
        opponentNickname: opponent.nickname,
      });
    }

    let saved: Debate;
    try {
      saved = await this.debateRepository.save(debate);
    } catch (error) {
      // 동시 요청 레이스: 활성 검사와 save 사이에 다른 요청이 먼저 PENDING 슬롯을 차지하면
      // 부분 유니크 인덱스가 막는다. 이미 unique_violation으로 분류가 끝난 기대 가능한
      // 에러이므로 cause 없이 던진다.
      const constraint = getUniqueViolationConstraint(error);
      if (constraint === DEBATE_PENDING_REQUEST_UNIQUE) {
        throw new GeneralException(DebateErrorCode.REQUEST_ALREADY_PENDING);
      }
      throw error;
    }

    this.publisher?.emitDebateRequested(saved.opponentId, {
      debateId: saved.id,
      communityId: saved.communityId,
      hostId: saved.hostId,
      hostNickname: saved.hostNickname,
    });

    return { debateId: saved.id, createdAt: saved.createdAt };
  }

  // 토론 요청 수락: 요청받은 당사자(opponent)만 가능. PENDING → STARTING 전환 후
  // 실제 토론 시작(양측 join 시 첫 턴 진입)은 소켓 join_room 흐름을 그대로 탄다.
  async accept(
    debateId: string,
    memberId: string,
  ): Promise<AcceptDebateResultDto> {
    const debate = await this.getDebateOrThrow(debateId);
    if (debate.opponentId !== memberId) {
      throw new GeneralException(DebateErrorCode.NOT_REQUEST_OPPONENT);
    }
    if (debate.currentTurn !== DebateTurn.PENDING) {
      throw new GeneralException(DebateErrorCode.REQUEST_NOT_PENDING);
    }

    debate.currentTurn = DebateTurn.STARTING;
    const saved = await this.debateRepository.save(debate);

    this.publisher?.emitDebateRequestAccepted(saved.hostId, {
      debateId: saved.id,
      opponentId: saved.opponentId,
      opponentNickname: saved.opponentNickname,
    });

    return { debateId: saved.id };
  }

  // 토론 요청 거절: 요청받은 당사자(opponent)만 가능. 토론 행을 soft delete한다.
  async reject(debateId: string, memberId: string): Promise<void> {
    const debate = await this.getDebateOrThrow(debateId);
    if (debate.opponentId !== memberId) {
      throw new GeneralException(DebateErrorCode.NOT_REQUEST_OPPONENT);
    }
    if (debate.currentTurn !== DebateTurn.PENDING) {
      throw new GeneralException(DebateErrorCode.REQUEST_NOT_PENDING);
    }

    debate.softDelete();
    const saved = await this.debateRepository.save(debate);

    this.publisher?.emitDebateRequestRejected(saved.hostId, {
      debateId: saved.id,
      opponentId: saved.opponentId,
      opponentNickname: saved.opponentNickname,
    });
  }

  // TODO: 실제 조회 구현 시 debate.status = NORMAL 필터를 적용해 soft-delete된 토론을 제외한다.
  findAll() {
    return `This action returns all debates`;
  }

  // TODO: 실제 조회 구현 시 status = NORMAL 필터를 적용해 soft-delete된 토론을 제외한다.
  findOne(id: string) {
    return `This action returns a #${id} debate`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(id: string, updateDebateDto: UpdateDebateDto) {
    return `This action updates a #${id} debate`;
  }

  remove(id: string) {
    return `This action removes a #${id} debate`;
  }

  private async getDebateOrThrow(debateId: string): Promise<Debate> {
    const debate = await this.debateRepository.findOneBy({
      id: debateId,
      status: ResourceStatus.NORMAL,
    });
    if (!debate) {
      throw new GeneralException(DebateErrorCode.NOT_FOUND);
    }
    return debate;
  }
}
