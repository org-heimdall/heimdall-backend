import { Module } from '@nestjs/common';
import { DebatesService } from './debates.service';
import { DebatesController } from './debates.controller';

@Module({
  controllers: [DebatesController],
  providers: [DebatesService],
})
export class DebatesModule {}
