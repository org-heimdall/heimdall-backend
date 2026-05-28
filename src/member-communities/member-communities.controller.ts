import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MemberCommunitiesService } from './member-communities.service';

@ApiTags('CommunityMembers')
@Controller('api/community-members')
export class MemberCommunitiesController {
  constructor(private readonly memberCommunitiesService: MemberCommunitiesService) {}


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
