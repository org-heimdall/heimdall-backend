import { Column } from 'typeorm';
import { ResourceStatus } from './resource-status.enum';

// soft-delete 대상 엔티티가 상속하는 추상 베이스. status 컬럼과 상태 전환 헬퍼를 공유한다.
// @Entity가 아니므로 테이블로 매핑되지 않고, 상속한 엔티티에 status 컬럼만 합쳐진다.
// 조회·삭제 규칙은 docs/soft-delete.md 참고.
export abstract class SoftDeletableEntity {
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
