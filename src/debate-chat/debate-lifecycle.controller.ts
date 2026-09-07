import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { DebateDto } from '../debates/dto/debate.dto';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import { DebateChatService } from './debate-chat.service';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

/**
 * 토론 생명주기 중 **진행 상태를 바꾸는** 두 경로. 조회·생성과 달리 채팅과 같은 상태 저장소(락 포함)와
 * 턴 타이머·방 이벤트를 거쳐야 하므로, 그것들을 소유한 debate-chat 모듈에 둔다
 * (debates 모듈에 두면 debate-chat과 순환 의존이 된다).
 */
@Controller('api/debates/:debateId')
export class DebateLifecycleController {
  constructor(private readonly service: DebateChatService) {}

  @ApiOperation({
    summary: '토론 시작',
    description:
      'READY 상태의 토론을 IN_PROGRESS로 바꾸고 첫 차례의 제한 시간을 흐르게 한다. ' +
      '채팅 첫 접속도 같은 전이를 하므로 이미 시작된 토론에 다시 불러도 그대로 200이다.',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiOkResponse({ type: DebateDto })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    DebateErrorCode.ALREADY_ENDED,
    DebateChatErrorCode.NOT_PARTICIPANT,
    DebateChatErrorCode.OPPONENT_MISSING,
    DebateChatErrorCode.FINALIZE_IN_PROGRESS,
  )
  @ApiAuthRequired()
  @Post('start')
  @HttpCode(200)
  async start(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
  ): Promise<DebateDto> {
    return this.service.start(debateId, memberId);
  }

  @ApiOperation({
    summary: '토론 기권',
    description:
      '발언자가 진행 중인 토론을 포기한다. 토론은 판정 없이 FAILED로 끝나고 승자는 상대가 되며, ' +
      '이후 발언·확정 명령은 모두 거절된다.',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiNoContentResponse({ description: '기권 처리 성공' })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    DebateChatErrorCode.NOT_PARTICIPANT,
    DebateChatErrorCode.OPPONENT_MISSING,
    DebateChatErrorCode.NOT_IN_PROGRESS,
    DebateChatErrorCode.FINALIZE_IN_PROGRESS,
  )
  @ApiAuthRequired()
  @Post('forfeit')
  @HttpCode(204)
  async forfeit(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.service.forfeit(debateId, memberId);
  }
}
