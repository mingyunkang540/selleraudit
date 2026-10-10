# SellerAudit V0.1 Foundation

여러 판매채널의 상품 정보를 사방넷 품번 기준으로 연결하고 검수하는 로컬 데모입니다. 기존 `RetirePay` 앱은 저장소 루트에 그대로 유지하며, SellerAudit은 독립된 `seller-audit/` 하위 앱으로 추가했습니다.

현재 구현은 실제 SCM 데이터가 들어오기 전의 Foundation입니다. Product·SKU·BOM 관계, 채널 현황, 수동 매핑, 검수 상태 변경을 데모 데이터로 확인할 수 있습니다. 실제 파일 Import, SCM Adapter, 자동매칭, Audit 탐지 알고리즘, 채널 API 동기화는 포함하지 않습니다.

## 실행

Node.js `^22.12.0` 또는 `>=24.0.0`과 npm이 필요합니다.

```sh
cd seller-audit
npm ci
npm run dev
```

기본 주소는 `http://127.0.0.1:5173`입니다.

## 구현 화면

| 화면 | 경로 | 주요 동작 |
| --- | --- | --- |
| 대시보드 | `#/dashboard` | 전체 현황, 채널별 상태, 최근 이슈 확인 |
| 판매상품 마스터 | `#/products` | 사방넷 품번·상품명·SKU·채널 정보 검색과 필터 |
| 상품 360 | `#/products/:id` | 기본 정보, BOM, 6개 채널 등록 정보, 이슈 이력 확인 |
| SKU 관리 | `#/skus` | SKU 검색과 연결 판매상품 확인 |
| 채널 상품 매트릭스 | `#/channels` | 상품별 등록·미등록·가격 이상 상태 비교 |
| 매핑 센터 | `#/mapping` | 미매칭 Offer를 Product에 수동 연결하고 Alias 저장 |
| 감사(Audit) 센터 | `#/audit` | 이슈 검색·필터와 처리 상태 변경 |
| 판매채널 설정 | `#/settings/channels` | 샘플 채널 현황 조회 전용 |
| 워크스페이스 설정 | `#/settings/workspace` | 현재 데모 환경 조회 전용 |

## 데모 데이터와 저장

초기 시드는 Product 30개, SKU 25개, BOM 구성 31개, Channel 6개, Listing 120개, Offer 150개, Alias 60개, Audit Issue 29개입니다. 정상, 가격 이상, 미등록, 미매칭, 중복 Listing, 판매중지 불일치, BOM 누락 사례를 포함합니다.

수동 매핑과 이슈 상태 변경은 브라우저 `localStorage`의 `seller-audit:v0.1:data`에 저장되어 새로고침 후에도 유지됩니다. 브라우저·기기 사이에 공유되지 않으며 사이트 데이터를 삭제하면 초기 시드로 돌아갑니다. 현재 앱에는 로그인과 라이브 Supabase 연결이 없습니다.

## 검증

```sh
npm run test:unit
npx playwright install chromium
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

E2E 테스트는 자체 개발 서버를 `127.0.0.1:4180`에서 실행합니다. 자세한 구현 범위, 인수 시나리오, 테스트 결과, 다음 단계는 [Foundation 인수인계](docs/FOUNDATION.md)를 참고하세요. 데이터베이스 계약과 로컬 검증 방법은 [Database foundation](docs/DATABASE.md)에 있습니다.

SellerAudit V0.1은 Foundation에서 멈춥니다. 실제 SCM 상품관리 원본 파일을 받기 전에는 Import Engine, 채널별 Adapter, 자동매칭, 실제 Audit 알고리즘으로 범위를 넓히지 않습니다.
