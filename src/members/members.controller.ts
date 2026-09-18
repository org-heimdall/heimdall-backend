import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiParam,
} from '@nestjs/swagger';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ErrorCode } from '../common/exceptions/error-code';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { MembersService } from './members.service';
import { CreateMemberProfileDto } from './dto/create-member-profile.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MemberDto } from './dto/member.dto';
import { MemberErrorCode } from './exceptions/member-error-code';

// 회원가입·로그인은 토큰 발급이 따라오므로 인증 도메인이 소유한다(POST /auth/signup, /auth/login).
// 로그아웃도 리프레시 토큰 폐기가 필요해 같은 곳에 있다(POST /auth/logout).
@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @ApiOperation({
    summary: '회원 생성 (프로필만)',
    description:
      '이메일·비밀번호 없이 표시 이름과 프로필 사진만으로 회원을 만든다. ' +
      '자격증명이 없어 이 계정으로는 로그인할 수 없다. 로그인까지 필요하면 POST /auth/signup을 쓴다.',
  })
  @ApiCreatedResponse({ description: '회원 생성 성공', type: MemberDto })
  @Post()
  async create(@Body() request: CreateMemberProfileDto): Promise<MemberDto> {
    return this.membersService.create(request);
  }

  @ApiOperation({
    summary: '회원 목록 조회',
    description: '탈퇴하지 않은 회원을 모두 돌려준다.',
  })
  @ApiOkResponse({ type: [MemberDto] })
  @Get()
  async findAll(): Promise<MemberDto[]> {
    return this.membersService.findAll();
  }

  @ApiOperation({ summary: '회원 단건 조회' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: MemberDto })
  @ApiErrorResponses(MemberErrorCode.NOT_FOUND)
  @Get('/:memberId')
  async findOne(
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<MemberDto> {
    return this.membersService.findOne(memberId);
  }

  @ApiOperation({
    summary: '회원 정보 수정',
    description:
      '액세스 토큰의 주인만 자신의 정보를 수정한다(경로의 memberId가 토큰의 회원과 다르면 403). ' +
      '전달된 필드만 수정하며, 비밀번호를 바꾸려면 newPassword와 함께 currentPassword를 보내야 한다. ' +
      'email 변경은 지원하지 않는다.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ description: '수정 성공', type: MemberDto })
  @ApiErrorResponses(
    ErrorCode.FORBIDDEN,
    MemberErrorCode.NOT_FOUND,
    MemberErrorCode.INVALID_CURRENT_PASSWORD,
    MemberErrorCode.SOCIAL_ACCOUNT_NO_PASSWORD,
  )
  @ApiAuthRequired()
  @Patch('/:memberId')
  async update(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentMember() currentMemberId: string,
    @Body() request: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.membersService.update(currentMemberId, memberId, request);
  }

  @ApiOperation({
    summary: '회원 탈퇴',
    description:
      '액세스 토큰의 주인만 자신을 탈퇴시킬 수 있다. 회원 행은 남기고 상태만 바꾸므로 ' +
      '이미 참여한 커뮤니티·토론 기록은 그대로 유지된다.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiNoContentResponse({ description: '탈퇴 성공' })
  @ApiErrorResponses(ErrorCode.FORBIDDEN, MemberErrorCode.NOT_FOUND)
  @ApiAuthRequired()
  @Delete('/:memberId')
  @HttpCode(204)
  async remove(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentMember() currentMemberId: string,
  ): Promise<void> {
    return this.membersService.remove(currentMemberId, memberId);
  }
}
