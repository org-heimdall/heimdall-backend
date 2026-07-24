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
  DefaultValuePipe,
} from '@nestjs/common';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CommunityDto, CommunitySliceDto } from './dto/community.dto';
import { ThemeDto } from './dto/theme.dto';
import { MemberPreviewDto } from '../members/dto/member.dto';
import { KeynoteDto } from './dto/keynote.dto';
import { CommunityMemberType, CommunitySort } from './communities.enums';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { CommunityErrorCode } from './exceptions/community-error-code';

export { CommunityMemberType, CommunitySort };

@Controller('api/communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @ApiOperation({
    summary: '테마 목록 전체 조회',
  })
  @ApiOkResponse({ type: [ThemeDto] })
  @Get('/themes')
  async findAllThemes(): Promise<ThemeDto[]> {
    return this.communitiesService.findAllThemes();
  }

  @ApiOperation({
    summary: '커뮤니티 목록 페이지 조회',
    description: 'hasNext 무한 스크롤 방식',
  })
  @ApiOkResponse({ type: CommunitySliceDto })
  @Get()
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'size', required: false, type: Number, example: 10 })
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
    @Query('page', new DefaultValuePipe(1), ParsePositiveIntPipe) page: number,
    @Query('size', new DefaultValuePipe(10), ParsePositiveIntPipe) size: number,
    @Query('sort') sort?: CommunitySort,
    @Query('themeId', new ParseUUIDPipe({ optional: true })) themeId?: string,
  ): Promise<CommunitySliceDto> {
    return this.communitiesService.findAll(page, size, sort, themeId);
  }

  @ApiOperation({
    summary: '커뮤니티 생성',
  })
  @ApiHeader({
    name: 'X-Member-Id',
    required: true,
    description: '현재 회원 id',
  })
  @ApiCreatedResponse({ type: CommunityDto })
  @Post()
  async create(
    @CurrentMember() memberId: string,
    @Body() request: CreateCommunityDto,
  ): Promise<CommunityDto> {
    return this.communitiesService.create(request, memberId);
  }

  @ApiOperation({
    summary: '커뮤니티 삭제',
  })
  @ApiHeader({
    name: 'X-Member-Id',
    required: true,
    description: '현재 회원 id',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiNoContentResponse({ description: '커뮤니티 삭제 성공' })
  @ApiErrorResponses(CommunityErrorCode.DELETE_FORBIDDEN)
  @Delete('/:communityId')
  @HttpCode(204)
  async delete(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.communitiesService.delete(communityId, memberId);
  }

  @ApiOperation({
    summary: '커뮤니티 참여자 목록 조회',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiOkResponse({ type: [MemberPreviewDto] })
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
  ): Promise<MemberPreviewDto[]> {
    return this.communitiesService.findCommunityMembers(
      communityId,
      memberType,
    );
  }

  @ApiOperation({
    summary: '커뮤니티 참여자의 기조 발언 조회',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: KeynoteDto })
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
  @ApiHeader({
    name: 'X-Member-Id',
    required: true,
    description: '현재 회원 id',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiOkResponse({ type: KeynoteDto })
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
  @ApiHeader({
    name: 'X-Member-Id',
    required: true,
    description: '현재 회원 id',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiNoContentResponse({ description: '즐겨찾기 추가 성공' })
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
  @ApiHeader({
    name: 'X-Member-Id',
    required: true,
    description: '현재 회원 id',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiNoContentResponse({ description: '즐겨찾기 삭제 성공' })
  @Delete(':communityId/favorites/me')
  @HttpCode(204)
  async deleteMyFavorite(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.communitiesService.deleteMyFavorite(communityId, memberId);
  }
}
