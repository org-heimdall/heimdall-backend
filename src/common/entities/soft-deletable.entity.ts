import { Column } from 'typeorm';
import { ResourceStatus } from './resource-status.enum';

// soft-delete 대상 엔티티가 상속하는 추상 베이스. status 컬럼과 상태 전환 헬퍼를 공유한다.
// @Entity가 아니므로 테이블로 매핑되지 않고, 상속한 엔티티에 status 컬럼만 합쳐진다.
export abstract class SoftDeletableEntity {
  // 조회 컨벤션: 이 엔티티를 조회하는 모든 서비스는 where에 status=NORMAL을 넣어
  // soft-delete된 행을 제외해야 한다(예: members/communities 서비스). debate/
  // debate-speech/community-message는 아직 조회 서비스가 없으므로, 향후 조회 구현 시
  // 동일하게 NORMAL 필터를 적용한다.
  // DB default는 INSERT 시점에만 적용되므로, 아직 저장되지 않은 in-memory 객체가
  // isDeleted()에서 삭제로 판정되지 않도록 필드 초기값도 NORMAL로 맞춘다.
  @Column({
    type: 'enum',
    enum: ResourceStatus,
    default: ResourceStatus.NORMAL,
  })
  status: ResourceStatus = ResourceStatus.NORMAL;

  // 상태를 삭제로 전환한다(관리자 삭제면 ADMIN_DELETED, 일반이면 DELETED).
  softDelete(byAdmin = false): void {
    this.status = byAdmin
      ? ResourceStatus.ADMIN_DELETED
      : ResourceStatus.DELETED;
  }

  isDeleted(): boolean {
    return this.status !== ResourceStatus.NORMAL;
  }
}
