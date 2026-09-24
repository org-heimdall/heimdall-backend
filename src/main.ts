// 게이트웨이 포트(@WebSocketGateway)는 import 시점에 평가되므로 ConfigModule보다 먼저 .env를 읽는다.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { validationExceptionFactory } from './common/exceptions/validation-exception.factory';
import { CommandEnvelopeWsAdapter } from './common/ws/command-envelope-ws.adapter';
import { WsMetrics } from './common/metrics/ws.metrics';
import { Server } from 'node:http';

// 클라이언트(Dio·OkHttp)의 풀 유지 시간보다 길게 잡는다.
const KEEP_ALIVE_TIMEOUT_MS = 65_000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 종료 시그널에서 WebSocket 서버까지 정리되도록 한다.
  app.enableShutdownHooks();
  // 계약의 명령 봉투 { id, type, payload }를 게이트웨이 핸들러에 연결한다.
  // 연결 수·명령 처리 메트릭도 이 어댑터가 기록한다.
  app.useWebSocketAdapter(
    new CommandEnvelopeWsAdapter(app, app.get(WsMetrics)),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true, // DTO에 없는 속성이 있으면 400
      transform: true, // 요청 body를 DTO 인스턴스로 변환
      exceptionFactory: validationExceptionFactory, // 검증 오류를 ProblemDetail 형식으로 변환
    }),
  );

  // Swagger 설정 객체 생성
  const config = new DocumentBuilder()
    .setTitle('Heimdall Backend API') // 팀 프로젝트 API 이름
    .setDescription('Heimdall 서비스의 백엔드 API 명세서')
    .setVersion('1.0')
    .addBearerAuth() // JWT Bearer 인증 스킴 정의 (요구는 @ApiAuthRequired() 라우트에만 적용)
    .build();

  // Swagger 문서 생성 및 엔드포인트 설정
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document); // 'localhost:3000/api-docs'로 접속 가능

  /*
   * Node의 keep-alive 타임아웃 기본값은 5초라, 클라이언트가 커넥션 풀에 5초 넘게 묵혀 둔
   * 연결을 재사용하는 순간 서버가 막 닫은 소켓에 요청이 실려 응답 없이 멈춘다
   * (Dio의 receive timeout, OkHttp의 unexpected end of stream으로 나타난다).
   * 끊는 쪽을 항상 클라이언트로 만들기 위해 서버 쪽을 넉넉히 늘린다.
   * headersTimeout은 keepAliveTimeout보다 커야 같은 경합이 헤더 단계에서 재발하지 않는다.
   */
  const httpServer = app.getHttpServer() as Server;
  httpServer.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  httpServer.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000;

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
