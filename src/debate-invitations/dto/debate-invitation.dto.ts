import { ApiProperty } from '@nestjs/swagger';
import { Member } from '../../members/entities/member.entity';
import { DebateInvitation } from '../entities/debate-invitation.entity';

// 계약의 DebateInvitation. 초대받은 화면이 "누가 불렀는지"를 바로 그릴 수 있도록 방장 이름을 함께 싣는다.
export class DebateInvitationDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61' })
  communityId: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62' })
  hostMemberId: string;

  @ApiProperty({ example: '메시' })
  hostName: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f63' })
  opponentMemberId: string;

  @ApiProperty({
    example: '2026-09-07T12:00:05.000Z',
    description:
      '응답 마감 시각. 프론트의 카운트다운이 아니라 이 값이 만료 기준이다.',
  })
  expiresAt: string;

  static from(invitation: DebateInvitation, host: Member): DebateInvitationDto {
    return Object.assign(new DebateInvitationDto(), {
      id: invitation.id,
      communityId: invitation.communityId,
      hostMemberId: invitation.hostMemberId,
      hostName: host.nickname,
      opponentMemberId: invitation.opponentMemberId,
      expiresAt: invitation.expiresAt.toISOString(),
    });
  }
}
