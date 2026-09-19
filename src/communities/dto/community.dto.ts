import { ApiProperty } from '@nestjs/swagger';
import { Community, CommunityState } from '../entities/community.entity';
import { Member } from '../../members/entities/member.entity';
import { MemberCommunity } from '../../member-communities/entities/member-community.entity';

// 커뮤니티 카드에 함께 싣는 참여자 미리보기 인원. 늘리려면 여기만 바꾸면 된다.
export const MAX_PARTICIPANT_PREVIEWS = 5;

export class CommunityHostDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: '헤임달' })
  displayName: string;

  @ApiProperty({
    example: 'https://cdn.example.com/profile/1.png',
    nullable: true,
  })
  profileImageUrl: string | null;
}

export class ParticipantPreviewDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: '헤임달' })
  displayName: string;

  @ApiProperty({
    example: 'https://cdn.example.com/profile/1.png',
    nullable: true,
  })
  profileImageUrl: string | null;

  static from(member: Member): ParticipantPreviewDto {
    return {
      id: member.id,
      displayName: member.nickname,
      profileImageUrl: member.profileImageUrl,
    };
  }
}

/**
 * CommunityDto를 만드는 데 필요한, 커뮤니티 밖에서 모아 와야 하는 값들.
 * 조회 책임은 서비스가 지고 DTO는 이름만 계약에 맞춰 옮긴다.
 */
export interface CommunityAssembly {
  community: Community;
  // 테마 이름을 계약의 category로 노출한다. 테마가 사라진 커뮤니티는 빈 문자열이 된다.
  category: string;
  host: Member | null;
  // 방장의 기조 발언 행(member_community). hostClaim/hostReasons의 출처다.
  hostKeynote: MemberCommunity | null;
  // 참여 순으로 자른 미리보기 대상 회원들
  participants: Member[];
  currentMemberId: string;
  isJoined: boolean;
}

export class CommunityDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: 'AI 규제 토론방' })
  title: string;

  @ApiProperty({ example: 'AI 규제, 필요한가?' })
  topic: string;

  @ApiProperty({ example: 'POLITICS' })
  category: string;

  @ApiProperty({ enum: CommunityState, example: CommunityState.WAITING })
  status: CommunityState;

  @ApiProperty({ example: 3, description: '반론·질의 라운드 수' })
  rounds: number;

  @ApiProperty({ example: true })
  isPublic: boolean;

  @ApiProperty({ example: '인공지능 규제는 강화되어야 한다.' })
  hostClaim: string;

  @ApiProperty({ example: ['안전성 확보'], type: [String] })
  hostReasons: string[];

  @ApiProperty({ type: CommunityHostDto })
  host: CommunityHostDto;

  @ApiProperty({ type: [ParticipantPreviewDto] })
  participantPreviews: ParticipantPreviewDto[];

  @ApiProperty({ example: 1 })
  memberCount: number;

  @ApiProperty({ example: '2026-09-07T11:59:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: false, description: '요청한 회원이 방장인지' })
  isOwnedByCurrentUser: boolean;

  @ApiProperty({ example: false, description: '요청한 회원이 참여 중인지' })
  isJoined: boolean;

  static from(assembly: CommunityAssembly): CommunityDto {
    const { community, host, hostKeynote } = assembly;

    return {
      id: community.id,
      title: community.title,
      topic: community.topic,
      category: assembly.category,
      status: community.state,
      rounds: community.debateRoundCount,
      isPublic: community.isPublic,
      hostClaim: hostKeynote?.opinion ?? '',
      hostReasons: hostKeynote?.reasons ?? [],
      host: {
        id: community.hostId,
        // 방장이 탈퇴하면 회원 조회에서 빠진다. 커뮤니티 자체는 계속 보여야 하므로 이름만 비운다.
        displayName: host?.nickname ?? '',
        profileImageUrl: host?.profileImageUrl ?? null,
      },
      participantPreviews: assembly.participants.map((participant) =>
        ParticipantPreviewDto.from(participant),
      ),
      memberCount: community.memberCount,
      createdAt: community.createdAt.toISOString(),
      isOwnedByCurrentUser: community.hostId === assembly.currentMemberId,
      isJoined: assembly.isJoined,
    };
  }
}
