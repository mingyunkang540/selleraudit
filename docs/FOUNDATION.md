# SellerAudit V0.1 Foundation 인수인계

## 구현 완료

SellerAudit은 기존 `RetirePay`를 변경하거나 대체하지 않고 저장소의 `seller-audit/` 하위에 독립 React·TypeScript·Vite 앱으로 구현했다. 사방넷 품번을 사용자가 보는 판매상품 기준으로, `AL00` 같은 코드를 실제 물류 SKU로 분리한다.

구현한 범위는 다음과 같다.

- 대시보드: Product, SKU, Listing, Offer, 미해결 Issue 요약과 채널별 현황
- 판매상품 마스터: 사방넷 품번, 상품명, SKU, 채널 상품번호·상품명 검색과 상태·상품 구분 필터
- 상품 360: 기본 정보, BOM, 6개 채널 등록 정보, 연결 Issue 이력
- SKU 관리: SKU 검색·필터, 연결 Product와 구성 수량 Drawer
- 채널 상품 매트릭스: Product × Channel의 정상·확인필요·가격이상·미등록 상태와 Offer 상세
- 매핑 센터: 미매칭 Offer 선택, 정적 데모 후보 또는 Product 검색, 확인 Dialog, Product 연결, 원문 Alias 저장, 관련 `UNMATCHED` Issue 해결
- 감사(Audit) 센터: 유형·상태·채널·검색어 필터, 상세 Drawer, `OPEN`·`IN_PROGRESS`·`RESOLVED`·`IGNORED` 상태 변경
- 공통 UX: Loading, Empty, 검색 결과 없음, 없는 Product, 손상 저장소 Error, 키보드 Drawer/Dialog 닫기, 모바일 메뉴
- 판매채널·워크스페이스 설정: 현재 데모 상태를 보여주는 조회 전용 화면 2개

초기 시드는 다음 수치를 가진 결정적 데이터다.

| Entity | 수량 |
| --- | ---: |
| Product | 30 |
| SKU | 25 |
| ProductComponent(BOM) | 31 |
| Channel | 6 |
| ChannelListing | 120 |
| ChannelOffer | 150 |
| Alias | 60 |
| AuditIssue | 29 |

수동 매핑과 Issue 상태 변경은 `SellerRepository` 계약을 통해 처리하며, 현재 구현체는 브라우저 `localStorage`를 사용한다. 저장 키는 `seller-audit:v0.1:data`이다. 저장 문서를 읽을 때 UUID, enum, 날짜, 비음수 가격, 코드 중복, 참조 관계, workspace 일치 여부를 검증하고 손상된 데이터는 오류 화면으로 전달한다. 수동 매핑은 원본 판매자 코드를 보존하며 해당 Offer의 미처리·확인중 `UNMATCHED` 이슈만 해결한다. 사용자가 제외한 이슈와 Listing 전체 수준 이슈는 유지한다.

## 미구현

다음 항목은 Foundation 범위 밖이므로 의도적으로 구현하지 않았다.

- 실제 Excel·CSV Import와 Import History
- SCM 자동 감지와 사방넷·네이버·쿠팡·G마켓 등 채널별 Adapter
- 판매자 코드·Alias·정규화·유사도를 이용한 자동매칭
- 가격·상품명·판매상태 변경을 탐지하는 실제 Audit 알고리즘
- 채널 API 자동 동기화와 상품 자동 수정
- Supabase Auth, 팀 권한 UI, 라이브 DB 연결
- 재고 차감, 주문 수집, 출고, 송장, 정산

매핑 센터의 추천 후보와 점수는 `src/mock/seed.ts`에서 만든 정적 데모 값이다. 현재 Issue도 시드 fixture이며 실행 중 탐지한 결과가 아니다. 설정 화면의 Import/API 안내는 기능 제공을 뜻하지 않는다.

## DB 구조

`supabase/migrations/`의 Foundation 및 Audit 채널 문맥 마이그레이션 2개는 향후 Supabase 저장소가 따라야 할 SQL 계약이다. 현재 앱은 이 SQL을 호출하지 않으며, 연결된 Supabase 프로젝트나 인증 세션도 없다.

스키마는 `workspaces`를 테넌트 루트로 두고 `workspace_members`, `products`, `skus`, `product_components`, `channels`, `channel_listings`, `channel_offers`, `aliases`, `audit_issues`를 `workspace_id`로 격리한다. Product↔SKU는 BOM, ChannelListing↔ChannelOffer는 상품 페이지와 실제 판매 옵션 관계다. `map_offer`와 `update_issue_status` RPC는 프론트엔드 저장소의 두 쓰기 동작과 대응한다.

RLS, grants, 복합 외래 키, RPC 동작과 로컬 적용 절차는 [DATABASE.md](DATABASE.md)에 정리했다. 라이브 프로젝트에는 적용하지 않았다.

## 파일 구조

| 경로 | 책임 |
| --- | --- |
| `src/App.tsx` | hash route 조립, Loading·Error 상태, 저장소 동작 연결 |
| `src/types/domain.ts` | Workspace, Product, SKU, Listing, Offer, Alias, Issue 도메인 타입 |
| `src/mock/seed.ts` | 결정적 데모 데이터와 정적 추천 fixture |
| `src/services/repository.ts` | UI가 의존하는 `SellerRepository` 인터페이스 |
| `src/services/mockRepository.ts` | 검증·복제·원자적 저장을 포함한 localStorage 구현 |
| `src/lib/selectors.ts` | 검색, Product 관계, 매트릭스 상태 계산 |
| `src/features/` | dashboard, products, skus, channels, mapping, audit 화면 |
| `src/components/` | Layout과 공통 UI 컴포넌트 |
| `src/adapters/index.ts` | 향후 source adapter의 타입 경계만 정의하며 parser는 없음 |
| `src/pages/Settings.tsx` | 조회 전용 설정 2개 |
| `tests/unit/foundation.spec.ts` | 시드·selector·repository 회귀 테스트 |
| `tests/e2e/acceptance.spec.ts` | 핵심 사용자 흐름과 반응형·오류 상태 브라우저 테스트 |
| `supabase/migrations/` | 라이브 연결 전의 Supabase SQL 계약 |
| `supabase/tests/pglite/` | 재현 가능한 PostgreSQL 엔진·RLS·트랜잭션 검증 |

## 실행 방법

Node.js `^22.12.0` 또는 `>=24.0.0`을 사용한다.

```sh
cd seller-audit
npm ci
npm run dev
```

기본 개발 주소는 `http://127.0.0.1:5173`이다. 앱은 hash route를 사용하므로 대시보드는 `http://127.0.0.1:5173/#/dashboard`에서 연다.

브라우저 데이터를 초기화하려면 개발자 도구에서 해당 Origin의 `seller-audit:v0.1:data` 키를 삭제하고 새로고침한다. 앱 자체에는 전체 초기화 버튼이 없다.

## Acceptance Criteria

- [x] `100051`을 검색해 `점보 쿨라벤더 1개` Product 360으로 이동할 수 있다.
- [x] Product 360의 SKU 구성에서 `AL00 × 1`을 확인할 수 있다.
- [x] Product 360에서 NAVER, COUPANG, GMARKET, OHOUSE를 포함한 6개 채널의 등록 또는 미등록 상태를 확인할 수 있다.
- [x] Channel Matrix에서 상품별 등록, 미등록, 가격 이상 상태와 연결 Offer를 확인할 수 있다.
- [x] Mapping Center에서 미매칭 Offer를 Product에 수동 연결하고 Alias를 저장할 수 있다.
- [x] Audit Center에서 Issue를 확인하고 `OPEN`에서 `RESOLVED`로 변경할 수 있다.
- [x] SCM Adapter 없이도 Mock 데이터와 localStorage repository로 전체 UI가 동작한다.

## 테스트 결과

검증 명령은 다음과 같다.

```sh
npm run test:unit
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

| 검증 | 상태 | 결과 |
| --- | --- | --- |
| 의존성 설치 | PASS | `npm ci --ignore-scripts`, 취약점 0건 |
| 개발 서버 | PASS | Vite 및 E2E 전용 서버 기동 확인 |
| 단위 테스트 | PASS | 14개 통과 |
| E2E | PASS | Chromium 12개 통과, 1440×1000 주요 화면 스크린샷 생성 |
| TypeScript | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Production build | PASS | `npm run build` |
| DB harness | PASS | PGlite 0.5.8에서 10개 테이블 생성, RLS·FK·원자성·상태 전이 SQL 검증 |

E2E는 `127.0.0.1:4180`에 별도 개발 서버를 띄운다. DB 검증은 라이브 Supabase 적용과 별개이며, 실제 Supabase Auth/PostgREST 통합 검증은 아직 수행 대상이다.

## 다음 단계

실제 SCM 상품관리 다운로드 원본을 받으면 다음 순서로 확장한다.

1. 원본 파일과 채널별 컬럼을 확정하고 RAW 보존 형식을 새 범위로 설계한다.
2. `src/adapters/`에 채널별 parser/normalizer를 구현해 RAW를 SellerAudit 표준 NORMALIZED 레코드로 바꾼다.
3. Import service와 repository 계약을 추가해 `RAW → NORMALIZED → MASTER` 흐름을 실제 파일로 검증한다.
4. 실제 Alias와 판매자 코드를 기준으로 매칭 규칙을 구현하고 불확실한 결과만 기존 Mapping Center로 보낸다.
5. 저장소 구현을 `SellerRepository` 뒤에서 Supabase로 교체하고 camelCase 도메인과 snake_case DB 변환을 그 경계에 둔다.
6. 실제 이전 스냅샷과 현재 스냅샷이 확보된 뒤 `MASTER → AUDIT` 탐지 규칙을 구현한다.

각 단계는 실제 파일, 변환 규칙, 오류 사례와 테스트 fixture를 먼저 확보한 뒤 시작한다. 프론트엔드 컴포넌트에서 Supabase를 직접 조회하거나 존재하지 않는 클라우드 환경 키를 추가하지 않는다.

## Stop Line

현재 완료 지점은 `Foundation → Product/SKU/BOM → Mock Channel Listing → Product 360 → Channel Matrix → Mapping UI → Audit UI → STOP`이다.

실제 SCM 상품관리 원본 파일과 명시적인 다음 범위가 오기 전에는 Import Engine, 실제 Adapter, 자동매칭, 실제 Audit 알고리즘, API 동기화를 구현하지 않는다.
