import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebatesService } from './debates.service';
import { DebatesController } from './debates.controller';
import { Debate } from './entities/debate.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Debate])],
  controllers: [DebatesController],
  providers: [DebatesService],
  // 토론 채팅 등 다른 도메인은 이 서비스로만 debate를 조회한다(엔티티 직접 참조 대신).
  exports: [DebatesService],
})
export class DebatesModule {}
