import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_WS_PORT } from '../common/ws/ws.config';
import { DebateTurnLimits } from './debate-chat-state';

// 채팅 WS는 커뮤니티 채팅과 같은 포트 하나를 공유한다(common/ws/ws.config.ts).
export const DEBATE_CHAT_WS_PORT = CHAT_WS_PORT;

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
