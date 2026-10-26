# SellerAudit Supabase development integration

## Purpose

SellerAudit은 두 실행 모드를 지원한다. 기본 `mock` 모드는 기존 브라우저 데모와 회귀 테스트에 사용하고, `supabase` 모드는 별도 Development Supabase 프로젝트에서 이메일 로그인, ACTIVE Workspace 멤버십, 역할 기반 UI와 중앙 `SellerRepository`를 검증한다.

이 통합은 Development와 Internal Pilot 준비 단계다. 프로젝트 소유자는 2026-10-25 SellerAudit 전용 Development 프로젝트에서 기존 5개 Migration과 Auth, Data API, RLS, Import RPC 인수 검증을 완료했다고 제공했다. 프로젝트와 검증 범위는 [Remote Acceptance](SUPABASE_REMOTE_ACCEPTANCE.md)에 기록한다.

```text
LOCAL IMPLEMENTATION = GO
REMOTE 5D SUPABASE ACCEPTANCE = GO (PROJECT OWNER REPORTED, 2026-10-25)
REMOTE 5E ACCEPTANCE = HOLD (DB CONTRACT PASS, LIVE AUTH/BROWSER PARTIAL)
```

## Environment Variables

[`.env.example`](../.env.example)은 값이 없는 다음 계약만 제공한다.

```dotenv
VITE_DATA_SOURCE=mock
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

| 변수 | 값 | 동작 |
| --- | --- | --- |
| `VITE_DATA_SOURCE` | `mock` 또는 생략 | MockRepository와 브라우저 `localStorage` 사용 |
| `VITE_DATA_SOURCE` | `supabase` | Supabase Auth와 SupabaseSellerRepository 사용 |
| `VITE_SUPABASE_URL` | Development 프로젝트 URL | `supabase` 모드에서 필수 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Development 프로젝트 publishable key | `supabase` 모드에서 필수 |

로컬 값은 Git에서 제외된 `.env.local`에 둔다. 값을 변경한 뒤 Vite 개발 서버를 다시 시작한다. 브라우저 빌드에 포함되는 `VITE_` 변수에는 `service_role`, secret key, Auth admin key, DB password 또는 JWT secret을 넣지 않는다.

`supabase` 모드에서 URL이나 publishable key가 없으면 앱은 설정 오류를 표시하고 Mock 데이터로 전환하지 않는다. Secret key 접두사인 `sb_secret_`, legacy JWT의 `service_role` claim, 비밀값을 암시하는 `VITE_` 변수명도 거부한다. URL은 HTTPS를 사용하며 `localhost`와 `127.0.0.1`의 로컬 개발 주소만 HTTP를 허용한다.

## Mock vs Supabase Mode

| 구분 | Mock | Supabase |
| --- | --- | --- |
| 목적 | UI 개발, 데모, 기본 E2E | 중앙 Persistence와 Auth 개발 검증 |
| 인증 | 없음 | 이메일과 비밀번호 |
| 업무 데이터 | 고정 Seed + `seller-audit:v0.1:data` | Development PostgreSQL |
| Workspace 선택 | 고정 데모 Workspace | ACTIVE 멤버십 중 선택 |
| 쓰기 | MockRepository가 `localStorage` 갱신 | 공개 RPC 호출 후 중앙 데이터 재조회; Master Dry-run 검증 결과 저장 |
| 설정 누락 | 정상 실행 | 명시적 설정 오류 |

Supabase 모드는 업무 데이터를 `localStorage`에 저장하지 않는다. 선택한 Workspace ID만 사용자별 키 `seller-audit:selected-workspace:<user-id>`에 편의 설정으로 보관한다. 권한은 이 값에서 판단하지 않고 매번 DB의 현재 멤버십과 RLS/RPC에서 검사한다.

## Authentication Flow

Supabase 모드의 부트스트랩 순서는 다음과 같다.

```text
환경 설정 확인
→ singleton Supabase client
→ getSession
→ getUser
→ ACTIVE workspace_members 조회
→ Workspace 선택
→ Workspace 범위 Repository 생성
→ 업무 데이터 로드
```

초기 확인 중에는 전용 Loading 화면을 표시한다. 세션이 없으면 이메일·비밀번호 Login 화면만 표시하고 회원가입 UI는 제공하지 않는다. 잘못된 로그인은 내부 Auth 세부 정보를 노출하지 않는 공통 오류로 처리한다.

`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED` 이벤트를 구독하며 React unmount 시 listener를 해제한다. 로그아웃은 현재 브라우저의 Supabase 세션을 종료하고 먼저 업무 화면을 제거한다. Session과 token을 별도 앱 저장소에 복사하거나 Console에 출력하지 않는다.

Public Sign Up은 Internal Pilot 정책상 Development 프로젝트에서도 꺼야 한다. 이메일 확인 정책은 Dashboard의 실제 설정을 확인해 테스트 계정 프로비저닝 절차와 맞춘다. 비밀번호 재설정은 redirect URL, 이메일 Template과 SMTP 정책이 5D 인수 범위에 포함되지 않아 **DEFER** 상태다.

## Workspace Flow

로그인한 Auth User ID로 `workspace_members`의 `status = 'ACTIVE'` 행을 조회한 뒤 해당 `workspaces`의 이름을 읽는다. 접근 가능한 Workspace가 없으면 업무 화면을 차단하고 로그아웃만 제공한다.

Workspace가 하나면 자동 선택한다. 둘 이상이면 저장된 사용자별 선택값을 우선하고, 값이 없거나 더 이상 유효하지 않으면 이름순 첫 Workspace를 선택한다. 전환할 때 현재 데이터를 Loading 상태로 제거한 뒤 새 Workspace 전용 Repository와 데이터를 생성하므로 이전 Workspace 데이터가 화면에 남지 않는다.

상단 새로고침은 멤버십과 역할을 다시 조회한다. Realtime 역할 갱신은 아직 없지만 DB 요청은 RLS/RPC가 현재 `ACTIVE` 멤버십을 다시 검사한다.

## Role Model

| Role | 조회 | Offer Mapping | Audit 상태 변경 | Master Dry-run / snapshot 저장 | Candidate / Issue review |
| --- | :---: | :---: | :---: | :---: | :---: |
| `ADMIN` | 허용 | 허용 | 허용 | 허용 | 허용 |
| `EDITOR` | 허용 | 허용 | 허용 | 허용 | 읽기 전용 |
| `VIEWER` | Batch metadata만 | 거부 | 거부 | 거부 | 거부 |

VIEWER의 Mapping과 Audit 화면은 읽기 전용으로 표시한다. Master Dry-run 메뉴를 숨기고 직접 `#/import/master`로 접근해도 실행을 차단한다. EDITOR는 저장된 Candidate와 Issue를 조회하지만 review control을 사용할 수 없다. UI guard는 사용성 경계이고 실제 쓰기 권한은 trusted RPC가 현재 ACTIVE membership과 역할을 다시 확인한다.

Role과 Status를 JWT의 사용자 metadata에서 읽지 않는다. `workspace_members`가 현재 권한의 기준이며 `INVITED`와 `DISABLED`는 업무 데이터에 접근할 수 없다.

## Repository Architecture

React 업무 화면은 기존 `SellerRepository` 계약만 사용한다.

```text
App
→ data source config
→ Supabase Auth / Workspace bootstrap
→ SellerRepository
   ├─ MockRepository
   └─ SupabaseSellerRepository
→ Feature screens
```

`SupabaseSellerRepository`는 선택 Workspace의 다음 데이터를 읽는다.

- Workspace
- Products
- SKUs
- Product Components(BOM)
- Channels
- Channel Listings
- Channel Offers
- Aliases
- Audit Issues

Repository가 각 업무 테이블을 ID 오름차순, 500행 단위로 끝까지 읽은 뒤 DB의 `snake_case` 행을 앱의 `camelCase` Domain으로 변환한다. 문자열, enum, timestamp, nullable 값, 양수 수량과 KRW 금액 범위를 검증하고 Workspace ID 및 테이블 간 참조가 선택 Workspace와 일치하는지 확인한다. Workspace는 존재하지만 업무 행이 0개인 경우는 정상적인 빈 상태다.

`mapOffer`는 Offer와 Product가 선택 Workspace에 있는지 먼저 확인하고 `map_offer` RPC를 호출한다. `updateIssueStatus`도 Issue 범위와 허용 상태를 확인한 뒤 `update_issue_status` RPC를 호출한다. 성공 후 전체 Workspace 데이터를 다시 읽어 서버 상태를 반영한다. Component에서 `supabase.from(...)` 또는 `supabase.rpc(...)`를 직접 호출하지 않는다.

Master Import persistence는 Core 업무 데이터용 `SellerRepository`에 섞지 않고 별도 `ImportPersistence` contract로 제공한다. 저장, Batch/Raw/Candidate/Issue 조회와 Candidate/Issue review가 이 경계에 모인다. 세부 계약은 [Master Import persistence](data/MASTER_IMPORT_PERSISTENCE.md)와 [Candidate Review](data/IMPORT_CANDIDATE_REVIEW.md)를 따른다.

## Supabase Development Setup

1. 운영 프로젝트와 분리된 SellerAudit Development 프로젝트를 준비한다.
2. Dashboard에서 Project URL과 publishable key를 확인한다. Secret key는 복사하지 않는다.
3. Authentication의 Email/Password provider를 활성화하고 Public Sign Up을 끈다.
4. Email confirmation 정책을 정하고 테스트 계정 생성 방식과 일치시키며, Production 정책으로 간주하지 않는다.
5. 새 Migration을 적용할 때 아래 절차로 원격 이력과 expected migration만 검토한다.
6. Dashboard 또는 별도 신뢰된 관리자 경계에서 테스트 Auth User와 Workspace 멤버십을 만든다.
7. `.env.local`에 Development URL과 publishable key를 넣고 `VITE_DATA_SOURCE=supabase`로 실행한다.

공식 React 안내도 Vite 브라우저 환경에 Project URL과 publishable key를 사용한다. Data API가 비활성화되었거나 `public` schema가 노출되지 않은 프로젝트에서는 Integrations의 Data API 설정도 확인한다. RLS와 GRANT는 서로 다른 경계이므로 둘 다 현재 Migration과 일치해야 한다.

## Migration Apply Procedure

아래 명령은 반드시 저장소 루트에서 별도 Development 프로젝트를 대상으로 실행한다. `<development-project-ref>`를 실제 개발 프로젝트 ref로 바꾼다.

```sh
npx --yes supabase login
npx --yes supabase link --project-ref <development-project-ref>
npx --yes supabase migration list --linked
npx --yes supabase db push --linked --dry-run
npx --yes supabase db push --linked
npx --yes supabase migration list --linked
```

5D 인수 시 아래 다섯 Migration이 저장소 timestamp와 같은 버전으로 적용됐다고 프로젝트 소유자가 보고했다.

```text
20261009015155
20261010064046
20261010080630
20261025090000
20261025090001
```

Prompt 5E의 두 migration도 원격 적용돼 저장소와 remote migration list 7개가 일치한다. 둘 다 위 5D 인수 결과와는 별도 검증 범위다.

```text
20261025114440
20261025115414
```

원격 프로젝트에 `db reset --linked`를 실행하지 않는다. 5E Migration은 적용 전 프로젝트 ref가 `yzpkhvuftusnshdqfnim`인지 다시 확인하고, drift와 dry-run 결과에 expected migration만 표시될 때 진행한다.

## Development Test Accounts

비밀번호를 저장소, 문서, Issue 또는 CI 로그에 남기지 않는다. Dashboard의 Authentication Users 또는 동등한 신뢰된 관리자 경계에서 최소 다음 계정을 준비한다.

| 계정 용도 | Workspace A | 기대 용도 |
| --- | --- | --- |
| ADMIN | `ACTIVE / ADMIN` | 전체 조회와 두 RPC 허용 |
| EDITOR | `ACTIVE / EDITOR` | 전체 조회와 두 RPC 허용 |
| VIEWER | `ACTIVE / VIEWER` | 조회 허용, 두 RPC 거부 |
| DISABLED | `DISABLED / VIEWER` 이상 | 로그인 세션이 있어도 업무 조회 거부 |

Workspace B에는 별도 안전한 테스트 데이터를 만들고 Workspace A 사용자에게 멤버십을 주지 않아 교차 Workspace 거부를 확인한다. 테스트 User를 만든 뒤 `workspace_members` 행의 `user_id`가 해당 `auth.users.id`와 정확히 일치하는지 확인한다. 계정 생성·초대·Role 변경 UI는 이번 구현에 포함되지 않는다.

## RLS Acceptance Procedure

Dashboard SQL Editor는 높은 권한으로 실행되어 사용자 RLS 인수 검증에 사용하지 않는다. 각 테스트 계정으로 앱에 로그인하거나 해당 사용자 세션의 Data API/RPC를 통해 검증한다.

| 시나리오 | 기대 결과 | 5D 보고 결과 |
| --- | --- | --- |
| ACTIVE ADMIN이 Workspace A 데이터 조회 | ALLOW | PASS |
| ACTIVE EDITOR가 Workspace A 데이터 조회 | ALLOW | PASS |
| ACTIVE VIEWER가 Workspace A 데이터 조회 | ALLOW | PASS |
| VIEWER가 `map_offer`, `update_issue_status` 호출 | DENY | PASS |
| EDITOR가 두 RPC 호출 | ALLOW | PASS |
| ADMIN이 두 RPC 호출 | ALLOW | PASS |
| ACTIVE 사용자를 같은 세션에서 DISABLED로 변경한 뒤 재조회 | DENY | PASS |
| Workspace A 사용자가 Workspace B 행 조회 | 빈 결과 또는 DENY | PASS |
| ACTIVE ADMIN/EDITOR가 Master Dry-run 저장 | ALLOW, Batch/Raw/Issue/ActivityLog 원자적 생성 | PASS |
| VIEWER·DISABLED·익명이 Master Dry-run 저장 | DENY | PASS |
| Workspace A 사용자가 Workspace B로 Dry-run 저장 | DENY | PASS |

표의 PASS는 프로젝트 소유자가 제공한 2026-10-25 `selleraudit-dev` 5D 인수 결과다. 생성한 acceptance 데이터는 모두 정리됐다고 보고됐다. 브라우저 UI의 read-only 처리와 별개로 RPC 직접 호출 거부를 확인한다. PGlite는 SQL Contract를 계속 검증하지만 Auth, API gateway와 PostgREST를 포함하지 않으므로 이 원격 절차를 대체하지 않는다. Candidate Snapshot과 Human Review는 이 결과에 포함되지 않으며 별도 5E 원격 인수가 필요하다.

## Local Integration Verification

다음 별도 Playwright 설정은 로컬 fake Supabase HTTP 응답으로 로그인 gate, ACTIVE 멤버십, Workspace 부재, 로그아웃, Workspace 전환과 VIEWER Import 차단을 확인한다.

```sh
npm run test:e2e:supabase
```

이 테스트의 URL과 `sb_publishable_test_only` 값은 `scripts/dev-supabase-test.mjs`의 테스트 전용 localhost 설정이며 실제 프로젝트 자격증명이 아니다. Fake API 테스트는 브라우저 부트스트랩과 UI 상태 전이를 검증하지만 원격 Auth, PostgREST, RLS 또는 RPC 권한을 증명하지 않는다. 원격 인수 결과는 위 RLS Acceptance Procedure에서 별도로 기록한다.

## Security Rules

- 브라우저에는 Project URL과 publishable key만 제공한다.
- `service_role`, secret key, Auth admin key, DB password와 JWT secret은 Frontend 및 `VITE_` 변수에 두지 않는다.
- `.env`와 `.env.local`은 Git에서 제외하고 `.env.example`에는 빈 값만 둔다.
- Role과 Status는 사용자 수정 가능한 metadata가 아니라 현재 DB 멤버십에서 판단한다.
- 모든 업무 조회는 선택 Workspace를 명시하고 RLS가 같은 경계를 다시 강제한다.
- 모든 업무 쓰기는 공개 RPC를 통해 수행하며 VIEWER의 직접 호출을 DB가 거부한다.
- access token, refresh token, password, Session 전체 객체와 Raw Excel 내용을 Console에 출력하지 않는다.
- 오류와 DB 문자열은 React의 기본 escaping으로 렌더링하며 `dangerouslySetInnerHTML`을 사용하지 않는다.
- Supabase 모드의 설정 오류는 비밀값을 표시하거나 Mock 데이터로 우회하지 않는다.

## Known Limitations

- 5D 원격 Migration/Auth/RLS/Data API/RPC acceptance는 프로젝트 소유자 제공 결과로 기록했으며, 이 문서 작업에서 독립 재실행하지 않았다.
- Candidate Snapshot과 Human Review의 5E 원격 DB contract는 통과했다. 실제 Auth 브라우저 인수는 ADMIN·VIEWER·DISABLED에서 통과했고 EDITOR 자격증명 오류로 미완료다.
- Public Sign Up, Email confirmation, Site URL과 Redirect URL의 실제 Dashboard 설정은 이 문서 작업에서 재확인하지 않았다.
- 비밀번호 재설정은 DEFER 상태다.
- 직원 초대, Role/Status 변경, Workspace 생성과 마지막 ACTIVE ADMIN 보호 UI/RPC가 없다.
- ActivityLog writer는 Master Dry-run 저장의 `IMPORT_VALIDATED`와 Candidate/Issue review의 `IMPORT_REVIEWED`에 적용된다. 다른 업무·Import 이벤트는 아직 없다.
- Master Dry-run의 Batch/Raw Row/Candidate/Validation Issue snapshot과 ADMIN review 기록은 구현됐지만 원본 binary와 Product/SKU/BOM Apply는 없다.
- Role 변경 Realtime 반영은 없으며 새로고침 또는 Workspace 데이터 새로고침이 필요하다.
- Repository는 서버 응답을 500행 단위로 페이지 처리하지만 현재 Workspace의 Core 데이터 전체를 브라우저 메모리에 구성한다. 화면 단위 조회와 증분 동기화는 후속 검증 대상이다.
- 실제 사내 데이터 Import, Internal Pilot 배포와 Production 배포를 수행하지 않았다.

## Current Stop Line

현재 완료 범위는 Mock/Supabase 모드 분리, 안전한 Supabase client 설정, 이메일 로그인·세션 복원·로그아웃, ACTIVE Workspace 선택, ADMIN/EDITOR/VIEWER 인식, Core SellerRepository read, 두 업무 RPC, VIEWER UI guard와 Master Dry-run의 Batch/Raw/Candidate/Issue 중앙 저장, ADMIN review와 `IMPORT_VALIDATED`/`IMPORT_REVIEWED` 기록까지다.

다음 기능은 여기서 시작하지 않는다.

- Excel Storage 업로드와 server-verified hash
- Product, SKU, BOM Apply
- `IMPORT_VALIDATED` 이외의 ActivityLog writer
- 직원 초대와 Role 관리 UI
- 비밀번호 재설정
- 회사 Production 배포

기존 5D 원격 인수는 프로젝트 소유자 보고 기준 GO다. 5E 역할별 원격 DB contract는 JWT claim으로 actor를 재현한 transaction에서 통과했다. 실제 이메일/비밀번호 Auth 브라우저 인수는 ADMIN·VIEWER·DISABLED에서 통과했으나 EDITOR 자격증명 오류로 `REMOTE 5E ACCEPTANCE = HOLD (DB CONTRACT PASS, LIVE AUTH/BROWSER PARTIAL)`이다. Internal Pilot은 [Pilot Readiness Gate](INTERNAL_PILOT_ARCHITECTURE.md#9-pilot-readiness-gate)의 나머지 항목을 통과하기 전까지 보류한다.

## Official References

- [Use Supabase with React](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs)
- [Password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database functions and function security](https://supabase.com/docs/guides/database/functions)
- [JavaScript RPC](https://supabase.com/docs/reference/javascript/rpc)
- [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase CLI database commands](https://supabase.com/docs/reference/cli/supabase-db-push)
