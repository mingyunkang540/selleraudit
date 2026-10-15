# SellerAudit V0.1 Foundation 인수인계

## 현재 상태

SellerAudit은 React·TypeScript·Vite로 구성된 독립 저장소입니다. 사방넷 품번을 판매상품 Product의 기준 코드로 사용하고, `AL00` 같은 실제 물류 SKU와 Product를 BOM으로 연결합니다. 전체 도메인 규칙은 [DOMAIN.md](DOMAIN.md)에 정의합니다.

구현 화면은 다음과 같습니다.

- 대시보드: Product, SKU, Listing, Offer, 미해결 Issue 요약과 채널별 현황
- 판매상품 마스터: 사방넷 품번, 상품명, SKU, 채널 상품번호·상품명 검색과 필터
- 상품 360: 기본 정보, BOM, 전체 채널 등록 정보, 연결 Issue 이력
- SKU 관리: SKU 검색·필터, 연결 Product와 구성 수량 Drawer
- 채널 상품 매트릭스: Product × Channel 상태와 Offer 상세 Drawer
- 매핑 센터: 미매칭 Offer 선택, 정적 데모 후보 또는 Product 검색, 확인 Dialog, Product 연결, 원문 Alias 저장, 관련 `UNMATCHED` Issue 해결
- 감사 센터: 유형·상태·채널·검색어 필터, 상세 Drawer, Issue 상태 변경
- 판매채널·워크스페이스 설정: 현재 데모 상태를 보여주는 조회 전용 화면

초기 시드는 Product 30개, SKU 25개, ProductComponent 31개, Channel 6개, ChannelListing 120개, ChannelOffer 150개, Alias 60개, AuditIssue 29개입니다.

## 저장 구조

UI는 `SellerRepository` 계약만 사용합니다. 현재 `createMockRepository` 구현은 전체 `SellerData` 문서를 브라우저 `localStorage`의 `seller-audit:v0.1:data`에 저장합니다. UUID, enum, 날짜, 가격, 중복 business key, Entity 참조와 workspace 관계를 읽을 때 검증하고 손상 데이터는 오류 화면으로 전달합니다.

수동 매핑은 원본 판매자 코드를 보존하고 Alias를 추가한 뒤 해당 Offer의 `OPEN` 또는 `IN_PROGRESS` `UNMATCHED` 이슈만 해결합니다. 사용자가 `IGNORED`로 분류한 이슈와 Listing 전체 수준 이슈는 유지합니다. Issue 상태 변경은 `RESOLVED` 전이와 `resolvedAt`을 함께 관리합니다.

현재 앱에는 Supabase client, Auth session 또는 라이브 DB 연결이 없습니다. `supabase/`는 향후 Supabase 저장소가 따라야 할 스키마와 RPC 계약입니다.

## Channel 확장성

Channel code의 타입은 현재 6개 시드 채널의 목록과 분리합니다. `asChannelCode`는 공백이 아닌 문자열을 branded `ChannelCode`로 만들고, Repository는 Alias의 `sourceChannel`이 같은 workspace에 등록된 Channel code인지 검증합니다. 신규 code 추가를 위해 TypeScript union을 수정하지 않습니다.

현재 기본 시드 채널은 NAVER, COUPANG, GMARKET, OHOUSE, 11ST, SSG입니다. 이 목록은 데모 데이터이며 지원 가능한 전체 Channel 목록이 아닙니다.

## DB 계약

`supabase/migrations/`는 `workspaces`를 테넌트 루트로 두고 `workspace_members`, `products`, `skus`, `product_components`, `channels`, `channel_listings`, `channel_offers`, `aliases`, `audit_issues`를 `workspace_id`로 격리합니다. Product↔SKU는 BOM, ChannelListing↔ChannelOffer는 상품 페이지와 실제 판매 옵션 관계입니다.

Supabase 저장소가 구현되면 매핑은 `map_offer`, Audit 상태 변경은 `update_issue_status` 공개 RPC로만 수행합니다. 공개 함수는 빈 `search_path`의 `SECURITY INVOKER` wrapper이고, 실제 쓰기를 담당하는 private 함수는 `SECURITY DEFINER`, 빈 `search_path`, 완전 수식된 객체명을 사용합니다. Private 함수는 `auth.uid()`와 `workspace_members`를 기준으로 대상 Workspace 접근을 명시적으로 검증합니다. `authenticated`의 위험 컬럼 직접 DML은 차단합니다. 자세한 권한과 로컬 검증 방법은 [DATABASE.md](DATABASE.md)에 있습니다.

## 주요 파일

| 경로 | 책임 |
| --- | --- |
| `src/App.tsx` | hash route 조립, Loading·Error 상태, 저장소 동작 연결 |
| `src/types/domain.ts` | Workspace, Product, SKU, Listing, Offer, Alias, Issue 도메인 타입 |
| `src/mock/seed.ts` | 결정적 데모 데이터와 정적 추천 fixture |
| `src/services/repository.ts` | UI가 의존하는 `SellerRepository` 인터페이스 |
| `src/services/mockRepository.ts` | 검증·복제·저장을 포함한 localStorage 구현 |
| `src/lib/selectors.ts` | 검색, Product 관계, 매트릭스 상태 계산 |
| `src/features/` | dashboard, products, skus, channels, mapping, audit 화면 |
| `src/components/` | Layout과 공통 UI 컴포넌트 |
| `src/adapters/index.ts` | 향후 source adapter의 interface boundary; parser는 없음 |
| `tests/unit/foundation.spec.ts` | 시드·selector·repository 회귀 테스트 |
| `tests/e2e/acceptance.spec.ts` | 핵심 사용자 흐름과 반응형·오류 상태 브라우저 테스트 |
| `.github/workflows/ci.yml` | push와 pull request 자동 검증 |
| `supabase/migrations/` | Supabase 스키마와 RPC write boundary |
| `supabase/tests/pglite/` | PostgreSQL·RLS·트랜잭션 계약 테스트 |

## 실행과 검증

Node.js `^22.12.0` 또는 `>=24.0.0`을 사용합니다.

```sh
npm ci
npm run dev
```

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
```

DB Contract의 재현 가능한 PowerShell 명령은 [DATABASE.md](DATABASE.md)에 있습니다. 개발 서버 기본 주소는 `http://127.0.0.1:5173`, E2E 전용 주소는 `http://127.0.0.1:4180`입니다. DB runner는 라이브 Supabase가 아닌 격리된 PostgreSQL WASM 런타임에서 SQL 계약을 검증합니다. 최신 통과 여부와 test count는 로컬 명령 결과와 GitHub Actions run을 기준으로 판단합니다.

## Acceptance Criteria

- `100051` 검색 후 `점보 쿨라벤더 1개` Product 360으로 이동
- Product 360에서 `AL00 × 1` BOM 확인
- Product 360에서 현재 워크스페이스의 전체 Channel 등록 또는 미등록 상태 확인
- SKU 검색 후 연결된 Product와 구성 수량 확인
- Channel Matrix에서 등록, 미등록, 가격 이상 상태와 연결 Offer 확인
- Mapping Center에서 미매칭 Offer를 Product에 연결하고 Alias 저장
- Audit Center에서 Issue 상태 변경
- 기존 시드 Channel과 임의의 신규 Channel code 모두 Repository validation 통과
- DB RPC가 같은 워크스페이스 쓰기만 허용하고 매핑 세 작업을 원자적으로 처리

## 의도적으로 미구현

- Excel·CSV Import와 Import History
- SCM 자동 감지와 사방넷·채널별 Adapter
- 자동 상품 매칭 또는 AI 매칭
- 실제 가격·상품명·판매상태 Audit 탐지
- 채널 API 동기화와 상품 자동 수정
- Supabase client, Auth UI와 라이브 DB 연결
- Product·SKU·BOM 생성·수정·삭제 UI
- 재고 차감, 주문 수집, 출고, 송장, 정산

매핑 추천과 Issue는 정적 데모 fixture입니다. 화면에 보이는 상태는 외부 채널에서 실시간 수집하거나 실행 중 탐지한 결과가 아닙니다.

## 다음 단계와 Stop Line

제공된 채널 상품목록 7개에 대한 1차 구조·품질 분석은 [SCM_SOURCE_ANALYSIS.md](SCM_SOURCE_ANALYSIS.md)에 기록했습니다. 사방넷 Product·SKU·BOM 원본과 옵션별 행이 부족한 채널의 추가 추출물을 확인한 뒤 `RAW → NORMALIZED → MASTER` 변환 계약을 확정합니다. 이후 `src/adapters/` 구현, Import service, 실제 Alias 기반 매칭, Supabase repository, 과거·현재 스냅샷 기반 Audit 탐지 순서로 별도 범위를 정의합니다.

Foundation 안정화 작업은 `Channel 확장성 → 문서 정합성 → GitHub Actions CI → Supabase RPC write boundary → 검증 → STOP`에서 끝났습니다. 채널 원본 일부가 들어왔지만 Master·옵션 데이터와 의미 확인이 끝나기 전에는 Import, Adapter, Auto Matching, Audit Detection, API Sync를 시작하지 않습니다.
