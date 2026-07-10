import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMemberDto {
  @ApiProperty({ example: 'heimdall@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password1234', minLength: 8, maxLength: 64 })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password: string;

  @ApiProperty({ example: '헤임달' })
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  nickname: string;

  @ApiPropertyOptional({ example: 'MALE' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @ApiPropertyOptional({ example: 28 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/profile/1.png' })
  @IsOptional()
  @IsUrl()
  profileImageUrl?: string;
}
