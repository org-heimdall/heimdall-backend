import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { GeneralException } from '../common/exceptions/general.exception';
import { CommunitiesService } from '../communities/communities.service';
import { CommunityMessagesService } from '../communities/community-messages.service';
import { CommunityMessageDto } from '../communities/dto/community-message.dto';
import {
  CommunityOpinionAction,
  CommunityOpinionDto,
} from '../communities/dto/community-opinion.dto';
import { CommunityMessage } from '../communities/entities/community-message.entity';
import { MemberCommunity } from '../member-communities/entities/member-community.entity';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { Member } from '../members/entities/member.entity';
import { MembersService } from '../members/members.service';
import { CommunityOpinionSubmitDto } from './community-chat.dto';
import { CommunityMessageAckStatus } from './community-chat.types';
import { CommunityChatErrorCode } from './exceptions/community-chat-error-code';

// 계약: 접속 직후 replay로 보내는 최근 메시지 수.
export const REPLAY_MESSAGE_LIMIT = 50;

export interface CommunityChatReplay {
  messages: CommunityMessageDto[];
  opinions: CommunityOpinionDto[];
}

export interface CommunityMessageResult {
  status: CommunityMessageAckStatus;
  message: CommunityMessageDto;
}

/**
 * 커뮤니티 채팅 응용 서비스. 소켓을 모르므로 WS 게이트웨이와 REST 컨트롤러가 그대로 함께 쓴다.
 * 방 전체 이벤트는 송신 소켓을 아는 쪽(게이트웨이/컨트롤러)이 publisher로 보낸다.
 */
@Injectable()
export class CommunityChatService {
  constructor(
    private readonly communitiesService: CommunitiesService,
    private readonly communityMessagesService: CommunityMessagesService,
    private readonly memberCommunitiesService: MemberCommunitiesService,
    private readonly membersService: MembersService,
  ) {}

  // 접속 가능한 커뮤니티인지 확인한다(삭제된 커뮤니티는 NOT_FOUND).
  // 관전(비참여자 접속)은 허용하고, 명령만 참여자로 제한한다.
  async assertJoinable(communityId: string): Promise<void> {
    await this.communitiesService.findOneOrThrow(communityId);
  }

  // 접속 직후 복구용. 토론 채팅의 connection.restored와 달리 계약상 스냅샷 이벤트가 없어
  // 최근 메시지와 의견 목록을 각각의 이벤트로 그대로 다시 보낸다.
  async replay(communityId: string): Promise<CommunityChatReplay> {
    const [messages, opinions] = await Promise.all([
      this.communityMessagesService.findRecent(
        communityId,
        REPLAY_MESSAGE_LIMIT,
      ),
      this.findOpinions(communityId),
    ]);

    return {
      // 작성자는 메시지와 함께 조회된다(탈퇴해도 이력은 남는다).
      messages: messages.map((message) =>
        CommunityMessageDto.from(message, message.member),
      ),
      opinions,
    };
  }

  // 커뮤니티의 의견 목록. 작성자 이름은 회원을 배치 조회해 채운다.
  async findOpinions(communityId: string): Promise<CommunityOpinionDto[]> {
    const rows = await this.memberCommunitiesService.findOpinions(communityId);
    const authors = await this.loadAuthorMap(rows);

    return rows
      .map((row) => {
        const author = authors.get(row.memberId);
        // 탈퇴한 회원의 의견은 이름을 채울 수 없으므로 목록에서 제외한다.
        return author ? CommunityOpinionDto.from(row, author) : null;
      })
      .filter((opinion): opinion is CommunityOpinionDto => opinion !== null);
  }

  async findRecentMessages(
    communityId: string,
    limit: number,
    before?: Date,
  ): Promise<CommunityMessageDto[]> {
    await this.communitiesService.findOneOrThrow(communityId);

    const messages = await this.communityMessagesService.findRecent(
      communityId,
      limit,
      before,
    );
    return messages.map((message) =>
      CommunityMessageDto.from(message, message.member),
    );
  }

  // 메시지 전송(참여자만). 같은 clientMessageId를 다시 보내면 저장 없이 DUPLICATE로 알린다.
  async sendMessage(
    communityId: string,
    memberId: string,
    text: string,
    clientMessageId: string,
  ): Promise<CommunityMessageResult> {
    const author = await this.requireParticipantMember(communityId, memberId);

    const result = await this.communityMessagesService.create(
      CommunityMessage.write({
        id: randomUUID(),
        communityId,
        memberId,
        clientMessageId,
        text,
        createdAt: new Date(),
      }),
    );

    // 중복 방지 키의 범위가 커뮤니티 단위(계약)라 기존 메시지의 작성자는 요청자와 다를 수 있다.
    // 그때는 저장된 행에 함께 읽어 온 작성자를 쓴다.
    const stored = result.message;
    return {
      status: result.status,
      message: CommunityMessageDto.from(stored, stored.member ?? author),
    };
  }

  // 기조 발언 작성/수정(참여자만). 새로 작성했는지(CREATED) 고쳤는지(UPDATED)를 함께 알린다.
  async submitOpinion(
    communityId: string,
    memberId: string,
    { claim, reasons }: CommunityOpinionSubmitDto,
  ): Promise<CommunityOpinionDto> {
    await this.communitiesService.findOneOrThrow(communityId);

    const updated = await this.memberCommunitiesService.updateKeynote(
      memberId,
      communityId,
      claim,
      reasons,
    );
    if (!updated) {
      throw new GeneralException(CommunityChatErrorCode.NOT_PARTICIPANT);
    }

    const author = await this.membersService.findOneOrThrow(memberId);
    return CommunityOpinionDto.from(
      updated.row,
      author,
      updated.created
        ? CommunityOpinionAction.CREATED
        : CommunityOpinionAction.UPDATED,
    );
  }

  // 커뮤니티가 살아 있고 요청자가 참여자인지 확인하고, 작성자 회원을 돌려준다.
  private async requireParticipantMember(
    communityId: string,
    memberId: string,
  ): Promise<Member> {
    await this.communitiesService.findOneOrThrow(communityId);

    const participation = await this.memberCommunitiesService.findOne(
      memberId,
      communityId,
    );
    if (!participation) {
      throw new GeneralException(CommunityChatErrorCode.NOT_PARTICIPANT);
    }

    return this.membersService.findOneOrThrow(memberId);
  }

  private async loadAuthorMap(
    rows: MemberCommunity[],
  ): Promise<Map<string, Member>> {
    const members = await this.membersService.findByIds(
      rows.map((row) => row.memberId),
    );
    return new Map(members.map((member) => [member.id, member]));
  }
}
