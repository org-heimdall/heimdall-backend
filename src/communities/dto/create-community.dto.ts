import { KeynoteDto } from './keynote.dto';

export class CreateCommunityDto {
  themeId: string;
  topic: string;
  roundCount: number;
  keynoteDto: KeynoteDto;
}
