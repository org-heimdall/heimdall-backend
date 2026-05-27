import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { MemberCommunitiesService } from './member-communities.service';
import { CreateMemberCommunityDto } from './dto/create-member-community.dto';
import { UpdateMemberCommunityDto } from './dto/update-member-community.dto';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MemberProfileDto } from 'src/members/dto/member.dto';

export enum CommunityMemberType {
  KEYNOTE_MEMBER = 'KEYNOTE_MEMBER',
  NORMAL_MEMBER = 'NORMAL_MEMBER',
}

@Controller('member-communities')
export class MemberCommunitiesController {
  constructor(private readonly memberCommunitiesService: MemberCommunitiesService) {}

  @ApiOperation({
    summary: '커뮤니티 참여자 목록 조회',
  })
  @Get(':communityId')
  @ApiQuery({
    name: 'memberType',
    required: false,
    enum: CommunityMemberType,
    enumName: 'CommunityMemberType',
    description: '필터 기준',
    example: CommunityMemberType.KEYNOTE_MEMBER,
  })
  async getMembersByCommunityId(
    @Param('communityId') communityId: number,
    @Query('memberType') memberType?: CommunityMemberType,
  ): Promise<MemberProfileDto[]> {
    return {} as any;
  }

  // @Post()
  // create(@Body() createMemberCommunityDto: CreateMemberCommunityDto) {
  //   return this.memberCommunitiesService.create(createMemberCommunityDto);
  // }
  //
  // @Get()
  // findAll() {
  //   return this.memberCommunitiesService.findAll();
  // }
  //
  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.memberCommunitiesService.findOne(+id);
  // }
  //
  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateMemberCommunityDto: UpdateMemberCommunityDto) {
  //   return this.memberCommunitiesService.update(+id, updateMemberCommunityDto);
  // }
  //
  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.memberCommunitiesService.remove(+id);
  // }
}
