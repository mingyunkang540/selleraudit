# SellerAudit Foundation + Supabase Development Integration

SellerAudit은 여러 판매채널의 상품 정보를 사방넷 품번 기준의 판매상품 Master에 연결하고 검수하는 운영 도구입니다. 기본 Mock/localStorage 모드와, 별도 Development Supabase 프로젝트에 연결할 수 있는 Auth·중앙 Repository 모드를 지원합니다. Master Excel Dry-run은 두 모드 모두 브라우저에서만 실행하며 DB에 저장하지 않습니다.

## 현재 구현 범위

- 사방넷 품번과 상품명으로 Product를 검색하고 Product 360에서 SKU·BOM·채널 등록·이슈를 확인
- SKU를 검색하고 해당 SKU를 사용하는 Product와 구성 수량을 확인
- Product × Channel 매트릭스에서 등록·미등록·가격 이상 상태와 Offer 상세를 확인
- 미매칭 Channel Offer를 Product에 연결하고 Alias를 저장하며 해당 Offer의 `UNMATCHED` 이슈를 해결
- Audit Issue를 검색·필터링하고 처리 상태를 변경
- Supabase 모드에서 이메일/비밀번호 로그인, 세션 복원, 로그아웃과 ACTIVE Workspace 선택
- ADMIN/EDITOR/VIEWER 역할 표시 및 VIEWER의 Mapping·Audit 변경과 Master Dry-run 실행 차단
- Supabase에서 Product·SKU·BOM·Channel·Listing·Offer·Alias·Audit Issue를 읽고 기존 두 업무 RPC로 변경
- 대시보드와 판매채널·워크스페이스 조회 화면 제공
- Master `.xlsx` 파일을 브라우저에서 분석하고 후보·검증 이슈를 미리보기로 확인. DB Apply는 없음
- 폭 390px의 모바일 메뉴부터 1440px 데스크톱 테이블까지 반응형 지원

도메인 용어와 데이터 관계는 [Domain rules](docs/DOMAIN.md)를 먼저 참고합니다. 제공된 채널 상품목록 7개의 구조와 Import 제약은 [원본 분석](docs/SCM_SOURCE_ANALYSIS.md)에 기록했습니다. 원본은 저장소에 포함하지 않았고 앱에 적재되지 않았습니다.

## 실행

Node.js `^22.12.0` 또는 `>=24.0.0`과 npm이 필요합니다.

```sh
npm ci
npm run dev
```

기본 주소는 `http://127.0.0.1:5173`이며 대시보드는 `http://127.0.0.1:5173/#/dashboard`입니다.

기본값은 Mock 모드입니다. Supabase 개발 통합을 실행하려면 `.env.example`을 참고해 Git에서 제외된 `.env.local`에 다음 값을 설정합니다.

```dotenv
VITE_DATA_SOURCE=supabase
VITE_SUPABASE_URL=https://<development-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<development-publishable-key>
```

브라우저 환경변수에는 publishable key만 사용합니다. `service_role`, secret key, Auth admin key, DB password와 JWT secret을 `VITE_` 변수에 넣지 않습니다. 상세 설정과 원격 인수 절차는 [Supabase development integration](docs/SUPABASE_DEVELOPMENT_INTEGRATION.md)을 참고하세요.

## 주요 화면

| 화면 | 경로 | 주요 동작 |
| --- | --- | --- |
| 대시보드 | `#/dashboard` | 전체 현황, 채널별 상태, 최근 이슈 확인 |
| 판매상품 마스터 | `#/products` | 사방넷 품번·상품명·SKU·채널 정보 검색과 필터 |
| 상품 360 | `#/products/:id` | 기본 정보, BOM, 채널 등록 정보, 이슈 이력 확인 |
| SKU 관리 | `#/skus` | SKU 검색과 연결 Product 확인 |
| 채널 상품 매트릭스 | `#/channels` | Product별 채널 등록 상태 비교와 상세 Drawer |
| 매핑 센터 | `#/mapping` | 미매칭 Offer를 Product에 수동 연결하고 Alias 저장 |
| 감사 센터 | `#/audit` | Issue 검색·필터와 처리 상태 변경 |
| Master Excel 분석 | `#/import/master` | 원본 파일 선택, Product·SKU·BOM 후보와 차단 이슈 Dry-run |
| 판매채널 설정 | `#/settings/channels` | 현재 워크스페이스의 채널 현황 조회 |
| 워크스페이스 설정 | `#/settings/workspace` | 현재 데이터 저장 방식과 작업 환경 조회 |

## 실행 모드와 저장

초기 시드는 Product 30개, SKU 25개, BOM 구성 31개, Channel 6개, Listing 120개, Offer 150개, Alias 60개, Audit Issue 29개입니다. 정상, 가격 이상, 미등록, 미매칭, 중복 Listing, 판매중지 불일치, BOM 누락 사례를 포함합니다.

UI는 `SellerRepository` 인터페이스에 의존합니다. Mock 모드의 수동 매핑과 Issue 상태 변경은 `seller-audit:v0.1:data`에 저장되어 새로고침 후에도 유지됩니다. 다른 브라우저나 기기와 공유되지 않고, 해당 Origin의 사이트 데이터를 삭제하면 초기 시드로 돌아갑니다.

Supabase 모드는 Auth Session의 ACTIVE 멤버십으로 Workspace를 선택하고 중앙 PostgreSQL에서 업무 데이터를 읽습니다. 수동 매핑과 Issue 상태 변경은 `map_offer`, `update_issue_status` RPC를 호출한 뒤 데이터를 다시 읽습니다. 업무 데이터는 `localStorage`에 저장하지 않으며 사용자별 마지막 Workspace ID만 편의 설정으로 보관합니다. URL 또는 publishable key가 없으면 설정 오류를 표시하고 Mock 모드로 자동 전환하지 않습니다.

Master Excel 분석 결과는 `SellerRepository`와 분리된 화면 메모리에만 보관됩니다. 원본 파일과 후보는 `localStorage`나 DB에 저장되지 않습니다. 지원 형식과 한계는 [Master Import Dry-run](docs/data/MASTER_IMPORT_DRY_RUN.md)을 참고하세요.

SQL 스키마와 RPC 계약은 `supabase/`에 있습니다. 로컬 Migration에는 ACTIVE Workspace 역할, Import 이력·ActivityLog 테이블과 RLS 계약이 포함됩니다. Supabase client, Auth와 중앙 Repository 구현은 준비됐지만 SellerAudit용 원격 Development 프로젝트와 자격증명이 없어 Migration 적용 및 Auth·Data API·RLS·RPC 인수 검증은 아직 수행하지 않았습니다. [DB Foundation 상세](docs/data/IMPORT_DB_FOUNDATION.md)와 [Supabase 개발 통합](docs/SUPABASE_DEVELOPMENT_INTEGRATION.md)을 참고하세요.

## 검증 명령

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:e2e:supabase
```

DB Contract 검증은 PowerShell에서 임시 디렉터리에 `@electric-sql/pglite@0.5.8`을 설치하고 runner에 모듈의 절대 경로를 전달합니다.

```powershell
$sellerAuditQa = Join-Path $env:TEMP ('seller-audit-db-qa-' + [guid]::NewGuid())
npm.cmd install --prefix $sellerAuditQa --no-save --package-lock=false --ignore-scripts '@electric-sql/pglite@0.5.8'
node supabase/tests/pglite/run.mjs (Join-Path $sellerAuditQa 'node_modules/@electric-sql/pglite/dist/index.js')
npm.cmd uninstall --prefix $sellerAuditQa --no-save --package-lock=false '@electric-sql/pglite'
```

기본 E2E는 자체 개발 서버를 `127.0.0.1:4180`에서 실행합니다. 별도 Supabase-mode E2E는 localhost의 fake API로 Auth/Workspace UI 흐름을 검증하며 실제 원격 RLS를 검증하지 않습니다. DB 검증 범위와 한계는 [Database foundation](docs/DATABASE.md), 전체 구현 범위는 [Foundation 인수인계](docs/FOUNDATION.md)를 참고하세요.

`.github/workflows/ci.yml`은 모든 push와 pull request에서 Node.js 24로 의존성 설치, TypeScript, Lint, Unit, Build, Mock Chromium E2E, fake Supabase-mode E2E와 DB Contract를 순서대로 실행합니다. 실패하면 로그와 Playwright 결과를 artifact로 보존합니다.

## Stop Line

로컬 Supabase 통합 구현은 완료됐지만 원격 Development 프로젝트의 Migration, Auth, RLS와 RPC acceptance는 HOLD입니다. Master 원본의 Product·SKU·BOM은 Dry-run까지만 분석합니다. Import Batch/Raw 저장, Apply, Excel Storage 업로드, ActivityLog 실제 기록, 직원 초대·Role 관리 UI와 회사 Production 배포는 구현하지 않습니다.
