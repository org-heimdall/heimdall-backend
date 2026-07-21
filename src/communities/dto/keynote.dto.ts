import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class KeynoteDto {
  @ApiProperty({ example: '인공지능 규제는 강화되어야 한다.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  opinion: string;

  @ApiProperty({
    example: ['안전성 확보', '책임 소재 명확화'],
    type: [String],
    description: '빈 배열 허용',
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  reasons: string[];
}
