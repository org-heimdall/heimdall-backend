import { KeynoteDto } from '../../member-communities/dto/keynote.dto';

export class CreateCommunityDto {
  themeId: string;
  topic: string;
  roundCount: number;
  keynoteDto: KeynoteDto;
}
