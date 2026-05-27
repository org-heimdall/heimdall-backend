import { PageInfo } from '../../common/dto/pageInfo.dto';

export class CommunityDto {
  communityId: string;
  state: string;
  topic: string;
  memberCount: number;
  hostProfileImageUrl: string;
  opponentProfileImageUrl: string;
  debateTotalMinutes: number;
}

export class CommunitySliceDto {
  totalCommunityCount: number;
  communityPreviews: CommunityDto[];
  pageInfo: PageInfo;
}
