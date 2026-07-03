import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommunitiesModule } from './communities/communities.module';
import { MemberCommunitiesModule } from './member-communities/member-communities.module';
import { MembersModule } from './members/members.module';
import { DebatesModule } from './debates/debates.module';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('local', 'development', 'production', 'test')
          .default('development'),

        MYSQL_HOST: Joi.string().required(),
        MYSQL_PORT: Joi.number().default(3306),
        MYSQL_USER: Joi.string().required(),
        MYSQL_ROOT_PASSWORD: Joi.string().required(),
        MYSQL_DATABASE: Joi.string().required(),
      }),
    }),
    CommunitiesModule,
    MemberCommunitiesModule,
    MembersModule,
    DebatesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
