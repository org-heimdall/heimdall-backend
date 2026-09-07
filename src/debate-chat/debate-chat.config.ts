import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DebateTurnLimits } from './debate-chat-state';

// 게이트웨이 데코레이터는 import 시점에 평가되어 ConfigService를 쓸 수 없으므로 포트만 process.env로 읽는다.
// (main.ts가 dotenv를 먼저 로드한다.) 형식 검증은 app.module의 Joi 스키마가 한다.
export const DEBATE_CHAT_WS_PORT = Number(
  process.env.DEBATE_CHAT_WS_PORT ?? 8080,
);

// 턴 제한값. 값은 Joi 스키마가 보장하며, 운영 확인을 위해 실제 값을 시작 로그로 남긴다.
@Injectable()
export class DebateChatConfig {
  readonly limits: DebateTurnLimits;

  constructor(configService: ConfigService) {
    this.limits = {
      maxContentLength: configService.getOrThrow<number>(
        'DEBATE_TURN_MAX_CONTENT_LENGTH',
      ),
      maxTotalCharacters: configService.getOrThrow<number>(
        'DEBATE_TURN_MAX_TOTAL_CHARACTERS',
      ),
      maxDurationSeconds: configService.getOrThrow<number>(
        'DEBATE_TURN_MAX_DURATION_SECONDS',
      ),
    };
    new Logger(DebateChatConfig.name).log(
      `토론 채팅 WS port=${DEBATE_CHAT_WS_PORT}, 턴 제한: content=${this.limits.maxContentLength}자, ` +
        `total=${this.limits.maxTotalCharacters}자, duration=${this.limits.maxDurationSeconds}초`,
    );
  }
}
