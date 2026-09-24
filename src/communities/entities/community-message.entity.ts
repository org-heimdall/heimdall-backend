import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';
import { Community } from './community.entity';

/**
 * 계약의 CommunityMessage.messageType 문자열 집합. 값을 바꾸면 프론트 렌더링 분기가 깨진다.
 * 계약의 다른 열거형과 같이 SCREAMING_SNAKE_CASE로 쓴다.
 *
 * 사용자가 보낸 일반 메시지는 TEXT, 나머지는 서버가 만드는 시스템 메시지다. DEBATE_* 네 가지는
 * 프론트가 각각 다른 카드로 그리는 토론 알림이며 debate-outcomes 도메인이 만든다.
 */
export enum CommunityChatMessageType {
  TEXT = 'TEXT',
  SYSTEM = 'SYSTEM',
  OPINION_NOTICE = 'OPINION_NOTICE',
  DEBATE_STARTED = 'DEBATE_STARTED',
  DEBATE_RESULT = 'DEBATE_RESULT',
  DEBATE_FORFEIT = 'DEBATE_FORFEIT',
  DEBATE_TIMEOUT = 'DEBATE_TIMEOUT',
}

/**
 * 재전송 중복 방지 키의 unique 제약 이름. 자동 생성 이름(UQ_<해시>)은 코드에서 참조할 수 없어 명시한다.
 * 범위는 계약대로 (communityId, clientMessageId)다.
 */
export const COMMUNITY_MESSAGE_CLIENT_UNIQUE = 'UQ_community_message_client';

/**
 * 서버가 만드는 시스템 메시지의 멱등 키 형식({종류}:{debateId}, 예: debate_result:<uuid>).
 * 멱등 키 범위가 커뮤니티 단위라, 사용자가 이 형식의 키를 먼저 쓰면 시스템 메시지가 저장되지 못하고
 * 사용자 메시지가 알림으로 방송된다. 그래서 사용자 입력(DTO)은 이 형식을 거절한다.
 */
export const SYSTEM_CLIENT_MESSAGE_ID_PATTERN = /^debate_[a-z_]+:/;

@Entity('community_message')
@Unique(COMMUNITY_MESSAGE_CLIENT_UNIQUE, ['communityId', 'clientMessageId'])
export class CommunityMessage extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 작성자. 서버가 만드는 시스템 메시지는 작성자가 없어 null이다.
  @Column({ type: 'uuid', nullable: true })
  memberId: string | null;

  @Column({ type: 'uuid' })
  communityId: string;

  // 계약의 text. 길이 제한(2000)은 DTO가 검증한다.
  @Column({ type: 'varchar', nullable: true })
  body: string | null;

  // 클라이언트가 만드는 재전송 키. 같은 키로 다시 보내면 저장 없이 DUPLICATE로 응답한다.
  @Column({ type: 'varchar' })
  clientMessageId: string;

  @Column({
    type: 'enum',
    enum: CommunityChatMessageType,
    default: CommunityChatMessageType.TEXT,
  })
  messageType: CommunityChatMessageType;

  // 시스템 메시지가 가리키는 토론(일반 메시지는 null). 토론은 다른 도메인이라 ID로만 참조한다.
  @Column({ type: 'uuid', nullable: true })
  debateId: string | null;

  /**
   * 작성 시각. @CreateDateColumn 대신 앱에서 만든 값을 넣는다 —
   * insert 결과를 재조회하지 않고 그대로 ack·브로드캐스트에 실어야 하기 때문이다.
   * 컬럼 default는 이 경로를 타지 않는 삽입(시드 등)을 위한 안전장치다.
   */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  // nullable이어야 LEFT JOIN이 된다 — TypeORM 1.0은 non-nullable 관계를 INNER JOIN으로 읽어
  // 작성자가 없는 시스템 메시지가 조회에서 조용히 빠진다.
  @ManyToOne(() => Member, { nullable: true })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @ManyToOne(() => Community, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community: Community;

  // 메시지 작성 팩토리. id·createdAt을 앱에서 만들어 저장 전에 응답 DTO를 만들 수 있게 한다.
  static write(params: {
    id: string;
    communityId: string;
    memberId: string;
    clientMessageId: string;
    text: string;
    createdAt: Date;
    messageType?: CommunityChatMessageType;
    debateId?: string | null;
  }): CommunityMessage {
    const message = new CommunityMessage();
    message.id = params.id;
    message.communityId = params.communityId;
    message.memberId = params.memberId;
    message.clientMessageId = params.clientMessageId;
    message.body = params.text;
    message.createdAt = params.createdAt;
    message.messageType = params.messageType ?? CommunityChatMessageType.TEXT;
    message.debateId = params.debateId ?? null;
    return message;
  }

  // 서버가 만드는 시스템 메시지 팩토리. 작성자가 없고, 멱등 키(clientMessageId)는 호출자가 결정적으로 만든다.
  static system(params: {
    id: string;
    communityId: string;
    debateId: string;
    messageType: CommunityChatMessageType;
    clientMessageId: string;
    text: string;
    createdAt: Date;
  }): CommunityMessage {
    const message = new CommunityMessage();
    message.id = params.id;
    message.communityId = params.communityId;
    message.memberId = null;
    message.clientMessageId = params.clientMessageId;
    message.body = params.text;
    message.createdAt = params.createdAt;
    message.messageType = params.messageType;
    message.debateId = params.debateId;
    return message;
  }
}
