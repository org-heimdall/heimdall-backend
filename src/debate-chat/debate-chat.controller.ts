import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import {
  DebateTurnFinalizeRequestDto,
  DebateTurnMessageSendRequestDto,
} from './debate-chat.dto';
import { DebateChatPublisher } from './debate-chat.publisher';
import {
  DebateChatSnapshotDto,
  DebateTurnDto,
  DebateTurnMessageAppendResultDto,
} from './debate-chat.response.dto';
import { DebateChatService } from './debate-chat.service';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

/**
 * 토론 채팅의 HTTP 경로. WebSocket과 같은 서비스·저장소를 거치므로 두 경로가 섞여도 상태는 어긋나지 않는다.
 * 소켓을 아는 것은 게이트웨이뿐이므로, 방 전체에 알려야 하는 created 이벤트만 여기서 publisher로 보낸다
 * (HTTP에는 제외할 송신 소켓이 없다).
 */
@Controller('api/debates/:debateId/chat')
export class DebateChatController {
  constructor(
    private readonly service: DebateChatService,
    private readonly publisher: DebateChatPublisher,
  ) {}

  @ApiOperation({
    summary: '토론 채팅 상태 조회',
    description:
      'WebSocket의 connection.restored와 같은 내용(현재 차례, 확정된 턴, 진행 중 draft)을 돌려준다. ' +
      '아직 시작되지 않은 토론은 이 호출로 진행 중이 되며 첫 차례의 제한 시간이 흐르기 시작한다.',
  })
  @ApiOkResponse({ description: '조회 성공', type: DebateChatSnapshotDto })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    DebateChatErrorCode.OPPONENT_MISSING,
    DebateChatErrorCode.FINALIZE_IN_PROGRESS,
  )
  @ApiAuthRequired()
  @Get()
  async getSnapshot(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    // 관전자를 포함해 인증된 회원만 볼 수 있다는 선언(D9). 토큰이 없으면 이 데코레이터가 401을
    // 던지므로, 값을 쓰지 않더라도 빼면 라우트가 조용히 공개된다.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @CurrentMember() _memberId: string,
  ): Promise<DebateChatSnapshotDto> {
    return this.service.restore(debateId);
  }

  @ApiOperation({
    summary: '발언 메시지 추가',
    description:
      '현재 차례의 draft에 메시지를 더한다. 같은 clientMessageId를 다시 보내면 저장 없이 DUPLICATE로 응답한다. ' +
      'body는 WebSocket과 같은 봉투({ payload: { ... } })와 발언 필드를 최상위에 둔 형태를 모두 받는다.',
  })
  @ApiOkResponse({
    description: '추가 성공',
    type: DebateTurnMessageAppendResultDto,
  })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    DebateChatErrorCode.NOT_PARTICIPANT,
    DebateChatErrorCode.SPEAKER_MISMATCH,
    DebateChatErrorCode.OPPONENT_MISSING,
    DebateChatErrorCode.NOT_IN_PROGRESS,
    DebateChatErrorCode.TURN_MISMATCH,
    DebateChatErrorCode.CONTENT_TOO_LONG,
    DebateChatErrorCode.TURN_CHARACTER_LIMIT_EXCEEDED,
    DebateChatErrorCode.FINALIZE_IN_PROGRESS,
  )
  @ApiAuthRequired()
  @Post('messages')
  @HttpCode(200)
  async appendMessage(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
    @Body() request: DebateTurnMessageSendRequestDto,
  ): Promise<DebateTurnMessageAppendResultDto> {
    const result = await this.service.appendDraft(
      debateId,
      memberId,
      request.toPayload(),
      request.clientMessageId,
    );

    if (result.status === 'APPENDED') {
      this.publisher.messageCreated(debateId, result.message);
    }
    return result;
  }

  @ApiOperation({
    summary: '발언 차례 확정',
    description:
      '현재 차례의 draft를 개행으로 이어 붙여 하나의 턴으로 확정하고 다음 차례로 넘긴다. ' +
      'draft가 없으면 확정할 수 없다.',
  })
  @ApiOkResponse({ description: '확정 성공', type: DebateTurnDto })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    DebateChatErrorCode.NOT_PARTICIPANT,
    DebateChatErrorCode.SPEAKER_MISMATCH,
    DebateChatErrorCode.OPPONENT_MISSING,
    DebateChatErrorCode.NOT_IN_PROGRESS,
    DebateChatErrorCode.TURN_MISMATCH,
    DebateChatErrorCode.TURN_EMPTY,
    DebateChatErrorCode.FINALIZE_IN_PROGRESS,
  )
  @ApiAuthRequired()
  @Post('finalize')
  @HttpCode(200)
  async finalizeTurn(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
    @Body() request: DebateTurnFinalizeRequestDto,
  ): Promise<DebateTurnDto> {
    return this.service.finalizeTurn(debateId, memberId, request.toPayload());
  }
}
