import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { CommunityDebateIntent } from '../../member-communities/entities/member-community.entity';

export class UpdateDebateIntentDto {
  @ApiProperty({
    enum: CommunityDebateIntent,
    example: CommunityDebateIntent.OPEN_TO_DEBATE,
    description: 'OPEN_TO_DEBATE여야 방장이 토론에 초대할 수 있다.',
  })
  @IsEnum(CommunityDebateIntent)
  debateIntent: CommunityDebateIntent;
}
