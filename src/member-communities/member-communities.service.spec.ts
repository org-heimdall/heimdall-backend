import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MemberCommunitiesService } from './member-communities.service';
import { MemberCommunity } from './entities/member-community.entity';

describe('MemberCommunitiesService', () => {
  let service: MemberCommunitiesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberCommunitiesService,
        {
          provide: getRepositoryToken(MemberCommunity),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<MemberCommunitiesService>(MemberCommunitiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
