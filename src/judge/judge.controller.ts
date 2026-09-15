import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ApiAuthRequired } from '../common/decorators/api-auth-required.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import { ApiErrorResponses } from '../common/exceptions/api-error-responses.decorator';
import { ErrorCode } from '../common/exceptions/error-code';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import { JudgeService } from './judge.service';
import { DebateResultDto, JudgmentResultDto } from './dto/debate-result.dto';
import { JudgeErrorCode } from './exceptions/judge-error-code';

// 계약의 판정 API 3개. 실제 처리는 큐의 worker가 하고, 여기서는 밀어 주고 결과를 읽기만 한다.
@Controller('api/debates/:debateId')
export class JudgeController {
  constructor(private readonly service: JudgeService) {}

  @ApiOperation({
    summary: '판정 요청',
    description:
      '끝난 토론의 판정을 진행시킨다. 아직 분석되지 않은 턴이 있으면 그 작업부터 채우므로, ' +
      '중간에 멈춘 토론도 이 경로로 재개된다. 판정은 비동기라 완료 전에는 409로 답하고, ' +
      '완료된 뒤에는 저장된 결과를 200으로 돌려준다. 진행 상황은 debate.processing.stage 이벤트로 온다.',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiOkResponse({ type: JudgmentResultDto })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    ErrorCode.FORBIDDEN,
    JudgeErrorCode.NOT_FINALIZED,
    JudgeErrorCode.IN_PROGRESS,
    JudgeErrorCode.PROCESSING_FAILED,
  )
  @ApiAuthRequired()
  @Post('judge')
  @HttpCode(200)
  async requestJudgment(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
  ): Promise<JudgmentResultDto> {
    return this.service.requestJudgment(debateId, memberId);
  }

  @ApiOperation({
    summary: '판정 재시도',
    description:
      '최종 실패한 분석·판정 작업을 되돌려 다시 실행한다. 마지막 실패로부터 ' +
      'DEBATE_JUDGE_RETRY_COOLDOWN_SECONDS(기본 300초)가 지나야 받아 준다.',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiOkResponse({ type: JudgmentResultDto })
  @ApiErrorResponses(
    DebateErrorCode.NOT_FOUND,
    ErrorCode.FORBIDDEN,
    JudgeErrorCode.ALREADY_COMPLETED,
    JudgeErrorCode.NOTHING_TO_RETRY,
    JudgeErrorCode.RETRY_NOT_READY,
    JudgeErrorCode.IN_PROGRESS,
  )
  @ApiAuthRequired()
  @Post('judge/retry')
  @HttpCode(200)
  async retryJudgment(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
  ): Promise<JudgmentResultDto> {
    return this.service.retryJudgment(debateId, memberId);
  }

  @ApiOperation({
    summary: '토론 결과 조회',
    description:
      '판정이 끝난 토론의 결과(토론 정보·내 편·판정 결과·사실 검증)를 한 번에 준다. ' +
      '아직 판정 전이면 409이며, 진행 상황은 debate.processing.stage 이벤트로 확인한다.',
  })
  @ApiParam({ name: 'debateId', format: 'uuid' })
  @ApiOkResponse({ type: DebateResultDto })
  @ApiErrorResponses(DebateErrorCode.NOT_FOUND, JudgeErrorCode.RESULT_NOT_READY)
  @ApiAuthRequired()
  @Get('result')
  async getResult(
    @Param('debateId', ParseUUIDPipe) debateId: string,
    @CurrentMember() memberId: string,
  ): Promise<DebateResultDto> {
    return this.service.getResult(debateId, memberId);
  }
}
