# Repository Guidelines

## **CRITICAL**

- 구현 세부가 불확실하면 **항상 개발자에게 먼저 물어보세요.**
- 최대한 **확장성** 있고 유지보수하기 쉬운 아키텍처와 코드를 설계해주세요.
- OOP(객체지향)와 SOLID 원칙을 준수하여 책임을 분리하고 확장성 좋은 코드를 작성해주세요.
- 재사용할 수 있는 메서드/코드가 있으면 새로 만들지 말고 재사용해주세요.
- 클래스 단위 주석은 달지 마세요. 메서드에만 간결한 `//` 주석을 작성하고, 복잡한 로직이면 상세히 설명해주세요.
- Testable한 코드를 작성해주세요. 테스트 코드는 **Service와 Repository 레이어만** 작성합니다.
- 관련 로직이 삭제되는 것이 아닌 이상, 기존 테스트 코드를 삭제하지 마세요.
- REST 엔드포인트 추가 시 Swagger 데코레이터(`@ApiOperation` 등)를 함께 작성해주세요.
- DTO는 `class` + `class-validator`로 정의하고, 형식 검증은 DTO에서 처리해주세요.
- 에러 처리는 아래 **에러 처리** 섹션의 규칙을 따르세요.
- `SoftDeletableEntity` 상속 엔티티는 조회 시 `status = NORMAL` 필터가 **필수**입니다(자동 적용 안 됨). 규칙은 [`docs/soft-delete.md`](docs/soft-delete.md).
- 전역 인증 가드는 **옵셔널**입니다(토큰 없으면 통과). 사용자 컨텍스트가 필요한 라우트는 반드시 `@CurrentMember()`로 memberId를 받으세요 — 이 데코레이터를 쓰는 것이 곧 "인증 필수" 선언이며, 빠뜨리면 라우트가 조용히 공개됩니다.

## TypeORM 1.0 — 코드 작성 전 필독

- 이 프로젝트는 **TypeORM `^1.0.0`** (2026-05-19 릴리스, 약 5년 만의 첫 메이저)을 사용합니다.
- **주의: 다수의 LLM/에이전트는 학습 데이터 컷오프가 이 릴리스보다 앞서 있어 TypeORM을 여전히 pre-1.0(v0.3) API로 기억합니다.** v1.0은 `Connection`→`DataSource` 전환, 전역 `createConnection`/`getConnection`/`getRepository`/`getManager` 제거, find 옵션 객체화(`relations: { profile: true }`), 레포지토리 메서드 통합(`findOneBy`/`findBy`/`exists`), high-level API(`find*`, Repository/Manager mutation, `queryBuilder.setFindOptions()`)의 `where`에서 `null`/`undefined` throw(QueryBuilder `.where()`/`.andWhere()`/`.orWhere()`는 제외·그대로 통과), 비-nullable 관계의 `INNER JOIN`화, Node 20+/ES2023, `mysql2`·`better-sqlite3` 전용화 등 **다수의 브레이킹 체인지**를 포함합니다.
- **엔티티·레포지토리·DataSource·마이그레이션·쿼리빌더 등 TypeORM 관련 코드를 작성/수정하기 전에 반드시 [`docs/typeorm.md`](docs/typeorm.md)를 먼저 읽고, v1.0 API 기준으로 작업하세요.** 기억에 의존해 v0.3 API를 사용하지 마세요.

## 에러 처리

- 비즈니스 에러는 Nest 기본 예외(`NotFoundException` 등) 대신 **`GeneralException` + 도메인별 에러 코드 카탈로그**로 던지세요. 카탈로그는 `src/<domain>/exceptions/<domain>-error-code.ts`에 `as const satisfies Record<string, AppError>`로 정의하고(공통은 `src/common/exceptions/error-code.ts`), 응답 변환은 전역 `AllExceptionsFilter`가 담당합니다(응답 형식: `ProblemDetail`). 예시: `src/members/exceptions/member-error-code.ts`
- 카탈로그의 `detail`은 유저에게 그대로 노출되는 **한국어 문장**이며 에러 문구의 단일 출처입니다. 컨트롤러나 다른 곳에서 문구를 재정의하지 마세요.
- `cause` 옵션은 **원인 예외를 도메인 사실로 완전히 환원하지 못한 채 감쌀 때만** 붙이세요(예: LLM SDK·외부 API의 예상 밖 실패). catch에서 원인을 검사해 분류를 끝낸 기대 가능한 에러(예: unique 위반 → `EMAIL_ALREADY_EXISTS`)는 cause 없이 던집니다. 필터가 cause를 WARN으로 로깅하므로, 정상 비즈니스 흐름이 경고 로그를 만들면 안 됩니다.
- Swagger 에러 문서화는 `@ApiErrorResponses(카탈로그항목, ...)` 하나로만 하세요(`src/common/exceptions/api-error-responses.decorator.ts`). 수기 `@ApiConflictResponse` 등은 금지 — status·문구가 카탈로그에서 파생되어 불일치가 생길 수 없습니다. 문서화 대상은 **프론트가 분기해야 하는 도메인 에러만**이며, 검증 400·예상 못 한 500은 전 엔드포인트 공통이므로 개별 문서화하지 않습니다.

## Project Structure & Module Organization

NestJS 도메인 모듈 구조입니다.

- `src/<domain>/`: 도메인 모듈 (`controller`, `service`, `module`, `gateway`, `dto`, `entities`). 실시간(소켓) 기능 등은 도메인 모듈 내 하위 디렉토리(예: `src/debates/room/`)로 응집할 수 있습니다.
- `src/common/`: 전역 공통 (필터, 가드, 데코레이터, 공통 DTO).
- `docs/`: 코드 컨벤션·소켓 명세·협업 가이드.
- 도메인 간 참조는 Module `imports`/`exports`를 통해서만. 엔티티는 소유 도메인에만 두고 다른 도메인은 ID로 참조.

## Build, Test, and Development Commands

- `npm run start:dev`: 개발 서버(watch) 실행.
- `npm run build`: 빌드.
- `npm test`: 전체 테스트.
- `npm run lint` / `npm run format`: ESLint 자동수정 / Prettier 포맷.

## Coding Style & Naming Conventions

- TypeScript, NestJS 11, 2-space indent, Prettier(`singleQuote`, `trailingComma: all`).
- 파일 `kebab-case`(+역할 접미사), 클래스 `PascalCase`, DTO는 `Create*Dto`/`*Dto`.
- Socket 이벤트는 `snake_case`, 명세와 1:1 일치.

## Testing Guidelines

- Jest(`*.spec.ts`), Service/Repository 레이어 중심. Controller/Gateway 단위 테스트는 생략.

## Commit & Pull Request Guidelines

- 커밋: `type: 한글 설명 (#N)` (`feat`/`fix`/`hotfix`/`refactor`/`test`/`docs`/`chore`).
- PR: 템플릿 사용, `close #N`으로 이슈 연결. 자세한 플로우는 `docs/collaboration.md`.

## Configuration & Secrets

- `.env`는 git-ignored. DB/JWT/외부 API 키는 로컬 환경변수로 관리.
