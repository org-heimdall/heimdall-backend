import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenModule } from '../auth/token.module';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { Member } from './entities/member.entity';
import { MemberOAuthAccount } from './entities/member-oauth-account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Member, MemberOAuthAccount]),
    TokenModule,
  ],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
