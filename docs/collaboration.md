# 협업 가이드

브랜치 전략, 커밋/PR 규칙을 정의합니다.

---

## 1. 브랜치 전략 (2-tier)

```
feat/#N-*  ──(squash PR)──▶  develop  ──(merge PR)──▶  main
  작업 브랜치                  통합 · CI               배포 · CD
```

| 브랜치 | 역할 | 자동화 |
|--------|------|--------|
| `main` | 배포(프로덕션) 브랜치 | push 시 **CD**(배포) 트리거 |
| `develop` | 통합 브랜치 | push/PR 시 **CI**(lint·test·build) 트리거 |
| `feat/#N-설명`, `fix/#N-설명` | 작업 브랜치 | 이슈 단위로 생성 |

- **작고 잦은 PR**을 지향 (기능/이슈 단위)

---

## 2. 이슈 → 브랜치 → PR 플로우

1. **이슈 생성**: 템플릿(`[FEAT]`/`[FIX]`/`[REFACTOR]`/`[TEST]`/`[CHORE]`) 사용, 라벨 자동 부여
2. **브랜치 생성**: `feat/#12-join-room` 처럼 이슈 번호 포함
3. **작업 & 커밋**: 커밋 컨벤션 준수
4. **PR 생성**: PR 템플릿 작성, `close #12`로 이슈 연결
5. **리뷰**: CodeRabbit AI 자동 리뷰 + 상대방 1인 리뷰
6. **머지**: `develop`로 squash merge
7. **배포**: 안정화되면 `develop` → `main` PR → 자동 배포

---

## 3. 커밋 컨벤션

형식: `type: 한글 설명 (#이슈번호)`

```
feat: 토론방 턴 상태머신 구현 (#23)
fix: 소켓 재연결 시 room 재입장 누락 (#31)
```

| type | 용도 |
|------|------|
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `hotfix` | 배포 후 긴급 수정 |
| `refactor` | 동작 변화 없는 구조 개선 |
| `test` | 테스트 추가/수정 |
| `docs` | 문서 |
| `chore` | 설정·빌드·잡일 |

---

## 4. 코드 리뷰

- **CodeRabbit**(`.coderabbit.yaml`): PR마다 한국어로 자동 리뷰. 2인 팀의 부족한 리뷰 인력을 보완.
- **사람 리뷰**: 상대방이 approve해야 머지. 실시간/인증 등 위험한 변경은 반드시 리뷰.
- 리뷰 기준은 `docs/code-convention.md` + `AGENTS.md`.

