import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { CommunityMessageDto } from '../communities/dto/community-message.dto';
import { CommunityOpinionDto } from '../communities/dto/community-opinion.dto';
import { CommunityErrorCode } from '../communities/exceptions/community-error-code';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import {
  CommunityMessageSendDto,
  CommunityMessagesQueryDto,
  CommunityOpinionSubmitDto,
} from './community-chat.dto';
import { CommunityChatPublisher } from './community-chat.publisher';
import { CommunityChatService } from './community-chat.service';
import { CommunityChatErrorCode } from './exceptions/community-chat-error-code';

/**
 * 커뮤니티 채팅의 HTTP 경로. WebSocket과 같은 서비스·저장소를 거치므로 두 경로가 섞여도 상태는 어긋나지 않는다.
 * 소켓을 아는 것은 게이트웨이뿐이므로, 방 전체에 알려야 하는 이벤트만 여기서 publisher로 보낸다
 * (HTTP에는 제외할 송신 소켓이 없다).
 */
@Controller('communities/:communityId')
export class CommunityChatController {
  constructor(
    private readonly service: CommunityChatService,
    private readonly publisher: CommunityChatPublisher,
  ) {}

  @ApiOperation({
    summary: '커뮤니티 메시지 목록 조회',
    description:
      '최근 메시지를 오래된 순으로 돌려준다. before를 주면 그 시각 이전만 읽어 과거로 거슬러 올라갈 수 있다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiOkResponse({ type: [CommunityMessageDto] })
  @ApiErrorResponses(CommunityErrorCode.NOT_FOUND)
  @Get('messages')
  async findMessages(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query() query: CommunityMessagesQueryDto,
  ): Promise<CommunityMessageDto[]> {
    return this.service.findRecentMessages(
      communityId,
      query.limit,
      query.before,
    );
  }

  @ApiOperation({
    summary: '커뮤니티 메시지 전송',
    description:
      '기조 발언을 작성한 커뮤니티 참여자만 보낼 수 있다. 같은 clientMessageId를 다시 보내면 저장 없이 기존 메시지를 돌려준다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiCreatedResponse({ type: CommunityMessageDto })
  @ApiErrorResponses(
    CommunityErrorCode.NOT_FOUND,
    MemberErrorCode.NOT_FOUND,
    CommunityChatErrorCode.NOT_PARTICIPANT,
    CommunityChatErrorCode.OPINION_REQUIRED,
  )
  @ApiAuthRequired()
  @Post('messages')
  async sendMessage(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
    @Body() request: CommunityMessageSendDto,
  ): Promise<CommunityMessageDto> {
    const result = await this.service.sendMessage(
      communityId,
      memberId,
      request.text,
      request.clientMessageId,
    );

    if (result.status === 'STORED') {
      this.publisher.messageCreated(communityId, result.message);
    }
    return result.message;
  }

  @ApiOperation({
    summary: '커뮤니티 의견 목록 조회',
    description: '기조 발언을 작성한 참여자의 의견만 돌려준다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiOkResponse({ type: [CommunityOpinionDto] })
  @Get('opinions')
  async findOpinions(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<CommunityOpinionDto[]> {
    return this.service.findOpinions(communityId);
  }

  @ApiOperation({
    summary: '커뮤니티에 대한 나의 의견 작성/수정',
    description:
      '커뮤니티 참여자만 작성할 수 있다. 새로 작성하면 action=CREATED, 고치면 UPDATED다.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiOkResponse({ type: CommunityOpinionDto })
  @ApiErrorResponses(
    CommunityErrorCode.NOT_FOUND,
    MemberErrorCode.NOT_FOUND,
    CommunityChatErrorCode.NOT_PARTICIPANT,
  )
  @ApiAuthRequired()
  @Put('opinions/me')
  async submitOpinion(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentMember() memberId: string,
    @Body() request: CommunityOpinionSubmitDto,
  ): Promise<CommunityOpinionDto> {
    const opinion = await this.service.submitOpinion(
      communityId,
      memberId,
      request,
    );

    this.publisher.opinionSubmitted(communityId, opinion);
    return opinion;
  }
}
