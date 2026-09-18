import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// draft·락 저장용 Redis 클라이언트. 키 접두사는 도메인이 직접 붙이므로(Lua의 KEYS와 어긋나지
// 않도록) 클라이언트 수준 keyPrefix는 쓰지 않는다.
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.getOrThrow<string>('REDIS_HOST');
        const port = config.getOrThrow<number>('REDIS_PORT');
        const password = config.get<string>('REDIS_PASSWORD') || undefined;
        new Logger('RedisModule').log(`Redis 연결 대상: ${host}:${port}`);
        return new Redis({ host, port, password });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // 종료 시그널에서 연결을 정리한다(main.ts의 enableShutdownHooks가 호출한다).
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
