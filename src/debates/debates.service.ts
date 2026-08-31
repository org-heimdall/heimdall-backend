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

  // 토론 요청 생성: 호스트만 가능, 상대는 커뮤니티 멤버 + 기조발언 필요.
  // PENDING으로 저장 후 상대에게 소켓 알림, 실제 시작은 accept() 수락 시.
  async create(
    dto: CreateDebateDto,
    hostId: string,
  ): Promise<CreateDebateResultDto> {
    const { opponentId, communityId } = dto;
    const community = await this.communitiesService.findOneOrThrow(communityId);
    if (community.hostId !== hostId) {
      throw new GeneralException(DebateErrorCode.NOT_HOST);
    }
    // 자기 자신은 상대 토론자로 지정 불가.
    if (opponentId === hostId) {
      throw new GeneralException(DebateErrorCode.SELF_DEBATE_FORBIDDEN);
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

    // 거절된 PENDING 행을 조건부 UPDATE로 되살린다. status != NORMAL 조건 덕에 동시
    // 요청 중 한쪽만 점유하고, 진 쪽은 아래 insert의 유니크 인덱스 위반으로 처리된다.
    const reopened = await this.debateRepository.update(
      {
        communityId,
        hostId,
        currentTurn: DebateTurn.PENDING,
        status: Not(ResourceStatus.NORMAL),
      },
      Debate.reopenRequestValues(host.nickname, opponentId, opponent.nickname),
    );

    if (reopened.affected === 1) {
      const revived = await this.debateRepository.findOneBy({
        communityId,
        hostId,
        currentTurn: DebateTurn.PENDING,
        status: ResourceStatus.NORMAL,
      });
      if (revived) {
        return this.emitCreated(revived);
      }
      // 점유 직후 상대가 거절한 극단 케이스: 아래 insert 경로로 폴스루한다. 되살린 행이
      // 여전히 PENDING이라 유니크 인덱스 위반 → catch에서 REQUEST_ALREADY_PENDING 처리.
    }

    const debate = Debate.open({
      communityId: communityId,
      hostId,
      hostNickname: host.nickname,
      opponentId,
      opponentNickname: opponent.nickname,
    });

    let saved: Debate;
    try {
      saved = await this.debateRepository.save(debate);
    } catch (error) {
      // 동시 요청 레이스: 활성 검사와 save 사이 선점은 부분 유니크 인덱스가 막는다.
      // 이미 분류가 끝난 기대 가능한 에러이므로 cause 없이 던진다.
      const constraint = getUniqueViolationConstraint(error);
      if (constraint === DEBATE_PENDING_REQUEST_UNIQUE) {
        throw new GeneralException(DebateErrorCode.REQUEST_ALREADY_PENDING);
      }
      throw error;
    }

    return this.emitCreated(saved);
  }

  // 토론 요청 생성 성공(재사용/신규 공통) 처리: 상대에게 debate_requested를 발행하고 응답을 만든다.
  private emitCreated(saved: Debate): CreateDebateResultDto {
    this.publisher?.emitDebateRequested(saved.opponentId, {
      debateId: saved.id,
      communityId: saved.communityId,
      hostId: saved.hostId,
      hostNickname: saved.hostNickname,
    });

    return { debateId: saved.id, createdAt: saved.createdAt };
  }

  // 토론 요청 수락: 요청받은 당사자(opponent)만 가능. PENDING → STARTING 전환 후
  // 실제 토론 시작(양측 join 시 첫 턴 진입)은 소켓 join_debate 흐름을 그대로 탄다.
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

    // 사전 검증과 UPDATE 사이 레이스 대비: 조건부 UPDATE로 한쪽만 성공시킨다.
    // affected가 0이면 이미 다른 요청이 전이시킨 것이므로 REQUEST_NOT_PENDING 처리.
    const transition = await this.debateRepository.update(
      {
        id: debateId,
        status: ResourceStatus.NORMAL,
        currentTurn: DebateTurn.PENDING,
      },
      { currentTurn: DebateTurn.STARTING },
    );
    if (transition.affected !== 1) {
      throw new GeneralException(DebateErrorCode.REQUEST_NOT_PENDING);
    }

    this.publisher?.emitDebateRequestAccepted(debate.hostId, {
      debateId: debate.id,
      opponentId: debate.opponentId,
      opponentNickname: debate.opponentNickname,
    });

    return { debateId: debate.id };
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

    // accept와 동일한 레이스 대비. 소프트 삭제 값은 SoftDeletableEntity.softDelete()의
    // 일반 삭제(DELETED)와 동일해야 한다.
    const transition = await this.debateRepository.update(
      {
        id: debateId,
        status: ResourceStatus.NORMAL,
        currentTurn: DebateTurn.PENDING,
      },
      { status: ResourceStatus.DELETED },
    );
    if (transition.affected !== 1) {
      throw new GeneralException(DebateErrorCode.REQUEST_NOT_PENDING);
    }

    this.publisher?.emitDebateRequestRejected(debate.hostId, {
      debateId: debate.id,
      opponentId: debate.opponentId,
      opponentNickname: debate.opponentNickname,
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
