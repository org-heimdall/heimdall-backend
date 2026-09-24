import { randomUUID } from 'node:crypto';
import {
  CommunityChatMessageType,
  CommunityMessage,
} from '../communities/entities/community-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import { DebateOutcome, DebateOutcomeKind } from './debate-outcome.types';

// 종류별 시스템 메시지의 모양. 멱등 키 접두사는 요구사항의 결정적 clientMessageId 형식과 1:1이다.
interface SystemMessageSpec {
  messageType: CommunityChatMessageType;
  clientMessagePrefix: string;
  text: (debate: Debate, outcome: DebateOutcome) => string;
}

// 토론 편의 표시 이름. 이름은 토론 생성 시 복사해 둔 값이라 회원이 이름을 바꿔도 알림은 흔들리지 않는다.
function nicknameOf(debate: Debate, memberId: string | null): string {
  if (memberId === debate.hostId) {
    return debate.hostNickname;
  }
  return debate.opponentNickname ?? '';
}

// 기권한 쪽 = 승자가 아닌 발언자.
function loserOf(debate: Debate, winnerId: string | null): string | null {
  return winnerId === debate.hostId ? debate.opponentId : debate.hostId;
}

/**
 * 판정 실패는 알리지 않는다(요구사항의 시스템 메시지 4종에 없다).
 * 이 표가 문구·메시지 종류·멱등 키의 단일 출처다.
 */
const SYSTEM_MESSAGE_SPECS: Partial<
  Record<DebateOutcomeKind, SystemMessageSpec>
> = {
  [DebateOutcomeKind.STARTED]: {
    messageType: CommunityChatMessageType.DEBATE_STARTED,
    clientMessagePrefix: 'debate_started',
    text: (debate) =>
      `${debate.hostNickname} vs ${debate.opponentNickname ?? ''} 토론이 시작되었습니다.`,
  },
  [DebateOutcomeKind.RESULT]: {
    messageType: CommunityChatMessageType.DEBATE_RESULT,
    clientMessagePrefix: 'debate_result',
    text: (debate, { winnerId }) =>
      winnerId === null
        ? '토론 판정이 완료되었습니다. 무승부입니다.'
        : `토론 판정이 완료되었습니다. 승자: ${nicknameOf(debate, winnerId)}`,
  },
  [DebateOutcomeKind.FORFEIT]: {
    messageType: CommunityChatMessageType.DEBATE_FORFEIT,
    clientMessagePrefix: 'debate_forfeit',
    text: (debate, { winnerId }) =>
      `${nicknameOf(debate, loserOf(debate, winnerId))}님이 기권하여 토론이 종료되었습니다.`,
  },
  [DebateOutcomeKind.TOTAL_TIMEOUT]: {
    messageType: CommunityChatMessageType.DEBATE_TIMEOUT,
    clientMessagePrefix: 'debate_timeout',
    text: () => '발언 시간이 모두 지나 토론이 종료되었습니다.',
  },
};

export class DebateSystemMessageFactory {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly generateId: () => string = randomUUID,
  ) {}

  // 이 종류의 결정적 멱등 키. 알리지 않는 종류면 null.
  clientMessageIdOf(outcome: DebateOutcome): string | null {
    const spec = SYSTEM_MESSAGE_SPECS[outcome.kind];
    return spec ? `${spec.clientMessagePrefix}:${outcome.debateId}` : null;
  }

  // 저장할 시스템 메시지. 알리지 않는 종류면 null.
  create(outcome: DebateOutcome, debate: Debate): CommunityMessage | null {
    const spec = SYSTEM_MESSAGE_SPECS[outcome.kind];
    const clientMessageId = this.clientMessageIdOf(outcome);
    if (!spec || clientMessageId === null) {
      return null;
    }
    return CommunityMessage.system({
      id: this.generateId(),
      communityId: outcome.communityId,
      debateId: outcome.debateId,
      messageType: spec.messageType,
      clientMessageId,
      text: spec.text(debate, outcome),
      createdAt: this.now(),
    });
  }
}
