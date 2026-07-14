import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true, // DTO에 없는 속성이 있으면 400
      transform: true, // 요청 body를 DTO 인스턴스로 변환
    }),
  );

  // Swagger 설정 객체 생성
  const config = new DocumentBuilder()
    .setTitle('Heimdall Backend API') // 팀 프로젝트 API 이름
    .setDescription('Heimdall 서비스의 백엔드 API 명세서')
    .setVersion('1.0')
    .addBearerAuth() // JWT 토큰 인증이 필요할 경우 추가 (선택)
    .build();

  // Swagger 문서 생성 및 엔드포인트 설정
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document); // 'localhost:3000/api-docs'로 접속 가능

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
