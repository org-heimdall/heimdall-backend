import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { JudgeTaskKind, JudgeTaskStatus } from '../judge.types';

/**
 * 파이프라인 작업 1건. 이 테이블이 곧 stage 이력이며 중복 실행을 막는 단일 출처다.
 *
 * 같은 대상의 작업은 (kind, target_id) unique로 한 행만 존재하고, 선점은 조건부 UPDATE로 한다.
 * target_id는 종류마다 가리키는 대상이 다르다:
 * ANALYZER → 확정 턴(debate_message.id), FACT_CHECK → 논증 컴포넌트, JUDGE → 토론 자체(debate.id).
 * 세 대상이 모두 uuid라 한 컬럼으로 묶었고, 덕분에 nullable 컬럼의 unique(NULL은 서로 달라
 * 중복을 막지 못한다) 문제도 생기지 않는다.
 */
@Index(['kind', 'targetId'], { unique: true })
@Index(['debateId', 'kind', 'status'])
@Entity('debate_judge_task')
export class JudgeTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  debateId: string;

  @Column({ type: 'enum', enum: JudgeTaskKind })
  kind: JudgeTaskKind;

  @Column({ type: 'uuid' })
  targetId: string;

  @Column({
    type: 'enum',
    enum: JudgeTaskStatus,
    default: JudgeTaskStatus.PENDING,
  })
  status: JudgeTaskStatus;

  // 지금까지의 시도 횟수. 선점할 때마다 1씩 오르며 stage 이벤트의 attempt가 된다(J6).
  @Column({ type: 'int', default: 0 })
  attempt: number;

  // 이 값에 도달한 시도가 실패하면 재시도 없이 FAILED로 끝난다.
  @Column({ type: 'int' })
  maxAttempts: number;

  // 현재 선점자(이번 시도)의 식별자. 결과 저장은 이 값이 일치할 때만 반영한다.
  @Column({ type: 'uuid', nullable: true })
  requestId: string | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /**
   * 마지막 상태 전이 시각. Judge 재시도 쿨다운(J2)의 기준이다.
   *
   * 상태 전이는 전부 조건부 UPDATE(QueryBuilder)로 일어나므로 @UpdateDateColumn 대신
   * 일반 컬럼으로 두고 전이마다 now()를 직접 넣는다 — 갱신 시점을 SQL 한 곳에서 읽을 수 있다.
   */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
