import { Injectable } from '@nestjs/common';
import {
  DeadlineHandler,
  DeadlineScheduler,
} from '../common/scheduling/deadline-scheduler';

export type DebateTurnTimeoutHandler = DeadlineHandler;

/**
 * 토론별 턴 만료 타이머 등록소. 동작은 공통 DeadlineScheduler 그대로이고, 이 클래스는
 * "토론 턴 만료"라는 용도의 DI 토큰만 따로 가진다(초대 만료 타이머와 섞이지 않게 한다).
 *
 * 중복 발화가 있어도 실제 판정은 토론 단위 락 안의 멱등 연산(`DebateChatState.expireTurn`)이라
 * 결과는 한 번만 반영된다.
 */
@Injectable()
export class DebateTurnTimeoutScheduler extends DeadlineScheduler {}
