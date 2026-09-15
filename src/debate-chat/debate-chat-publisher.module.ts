import { Module } from '@nestjs/common';
import { DebateChatPublisher } from './debate-chat.publisher';

/**
 * debate room 레지스트리와 방 대상 이벤트 발행만 담은 모듈.
 *
 * 채팅(DebateChatModule)과 처리 파이프라인(JudgeModule)이 둘 다 방에 이벤트를 보내는데,
 * 채팅이 파이프라인을 호출하므로(onTurnFinalized) 발행자를 채팅 모듈에 두면 두 모듈이 서로를
 * 참조하게 된다. 공통 의존을 아래로 내려 순환을 없앤다.
 */
@Module({
  providers: [DebateChatPublisher],
  exports: [DebateChatPublisher],
})
export class DebateChatPublisherModule {}
