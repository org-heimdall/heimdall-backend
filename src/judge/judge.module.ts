import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import { MembersModule } from '../members/members.module';
import { JudgeController } from './judge.controller';
import { JUDGE } from './judge.interface';
import { JudgeService } from './judge.service';
import { OpenAiJudge } from './openai-judge';

@Module({
  imports: [TypeOrmModule.forFeature([Debate, DebateMessage]), MembersModule],
  controllers: [JudgeController],
  providers: [
    JudgeService,
    // 판정을 별도 서비스(MSA)로 떼어낼 때 이 구현체만 교체하면 된다.
    { provide: JUDGE, useClass: OpenAiJudge },
  ],
})
export class JudgeModule {}
