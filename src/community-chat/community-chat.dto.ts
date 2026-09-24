import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { WsCommandDto } from '../common/ws/ws-command.dto';
import { SYSTEM_CLIENT_MESSAGE_ID_PATTERN } from '../communities/entities/community-message.entity';

// 계약의 길이 제한. REST(POST /messages, PUT /opinions/me)와 WS가 같은 값을 쓴다.
export const MESSAGE_TEXT_MAX_LENGTH = 2000;
export const OPINION_CLAIM_MAX_LENGTH = 2000;
export const OPINION_REASON_MAX_LENGTH = 2000;
export const OPINION_REASONS_MAX_SIZE = 10;

// 사용자 메시지의 clientMessageId는 시스템 메시지 키 형식으로 시작할 수 없다(부정 전방탐색).
const USER_CLIENT_MESSAGE_ID_PATTERN = new RegExp(
  `^(?!${SYSTEM_CLIENT_MESSAGE_ID_PATTERN.source.slice(1)})`,
);
const RESERVED_CLIENT_MESSAGE_ID_MESSAGE =
  'clientMessageId는 시스템 메시지용 형식(debate_*:)으로 시작할 수 없습니다.';

// 메시지 목록 조회의 기본/최대 개수. 기본값은 계약(50)이고, 최대는 한 번에 읽는 양을 서버가 막는 선이다.
export const MESSAGE_PAGE_DEFAULT_LIMIT = 50;
export const MESSAGE_PAGE_MAX_LIMIT = 100;

// GET /communities/:communityId/messages 의 query.
export class CommunityMessagesQueryDto {
  @ApiPropertyOptional({
    default: MESSAGE_PAGE_DEFAULT_LIMIT,
    minimum: 1,
    maximum: MESSAGE_PAGE_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MESSAGE_PAGE_MAX_LIMIT)
  limit: number = MESSAGE_PAGE_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    example: '2026-09-18T12:00:00.000Z',
    description: '이 시각 이전 메시지만 읽는다(과거 페이지네이션).',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}

// message.send 의 payload(= REST POST /messages 의 body).
export class CommunityMessageSendDto {
  @ApiProperty({
    example: 'c1f0a2b3-4d5e-6f70-8192-a3b4c5d6e7f8',
    description:
      '재전송 중복 방지 키. 같은 키로 다시 보내면 저장되지 않는다. 시스템 메시지용 형식(debate_*:)은 쓸 수 없다.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(USER_CLIENT_MESSAGE_ID_PATTERN, {
    message: RESERVED_CLIENT_MESSAGE_ID_MESSAGE,
  })
  clientMessageId: string;

  @ApiProperty({ example: '저는 이 주제에 찬성합니다.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_TEXT_MAX_LENGTH)
  text: string;
}

// opinion.submit 의 payload(= REST PUT /opinions/me 의 body).
export class CommunityOpinionSubmitDto {
  @ApiProperty({ example: '인공지능 규제는 강화되어야 한다.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(OPINION_CLAIM_MAX_LENGTH)
  claim: string;

  @ApiProperty({
    example: ['안전성 확보', '책임 소재 명확화'],
    type: [String],
    description: '빈 배열 허용',
  })
  @IsArray()
  @ArrayMaxSize(OPINION_REASONS_MAX_SIZE)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(OPINION_REASON_MAX_LENGTH, { each: true })
  reasons: string[];
}

// WS 명령 봉투의 payload는 text만 담고, clientMessageId는 봉투 최상위에 온다(계약).
export class CommunityMessageTextDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_TEXT_MAX_LENGTH)
  text: string;
}

/**
 * { id, type, clientMessageId, payload: { text } }.
 * clientMessageId는 토론 채팅과 달리 필수라 봉투 base가 아니라 여기서 선언한다
 * (class-validator 메타데이터는 상속되므로 부모의 @IsOptional()을 자식이 되돌릴 수 없다).
 */
export class CommunityMessageSendCommandDto extends WsCommandDto {
  @IsString()
  @IsNotEmpty()
  @Matches(USER_CLIENT_MESSAGE_ID_PATTERN, {
    message: RESERVED_CLIENT_MESSAGE_ID_MESSAGE,
  })
  clientMessageId: string;

  @ValidateNested()
  @Type(() => CommunityMessageTextDto)
  payload: CommunityMessageTextDto;
}

// { id, type, payload: { claim, reasons } }.
export class CommunityOpinionSubmitCommandDto extends WsCommandDto {
  @ValidateNested()
  @Type(() => CommunityOpinionSubmitDto)
  payload: CommunityOpinionSubmitDto;
}
