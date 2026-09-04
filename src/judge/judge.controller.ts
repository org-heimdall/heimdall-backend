import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { ErrorCode } from '../common/exceptions/error-code';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import { DebateJudgmentDto } from './dto/debate-judgment.dto';
import { JudgeErrorCode } from './exceptions/judge-error-code';
import { JudgeService } from './judge.service';

@Controller('api/debates/:debateId/judgment')
export class JudgeController {
  constructor(private readonly judgeService: JudgeService) {}

  @ApiOperation({
    summary: '토론 판정 요청',
    description:
      '토론 당사자(host/opponent)만 요청할 수 있다. 즉시 202로 응답하고 판정은 백그라운드에서 수행되므로, ' +
      '결과는 판정 조회 API를 폴링해 받는다. 판정에 실패한 토론은 다시 요청할 수 있다.',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiAcceptedResponse({ description: '판정 요청 접수' })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    ErrorCode.FORBIDDEN,
    JudgeErrorCode.ALREADY_REQUESTED,
    JudgeErrorCode.NOT_JUDGEABLE,
  )
  @ApiAuthRequired()
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestJudgment(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
  ): Promise<void> {
    return this.judgeService.requestJudgment(debateId, memberId);
  }

  @ApiOperation({
    summary: '토론 판정 조회',
    description:
      'PENDING이면 판정이 진행 중이므로 폴링을 이어간다. JUDGED면 점수·승자·판정이유가 채워진다.',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiOkResponse({ type: DebateJudgmentDto })
  @ApiErrorResponses(DebateErrorCode.NOT_FOUND, JudgeErrorCode.NOT_REQUESTED)
  @ApiAuthRequired()
  @Get()
  async getJudgment(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    // @CurrentMember()를 쓰는 것이 곧 "인증 필수" 선언이다. 조회 자체는 참가자로 제한하지
    // 않으므로(관전자도 결과를 본다) 값은 사용하지 않는다.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @CurrentMember() _memberId: string,
  ): Promise<DebateJudgmentDto> {
    return this.judgeService.getJudgment(debateId);
  }
}
