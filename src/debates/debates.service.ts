import { Injectable } from '@nestjs/common';
import { CreateDebateDto } from './dto/create-debate.dto';
import { UpdateDebateDto } from './dto/update-debate.dto';

@Injectable()
export class DebatesService {
  create(createDebateDto: CreateDebateDto) {
    return 'This action adds a new debate';
  }

  findAll() {
    return `This action returns all debates`;
  }

  findOne(id: number) {
    return `This action returns a #${id} debate`;
  }

  update(id: number, updateDebateDto: UpdateDebateDto) {
    return `This action updates a #${id} debate`;
  }

  remove(id: number) {
    return `This action removes a #${id} debate`;
  }
}
