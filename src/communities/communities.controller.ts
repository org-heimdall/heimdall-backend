import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { CommunityDto, CommunitySliceDto } from './dto/community.dto';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Theme } from './dto/theme.dto';

export enum CommunitySort {
  MEMBER_ASC = 'MEMBER_ASC',
  MEMBER_DESC = 'MEMBER_DESC',
  CREATED_AT_ASC = 'CREATED_AT_ASC',
  CREATED_AT_DESC = 'CREATED_AT_DESC',
}

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
  async create(
    @Body() request: CreateCommunityDto,
  ): Promise<CommunityDto> {
    return {} as any;
  }

  // @Post()
  // create(@Body() createCommunityDto: CreateCommunityDto) {
  //   return this.communitiesService.create(createCommunityDto);
  // }
  //
  // @Get()
  // findAll() {
  //   return this.communitiesService.findAll();
  // }
  //
  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.communitiesService.findOne(+id);
  // }
  //
  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateCommunityDto: UpdateCommunityDto) {
  //   return this.communitiesService.update(+id, updateCommunityDto);
  // }
  //
  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.communitiesService.remove(+id);
  // }
}
