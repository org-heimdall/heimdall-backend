export class CreateDebateDto {
  communityId: string;
  opponentId: string;
}

export class CreateDebateResultDto {
  debateId: string;
  createdAt: Date;
}
