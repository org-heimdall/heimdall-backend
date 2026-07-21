import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
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
    description: '이메일과 비밀번호를 검증하고 memberId를 반환한다.',
  })
  @ApiOkResponse({ description: '로그인 성공', type: MemberDto })
  @ApiErrorResponses(MemberErrorCode.INVALID_CREDENTIALS)
  @Post('/login')
  @HttpCode(200)
  async login(@Body() request: LoginMemberDto): Promise<MemberDto> {
    return this.membersService.login(request);
  }

  @ApiOperation({
    summary: '로그아웃',
    description:
      '현재는 서버에 세션/토큰이 없어 무효화할 상태가 없다. ' +
      '클라이언트가 보관 중인 memberId를 폐기하면 로그아웃이 완료된다. ' +
      'JWT 또는 세션 도입 시 이 자리에 무효화 로직을 채운다.',
  })
  @ApiNoContentResponse({ description: '로그아웃 성공' })
  @Post('/logout')
  @HttpCode(204)
  logout(): void {
    return;
  }

  @ApiOperation({
    summary: '회원 정보 수정',
    description:
      '전달된 필드만 수정한다. 비밀번호를 바꾸려면 newPassword와 함께 ' +
      'currentPassword를 보내야 한다. email 변경은 지원하지 않는다.',
  })
  @ApiOkResponse({ description: '수정 성공', type: MemberDto })
  @ApiErrorResponses(
    MemberErrorCode.NOT_FOUND,
    MemberErrorCode.INVALID_CURRENT_PASSWORD,
  )
  @Patch('/:memberId')
  async update(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() request: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.membersService.update(memberId, request);
  }
}
