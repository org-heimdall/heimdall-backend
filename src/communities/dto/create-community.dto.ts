import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const COMMUNITY_TITLE_MAX_LENGTH = 200;
export const COMMUNITY_TOPIC_MAX_LENGTH = 5000;
export const COMMUNITY_CATEGORY_MAX_LENGTH = 30;
export const COMMUNITY_MIN_ROUNDS = 1;
export const COMMUNITY_MAX_ROUNDS = 9;
export const HOST_CLAIM_MAX_LENGTH = 2000;
export const HOST_REASONS_MAX_SIZE = 10;

export class CreateCommunityDto {
  @ApiProperty({
    example: 'AI 규제 토론방',
    maxLength: COMMUNITY_TITLE_MAX_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(COMMUNITY_TITLE_MAX_LENGTH)
  title: string;

  @ApiProperty({
    example: 'AI 규제, 필요한가?',
    maxLength: COMMUNITY_TOPIC_MAX_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(COMMUNITY_TOPIC_MAX_LENGTH)
  topic: string;

  @ApiProperty({
    example: '정치',
    maxLength: COMMUNITY_CATEGORY_MAX_LENGTH,
    description: 'GET /communities/themes가 돌려주는 테마 이름 중 하나',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(COMMUNITY_CATEGORY_MAX_LENGTH)
  category: string;

  @ApiProperty({
    example: 3,
    minimum: COMMUNITY_MIN_ROUNDS,
    maximum: COMMUNITY_MAX_ROUNDS,
    description: '반론·질의 라운드 수',
  })
  @IsInt()
  @Min(COMMUNITY_MIN_ROUNDS)
  @Max(COMMUNITY_MAX_ROUNDS)
  rounds: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  isPublic: boolean;

  @ApiProperty({
    example: '인공지능 규제는 강화되어야 한다.',
    maxLength: HOST_CLAIM_MAX_LENGTH,
    description:
      '방장의 기조 발언. 커뮤니티 의견(CommunityOpinion.claim)으로도 읽힌다.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(HOST_CLAIM_MAX_LENGTH)
  hostClaim: string;

  @ApiProperty({
    example: ['안전성 확보', '책임 소재 명확화'],
    type: [String],
    maxItems: HOST_REASONS_MAX_SIZE,
    description: '빈 배열 허용. 각 항목은 비어 있지 않아야 한다.',
  })
  @IsArray()
  @ArrayMaxSize(HOST_REASONS_MAX_SIZE)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(HOST_CLAIM_MAX_LENGTH, { each: true })
  hostReasons: string[];
}
