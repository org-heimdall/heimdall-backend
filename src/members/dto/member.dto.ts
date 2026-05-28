import { CommunityMemberType } from '../../communities/communities.controller';
import { KeynoteDto } from '../../communities/dto/keynote.dto';

export class MemberPreviewDto {
  memberId: string;
  profileImageUrl: string;
  nickName: string;
  rating: number;
  memberType: CommunityMemberType;
}

export class MemberProfileDto {
  memberPreviewDto: MemberPreviewDto;
  keynoteDto: KeynoteDto;
}
