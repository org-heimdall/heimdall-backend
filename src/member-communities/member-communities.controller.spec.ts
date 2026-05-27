import { Test, TestingModule } from '@nestjs/testing';
import { MemberCommunitiesController } from './member-communities.controller';
import { MemberCommunitiesService } from './member-communities.service';

describe('MemberCommunitiesController', () => {
  let controller: MemberCommunitiesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemberCommunitiesController],
      providers: [MemberCommunitiesService],
    }).compile();

    controller = module.get<MemberCommunitiesController>(MemberCommunitiesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
