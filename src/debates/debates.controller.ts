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
  ApiParam,
} from '@nestjs/swagger';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { CommunityErrorCode } from '../communities/exceptions/community-error-code';
import { DebatesService } from './debates.service';
import { AcceptDebateResultDto } from './dto/accept-debate.dto';
import {
  CreateDebateDto,
  CreateDebateResultDto,
} from './dto/create-debate.dto';
import { DebateErrorCode } from './exceptions/debate-error-code';

@Controller('api/debates')
export class DebatesController {
  constructor(private readonly debatesService: DebatesService) {}

  @ApiOperation({
    summary: '토론하기 요청',
    description:
      '커뮤니티 호스트만 사용 가능. 상대가 accept()로 수락해야 토론이 시작된다.',
  })
  @ApiCreatedResponse({ type: CreateDebateResultDto })
  @ApiErrorResponses(
    CommunityErrorCode.NOT_FOUND,
    DebateErrorCode.NOT_HOST,
    DebateErrorCode.OPPONENT_NOT_IN_COMMUNITY,
    DebateErrorCode.OPPONENT_KEYNOTE_REQUIRED,
    DebateErrorCode.REQUEST_ALREADY_PENDING,
    DebateErrorCode.DEBATE_ALREADY_ACTIVE,
  )
  @ApiAuthRequired()
  @Post()
  async create(
    @CurrentMember() hostId: string,
    @Body() request: CreateDebateDto,
  ): Promise<CreateDebateResultDto> {
    return this.debatesService.create(request, hostId);
  }

  @ApiOperation({
    summary: '토론 요청 수락',
    description: '토론 요청을 받은 상대(opponent)만 사용 가능',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiOkResponse({ type: AcceptDebateResultDto })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    DebateErrorCode.NOT_REQUEST_OPPONENT,
    DebateErrorCode.REQUEST_NOT_PENDING,
  )
  @ApiAuthRequired()
  @Patch(':debateId/accept')
  async accept(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
  ): Promise<AcceptDebateResultDto> {
    return this.debatesService.accept(debateId, memberId);
  }

  @ApiOperation({
    summary: '토론 요청 거절',
    description: '토론 요청을 받은 상대(opponent)만 사용 가능',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiNoContentResponse({ description: '토론 요청 거절 성공' })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    DebateErrorCode.NOT_REQUEST_OPPONENT,
    DebateErrorCode.REQUEST_NOT_PENDING,
  )
  @ApiAuthRequired()
  @Patch(':debateId/reject')
  @HttpCode(204)
  async reject(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.debatesService.reject(debateId, memberId);
  }
}
