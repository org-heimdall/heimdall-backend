import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { CreateDebateDto } from './dto/create-debate.dto';
import { UpdateDebateDto } from './dto/update-debate.dto';
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
