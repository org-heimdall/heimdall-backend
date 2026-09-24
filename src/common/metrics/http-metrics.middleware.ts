import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { HttpMetrics, UNMATCHED_ROUTE } from './http.metrics';

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: HttpMetrics) {}

  /**
   * 응답이 끝난 시점(finish)에 기록한다. Interceptor와 달리 가드 거절·404·검증 실패 응답도 잡힌다.
   * 라우트 패턴은 라우팅이 끝난 뒤에야 req.route에 채워지므로 finish 시점에 읽는다.
   */
  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = performance.now();
    res.on('finish', () => {
      this.metrics.record(
        req.method,
        routeOf(req),
        res.statusCode,
        (performance.now() - startedAt) / 1000,
      );
    });
    next();
  }
}

// express가 매칭한 라우트 패턴. 매칭되지 않았으면 unmatched로 묶는다.
function routeOf(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string'
    ? `${req.baseUrl}${route.path}`
    : UNMATCHED_ROUTE;
}
