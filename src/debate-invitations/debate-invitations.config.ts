import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// 초대 응답 제한 시간. 값은 Joi 스키마가 보장하며, 운영 확인을 위해 실제 값을 시작 로그로 남긴다.
@Injectable()
export class DebateInvitationsConfig {
  readonly ttlSeconds: number;

  constructor(configService: ConfigService) {
    this.ttlSeconds = configService.getOrThrow<number>(
      'DEBATE_INVITATION_TTL_SECONDS',
    );
    new Logger(DebateInvitationsConfig.name).log(
      `토론 초대 응답 제한 ${this.ttlSeconds}초`,
    );
  }
}
