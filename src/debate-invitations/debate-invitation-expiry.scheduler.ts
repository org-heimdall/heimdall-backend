import { Injectable } from '@nestjs/common';
import { DeadlineScheduler } from '../common/scheduling/deadline-scheduler';

/**
 * 초대별 응답 마감 타이머 등록소. 동작은 공통 DeadlineScheduler 그대로이고, 이 클래스는
 * "초대 만료"라는 용도의 DI 토큰만 따로 가진다.
 *
 * 다중 인스턴스에서 중복 발화하더라도 만료 판정은 조건부 UPDATE라 한 번만 성공한다.
 */
@Injectable()
export class DebateInvitationExpiryScheduler extends DeadlineScheduler {}
