import { DebateProcessingStageStatus } from '../debate-chat/debate-chat.types';
import { JudgeTask } from './entities/judge-task.entity';

/**
 * 작업 전이 중 무엇을 프론트(debate.processing.stage)로 내보낼지 정하는 규칙.
 *
 * worker는 규칙을 묻기만 하고 판단은 작업 종류가 고른 구현이 갖는다 — 종류마다
 * 사용자에게 보여 줄 만한 전이가 다르기 때문이다. 로그는 규칙과 무관하게 항상 남는다.
 */
export interface StageReportingPolicy {
  allows(status: DebateProcessingStageStatus, task: JudgeTask): boolean;
}

// 기본값. 시작·재시도·완료·실패를 모두 알린다.
export const REPORT_ALL_STAGES: StageReportingPolicy = {
  allows: () => true,
};

/**
 * 첫 시도의 시작만 알린다. 실패해도 사용자가 할 수 있는 일이 없고 판정도 막지 않는
 * 작업(사실 검증)에 쓴다 — 재시도·최종 실패는 백엔드 로그에만 남는다.
 */
export const REPORT_FIRST_ATTEMPT_START_ONLY: StageReportingPolicy = {
  allows: (status, task) =>
    status === DebateProcessingStageStatus.STARTED && task.attempt <= 1,
};
