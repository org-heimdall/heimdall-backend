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
- Socket 이벤트 추가/변경 시 `docs/socket-api.md` 명세를 반드시 갱신해주세요.
- DTO는 `class` + `class-validator`로 정의하고, 형식 검증은 DTO에서 처리해주세요.

## Project Structure & Module Organization
NestJS 도메인 모듈 구조입니다.

- `src/<domain>/`: 도메인 모듈 (`controller`, `service`, `module`, `gateway`, `dto`, `entities`).
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
- 자세한 내용은 `docs/code-convention.md` 참고.

## Testing Guidelines
- Jest(`*.spec.ts`), Service/Repository 레이어 중심. Controller/Gateway 단위 테스트는 생략.

## Commit & Pull Request Guidelines
- 커밋: `type: 한글 설명 (#N)` (`feat`/`fix`/`hotfix`/`refactor`/`test`/`docs`/`chore`).
- PR: 템플릿 사용, `close #N`으로 이슈 연결. 자세한 플로우는 `docs/collaboration.md`.

## Configuration & Secrets
- `.env`는 git-ignored. DB/JWT/외부 API 키는 로컬 환경변수로 관리.
