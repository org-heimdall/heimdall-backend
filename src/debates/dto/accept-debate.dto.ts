import { ApiProperty } from '@nestjs/swagger';

export class AcceptDebateResultDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  debateId: string;
}
