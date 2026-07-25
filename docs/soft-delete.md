# Soft Delete 규칙

`SoftDeletableEntity`를 상속한 엔티티의 삭제·조회 규칙을 정의합니다.

---

## 1. 구조

`src/common/entities/soft-deletable.entity.ts`의 추상 베이스를 상속하면 `status` 컬럼(`ResourceStatus`)이 합쳐집니다.

| 값 | 의미 |
|----|------|
| `NORMAL` | 정상 (조회 대상) |
| `DELETED` | 사용자 삭제 |
| `ADMIN_DELETED` | 관리자 삭제 |

상속 엔티티: `Member`, `Community`, `CommunityMessage`, `Debate`, `DebateSpeech`

`status`는 DB default와 별개로 필드 초기값도 `NORMAL`로 둡니다. DB default는 INSERT 시점에만 적용되므로, 아직 저장되지 않은 in-memory 객체가 `isDeleted()`에서 삭제로 판정되는 것을 막기 위함입니다.

TypeORM 네이티브 soft delete(`@DeleteDateColumn`)는 **사용하지 않습니다.** 삭제 주체(`DELETED`/`ADMIN_DELETED`) 구분을 `status` 한 컬럼으로 표현하기 위한 선택이며, 그 대가로 **프레임워크의 자동 제외 필터가 걸리지 않으므로 아래 조회 규칙을 직접 지켜야 합니다.**

---

## 2. 조회 규칙 (필수)

**이 엔티티들을 조회하는 모든 서비스는 `where`에 `status = NORMAL`을 넣어 soft-delete된 행을 제외합니다.** 조회 서비스가 새로 생기는 경우에도 동일하게 적용합니다.

```ts
// find 옵션
const member = await this.memberRepository.findOneBy({
  id: memberId,
  status: ResourceStatus.NORMAL,
});

// QueryBuilder
const query = this.communityRepository
  .createQueryBuilder('community')
  .where('community.status = :status', { status: ResourceStatus.NORMAL });
```

조인으로 끌어오는 다른 soft-delete 엔티티에도 같은 조건을 명시해야 합니다. 삭제분까지 포함해야 하는 예외적인 조회(관리자용 등)는 그 의도를 주석으로 남깁니다.

적용 예시: `src/members/members.service.ts`, `src/communities/communities.service.ts`

---

## 3. 삭제 규칙

레포지토리의 `remove`/`delete`(물리 삭제) 대신 엔티티의 `softDelete()`로 상태를 전환한 뒤 `save`합니다.

```ts
member.softDelete();      // DELETED
community.softDelete(true); // ADMIN_DELETED
```

삭제 여부 판정은 `isDeleted()`를 사용합니다. `status`를 직접 비교하지 마세요.

---

## 4. 테스트

Service/Repository 테스트에 **"soft-delete된 행이 조회 결과에서 빠진다"** 케이스를 포함합니다. 조회 필터 누락은 타입 검사로 잡히지 않으므로 테스트가 유일한 방어선입니다.
