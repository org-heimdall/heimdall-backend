import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import { JudgeController } from './judge.controller';
import { JUDGE } from './judge.interface';
import { JudgeService } from './judge.service';
import { OpenAiJudge } from './openai-judge';

@Module({
  // 엔티티는 debates 도메인 소유로 두고 레포지토리만 주입받는다.
  imports: [TypeOrmModule.forFeature([Debate, DebateMessage])],
  controllers: [JudgeController],
  providers: [
    JudgeService,
    // 판정을 별도 서비스(MSA)로 떼어낼 때 이 구현체만 교체하면 된다.
    { provide: JUDGE, useClass: OpenAiJudge },
  ],
})
export class JudgeModule {}
