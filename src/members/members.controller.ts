import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { LoginMemberDto } from './dto/login-member.dto';
import { MemberDto } from './dto/member.dto';

@Controller('api/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @ApiOperation({
    summary: '회원가입',
    description: '이메일과 비밀번호로 회원을 생성하고 memberId를 반환한다.',
  })
  @ApiCreatedResponse({ description: '회원가입 성공', type: MemberDto })
  @ApiConflictResponse({ description: '이미 가입된 이메일' })
  @Post('/signup')
  async signUp(@Body() request: CreateMemberDto): Promise<MemberDto> {
    return this.membersService.signUp(request);
  }

  @ApiOperation({
    summary: '로그인',
    description: '이메일과 비밀번호를 검증하고 memberId를 반환한다.',
  })
  @ApiOkResponse({ description: '로그인 성공', type: MemberDto })
  @ApiUnauthorizedResponse({ description: '이메일 또는 비밀번호 불일치' })
  @Post('/login')
  @HttpCode(200)
  async login(@Body() request: LoginMemberDto): Promise<MemberDto> {
    return this.membersService.login(request);
  }
}
