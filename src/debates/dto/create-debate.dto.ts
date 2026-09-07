import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { NotEqualToProperty } from '../../common/validators/not-equal-to-property.validator';

// 계약 CreateDebateRequest. 형식 검증(UUID·길이·두 발언자가 다름)은 여기서 끝내고,
// 존재 여부·소속 같은 도메인 규칙은 서비스가 본다.
export class CreateDebateDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f61' })
  @IsUUID()
  communityId: string;

  @ApiProperty({ example: 'AI 규제, 필요한가?', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  topic: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f62' })
  @IsUUID()
  sideASpeakerId: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f63' })
  @IsUUID()
  @NotEqualToProperty('sideASpeakerId', {
    message: '양쪽 발언자는 서로 달라야 합니다.',
  })
  sideBSpeakerId: string;

  @ApiProperty({ example: 3, minimum: 1, description: '반론·질의 라운드 수' })
  @IsInt()
  @Min(1)
  rebuttalQuestionRounds: number;
}
