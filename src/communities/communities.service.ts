import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Community } from './entities/community.entity';
import { Theme } from './entities/theme.entity';
import { CommunityTheme } from './entities/community-theme.entity';
import { CommunityFavorite } from './entities/community-favorite.entity';
import { ThemeDto } from './dto/theme.dto';
import { CommunityDto, CommunitySliceDto } from './dto/community.dto';
import { CreateCommunityDto } from './dto/create-community.dto';
import { KeynoteDto } from './dto/keynote.dto';
import { CommunityMemberType, CommunitySort } from './communities.enums';
import { MembersService } from '../members/members.service';
import { Member } from '../members/entities/member.entity';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { MemberCommunity } from '../member-communities/entities/member-community.entity';
import { MemberPreviewDto } from '../members/dto/member.dto';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { CommunityErrorCode } from './exceptions/community-error-code';

@Injectable()
export class CommunitiesService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    @InjectRepository(Theme)
    private readonly themeRepository: Repository<Theme>,
    @InjectRepository(CommunityFavorite)
    private readonly communityFavoriteRepository: Repository<CommunityFavorite>,
    private readonly dataSource: DataSource,
    private readonly memberCommunitiesService: MemberCommunitiesService,
    private readonly membersService: MembersService,
  ) {}

  // 테마 목록 전체 조회
  async findAllThemes(): Promise<ThemeDto[]> {
    const themes = await this.themeRepository.find();
    return themes.map((theme) => ThemeDto.from(theme));
  }

  // 커뮤니티 목록 페이지 조회 (size+1개를 읽어 hasNext 판정)
  async findAll(
    page: number,
    size: number,
    sort?: CommunitySort,
    themeId?: string,
  ): Promise<CommunitySliceDto> {
    const { column, direction } = this.resolveSort(sort);

    const query = this.communityRepository
      .createQueryBuilder('community')
      .where('community.status = :status', { status: ResourceStatus.NORMAL })
      .orderBy(column, direction)
      .skip((page - 1) * size)
      .take(size + 1);

    if (themeId) {
      query.innerJoin(
        CommunityTheme,
        'communityTheme',
        'communityTheme.communityId = community.id AND communityTheme.themeId = :themeId',
        { themeId },
      );
    }

    const rows = await query.getMany();
    const hasNext = rows.length > size;
    const communities = hasNext ? rows.slice(0, size) : rows;

    const totalCommunityCount = await query.getCount();
    const hostMap = await this.loadMemberMap(communities.map((c) => c.hostId));

    return {
      totalCommunityCount,
      communityPreviews: communities.map((community) =>
        CommunityDto.from(community, hostMap.get(community.hostId)),
      ),
      pageInfo: { hasNext, page, size },
    };
  }

  // 커뮤니티 생성: community + community_theme + 호스트 member_community(기조발언)를 한 트랜잭션으로 저장
  async create(
    createCommunityDto: CreateCommunityDto,
    hostId: string,
  ): Promise<CommunityDto> {
    const host = await this.membersService.findOneOrThrow(hostId);

    const community = await this.dataSource.transaction(async (manager) => {
      const communityRepository = manager.getRepository(Community);
      const communityThemeRepository = manager.getRepository(CommunityTheme);

      const saved = await communityRepository.save(
        Community.open(hostId, host.nickname, createCommunityDto.topic),
      );

      await communityThemeRepository.save(
        communityThemeRepository.create({
          communityId: saved.id,
          themeId: createCommunityDto.themeId,
        }),
      );

      await this.memberCommunitiesService.create(
        hostId,
        saved.id,
        createCommunityDto.keynoteDto.opinion,
        createCommunityDto.keynoteDto.reasons,
        manager,
      );

      // TODO: debate 생성(roundCount 등)은 추후 구현
      return saved;
    });

    return CommunityDto.from(community, host);
  }

  // 커뮤니티 삭제: host만 가능. 커뮤니티 엔티티만 soft-delete(상태 전환)하고
  // 자식 리소스(theme/favorite/member_community)는 그대로 둔다.
  async delete(communityId: string, currentMemberId: string): Promise<void> {
    const community = await this.getCommunityOrThrow(communityId);
    if (community.hostId !== currentMemberId) {
      throw new GeneralException(CommunityErrorCode.DELETE_FORBIDDEN);
    }

    community.softDelete();
    await this.communityRepository.save(community);
  }

  // 커뮤니티 참여자 목록 조회 (memberType 분류 후 선택적 필터)
  async findCommunityMembers(
    communityId: string,
    memberType?: CommunityMemberType,
  ): Promise<MemberPreviewDto[]> {
    const community = await this.getCommunityOrThrow(communityId);

    const participants =
      await this.memberCommunitiesService.findParticipants(communityId);
    const memberMap = await this.loadMemberMap(
      participants.map((p) => p.memberId),
    );

    const previews = participants
      .map((participant) => {
        const member = memberMap.get(participant.memberId);
        // 회원이 삭제된 경우 등 방어적으로 제외
        if (!member) {
          return null;
        }
        return MemberPreviewDto.from(
          member,
          this.classifyMemberType(community, participant),
        );
      })
      .filter((preview): preview is MemberPreviewDto => preview !== null);

    return memberType
      ? previews.filter((preview) => preview.memberType === memberType)
      : previews;
  }

  // 특정 참여자의 기조 발언 조회 (미작성이면 404)
  async getMemberKeynote(
    communityId: string,
    memberId: string,
  ): Promise<KeynoteDto> {
    const participant = await this.memberCommunitiesService.findOne(
      memberId,
      communityId,
    );
    if (!participant) {
      throw new NotFoundException('참여자를 찾을 수 없습니다.');
    }

    if (participant.opinion === null) {
      throw new NotFoundException('기조 발언을 찾을 수 없습니다.');
    }

    return {
      opinion: participant.opinion,
      reasons: participant.reasons ?? [],
    };
  }

  // 나의 기조 발언 작성/수정 (없으면 참여+작성)
  async upsertMyKeynote(
    communityId: string,
    memberId: string,
    keynoteDto: KeynoteDto,
  ): Promise<KeynoteDto> {
    await this.getCommunityOrThrow(communityId);

    const saved = await this.memberCommunitiesService.upsertKeynote(
      memberId,
      communityId,
      keynoteDto.opinion,
      keynoteDto.reasons,
    );

    return {
      opinion: saved.opinion!,
      reasons: saved.reasons ?? [],
    };
  }

  // 즐겨찾기 추가: (memberId, communityId) 유니크 제약 기반 upsert로 원자적 처리
  async addMyFavorite(communityId: string, memberId: string): Promise<void> {
    await this.getCommunityOrThrow(communityId);

    await this.communityFavoriteRepository.upsert(
      { memberId, communityId, isFavored: true },
      ['memberId', 'communityId'],
    );
  }

  // 즐겨찾기 삭제: 단일 UPDATE로 isFavored=false 처리 (row가 없으면 no-op)
  async deleteMyFavorite(communityId: string, memberId: string): Promise<void> {
    await this.getCommunityOrThrow(communityId);

    await this.communityFavoriteRepository.update(
      { memberId, communityId },
      { isFavored: false },
    );
  }

  // 정렬 기준을 쿼리 컬럼/방향으로 매핑 (기본: 최신순)
  private resolveSort(sort?: CommunitySort): {
    column: string;
    direction: 'ASC' | 'DESC';
  } {
    switch (sort) {
      case CommunitySort.MEMBER_ASC:
        return { column: 'community.memberCount', direction: 'ASC' };
      case CommunitySort.MEMBER_DESC:
        return { column: 'community.memberCount', direction: 'DESC' };
      case CommunitySort.CREATED_AT_ASC:
        return { column: 'community.createdAt', direction: 'ASC' };
      case CommunitySort.CREATED_AT_DESC:
      default:
        return { column: 'community.createdAt', direction: 'DESC' };
    }
  }

  // 참여자를 HOST / KEYNOTE_MEMBER / NORMAL_MEMBER로 분류
  private classifyMemberType(
    community: Community,
    participant: MemberCommunity,
  ): CommunityMemberType {
    if (participant.memberId === community.hostId) {
      return CommunityMemberType.HOST;
    }
    return participant.opinion !== null
      ? CommunityMemberType.KEYNOTE_MEMBER
      : CommunityMemberType.NORMAL_MEMBER;
  }

  // id 목록으로 회원을 배치 조회해 id→Member 맵으로 반환
  private async loadMemberMap(ids: string[]): Promise<Map<string, Member>> {
    const members = await this.membersService.findByIds(ids);
    return new Map(members.map((member) => [member.id, member]));
  }

  private async getCommunityOrThrow(communityId: string): Promise<Community> {
    const community = await this.communityRepository.findOneBy({
      id: communityId,
      status: ResourceStatus.NORMAL,
    });
    if (!community) {
      throw new NotFoundException('커뮤니티를 찾을 수 없습니다.');
    }
    return community;
  }
}
