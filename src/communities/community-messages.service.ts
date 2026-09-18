import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { CommunityMessage } from './entities/community-message.entity';

// 계약 ack의 status. 같은 clientMessageId 재전송이면 저장 없이 기존 메시지를 돌려준다.
export type CommunityMessageStoreStatus = 'STORED' | 'DUPLICATE';

export interface CommunityMessageStoreResult {
  status: CommunityMessageStoreStatus;
  message: CommunityMessage;
}

// 커뮤니티 채팅 메시지 저장소. WS replay와 REST(GET/POST /messages)가 같은 메서드를 쓴다.
@Injectable()
export class CommunityMessagesService {
  constructor(
    @InjectRepository(CommunityMessage)
    private readonly communityMessageRepository: Repository<CommunityMessage>,
  ) {}

  // 최근 메시지를 오래된 순으로 반환한다. before를 주면 그 시각 이전만 읽는다(과거 페이지네이션).
  // 작성자(member)는 탈퇴해도 메시지 이력이 남아야 하므로 member에는 status 필터를 걸지 않는다
  // (docs/soft-delete.md의 "의도를 주석으로 남기는" 예외). 메시지 자신은 NORMAL만 읽는다.
  async findRecent(
    communityId: string,
    limit = 50,
    before?: Date,
  ): Promise<CommunityMessage[]> {
    const rows = await this.communityMessageRepository.find({
      where: {
        communityId,
        status: ResourceStatus.NORMAL,
        ...(before ? { createdAt: LessThan(before) } : {}),
      },
      relations: { member: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.reverse();
  }

  /**
   * 메시지를 저장한다. (communityId, clientMessageId) 유니크 제약을 멱등 키로 써서
   * 재전송이면 아무것도 넣지 않고 DUPLICATE로 알린다 — 조회 후 삽입으로는 동시 재전송이
   * 둘 다 "없음"을 보는 창을 막을 수 없다. 예외 흐름을 타지 않으므로 cause 경고 로그도 생기지 않는다.
   */
  async create(
    message: CommunityMessage,
  ): Promise<CommunityMessageStoreResult> {
    const result = await this.communityMessageRepository
      .createQueryBuilder()
      .insert()
      .values(message)
      .orIgnore()
      .execute();

    if ((result.raw as unknown[]).length > 0) {
      return { status: 'STORED', message };
    }

    const existing = await this.communityMessageRepository.findOne({
      where: {
        communityId: message.communityId,
        clientMessageId: message.clientMessageId,
        status: ResourceStatus.NORMAL,
      },
      relations: { member: true },
    });
    // 삭제된 메시지도 키를 계속 점유하므로 기존 행을 못 읽을 수 있다.
    // 그때는 저장하지 않았다는 사실만 알리면 되므로 보낸 메시지를 그대로 돌려준다.
    return { status: 'DUPLICATE', message: existing ?? message };
  }
}
