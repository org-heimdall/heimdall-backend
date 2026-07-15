import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CommunitiesModule } from './communities/communities.module';
import { MemberCommunitiesModule } from './member-communities/member-communities.module';
import { MembersModule } from './members/members.module';
import { DebatesModule } from './debates/debates.module';
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
        synchronize: true,
        namingStrategy: new SnakeNamingStrategy(),
      }),
    }),
    CommunitiesModule,
    MemberCommunitiesModule,
    MembersModule,
    DebatesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // DI 컨테이너 안에서 전역 필터 등록 (추후 알림 서비스 등 주입 가능)
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
