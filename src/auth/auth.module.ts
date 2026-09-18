import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { MembersModule } from '../members/members.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { GoogleOAuthProvider } from './oauth/google-oauth.provider';
import { OAUTH_PROVIDERS } from './oauth/oauth-provider.interface';
import { OAuthProviderRegistry } from './oauth/oauth-provider.registry';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenModule } from './token.module';

@Module({
  imports: [PassportModule, TokenModule, MembersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleOAuthProvider,
    OAuthProviderRegistry,
    // 공급자를 추가하려면 구현체를 providers와 이 배열에만 등록하면 된다.
    {
      provide: OAUTH_PROVIDERS,
      useFactory: (google: GoogleOAuthProvider) => [google],
      inject: [GoogleOAuthProvider],
    },
    // 전역 등록: 라우트마다 @UseGuards를 붙이지 않아도 토큰이 있으면 request.user가 채워진다.
    { provide: APP_GUARD, useClass: OptionalJwtAuthGuard },
  ],
})
export class AuthModule {}
