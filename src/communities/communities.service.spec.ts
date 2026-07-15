import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CommunitiesService } from './communities.service';
import { Community } from './entities/community.entity';
import { Theme } from './entities/theme.entity';
import { CommunityTheme } from './entities/community-theme.entity';
import { CommunityFavorite } from './entities/community-favorite.entity';
import { MembersService } from '../members/members.service';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';

describe('CommunitiesService', () => {
  let service: CommunitiesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitiesService,
        { provide: getRepositoryToken(Community), useValue: {} },
        { provide: getRepositoryToken(Theme), useValue: {} },
        { provide: getRepositoryToken(CommunityTheme), useValue: {} },
        { provide: getRepositoryToken(CommunityFavorite), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: MembersService, useValue: {} },
        { provide: MemberCommunitiesService, useValue: {} },
      ],
    }).compile();

    service = module.get<CommunitiesService>(CommunitiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
