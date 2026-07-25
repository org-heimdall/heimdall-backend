import { Injectable } from '@nestjs/common';
import { CreateDebateDto } from './dto/create-debate.dto';
import { UpdateDebateDto } from './dto/update-debate.dto';

@Injectable()
export class DebatesService {
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
