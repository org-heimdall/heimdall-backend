import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { DebateChatErrorCode } from '../debate-chat/exceptions/debate-chat-error-code';
import { DebateDetailDto } from '../debates/dto/debate.dto';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import { DebateInvitationsService } from './debate-invitations.service';
import { DebateInvitationDto } from './dto/debate-invitation.dto';
import { StartDebateDto } from './dto/start-debate.dto';
import { DebateInvitationErrorCode } from './exceptions/debate-invitation-error-code';

/**
 * 커뮤니티 토론 초대의 HTTP 경로. 대기 화면(5초)은 별도 endpoint가 아니라
 * 이 네 개의 호출과 커뮤니티 WS 이벤트(debate.requested / rejected / expired / started)의 조합이다.
 */
@Controller('api/communities/:communityId/debates')
export class DebateInvitationsController {
  constructor(private readonly service: DebateInvitationsService) {}

  @ApiOperation({
    summary: '토론 초대 (방장)',
    description:
      '방장과 상대 모두 토론 의사가 OPEN_TO_DEBATE여야 한다. 초대받은 사람은 커뮤니티 WS의 ' +
      'debate.requested로 같은 초대를 받고, 응답이 없으면 expiresAt에 양쪽으로 debate.request.expired가 간다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiCreatedResponse({ type: DebateInvitationDto })
  @ApiErrorResponses(
    CommunityErrorCode.NOT_FOUND,
    MemberErrorCode.NOT_FOUND,
    DebateInvitationErrorCode.HOST_ONLY,
    DebateInvitationErrorCode.SELF_INVITATION,
    DebateErrorCode.SPEAKER_NOT_IN_COMMUNITY,
    DebateInvitationErrorCode.HOST_NOT_OPEN_TO_DEBATE,
    DebateInvitationErrorCode.OPPONENT_NOT_OPEN_TO_DEBATE,
    DebateInvitationErrorCode.ALREADY_PENDING,
    DebateInvitationErrorCode.DEBATE_ALREADY_ACTIVE,
  )
  @ApiAuthRequired()
  @Post('start')
  async start(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
    @Body() request: StartDebateDto,
  ): Promise<DebateInvitationDto> {
    return this.service.start(communityId, memberId, request.opponentMemberId);
  }

  @ApiOperation({
    summary: '커뮤니티에서 진행 중인 토론 조회',
    description:
      '진행 중인 토론이 없으면 본문 없이 200이다. 판정 중(JUDGING)인 토론도 진행 중으로 본다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiOkResponse({ type: DebateDetailDto })
  @ApiErrorResponses(CommunityErrorCode.NOT_FOUND)
  @ApiAuthRequired()
  @Get('active')
  async findActive(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    // 요청한 회원의 편(viewerSide)을 채우기 위해 인증이 필요하다.
    @CurrentMember() memberId: string,
  ): Promise<DebateDetailDto | null> {
    return this.service.findActive(communityId, memberId);
  }

  @ApiOperation({
    summary: '토론 초대 수락 (초대받은 사람)',
    description:
      '수락과 동시에 토론이 시작된다(IN_PROGRESS). 방 전체는 커뮤니티 WS의 debate.started를 받는다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiCreatedResponse({ type: DebateDetailDto })
  @ApiErrorResponses(
    DebateInvitationErrorCode.NOT_FOUND,
    DebateInvitationErrorCode.NOT_INVITEE,
    DebateInvitationErrorCode.ALREADY_RESPONDED,
    DebateInvitationErrorCode.EXPIRED,
    DebateErrorCode.SPEAKER_NOT_IN_COMMUNITY,
    DebateChatErrorCode.FINALIZE_IN_PROGRESS,
  )
  @ApiAuthRequired()
  @Post(':invitationId/accept')
  async accept(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentMember() memberId: string,
  ): Promise<DebateDetailDto> {
    return this.service.accept(communityId, invitationId, memberId);
  }

  @ApiOperation({
    summary: '토론 초대 거절 (초대받은 사람)',
    description:
      '방장은 커뮤니티 WS의 debate.request.rejected로 결과를 받는다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiNoContentResponse({ description: '초대 거절 성공' })
  @ApiErrorResponses(
    DebateInvitationErrorCode.NOT_FOUND,
    DebateInvitationErrorCode.NOT_INVITEE,
    DebateInvitationErrorCode.ALREADY_RESPONDED,
    DebateInvitationErrorCode.EXPIRED,
  )
  @ApiAuthRequired()
  @Post(':invitationId/reject')
  @HttpCode(204)
  async reject(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.service.reject(communityId, invitationId, memberId);
  }
}
