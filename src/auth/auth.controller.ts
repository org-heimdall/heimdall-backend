import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import { OAuthProviderType } from '../members/members.enums';
import { AuthService } from './auth.service';
import { AuthTokenDto } from './dto/auth-token.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthErrorCode } from './exceptions/auth-error-code';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: '구글 로그인',
    description:
      '프론트가 구글에서 받은 ID token을 검증하고 서비스 토큰을 발급한다. ' +
      '연동 이력이 없고 같은 이메일의 회원도 없으면 회원이 자동으로 생성된다.',
  })
  @ApiOkResponse({ description: '로그인 성공', type: AuthTokenDto })
  @ApiErrorResponses(
    AuthErrorCode.OAUTH_VERIFICATION_FAILED,
    AuthErrorCode.EMAIL_ALREADY_EXISTS,
  )
  @Post('/google')
  @HttpCode(200)
  async loginWithGoogle(
    @Body() request: GoogleLoginDto,
  ): Promise<AuthTokenDto> {
    return this.authService.loginWithOAuth(
      OAuthProviderType.GOOGLE,
      request.idToken,
    );
  }

  @ApiOperation({
    summary: '토큰 재발급',
    description:
      '리프레시 토큰을 회전해 새 토큰 쌍을 발급한다. 직전 토큰은 즉시 무효가 되며, ' +
      '이미 사용한 토큰을 다시 보내면 탈취로 간주해 해당 회원의 모든 리프레시 토큰을 폐기한다.',
  })
  @ApiOkResponse({ description: '재발급 성공', type: AuthTokenDto })
  @ApiErrorResponses(
    AuthErrorCode.INVALID_REFRESH_TOKEN,
    MemberErrorCode.NOT_FOUND,
  )
  @Post('/refresh')
  @HttpCode(200)
  async refresh(@Body() request: RefreshTokenDto): Promise<AuthTokenDto> {
    return this.authService.refresh(request.refreshToken);
  }

  @ApiOperation({
    summary: '로그아웃',
    description:
      '**액세스 토큰(Authorization: Bearer)이 필요하다.** 헤더의 액세스 토큰으로 회원을 식별하고, ' +
      'body의 리프레시 토큰을 폐기한다. 액세스 토큰은 만료(30분)까지 유효하므로 ' +
      '클라이언트도 보관 중인 토큰을 함께 폐기해야 한다.',
  })
  @ApiNoContentResponse({ description: '로그아웃 성공' })
  @ApiAuthRequired()
  @Post('/logout')
  @HttpCode(204)
  async logout(
    @CurrentMember() memberId: string,
    @Body() request: RefreshTokenDto,
  ): Promise<void> {
    return this.authService.logout(memberId, request.refreshToken);
  }
}
