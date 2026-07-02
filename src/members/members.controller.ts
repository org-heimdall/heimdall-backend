import { MembersService } from './members.service';
import { Controller } from '@nestjs/common';

@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}
}
