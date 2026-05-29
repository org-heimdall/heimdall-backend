import { DebatesService } from './debates.service';
import {
  CreateDebateDto,
  CreateDebateResultDto,
} from './dto/create-debate.dto';
import { ApiOperation } from '@nestjs/swagger';
import { Body, Controller, Post } from '@nestjs/common';

@Controller('api/debates')
export class DebatesController {
  constructor(private readonly debatesService: DebatesService) {}

  @ApiOperation({
    summary: '토론 생성',
    description: '호스트만 사용 가능',
  })
  @Post()
  async create(
    @Body() request: CreateDebateDto,
  ): Promise<CreateDebateResultDto> {
    return {} as any;
  }
}
