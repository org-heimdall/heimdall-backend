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
} from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CommunityDto, CommunitySliceDto } from './dto/community.dto';
import { ApiNoContentResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Theme } from './dto/theme.dto';
import { MemberPreviewDto } from '../members/dto/member.dto';
import { KeynoteDto } from './dto/keynote.dto';

export { CommunityMemberType, CommunitySort };

@Controller('api/communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @ApiOperation({
    summary: '테마 목록 전체 조회',
  })
  @Get('/themes')
  async findAllThemes(): Promise<Theme[]> {
    return {} as any;
  }

  @ApiOperation({
    summary: '커뮤니티 목록 페이지 조회',
    description: 'hasNext 무한 스크롤 방식',
  })
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
  async findAll(
    @Query('page') page: number = 1, // 기본값 설정 가능
    @Query('size') size: number = 10,
    @Query('sort') sort?: CommunitySort,
    @Query('themeId') themeId?: string,
  ): Promise<CommunitySliceDto> {
    return {} as any;
  }

  @ApiOperation({
    summary: '커뮤니티 생성',
  })
  @Post()
  async create(@Body() request: CreateCommunityDto): Promise<CommunityDto> {
    return {} as any;
  }

  @ApiOperation({
    summary: '커뮤니티 삭제',
  })
  @ApiNoContentResponse({ description: '커뮤니티 삭제 성공' })
  @Delete('/:communityId')
  @HttpCode(204)
  async delete(@Param('communityId') communityId: string): Promise<void> {
    return;
  }

  @ApiOperation({
    summary: '커뮤니티 참여자 목록 조회',
  })
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
    @Param('communityId') communityId: string,
    @Query('memberType') memberType?: CommunityMemberType,
  ): Promise<MemberPreviewDto[]> {
    return {} as any;
  }

  @ApiOperation({
    summary: '커뮤니티 참여자의 기조 발언 조회',
  })
  @Get(':communityId/keynotes/:memberId')
  async getMemberKeynote(
    @Param('communityId') communityId: string,
    @Param('memberId') memberId: string,
  ): Promise<KeynoteDto> {
    return {} as any;
  }

  @ApiOperation({
    summary: '커뮤니티에 대한 나의 기조 발언 작성/수정',
  })
  @Put(':communityId/keynotes/me')
  async upsertMyKeynote(
    @Param('communityId') communityId: string,
    @Body() request: KeynoteDto,
  ): Promise<KeynoteDto> {
    return {} as any;
  }

  @ApiOperation({
    summary: '커뮤니티를 나의 즐겨찾기에 추가',
  })
  @ApiNoContentResponse({ description: '즐겨찾기 추가 성공' })
  @Put(':communityId/favorites/me')
  async addMyFavorite(
    @Param('communityId') communityId: string,
  ): Promise<void> {
    return {} as any;
  }

  @ApiOperation({
    summary: '커뮤니티를 나의 즐겨찾기에서 삭제',
  })
  @ApiNoContentResponse({ description: '즐겨찾기 삭제 성공' })
  @Delete(':communityId/favorites/me')
  @HttpCode(204)
  async deleteMyFavorite(
    @Param('communityId') communityId: string,
  ): Promise<void> {
    return;
  }
}
