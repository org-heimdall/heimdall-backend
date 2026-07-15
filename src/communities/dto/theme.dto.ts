import { ApiProperty } from '@nestjs/swagger';
import { Theme as ThemeEntity } from '../entities/theme.entity';

export class Theme {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  themeId: string;

  @ApiProperty({ example: '정치' })
  name: string;

  static from(theme: ThemeEntity): Theme {
    return {
      themeId: theme.id,
      name: theme.name,
    };
  }
}
