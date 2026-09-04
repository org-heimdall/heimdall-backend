import { Module } from '@nestjs/common';
import { SeedService } from './seed.service';
import { DebateSeedSource } from './debate-seed.source';

@Module({
  providers: [SeedService, DebateSeedSource],
})
export class SeedModule {}
