import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// 계약 POST /communities/:communityId/debates/start의 본문.
// 방장 자신인지·상대가 참여자인지 같은 도메인 규칙은 서비스가 본다.
export class StartDebateDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f63' })
  @IsUUID()
  opponentMemberId: string;
}
