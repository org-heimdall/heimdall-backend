import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// join_room / next_turn 공용: roomId는 debateId 그대로다.
export class JoinDebateRoomDto {
  @IsUUID()
  roomId: string;
}

export class NextTurnDto {
  @IsUUID()
  roomId: string;
}

export class SendDebateMessageDto {
  @IsUUID()
  roomId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  msg: string;
}
