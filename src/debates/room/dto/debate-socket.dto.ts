import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class JoinDebateRoomDto {
  @IsUUID()
  debateId: string;
}

export class NextTurnDto {
  @IsUUID()
  debateId: string;
}

export class SendDebateMessageDto {
  @IsUUID()
  debateId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  msg: string;
}
