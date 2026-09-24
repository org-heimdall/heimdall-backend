import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { HttpMetrics } from './http.metrics';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsServer } from './metrics.server';
import { WsMetrics } from './ws.metrics';

@Module({
  providers: [
    {
      provide: Registry,
      // 프로세스 기본 메트릭(CPU·메모리·이벤트 루프 지연·GC 등)을 수집하는 레지스트리.
      // 도메인 메트릭은 이 레지스트리를 주입받아 Counter/Histogram 등을 등록한다.
      useFactory: () => {
        const registry = new Registry();
        collectDefaultMetrics({ register: registry });
        return registry;
      },
    },
    MetricsServer,
    HttpMetrics,
    // WS 어댑터는 DI 밖(main.ts)에서 만들어지므로 app.get(WsMetrics)로 꺼내 넘긴다.
    WsMetrics,
  ],
  exports: [Registry, WsMetrics],
})
export class MetricsModule implements NestModule {
  // 404·가드 거절까지 세도록 라우트 매칭 전 단계인 미들웨어로 전 경로에 건다.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('{*splat}');
  }
}
