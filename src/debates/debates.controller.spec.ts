import { Test, TestingModule } from '@nestjs/testing';
import { DebatesController } from './debates.controller';
import { DebatesService } from './debates.service';

describe('DebatesController', () => {
  let controller: DebatesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DebatesController],
      providers: [DebatesService],
    }).compile();

    controller = module.get<DebatesController>(DebatesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
