import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthSessionService } from './auth-session.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    // secret은 토큰 종류별로 다르므로 모듈에 고정하지 않고 TokenService가 호출마다 넘긴다.
    JwtModule.register({}),
  ],
  providers: [TokenService, RefreshTokenService, AuthSessionService],
  exports: [TokenService, RefreshTokenService, AuthSessionService],
})
export class TokenModule {}
