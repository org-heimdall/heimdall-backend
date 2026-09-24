import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { Registry } from 'prom-client';

const METRICS_PATH = '/metrics';

@Injectable()
export class MetricsServer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MetricsServer.name);
  private server?: Server;

  constructor(
    private readonly registry: Registry,
    private readonly config: ConfigService,
  ) {}

  // API 포트와 분리된 메트릭 전용 리스너를 같은 프로세스에 연다.
  // 포트가 분리되어 있어야 보안 그룹에서 이 포트만 Observability 서버로 제한할 수 있다.
  async onApplicationBootstrap(): Promise<void> {
    const port = this.config.getOrThrow<number>('METRICS_PORT');
    const server = createServer((req, res) => void this.handle(req, res));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.logger.log(`메트릭 서버 port=${port}, path=${METRICS_PATH}`);
  }

  // 종료 시그널에서 메트릭 리스너도 함께 닫아 프로세스가 매달리지 않게 한다.
  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // GET /metrics만 응답하고 나머지 경로는 404로 막는다.
  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (req.method !== 'GET' || req.url !== METRICS_PATH) {
      res.writeHead(404).end();
      return;
    }

    try {
      const body = await this.registry.metrics();
      res.writeHead(200, { 'Content-Type': this.registry.contentType });
      res.end(body);
    } catch (error) {
      this.logger.error('메트릭 수집 실패', error);
      res.writeHead(500).end();
    }
  }
}
