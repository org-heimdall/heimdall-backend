import { Module } from '@nestjs/common';
import { CommunityChatPublisher } from './community-chat.publisher';

/**
 * community room 레지스트리와 방 대상 이벤트 발행만 담은 모듈.
 *
 * 커뮤니티 채팅뿐 아니라 토론 채팅(debate.ended)도 이 방에 이벤트를 보내므로,
 * 토론 채팅 모듈이 커뮤니티 채팅 모듈 전체를 끌어오지 않도록 발행자만 아래로 내렸다
 * (DebateChatPublisherModule과 같은 이유).
 */
@Module({
  providers: [CommunityChatPublisher],
  exports: [CommunityChatPublisher],
})
export class CommunityChatPublisherModule {}
