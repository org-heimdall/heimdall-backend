import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

// 대부분 수 ms~수백 ms라 prom-client 기본 버킷을 쓴다.
const DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

// 라우트에 매칭되지 않은 요청(404·정적 경로 등)의 route label. 원본 URL은 cardinality가 무한이라 쓰지 않는다.
export const UNMATCHED_ROUTE = 'unmatched';

type HttpLabel = 'method' | 'route' | 'status';

@Injectable()
export class HttpMetrics {
  private readonly total: Counter<HttpLabel>;
  private readonly duration: Histogram<HttpLabel>;

  constructor(registry: Registry) {
    this.total = new Counter({
      name: 'heimdall_http_requests_total',
      help: '처리된 HTTP 요청 수',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'heimdall_http_request_duration_seconds',
      help: 'HTTP 요청 처리 시간',
      labelNames: ['method', 'route', 'status'],
      buckets: DURATION_BUCKETS_SECONDS,
      registers: [registry],
    });
  }

  // 응답 1건을 기록한다. route는 라우트 패턴(/debates/:id)이어야 한다.
  record(
    method: string,
    route: string,
    status: number,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status: String(status) };
    this.total.inc(labels);
    this.duration.observe(labels, durationSeconds);
  }
}
