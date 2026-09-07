import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { CreateDebateDto } from './dto/create-debate.dto';
import { UpdateDebateDto } from './dto/update-debate.dto';
import { DebateStatus } from './entities/debate-status.enum';
import { Debate } from './entities/debate.entity';
import { DebateErrorCode } from './exceptions/debate-error-code';

@Injectable()
export class DebatesService {
  constructor(
    @InjectRepository(Debate)
    private readonly debateRepository: Repository<Debate>,
  ) {}

  // 토론 1건을 커뮤니티와 함께 조회한다(라운드 수·communityId는 community에 있다).
  // 토론과 커뮤니티 모두 soft-delete되지 않은 것만 대상이며, 없으면 NOT_FOUND.
  async findOneOrThrow(debateId: string): Promise<Debate> {
    const debate = await this.debateRepository.findOne({
      where: {
        id: debateId,
        status: ResourceStatus.NORMAL,
        community: { status: ResourceStatus.NORMAL },
      },
      relations: { community: true },
    });

    if (!debate) {
      throw new GeneralException(DebateErrorCode.NOT_FOUND);
    }
    return debate;
  }

  // 서버 재시작 후 턴 타임아웃 타이머를 다시 걸기 위해 진행 중인 토론의 id만 읽는다.
  async findInProgressIds(): Promise<string[]> {
    const debates = await this.debateRepository.find({
      select: { id: true },
      where: {
        status: ResourceStatus.NORMAL,
        debateStatus: DebateStatus.IN_PROGRESS,
      },
    });
    return debates.map((debate) => debate.id);
  }

  create(createDebateDto: CreateDebateDto) {
    return 'This action adds a new debate';
  }

  // TODO: 실제 조회 구현 시 debate.status = NORMAL 필터를 적용해 soft-delete된 토론을 제외한다.
  findAll() {
    return `This action returns all debates`;
  }

  // TODO: 실제 조회 구현 시 status = NORMAL 필터를 적용해 soft-delete된 토론을 제외한다.
  findOne(id: string) {
    return `This action returns a #${id} debate`;
  }

  update(id: string, updateDebateDto: UpdateDebateDto) {
    return `This action updates a #${id} debate`;
  }

  remove(id: string) {
    return `This action removes a #${id} debate`;
  }
}
