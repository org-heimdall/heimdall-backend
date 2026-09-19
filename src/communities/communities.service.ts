import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GeneralException } from '../common/exceptions/general.exception';
import { CommunityErrorCode } from './exceptions/community-error-code';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Community, CommunityState } from './entities/community.entity';
import { Theme } from './entities/theme.entity';
import { CommunityFavorite } from './entities/community-favorite.entity';
import { ThemeDto } from './dto/theme.dto';
import { CommunityDto, MAX_PARTICIPANT_PREVIEWS } from './dto/community.dto';
import { CreateCommunityDto } from './dto/create-community.dto';
import { KeynoteDto } from './dto/keynote.dto';
import { CommunityMemberType, CommunitySort } from './communities.enums';
import { MembersService } from '../members/members.service';
import { Member } from '../members/entities/member.entity';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import {
  CommunityDebateIntent,
  MemberCommunity,
} from '../member-communities/entities/member-community.entity';
import { CommunityMemberDto } from './dto/community-member.dto';
import { ResourceStatus } from '../common/entities/resource-status.enum';

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

  // 트랜잭션 참여용: manager가 있으면 그 안의 레포지토리를, 없으면 기본 레포지토리를 사용한다.
  private repo(manager?: EntityManager): Repository<Community> {
    return manager
      ? manager.getRepository(Community)
      : this.communityRepository;
  }

  // 테마 목록 전체 조회
  async findAllThemes(): Promise<ThemeDto[]> {
    const themes = await this.themeRepository.find();
    return themes.map((theme) => ThemeDto.from(theme));
  }

  /**
   * 커뮤니티 목록 조회. 정렬·페이지·테마 필터는 프론트가 쓰지 않아도 되는 선택 쿼리다.
   * 계약상 쿼리 없이 부른 결과가 곧 전체 목록이므로, size를 주지 않으면 자르지 않는다.
   */
  async findAll(
    currentMemberId: string,
    page?: number,
    size?: number,
    sort?: CommunitySort,
    themeId?: string,
  ): Promise<CommunityDto[]> {
    const { column, direction } = this.resolveSort(sort);

    const query = this.communityRepository
      .createQueryBuilder('community')
      .where('community.status = :status', { status: ResourceStatus.NORMAL })
      .orderBy(column, direction);

    if (size !== undefined) {
      query.skip(((page ?? 1) - 1) * size).take(size);
    }

    if (themeId) {
      query.andWhere('community.themeId = :themeId', { themeId });
    }

    return this.toCommunityDtos(await query.getMany(), currentMemberId);
  }

  // 커뮤니티 1건 조회. 목록과 같은 스키마를 돌려주므로 조립 경로도 같이 쓴다.
  async findOne(
    communityId: string,
    currentMemberId: string,
  ): Promise<CommunityDto> {
    const community = await this.findOneOrThrow(communityId);
    const [dto] = await this.toCommunityDtos([community], currentMemberId);
    return dto;
  }

  // 커뮤니티 생성: community + 호스트 member_community(기조발언)를 한 트랜잭션으로 저장
  async create(
    createCommunityDto: CreateCommunityDto,
    hostId: string,
  ): Promise<CommunityDto> {
    await this.membersService.findOneOrThrow(hostId);
    const theme = await this.findThemeByNameOrThrow(
      createCommunityDto.category,
    );

    const community = await this.dataSource.transaction(async (manager) => {
      const communityRepository = manager.getRepository(Community);

      const saved = await communityRepository.save(
        Community.open({
          hostId,
          themeId: theme.id,
          title: createCommunityDto.title,
          topic: createCommunityDto.topic,
          debateRoundCount: createCommunityDto.rounds,
          isPublic: createCommunityDto.isPublic,
        }),
      );

      // 방장의 기조 발언은 참여 행에 실린다(계약의 hostClaim/hostReasons가 여기서 나온다).
      await this.memberCommunitiesService.create(
        hostId,
        saved.id,
        createCommunityDto.hostClaim,
        createCommunityDto.hostReasons,
        manager,
      );

      // TODO: debate 생성은 추후 구현
      return saved;
    });

    const [dto] = await this.toCommunityDtos([community], hostId);
    return dto;
  }

  // 커뮤니티 삭제: host만 가능. 커뮤니티 엔티티만 soft-delete(상태 전환)하고
  // 자식 리소스(favorite/member_community)는 그대로 둔다.
  async delete(communityId: string, currentMemberId: string): Promise<void> {
    const community = await this.findOneOrThrow(communityId);
    if (community.hostId !== currentMemberId) {
      throw new GeneralException(CommunityErrorCode.DELETE_FORBIDDEN);
    }

    community.softDelete();
    await this.communityRepository.save(community);
  }

  // 커뮤니티 참여자 목록 조회(계약 CommunityMember[]). memberType은 응답에 실리지 않는
  // 분류 기준이라 필터링에만 쓴다(기조 발언 작성자만 보기 등).
  async findCommunityMembers(
    communityId: string,
    memberType?: CommunityMemberType,
  ): Promise<CommunityMemberDto[]> {
    const community = await this.findOneOrThrow(communityId);

    const participants =
      await this.memberCommunitiesService.findParticipants(communityId);
    const memberMap = await this.loadMemberMap(
      participants.map((p) => p.memberId),
    );

    return participants
      .filter(
        (participant) =>
          memberType === undefined ||
          this.classifyMemberType(community, participant) === memberType,
      )
      .map((participant) => {
        const member = memberMap.get(participant.memberId);
        // 회원이 삭제된 경우 등 방어적으로 제외
        return member
          ? CommunityMemberDto.from(member, participant, community.hostId)
          : null;
      })
      .filter((dto): dto is CommunityMemberDto => dto !== null);
  }

  /**
   * 토론 의사 변경(본인). 응답은 204지만 방 전체가 갱신된 참여자를 알아야 하므로
   * 컨트롤러가 이 DTO를 그대로 WS 이벤트로 발행한다.
   */
  async updateMyDebateIntent(
    communityId: string,
    memberId: string,
    debateIntent: CommunityDebateIntent,
  ): Promise<CommunityMemberDto> {
    const community = await this.findOneOrThrow(communityId);

    const participation =
      await this.memberCommunitiesService.updateDebateIntent(
        memberId,
        communityId,
        debateIntent,
      );
    if (participation === null) {
      throw new GeneralException(CommunityErrorCode.PARTICIPANT_NOT_FOUND);
    }

    const member = await this.membersService.findOneOrThrow(memberId);
    return CommunityMemberDto.from(member, participation, community.hostId);
  }

  /**
   * 토론이 시작되면 커뮤니티를 진행 중으로 옮긴다(WAITING → ACTIVE).
   * 이미 ACTIVE면 결과가 같으므로 조건 없이 갱신한다. 초대 수락 트랜잭션에 manager로 참여한다.
   */
  async markActive(
    communityId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.repo(manager).update(
      { id: communityId, status: ResourceStatus.NORMAL },
      { state: CommunityState.ACTIVE },
    );
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
      throw new GeneralException(CommunityErrorCode.PARTICIPANT_NOT_FOUND);
    }

    if (participant.opinion === null) {
      throw new GeneralException(CommunityErrorCode.KEYNOTE_NOT_FOUND);
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
    await this.findOneOrThrow(communityId);

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

  /**
   * 커뮤니티 참여(본인). 이미 참여 중이면 아무 일도 하지 않는다(멱등) —
   * 참여 행이 실제로 생겼을 때만 인원 수를 늘려야 하므로 둘을 한 트랜잭션에서 처리한다.
   */
  async joinMe(communityId: string, memberId: string): Promise<void> {
    await this.findOneOrThrow(communityId);

    await this.dataSource.transaction(async (manager) => {
      const joined = await this.memberCommunitiesService.insertIfAbsent(
        memberId,
        communityId,
        manager,
      );
      if (joined) {
        await manager.increment(
          Community,
          { id: communityId },
          'memberCount',
          1,
        );
      }
    });
  }

  /**
   * 커뮤니티 나가기(본인). 참여 중이 아니면 아무 일도 하지 않는다(멱등).
   * 방장은 나갈 수 없다 — hostId가 참여자가 아닌 커뮤니티가 되어 참여자 분류·토론 생성이 깨진다.
   */
  async leaveMe(communityId: string, memberId: string): Promise<void> {
    const community = await this.findOneOrThrow(communityId);
    if (community.hostId === memberId) {
      throw new GeneralException(CommunityErrorCode.HOST_CANNOT_LEAVE);
    }

    await this.dataSource.transaction(async (manager) => {
      const left = await this.memberCommunitiesService.deleteOne(
        memberId,
        communityId,
        manager,
      );
      if (left) {
        await manager.decrement(
          Community,
          { id: communityId },
          'memberCount',
          1,
        );
      }
    });
  }

  // 즐겨찾기 추가: (memberId, communityId) 유니크 제약 기반 upsert로 원자적 처리
  async addMyFavorite(communityId: string, memberId: string): Promise<void> {
    await this.findOneOrThrow(communityId);

    await this.communityFavoriteRepository.upsert(
      { memberId, communityId, isFavored: true },
      ['memberId', 'communityId'],
    );
  }

  // 즐겨찾기 삭제: 단일 UPDATE로 isFavored=false 처리 (row가 없으면 no-op)
  async deleteMyFavorite(communityId: string, memberId: string): Promise<void> {
    await this.findOneOrThrow(communityId);

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

  /**
   * 커뮤니티들을 계약의 Community로 조립한다. 테마·참여 행·회원은 커뮤니티마다 읽지 않고
   * id 목록으로 한 번에 읽어 목록 조회가 N+1이 되지 않게 한다.
   */
  private async toCommunityDtos(
    communities: Community[],
    currentMemberId: string,
  ): Promise<CommunityDto[]> {
    if (communities.length === 0) {
      return [];
    }

    const [participations, themeMap] = await Promise.all([
      this.memberCommunitiesService.findParticipantsByCommunities(
        communities.map((community) => community.id),
      ),
      this.loadThemeMap(communities.map((community) => community.themeId)),
    ]);

    const participationsByCommunity = new Map<string, MemberCommunity[]>();
    for (const participation of participations) {
      const rows =
        participationsByCommunity.get(participation.communityId) ?? [];
      rows.push(participation);
      participationsByCommunity.set(participation.communityId, rows);
    }

    // 미리보기에 실릴 참여자와 방장만 모아 한 번에 읽는다(참여자 전원을 읽을 필요는 없다).
    const previewRows = communities.flatMap((community) =>
      this.toPreviewRows(participationsByCommunity.get(community.id)),
    );
    const memberMap = await this.loadMemberMap([
      ...communities.map((community) => community.hostId),
      ...previewRows.map((row) => row.memberId),
    ]);

    return communities.map((community) => {
      const rows = participationsByCommunity.get(community.id) ?? [];
      return CommunityDto.from({
        community,
        category: themeMap.get(community.themeId)?.name ?? '',
        host: memberMap.get(community.hostId) ?? null,
        hostKeynote:
          rows.find((row) => row.memberId === community.hostId) ?? null,
        participants: this.toPreviewRows(rows)
          .map((row) => memberMap.get(row.memberId))
          // 탈퇴한 참여자는 회원 조회에서 빠지므로 미리보기에서도 제외한다.
          .filter((member): member is Member => member !== undefined),
        currentMemberId,
        isJoined: rows.some((row) => row.memberId === currentMemberId),
      });
    });
  }

  // 참여 행을 미리보기 정원만큼 자른다(참여 순 정렬은 조회 시점에 이미 적용돼 있다).
  private toPreviewRows(rows: MemberCommunity[] = []): MemberCommunity[] {
    return rows.slice(0, MAX_PARTICIPANT_PREVIEWS);
  }

  // 계약의 category는 테마 이름이다. 고정 테마 목록에 없는 값은 새로 만들지 않고 거절한다.
  private async findThemeByNameOrThrow(name: string): Promise<Theme> {
    const theme = await this.themeRepository.findOneBy({ name });
    if (!theme) {
      throw new GeneralException(CommunityErrorCode.THEME_NOT_FOUND);
    }
    return theme;
  }

  // id 목록으로 테마를 배치 조회해 id→Theme 맵으로 반환(카테고리 이름 조립용)
  private async loadThemeMap(ids: string[]): Promise<Map<string, Theme>> {
    if (ids.length === 0) {
      return new Map();
    }
    const themes = await this.themeRepository.findBy({ id: In(ids) });
    return new Map(themes.map((theme) => [theme.id, theme]));
  }

  // id 목록으로 회원을 배치 조회해 id→Member 맵으로 반환
  private async loadMemberMap(ids: string[]): Promise<Map<string, Member>> {
    const members = await this.membersService.findByIds(ids);
    return new Map(members.map((member) => [member.id, member]));
  }

  // 커뮤니티 1건 조회(soft-delete 제외). 다른 도메인(토론 생성 등)도 이 경로로만 커뮤니티를 읽는다.
  async findOneOrThrow(communityId: string): Promise<Community> {
    const community = await this.communityRepository.findOneBy({
      id: communityId,
      status: ResourceStatus.NORMAL,
    });
    if (!community) {
      throw new GeneralException(CommunityErrorCode.NOT_FOUND);
    }
    return community;
  }
}
