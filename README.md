# SellerAudit Foundation + Master Import Dry-run

SellerAudit은 여러 판매채널의 상품 정보를 사방넷 품번 기준의 판매상품 Master에 연결하고 검수하는 운영 도구입니다. 현재 운영 화면은 Mock/localStorage 기반 Foundation이며, 별도의 Master Excel Dry-run 화면에서 Product·SKU·BOM 후보를 읽기 전용으로 검증할 수 있습니다.

## 현재 구현 범위

- 사방넷 품번과 상품명으로 Product를 검색하고 Product 360에서 SKU·BOM·채널 등록·이슈를 확인
- SKU를 검색하고 해당 SKU를 사용하는 Product와 구성 수량을 확인
- Product × Channel 매트릭스에서 등록·미등록·가격 이상 상태와 Offer 상세를 확인
- 미매칭 Channel Offer를 Product에 연결하고 Alias를 저장하며 해당 Offer의 `UNMATCHED` 이슈를 해결
- Audit Issue를 검색·필터링하고 처리 상태를 변경
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
| 판매채널 설정 | `#/settings/channels` | 데모 워크스페이스의 채널 현황 조회 |
| 워크스페이스 설정 | `#/settings/workspace` | 현재 데이터 저장 방식과 작업 환경 조회 |

## Mock 데이터와 저장

초기 시드는 Product 30개, SKU 25개, BOM 구성 31개, Channel 6개, Listing 120개, Offer 150개, Alias 60개, Audit Issue 29개입니다. 정상, 가격 이상, 미등록, 미매칭, 중복 Listing, 판매중지 불일치, BOM 누락 사례를 포함합니다.

UI는 `SellerRepository` 인터페이스에 의존하며 현재 구현체는 브라우저 `localStorage`를 사용합니다. 수동 매핑과 Issue 상태 변경은 `seller-audit:v0.1:data`에 저장되어 새로고침 후에도 유지됩니다. 다른 브라우저나 기기와 공유되지 않고, 해당 Origin의 사이트 데이터를 삭제하면 초기 시드로 돌아갑니다.

Master Excel 분석 결과는 `SellerRepository`와 분리된 화면 메모리에만 보관됩니다. 원본 파일과 후보는 `localStorage`나 DB에 저장되지 않습니다. 지원 형식과 한계는 [Master Import Dry-run](docs/data/MASTER_IMPORT_DRY_RUN.md)을 참고하세요.

SQL 스키마와 RPC 계약은 `supabase/`에 있습니다. 로컬 Migration에는 ACTIVE Workspace 역할, Import 이력·ActivityLog 테이블과 RLS 계약이 포함되지만 앱은 아직 Supabase 프로젝트, Auth 또는 Data API에 연결되지 않았습니다. 실제 Supabase 저장소 구현은 후속 범위입니다. [DB Foundation 상세](docs/data/IMPORT_DB_FOUNDATION.md)를 참고하세요.

## 검증 명령

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
```

DB Contract 검증은 PowerShell에서 임시 디렉터리에 `@electric-sql/pglite@0.5.8`을 설치하고 runner에 모듈의 절대 경로를 전달합니다.

```powershell
$sellerAuditQa = Join-Path $env:TEMP ('seller-audit-db-qa-' + [guid]::NewGuid())
npm.cmd install --prefix $sellerAuditQa --no-save --package-lock=false --ignore-scripts '@electric-sql/pglite@0.5.8'
node supabase/tests/pglite/run.mjs (Join-Path $sellerAuditQa 'node_modules/@electric-sql/pglite/dist/index.js')
npm.cmd uninstall --prefix $sellerAuditQa --no-save --package-lock=false '@electric-sql/pglite'
```

E2E는 자체 개발 서버를 `127.0.0.1:4180`에서 실행합니다. DB 검증 범위와 한계는 [Database foundation](docs/DATABASE.md), 전체 구현 범위는 [Foundation 인수인계](docs/FOUNDATION.md)를 참고하세요.

`.github/workflows/ci.yml`은 모든 push와 pull request에서 Node.js 24로 의존성 설치, TypeScript, Lint, Unit, Build, Chromium E2E와 DB Contract를 순서대로 실행합니다. 실패하면 로그와 Playwright 결과를 artifact로 보존합니다.

## Stop Line

Master 원본의 Product·SKU·BOM은 Dry-run까지만 분석합니다. `100526` 충돌, `AL24` 미확인 SKU, BOM 수량 불일치의 공식 정정과 사내 Pilot 권한·보관 조건이 준비되기 전에는 Apply, DB Import, 자동매칭, 채널 API 동기화를 구현하지 않습니다.
