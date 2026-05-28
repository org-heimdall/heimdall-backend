import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { DebatesService } from './debates.service';
import { CreateDebateDto } from './dto/create-debate.dto';
import { UpdateDebateDto } from './dto/update-debate.dto';

@Controller('debates')
export class DebatesController {
  constructor(private readonly debatesService: DebatesService) {}

  @Post()
  create(@Body() createDebateDto: CreateDebateDto) {
    return {} as any;
  }

  // @Get()
  // findAll() {
  //   return this.debatesService.findAll();
  // }
  //
  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.debatesService.findOne(+id);
  // }
  //
  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateDebateDto: UpdateDebateDto) {
  //   return this.debatesService.update(+id, updateDebateDto);
  // }
  //
  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.debatesService.remove(+id);
  // }
}
