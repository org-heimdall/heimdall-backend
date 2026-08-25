import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CommunitiesModule } from './communities/communities.module';
import { MemberCommunitiesModule } from './member-communities/member-communities.module';
import { MembersModule } from './members/members.module';
import { DebatesModule } from './debates/debates.module';
import { SeedModule } from './seed/seed.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from './common/naming/snake-naming.strategy';
import * as Joi from 'joi';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('local', 'development', 'production', 'test')
          .default('development'),

        PG_HOST: Joi.string().required(),
        PG_PORT: Joi.number().default(5432),
        PG_USER: Joi.string().required(),
        PG_PASSWORD: Joi.string().required(),
        PG_DATABASE: Joi.string().required(),

        // access/refresh secret은 분리한다(혼용 토큰 원천 차단). 값이 같으면 부팅을 막는다.
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_EXPIRES_IN: Joi.string().default('30m'),
        JWT_REFRESH_SECRET: Joi.string()
          .min(32)
          .required()
          .disallow(Joi.ref('JWT_ACCESS_SECRET')),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('14d'),

        GOOGLE_CLIENT_ID: Joi.string().required(),

        // 토론 발언 턴 제한시간(초). 턴 시작 시 endsAt = now + 이 값*1000 으로 클라이언트에 통지된다.
        DEBATE_TURN_SECONDS: Joi.number().default(180),
        // 토론 STARTING(양측 join 완료 후 자유 인사) 대기시간(초).
        DEBATE_STARTING_SECONDS: Joi.number().default(10),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('PG_HOST'),
        port: config.get<number>('PG_PORT'),
        username: config.get<string>('PG_USER'),
        password: config.get<string>('PG_PASSWORD'),
        database: config.get<string>('PG_DATABASE'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: config.get<string>('NODE_ENV') === 'development',
        namingStrategy: new SnakeNamingStrategy(),
      }),
    }),
    AuthModule,
    CommunitiesModule,
    MemberCommunitiesModule,
    MembersModule,
    DebatesModule,
    SeedModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // DI 컨테이너 안에서 전역 필터 등록 (추후 알림 서비스 등 주입 가능)
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
