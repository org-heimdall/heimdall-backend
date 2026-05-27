import { Test, TestingModule } from '@nestjs/testing';
import { MemberCommunitiesService } from './member-communities.service';

describe('MemberCommunitiesService', () => {
  let service: MemberCommunitiesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MemberCommunitiesService],
    }).compile();

    service = module.get<MemberCommunitiesService>(MemberCommunitiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
