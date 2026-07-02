import { Injectable } from '@nestjs/common';
import { CreateMemberCommunityDto } from './dto/create-member-community.dto';
import { UpdateMemberCommunityDto } from './dto/update-member-community.dto';

@Injectable()
export class MemberCommunitiesService {
  create(createMemberCommunityDto: CreateMemberCommunityDto) {
    return 'This action adds a new memberCommunity';
  }

  findAll() {
    return `This action returns all memberCommunities`;
  }

  findOne(id: number) {
    return `This action returns a #${id} memberCommunity`;
  }

  update(id: number, updateMemberCommunityDto: UpdateMemberCommunityDto) {
    return `This action updates a #${id} memberCommunity`;
  }

  remove(id: number) {
    return `This action removes a #${id} memberCommunity`;
  }
}
