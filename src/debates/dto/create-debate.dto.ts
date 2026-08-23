import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateDebateDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  @IsUUID()
  communityId: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61' })
  @IsUUID()
  opponentId: string;
}

export class CreateDebateResultDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62' })
  debateId: string;

  @ApiProperty()
  createdAt: Date;
}
