import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  HttpCode,
  Put,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CommunityDto } from './dto/community.dto';
import { ThemeDto } from './dto/theme.dto';
import { CommunityMemberDto } from './dto/community-member.dto';
import { UpdateDebateIntentDto } from './dto/update-debate-intent.dto';
import { KeynoteDto } from './dto/keynote.dto';
import { CommunityMemberType, CommunitySort } from './communities.enums';
import { CommunityErrorCode } from './exceptions/community-error-code';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { CommunityChatPublisher } from '../community-chat/community-chat.publisher';

export { CommunityMemberType, CommunitySort };

@Controller('communities')
export class CommunitiesController {
  constructor(
    private readonly communitiesService: CommunitiesService,
    // 토론 의사 변경은 응답이 204라, 결과를 방 전체에 알리는 것은 WS 이벤트뿐이다.
    private readonly publisher: CommunityChatPublisher,
  ) {}

  @ApiOperation({
    summary: '테마 목록 전체 조회',
  })
  @ApiOkResponse({ type: [ThemeDto] })
  @Get('/themes')
  async findAllThemes(): Promise<ThemeDto[]> {
    return this.communitiesService.findAllThemes();
  }

  @ApiOperation({
    summary: '커뮤니티 목록 조회',
    description:
      '정렬·페이지·테마 필터는 모두 선택이며, 쿼리 없이 부르면 최신순 전체 목록을 돌려준다. ' +
      'size를 주면 그 크기로 잘라 page번째 묶음만 돌려준다. ' +
      'isOwnedByCurrentUser/isJoined는 액세스 토큰의 회원 기준이다.',
  })
  @ApiOkResponse({ type: [CommunityDto] })
  @ApiAuthRequired()
  @Get()
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'size와 함께 줄 때만 의미가 있다(기본 1).',
  })
  @ApiQuery({
    name: 'size',
    required: false,
    type: Number,
    example: 10,
    description: '생략하면 자르지 않고 전체를 돌려준다.',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: CommunitySort,
    enumName: 'CommunitySort',
    description: '정렬 기준',
    example: CommunitySort.MEMBER_ASC,
  })
  @ApiQuery({
    name: 'themeId',
    required: false,
    type: String,
    description: '테마 필터',
  })
  async findAll(
    @CurrentMember() memberId: string,
    @Query('page', new ParsePositiveIntPipe({ optional: true })) page?: number,
    @Query('size', new ParsePositiveIntPipe({ optional: true })) size?: number,
    @Query('sort') sort?: CommunitySort,
    @Query('themeId', new ParseUUIDPipe({ optional: true })) themeId?: string,
  ): Promise<CommunityDto[]> {
    return this.communitiesService.findAll(memberId, page, size, sort, themeId);
  }

  @ApiOperation({
    summary: '커뮤니티 생성',
    description:
      'category는 GET /communities/themes가 돌려주는 테마 이름 중 하나여야 한다. ' +
      'hostClaim/hostReasons는 방장의 기조 발언으로 함께 저장된다.',
  })
  @ApiCreatedResponse({ type: CommunityDto })
  @ApiErrorResponses(
    MemberErrorCode.NOT_FOUND,
    CommunityErrorCode.THEME_NOT_FOUND,
  )
  @ApiAuthRequired()
  @Post()
  async create(
    @CurrentMember() memberId: string,
    @Body() request: CreateCommunityDto,
  ): Promise<CommunityDto> {
    return this.communitiesService.create(request, memberId);
  }

  @ApiOperation({
    summary: '커뮤니티 단건 조회',
    description: 'isOwnedByCurrentUser/isJoined는 액세스 토큰의 회원 기준이다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiOkResponse({ type: CommunityDto })
  @ApiErrorResponses(CommunityErrorCode.NOT_FOUND)
  @ApiAuthRequired()
  @Get('/:communityId')
  async findOne(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
  ): Promise<CommunityDto> {
    return this.communitiesService.findOne(communityId, memberId);
  }

  @ApiOperation({
    summary: '커뮤니티 삭제',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiNoContentResponse({ description: '커뮤니티 삭제 성공' })
  @ApiErrorResponses(
    CommunityErrorCode.NOT_FOUND,
    CommunityErrorCode.DELETE_FORBIDDEN,
  )
  @ApiAuthRequired()
  @Delete('/:communityId')
  @HttpCode(204)
  async delete(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.communitiesService.delete(communityId, memberId);
  }

  @ApiOperation({
    summary: '커뮤니티 참여 (본인)',
    description:
      '이미 참여 중이면 아무 일도 일어나지 않는다(다시 호출해도 204). 참여자 수는 실제로 참여했을 때만 늘어난다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiNoContentResponse({ description: '참여 성공' })
  @ApiErrorResponses(CommunityErrorCode.NOT_FOUND)
  @ApiAuthRequired()
  @Post(':communityId/members/me')
  @HttpCode(204)
  async joinMe(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.communitiesService.joinMe(communityId, memberId);
  }

  @ApiOperation({
    summary: '커뮤니티 나가기 (본인)',
    description:
      '참여 중이 아니면 아무 일도 일어나지 않는다(204). 작성한 기조 발언도 함께 사라진다. 방장은 나갈 수 없다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiNoContentResponse({ description: '나가기 성공' })
  @ApiErrorResponses(
    CommunityErrorCode.NOT_FOUND,
    CommunityErrorCode.HOST_CANNOT_LEAVE,
  )
  @ApiAuthRequired()
  @Delete(':communityId/members/me')
  @HttpCode(204)
  async leaveMe(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.communitiesService.leaveMe(communityId, memberId);
  }

  @ApiOperation({
    summary: '커뮤니티 참여자 목록 조회',
    description:
      'memberType은 응답에 실리지 않는 분류 기준으로, 기조 발언 작성자만 보기 등 필터링에만 쓴다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiOkResponse({ type: [CommunityMemberDto] })
  @ApiErrorResponses(CommunityErrorCode.NOT_FOUND)
  @Get(':communityId/members')
  @ApiQuery({
    name: 'memberType',
    required: false,
    enum: CommunityMemberType,
    enumName: 'CommunityMemberType',
    description: '필터 기준',
    example: CommunityMemberType.KEYNOTE_MEMBER,
  })
  async findCommunityMembers(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query('memberType') memberType?: CommunityMemberType,
  ): Promise<CommunityMemberDto[]> {
    return this.communitiesService.findCommunityMembers(
      communityId,
      memberType,
    );
  }

  @ApiOperation({
    summary: '나의 토론 의사 변경',
    description:
      '방장은 OPEN_TO_DEBATE인 참여자만 토론에 초대할 수 있다. 결과는 커뮤니티 WS의 ' +
      'community.member.debate-intent.changed로 방 전체에 전달된다(응답 본문 없음).',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiNoContentResponse({ description: '토론 의사 변경 성공' })
  @ApiErrorResponses(
    CommunityErrorCode.NOT_FOUND,
    CommunityErrorCode.PARTICIPANT_NOT_FOUND,
    MemberErrorCode.NOT_FOUND,
  )
  @ApiAuthRequired()
  @Put(':communityId/members/me/debate-intent')
  @HttpCode(204)
  async updateMyDebateIntent(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
    @Body() request: UpdateDebateIntentDto,
  ): Promise<void> {
    const member = await this.communitiesService.updateMyDebateIntent(
      communityId,
      memberId,
      request.debateIntent,
    );

    this.publisher.memberDebateIntentChanged({ communityId, member });
  }

  @ApiOperation({
    summary: '커뮤니티 참여자의 기조 발언 조회',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: KeynoteDto })
  @ApiErrorResponses(
    CommunityErrorCode.PARTICIPANT_NOT_FOUND,
    CommunityErrorCode.KEYNOTE_NOT_FOUND,
  )
  @Get(':communityId/keynotes/:memberId')
  async getMemberKeynote(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<KeynoteDto> {
    return this.communitiesService.getMemberKeynote(communityId, memberId);
  }

  @ApiOperation({
    summary: '커뮤니티에 대한 나의 기조 발언 작성/수정',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiOkResponse({ type: KeynoteDto })
  @ApiErrorResponses(CommunityErrorCode.NOT_FOUND)
  @ApiAuthRequired()
  @Put(':communityId/keynotes/me')
  async upsertMyKeynote(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
    @Body() request: KeynoteDto,
  ): Promise<KeynoteDto> {
    return this.communitiesService.upsertMyKeynote(
      communityId,
      memberId,
      request,
    );
  }

  @ApiOperation({
    summary: '커뮤니티를 나의 즐겨찾기에 추가',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiNoContentResponse({ description: '즐겨찾기 추가 성공' })
  @ApiErrorResponses(CommunityErrorCode.NOT_FOUND)
  @ApiAuthRequired()
  @Put(':communityId/favorites/me')
  @HttpCode(204)
  async addMyFavorite(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.communitiesService.addMyFavorite(communityId, memberId);
  }

  @ApiOperation({
    summary: '커뮤니티를 나의 즐겨찾기에서 삭제',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiNoContentResponse({ description: '즐겨찾기 삭제 성공' })
  @ApiErrorResponses(CommunityErrorCode.NOT_FOUND)
  @ApiAuthRequired()
  @Delete(':communityId/favorites/me')
  @HttpCode(204)
  async deleteMyFavorite(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.communitiesService.deleteMyFavorite(communityId, memberId);
  }
}
