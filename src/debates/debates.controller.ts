import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { CommunityErrorCode } from '../communities/exceptions/community-error-code';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import { DebatesService } from './debates.service';
import { CreateDebateDto } from './dto/create-debate.dto';
import { DebateTurnWithVotesDto } from './dto/debate-turn.dto';
import { DebateDetailDto, DebateDto } from './dto/debate.dto';
import { DebateStatus } from './entities/debate-status.enum';
import { DebateErrorCode } from './exceptions/debate-error-code';

@Controller('api/debates')
export class DebatesController {
  constructor(private readonly debatesService: DebatesService) {}

  @ApiOperation({
    summary: '토론 목록 조회',
    description:
      '삭제되지 않은 토론을 최근 생성 순으로 돌려준다. status로만 좁힐 수 있다.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: DebateStatus,
    enumName: 'DebateStatus',
  })
  @ApiOkResponse({ type: [DebateDto] })
  @Get()
  async findAll(
    @Query('status', new ParseEnumPipe(DebateStatus, { optional: true }))
    status?: DebateStatus,
  ): Promise<DebateDto[]> {
    return this.debatesService.findAll(status);
  }

  @ApiOperation({
    summary: '토론 생성',
    description:
      '주제와 반론·질의 라운드 수를 토론이 직접 갖는다(이후 커뮤니티 설정이 바뀌어도 흔들리지 않는다). ' +
      '커뮤니티 참여자만 만들 수 있고, 양쪽 발언자도 그 커뮤니티의 참여자여야 한다.',
  })
  @ApiCreatedResponse({ type: DebateDto })
  @ApiErrorResponses(
    CommunityErrorCode.NOT_FOUND,
    MemberErrorCode.NOT_FOUND,
    DebateErrorCode.CREATE_FORBIDDEN,
    DebateErrorCode.SPEAKER_NOT_IN_COMMUNITY,
  )
  @ApiAuthRequired()
  @Post()
  async create(
    @CurrentMember() memberId: string,
    @Body() request: CreateDebateDto,
  ): Promise<DebateDto> {
    return this.debatesService.create(request, memberId);
  }

  @ApiOperation({
    summary: '토론 상세 조회',
    description:
      '토론 정보에 발언자 프로필·기조 발언, 요청한 회원의 편(viewerSide), 확정된 턴과 투표 수를 더해 돌려준다.',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiOkResponse({ type: DebateDetailDto })
  @ApiErrorResponses(DebateErrorCode.NOT_FOUND, MemberErrorCode.NOT_FOUND)
  @ApiAuthRequired()
  @Get(':debateId')
  async findOne(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    // viewerSide를 정하려면 요청한 회원이 누구인지 알아야 한다(관전자는 null).
    @CurrentMember() memberId: string,
  ): Promise<DebateDetailDto> {
    return this.debatesService.findDetail(debateId, memberId);
  }

  @ApiOperation({
    summary: '토론의 확정된 턴 목록 조회',
    description:
      '확정 순서(sequence)대로, 턴별 좋아요·싫어요 수와 함께 돌려준다.',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiOkResponse({ type: [DebateTurnWithVotesDto] })
  @ApiErrorResponses(DebateErrorCode.NOT_FOUND)
  @Get(':debateId/turns')
  async findTurns(
    @Param('debateId', ParseUUIDPipe) debateId: string,
  ): Promise<DebateTurnWithVotesDto[]> {
    return this.debatesService.findTurns(debateId);
  }
}
