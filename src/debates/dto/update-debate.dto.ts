import { PartialType } from '@nestjs/swagger';
import { CreateDebateDto } from './create-debate.dto';

export class UpdateDebateDto extends PartialType(CreateDebateDto) {}
