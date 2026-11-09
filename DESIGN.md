# SellerAudit Design

## Source of truth

- Status: Active
- Last refreshed: 2026-11-05
- Surface: SellerAudit local-first, Korean desktop operations application
- Evidence: current `src/`, tests, product specification and reference boards
- Domain contract: [docs/DOMAIN.md](docs/DOMAIN.md)

## Product goal

사용자는 Product를 사방넷 품번으로 찾고, 실제 물류 SKU와 BOM을 확인하고, 여러 채널의 Listing·Offer 상태를 비교한 뒤 미매칭과 Audit Issue를 수동 처리할 수 있어야 합니다. 현재 운영 환경에서는 이 흐름을 로컬 서버와 PostgreSQL의 실제 데이터로 사용하며, Mock 모드는 별도의 데모·테스트용입니다.

상품 마스터 분석과 채널별 파일 가져오기는 실제 원본을 기준으로 하며, 채널 정보는 자동 실시간 연동 여부를 명확히 표시합니다.

## Information architecture

- Sidebar: 대시보드, 판매상품 마스터, SKU 관리, 채널 상품 매트릭스, 매핑 센터, 감사 센터, 판매채널 설정, 워크스페이스 설정
- Routes: `#/dashboard`, `#/products`, `#/products/:id`, `#/skus`, `#/channels`, `#/mapping`, `#/audit`, `#/settings/channels`, `#/settings/workspace`
- Hierarchy: 제목과 목적 → 검색·필터 → 지표 또는 테이블 → Drawer/Dialog의 상세와 처리 동작
- Product 이름에는 사방넷 품번을 함께 표시하고 Channel 상태는 색과 텍스트를 함께 사용합니다.

## Visual system

- 밝은 회색 배경, 흰 패널, 남색 내비게이션, 파란 주요 동작, 절제한 녹색·주황·빨강 상태색
- 시스템 한글 글꼴, 본문 13–14px, 제목 26px, 숫자는 tabular numerals
- 4px 간격 단위, 10–12px 패널 radius, 얇은 경계와 최소 그림자
- 테이블을 장식보다 우선하고 넓은 표는 패널 안에서 가로 스크롤합니다.
- 등록된 상품 이미지를 우선 표시하고, 이미지가 없는 상품은 기본 아이콘을 사용합니다.

## Shared components and states

`PageHeader`, `SearchInput`, `FilterBar`, `DataTable`, `StatusBadge`, `IssueBadge`, `ChannelBadge`, `EmptyState`, `KpiCard`, `Drawer`, `ConfirmDialog`를 공통 사용합니다. Loading, 저장소 오류와 재시도, 빈 데이터, 검색 결과 없음, 미매핑, 미등록 상태를 명시합니다.

수동 매핑 확인창은 원본 Offer와 대상 Product를 함께 보여줍니다. 저장은 저장소의 단일 동작으로 수행하고 오류를 화면에 남깁니다. 로컬 서버 조회와 저장 결과는 로딩·오류 상태를 통해 구분합니다.

## Accessibility and responsive behavior

- WCAG 2.2 AA를 목표로 하며 keyboard focus, skip link, semantic table과 설명 가능한 label을 제공합니다.
- Drawer와 Dialog는 Escape로 닫히고 닫힌 뒤 이전 focus를 복원합니다.
- 상태는 색만으로 전달하지 않으며 자동 재생이나 깜빡임이 없습니다.
- 1440px 데스크톱을 주 화면으로 하고 1024px에서 축소하며, 800px 미만에서는 모바일 Sidebar를 사용합니다.
- 390px 화면에서도 주요 내비게이션과 핵심 동작을 사용할 수 있어야 합니다.

## Implementation constraints

- React, TypeScript, Vite, plain CSS
- UI → `SellerRepository` → persistence 경계를 유지
- 실제 운영 데이터는 서버 PC의 로컬 PostgreSQL과 SellerAudit 데이터 폴더에 저장합니다. 데모 모드는 별도 `localStorage`를 사용합니다.
- Channel code는 특정 채널 목록에 고정하지 않음
- 소스별 실제 원본을 확인하고 필드 의미를 검증하기 전에는 Adapter나 Import schema를 추측하지 않음

## Open integration inputs

채널 상품목록 7개의 1차 분석은 [원본 분석](docs/SCM_SOURCE_ANALYSIS.md)에 있습니다. 새 채널이나 원본 형식을 추가할 때는 실제 상품·옵션 행과 필드 의미를 확인한 뒤 가져오기 규칙을 확장합니다.
