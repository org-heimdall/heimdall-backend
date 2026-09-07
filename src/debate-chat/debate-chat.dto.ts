import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
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

/**
 * HTTP snapshot API의 body 공통 부분. 계약상 body는 WS와 같은 봉투(`payload` 안에 발언 필드)이거나
 * flat command(최상위에 발언 필드)일 수 있어 둘 다 받는다. 봉투 필드는 HTTP에서는 선택이다.
 * 발언 필드는 봉투가 없을 때(flat)만 검증하며, 어느 쪽으로 왔든 toPayload()가 하나의 payload로 돌려준다.
 */
abstract class DebateChatHttpCommandDto {
  @ApiPropertyOptional({ example: '9a5f9f5e-1f5a-4f1e-9a1d-6f2a3b4c5d6e' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @ApiPropertyOptional({ example: 'debate.turn.message.send' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: '토론 단위 중복 전송 방지 키' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  clientMessageId?: string;

  @ApiPropertyOptional({ example: '2026-09-06T12:00:00.000Z' })
  @IsOptional()
  @IsString()
  sentAt?: string;

  @ApiPropertyOptional({ description: 'flat command로 보낼 때의 발언자' })
  @ValidateIf(isFlatCommand)
  @IsUUID()
  speakerId?: string;

  @ApiPropertyOptional({ enum: DebateSide })
  @ValidateIf(isFlatCommand)
  @IsEnum(DebateSide)
  speakerSide?: DebateSide;

  @ApiPropertyOptional({ enum: DebatePhase })
  @ValidateIf(isFlatCommand)
  @IsEnum(DebatePhase)
  phase?: DebatePhase;

  @ApiPropertyOptional({ example: 1 })
  @ValidateIf(isFlatCommand)
  @IsInt()
  @Min(1)
  round?: number;

  // flat 필드는 위 검증을 통과했을 때만 읽으므로 값이 채워져 있다.
  protected toTurnCommand(): DebateTurnFinalizeDto {
    return {
      speakerId: this.speakerId!,
      speakerSide: this.speakerSide!,
      phase: this.phase!,
      round: this.round!,
    };
  }
}

// 봉투(payload)가 없으면 flat command이므로 최상위 발언 필드를 검증한다.
function isFlatCommand(object: { payload?: unknown }): boolean {
  return object.payload === undefined;
}

export class DebateTurnFinalizeRequestDto extends DebateChatHttpCommandDto {
  @ApiPropertyOptional({
    type: DebateTurnFinalizeDto,
    description:
      '봉투 형태로 보낼 때의 발언 정보. 없으면 최상위 필드에서 읽는다.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DebateTurnFinalizeDto)
  payload?: DebateTurnFinalizeDto;

  toPayload(): DebateTurnFinalizeDto {
    return this.payload ?? this.toTurnCommand();
  }
}

export class DebateTurnMessageSendRequestDto extends DebateChatHttpCommandDto {
  @ApiPropertyOptional({ example: '저는 이 주제에 찬성합니다.' })
  @ValidateIf(isFlatCommand)
  @IsString()
  @IsNotEmpty()
  content?: string;

  @ApiPropertyOptional({
    type: DebateTurnMessageSendDto,
    description:
      '봉투 형태로 보낼 때의 발언 정보. 없으면 최상위 필드에서 읽는다.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DebateTurnMessageSendDto)
  payload?: DebateTurnMessageSendDto;

  toPayload(): DebateTurnMessageSendDto {
    return this.payload ?? { ...this.toTurnCommand(), content: this.content! };
  }
}
