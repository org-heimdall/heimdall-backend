import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { KeynoteDto } from './keynote.dto';

export class CreateCommunityDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  @IsUUID()
  themeId: string;

  @ApiProperty({ example: 'AI 규제, 필요한가?' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  topic: string;

  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  roundCount: number;

  @ApiProperty({ type: KeynoteDto })
  @ValidateNested()
  @Type(() => KeynoteDto)
  keynoteDto: KeynoteDto;
}
