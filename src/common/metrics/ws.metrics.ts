import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

// 명령 처리는 대부분 수 ms~수백 ms라 prom-client 기본 버킷을 쓴다.
const DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

// 미등록 type·파싱 실패 명령의 type label. 클라이언트가 보낸 값을 그대로 쓰면 cardinality가 무한이다.
export const UNKNOWN_COMMAND_TYPE = 'unknown';

export type WsCommandOutcome = 'ok' | 'error';

type CommandLabel = 'gateway' | 'type' | 'outcome';

@Injectable()
export class WsMetrics {
  private readonly connections: Gauge<'gateway'>;
  private readonly commands: Counter<CommandLabel>;
  private readonly commandDuration: Histogram<CommandLabel>;

  constructor(registry: Registry) {
    this.connections = new Gauge({
      name: 'heimdall_ws_connections',
      help: '현재 열려 있는 WebSocket 연결 수',
      labelNames: ['gateway'],
      registers: [registry],
    });
    this.commands = new Counter({
      name: 'heimdall_ws_commands_total',
      help: '처리된 WebSocket 명령 수',
      labelNames: ['gateway', 'type', 'outcome'],
      registers: [registry],
    });
    this.commandDuration = new Histogram({
      name: 'heimdall_ws_command_duration_seconds',
      help: 'WebSocket 명령 처리 시간',
      labelNames: ['gateway', 'type', 'outcome'],
      buckets: DURATION_BUCKETS_SECONDS,
      registers: [registry],
    });
  }

  connectionOpened(gateway: string): void {
    this.connections.inc({ gateway });
  }

  connectionClosed(gateway: string): void {
    this.connections.dec({ gateway });
  }

  // 명령 1건을 기록한다. type은 등록된 명령 type이거나 UNKNOWN_COMMAND_TYPE이어야 한다.
  recordCommand(
    gateway: string,
    type: string,
    outcome: WsCommandOutcome,
    durationSeconds: number,
  ): void {
    const labels = { gateway, type, outcome };
    this.commands.inc(labels);
    this.commandDuration.observe(labels, durationSeconds);
  }
}
