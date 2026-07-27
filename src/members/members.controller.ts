import { Body, Controller, HttpCode, Patch, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { AuthTokenDto } from '../auth/dto/auth-token.dto';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { LoginMemberDto } from './dto/login-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MemberDto } from './dto/member.dto';
import { MemberErrorCode } from './exceptions/member-error-code';

@Controller('api/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @ApiOperation({
    summary: '회원가입',
    description: '이메일과 비밀번호로 회원을 생성하고 memberId를 반환한다.',
  })
  @ApiCreatedResponse({ description: '회원가입 성공', type: MemberDto })
  @ApiErrorResponses(MemberErrorCode.EMAIL_ALREADY_EXISTS)
  @Post('/signup')
  async signUp(@Body() request: CreateMemberDto): Promise<MemberDto> {
    return this.membersService.signUp(request);
  }

  @ApiOperation({
    summary: '로그인',
    description:
      '이메일과 비밀번호를 검증하고 액세스/리프레시 토큰을 발급한다. ' +
      '소셜 전용 계정(비밀번호 없음)은 이 경로로 로그인할 수 없다.',
  })
  @ApiOkResponse({ description: '로그인 성공', type: AuthTokenDto })
  @ApiErrorResponses(MemberErrorCode.INVALID_CREDENTIALS)
  @Post('/login')
  @HttpCode(200)
  async login(@Body() request: LoginMemberDto): Promise<AuthTokenDto> {
    return this.membersService.login(request);
  }

  // 로그아웃은 리프레시 토큰 폐기가 필요해 인증 도메인이 소유한다(POST /api/auth/logout).

  @ApiOperation({
    summary: '내 정보 수정',
    description:
      '액세스 토큰의 주인만 자신의 정보를 수정한다. 전달된 필드만 수정하며, ' +
      '비밀번호를 바꾸려면 newPassword와 함께 currentPassword를 보내야 한다. ' +
      'email 변경은 지원하지 않는다.',
  })
  @ApiOkResponse({ description: '수정 성공', type: MemberDto })
  @ApiErrorResponses(
    MemberErrorCode.NOT_FOUND,
    MemberErrorCode.INVALID_CURRENT_PASSWORD,
    MemberErrorCode.SOCIAL_ACCOUNT_NO_PASSWORD,
  )
  @Patch('/:memberId')
  async update(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() request: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.membersService.update(memberId, request);
  }
}
