import { PartialType } from '@nestjs/swagger';
import { CreateMemberCommunityDto } from './create-member-community.dto';

export class UpdateMemberCommunityDto extends PartialType(
  CreateMemberCommunityDto,
) {}
