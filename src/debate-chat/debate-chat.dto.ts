import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { DebatePhase, DebateSide } from './debate-chat.types';

// debate.turn.finalize 의 payload.
export class DebateTurnFinalizeDto {
  @IsUUID()
  speakerId: string;

  @IsEnum(DebateSide)
  speakerSide: DebateSide;

  @IsEnum(DebatePhase)
  phase: DebatePhase;

  @IsInt()
  @Min(1)
  round: number;
}

// debate.turn.send / debate.turn.message.send 의 payload.
// 최대 길이는 환경변수(DEBATE_TURN_MAX_CONTENT_LENGTH)라 데코레이터 대신 도메인에서 검사한다.
export class DebateTurnMessageSendDto extends DebateTurnFinalizeDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}

// 명령 봉투 공통 필드. 어댑터가 봉투 전체를 핸들러에 넘기므로 봉투째 검증한다.
export class DebateChatCommandDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  clientMessageId?: string;

  @IsOptional()
  @IsString()
  sentAt?: string;
}

export class DebateTurnMessageSendCommandDto extends DebateChatCommandDto {
  @ValidateNested()
  @Type(() => DebateTurnMessageSendDto)
  payload: DebateTurnMessageSendDto;
}

export class DebateTurnFinalizeCommandDto extends DebateChatCommandDto {
  @ValidateNested()
  @Type(() => DebateTurnFinalizeDto)
  payload: DebateTurnFinalizeDto;
}
