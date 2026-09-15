import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { CommunitiesService } from '../communities/communities.service';
import { Community } from '../communities/entities/community.entity';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { Member } from '../members/entities/member.entity';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import { MembersService } from '../members/members.service';
import {
  DebateSide,
  DebateSpeakers,
  DebateTurnSchedule,
  toDebateTurn,
} from './debate-turn';
import { CreateDebateDto } from './dto/create-debate.dto';
import {
  DebateDetailDto,
  DebateDto,
  DebateProgress,
  DebateSpeakerDto,
  NO_PROGRESS,
} from './dto/debate.dto';
import {
  DebateTurnWithVotesDto,
  NO_VOTES,
  VoteCount,
} from './dto/debate-turn.dto';
import { DebateMessageLike } from './entities/debate-message-like.entity';
import { DebateMessage } from './entities/debate-message.entity';
import { DebateStatus } from './entities/debate-status.enum';
import { Debate, DebateTurn } from './entities/debate.entity';
import { DebateErrorCode } from './exceptions/debate-error-code';

// 확정 턴 수와 마지막 턴 시각의 원시 집계 결과(현재 차례 파생의 입력).
interface RawProgress {
  debateId: string;
  turnCount: string;
  lastTurnCreatedAt: Date | null;
}

interface RawVoteCount {
  messageId: string;
  likeCount: string;
  dislikeCount: string;
}

@Injectable()
export class DebatesService {
  constructor(
    @InjectRepository(Debate)
    private readonly debateRepository: Repository<Debate>,
    @InjectRepository(DebateMessage)
    private readonly messageRepository: Repository<DebateMessage>,
    @InjectRepository(DebateMessageLike)
    private readonly likeRepository: Repository<DebateMessageLike>,
    private readonly communitiesService: CommunitiesService,
    private readonly memberCommunitiesService: MemberCommunitiesService,
    private readonly membersService: MembersService,
  ) {}

  // 토론 1건을 커뮤니티와 함께 조회한다.
  // 토론과 커뮤니티 모두 soft-delete되지 않은 것만 대상이며, 없으면 NOT_FOUND.
  async findOneOrThrow(debateId: string): Promise<Debate> {
    const debate = await this.debateRepository.findOne({
      where: {
        id: debateId,
        status: ResourceStatus.NORMAL,
        community: { status: ResourceStatus.NORMAL },
      },
      relations: { community: true },
    });

    if (!debate) {
      throw new GeneralException(DebateErrorCode.NOT_FOUND);
    }
    return debate;
  }

  // 서버 재시작 후 턴 타임아웃 타이머를 다시 걸기 위해 진행 중인 토론의 id만 읽는다.
  async findInProgressIds(): Promise<string[]> {
    const debates = await this.debateRepository.find({
      select: { id: true },
      where: {
        status: ResourceStatus.NORMAL,
        debateStatus: DebateStatus.IN_PROGRESS,
      },
    });
    return debates.map((debate) => debate.id);
  }

  /**
   * 토론을 만든다(계약 POST /debates). 주제·라운드 수는 요청 값을 토론이 직접 갖는다.
   * 커뮤니티와 양쪽 발언자의 소속을 확인하고 READY 상태로 저장한다.
   */
  async create(request: CreateDebateDto, memberId: string): Promise<DebateDto> {
    const community = await this.communitiesService.findOneOrThrow(
      request.communityId,
    );
    await this.assertParticipant(memberId, community.id);

    const [sideA, sideB] = await this.loadSpeakers(request, community);

    const debate = await this.debateRepository.save(
      this.debateRepository.create({
        communityId: community.id,
        topic: request.topic,
        rebuttalQuestionRounds: request.rebuttalQuestionRounds,
        // 컬럼 이름은 host/opponent 그대로 두고 계약의 SIDE_A/SIDE_B를 매핑한다.
        hostId: sideA.id,
        hostNickname: sideA.nickname,
        opponentId: sideB.id,
        opponentNickname: sideB.nickname,
        currentTurn: DebateTurn.HOST,
        debateStatus: DebateStatus.READY,
      }),
    );

    // 아직 확정된 턴이 없으므로 진행 정도를 따로 읽지 않는다.
    return DebateDto.from(debate, NO_PROGRESS);
  }

  // 토론 목록(계약 GET /debates). status 필터 외에는 좁히지 않는다.
  async findAll(status?: DebateStatus): Promise<DebateDto[]> {
    const debates = await this.debateRepository.find({
      where: {
        status: ResourceStatus.NORMAL,
        community: { status: ResourceStatus.NORMAL },
        ...(status !== undefined ? { debateStatus: status } : {}),
      },
      order: { createdAt: 'DESC' },
    });

    const progress = await this.loadProgress(
      debates.map((debate) => debate.id),
    );
    return debates.map((debate) =>
      DebateDto.from(debate, progress.get(debate.id) ?? NO_PROGRESS),
    );
  }

  // 토론 1건을 DTO로(계약 Debate). /start처럼 상태를 바꾼 뒤 응답을 만들 때도 쓴다.
  async findOneDto(debateId: string): Promise<DebateDto> {
    const debate = await this.findOneOrThrow(debateId);
    return DebateDto.from(debate, await this.loadOneProgress(debateId));
  }

  // 토론 상세(계약 GET /debates/:id). 발언자 프로필·기조 발언과 투표 집계까지 채운다.
  async findDetail(
    debateId: string,
    viewerId: string,
  ): Promise<DebateDetailDto> {
    const debate = await this.findOneOrThrow(debateId);
    const [speakers, turns, progress] = await Promise.all([
      this.loadSpeakerDtos(debate),
      this.findTurns(debateId, debate),
      this.loadOneProgress(debateId),
    ]);

    return DebateDetailDto.fromDetail(debate, progress, {
      speakers,
      viewerId,
      turns,
    });
  }

  // 확정된 턴 목록(계약 GET /debates/:id/turns). 순서·파생 규칙은 채팅과 같다.
  async findTurns(
    debateId: string,
    loaded?: Debate,
  ): Promise<DebateTurnWithVotesDto[]> {
    const debate = loaded ?? (await this.findOneOrThrow(debateId));
    const speakers: DebateSpeakers = {
      [DebateSide.SIDE_A]: debate.hostId,
      // 상대가 없는 토론에는 확정 턴도 없으므로 어떤 값이 와도 결과가 달라지지 않는다.
      [DebateSide.SIDE_B]: debate.opponentId ?? '',
    };
    const schedule = new DebateTurnSchedule(debate.rebuttalQuestionRounds);

    const rows = await this.findTurnRows(debate.id);
    const votes = await this.loadVoteCounts(rows.map((row) => row.id));

    return rows.map((row) =>
      DebateTurnWithVotesDto.from(
        toDebateTurn(row, speakers, schedule),
        votes.get(row.id) ?? NO_VOTES,
      ),
    );
  }

  // 채팅이 확정한 턴만 sequence 순으로 읽는다. 시드 행은 sequence가 null이라 자연히 제외된다.
  private async findTurnRows(debateId: string): Promise<DebateMessage[]> {
    return this.messageRepository.find({
      where: {
        debateId,
        status: ResourceStatus.NORMAL,
        sequence: Not(IsNull()),
      },
      order: { sequence: 'ASC' },
    });
  }

  // 커뮤니티 참여자가 아니면 토론을 만들 수 없다.
  private async assertParticipant(
    memberId: string,
    communityId: string,
  ): Promise<void> {
    const participation = await this.memberCommunitiesService.findOne(
      memberId,
      communityId,
    );
    if (participation === null) {
      throw new GeneralException(DebateErrorCode.CREATE_FORBIDDEN);
    }
  }

  // 양쪽 발언자를 회원·커뮤니티 소속까지 확인하고 [SIDE_A, SIDE_B] 순서로 돌려준다.
  private async loadSpeakers(
    request: CreateDebateDto,
    community: Community,
  ): Promise<[Member, Member]> {
    const ids = [request.sideASpeakerId, request.sideBSpeakerId];
    const members = await this.membersService.findByIds(ids);
    const memberById = new Map(members.map((member) => [member.id, member]));

    const participants = await this.memberCommunitiesService.findParticipants(
      community.id,
    );
    const participantIds = new Set(
      participants.map((participant) => participant.memberId),
    );

    return ids.map((id) => {
      const member = memberById.get(id);
      if (!member) {
        throw new GeneralException(MemberErrorCode.NOT_FOUND);
      }
      if (!participantIds.has(id)) {
        throw new GeneralException(DebateErrorCode.SPEAKER_NOT_IN_COMMUNITY);
      }
      return member;
    }) as [Member, Member];
  }

  // 발언자 2명의 회원 정보와 그 커뮤니티에서의 기조 발언을 합쳐 DTO로 만든다.
  private async loadSpeakerDtos(
    debate: Debate,
  ): Promise<Record<DebateSide, DebateSpeakerDto>> {
    const ids = [debate.hostId, debate.opponentId].filter(
      (id): id is string => id !== null,
    );
    const [members, keynotes] = await Promise.all([
      this.membersService.findByIds(ids),
      this.memberCommunitiesService.findParticipants(debate.communityId),
    ]);
    const memberById = new Map(members.map((member) => [member.id, member]));
    const keynoteById = new Map(
      keynotes.map((keynote) => [keynote.memberId, keynote]),
    );

    const toSpeakerDto = (id: string | null): DebateSpeakerDto => {
      const member = id === null ? undefined : memberById.get(id);
      if (!member) {
        throw new GeneralException(MemberErrorCode.NOT_FOUND);
      }
      return DebateSpeakerDto.from(member, keynoteById.get(member.id) ?? null);
    };

    return {
      [DebateSide.SIDE_A]: toSpeakerDto(debate.hostId),
      [DebateSide.SIDE_B]: toSpeakerDto(debate.opponentId),
    };
  }

  private async loadOneProgress(debateId: string): Promise<DebateProgress> {
    const progress = await this.loadProgress([debateId]);
    return progress.get(debateId) ?? NO_PROGRESS;
  }

  /**
   * 토론별 확정 턴 수와 마지막 턴 시각을 한 번에 집계한다. 현재 차례(phase/round/side)는
   * 저장하지 않고 이 두 값에서 파생하므로, 목록도 토론마다 조회하지 않고 한 번에 읽는다.
   */
  private async loadProgress(
    debateIds: string[],
  ): Promise<Map<string, DebateProgress>> {
    if (debateIds.length === 0) {
      return new Map();
    }

    const rows = await this.messageRepository
      .createQueryBuilder('message')
      .select('message.debateId', 'debateId')
      .addSelect('COUNT(*)', 'turnCount')
      .addSelect('MAX(message.createdAt)', 'lastTurnCreatedAt')
      .where('message.debateId IN (:...debateIds)', { debateIds })
      .andWhere('message.status = :status', { status: ResourceStatus.NORMAL })
      .andWhere('message.sequence IS NOT NULL')
      .groupBy('message.debateId')
      .getRawMany<RawProgress>();

    return new Map(
      rows.map((row) => [
        row.debateId,
        {
          finalizedTurnCount: Number(row.turnCount),
          lastTurnCreatedAt: row.lastTurnCreatedAt,
        },
      ]),
    );
  }

  // 턴별 좋아요/싫어요 수(isLiked true=LIKE, false=DISLIKE).
  private async loadVoteCounts(
    messageIds: string[],
  ): Promise<Map<string, VoteCount>> {
    if (messageIds.length === 0) {
      return new Map();
    }

    const rows = await this.likeRepository
      .createQueryBuilder('vote')
      .select('vote.messageId', 'messageId')
      .addSelect('COUNT(*) FILTER (WHERE vote.isLiked)', 'likeCount')
      .addSelect('COUNT(*) FILTER (WHERE NOT vote.isLiked)', 'dislikeCount')
      .where('vote.messageId IN (:...messageIds)', { messageIds })
      .groupBy('vote.messageId')
      .getRawMany<RawVoteCount>();

    return new Map(
      rows.map((row) => [
        row.messageId,
        {
          likeCount: Number(row.likeCount),
          dislikeCount: Number(row.dislikeCount),
        },
      ]),
    );
  }
}
