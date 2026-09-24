import { Module } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { MetricsServer } from './metrics.server';

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
  ],
  exports: [Registry],
})
export class MetricsModule {}
