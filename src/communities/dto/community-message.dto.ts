import { ApiProperty } from '@nestjs/swagger';
import { Member } from '../../members/entities/member.entity';
import {
  CommunityChatMessageType,
  CommunityMessage,
} from '../entities/community-message.entity';

// 계약의 CommunityMessage. WS(message.created/ack)와 REST(GET·POST /messages)가 같이 쓴다.
export class CommunityMessageDto {
  @ApiProperty({ example: '9a5f9f5e-1f5a-4f1e-9a1d-6f2a3b4c5d6e' })
  id: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  communityId: string;

  @ApiProperty({
    example: 'c1f0a2b3-4d5e-6f70-8192-a3b4c5d6e7f8',
    description: '클라이언트가 만드는 재전송 중복 방지 키',
  })
  clientMessageId: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  authorId: string;

  @ApiProperty({ example: '헤임달' })
  authorName: string;

  @ApiProperty({ example: '저는 이 주제에 찬성합니다.' })
  text: string;

  @ApiProperty({
    enum: CommunityChatMessageType,
    example: CommunityChatMessageType.TEXT,
  })
  messageType: CommunityChatMessageType;

  @ApiProperty({
    example: null,
    nullable: true,
    description: '시스템 메시지가 가리키는 토론 id',
  })
  debateId: string | null;

  @ApiProperty({ example: '2026-09-18T12:00:00.000Z' })
  createdAt: string;

  static from(message: CommunityMessage, author: Member): CommunityMessageDto {
    return {
      id: message.id,
      communityId: message.communityId,
      clientMessageId: message.clientMessageId,
      authorId: message.memberId,
      authorName: author.nickname,
      text: message.body ?? '',
      messageType: message.messageType,
      debateId: message.debateId,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
