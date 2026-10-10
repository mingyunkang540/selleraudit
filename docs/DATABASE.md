# SellerAudit database foundation

SellerAudit V0.1의 데이터베이스 계약은 세 개의 순차 마이그레이션으로 정의합니다.

| Migration | 책임 |
| --- | --- |
| `20261009015155_seller_audit_foundation.sql` | 10개 Foundation 테이블, 관계, RLS와 최초 RPC |
| `20261010064046_audit_channel_context.sql` | Listing이 없는 채널 누락 Issue의 대상 Channel 보존 |
| `20261010080630_harden_write_boundaries.sql` | 직접 DML 차단과 RPC 중심 write boundary |

이 SQL은 로컬 계약으로 작성되어 있으며 연결된 Supabase 프로젝트에는 적용하지 않았습니다. 현재 React 앱도 Supabase client, Auth 또는 Data API를 사용하지 않습니다.

## 테이블과 관계

| 테이블 | 역할 | 주요 무결성 규칙 |
| --- | --- | --- |
| `workspaces` | 테넌트 루트 | UUID PK |
| `workspace_members` | Auth 사용자와 Workspace 연결 | `(workspace_id, user_id)` PK, 신뢰된 프로비저닝 전용 |
| `products` | 사방넷 품번 기준 판매상품 Master | Workspace별 `sabangnet_code` 고유 |
| `skus` | 실제 물류·재고 SKU | Workspace별 `sku_code` 고유 |
| `product_components` | Product ↔ SKU BOM | Workspace 복합 FK, `quantity > 0` |
| `channels` | Workspace 채널 | Workspace별 비어 있지 않은 `channel_code` 고유 |
| `channel_listings` | 채널 상품 페이지 | Workspace·Channel별 `channel_product_id` 고유 |
| `channel_offers` | 실제 판매 옵션 또는 판매 단위 | Workspace 복합 FK, 가격 음수 금지, 옵션 없는 상품은 `BASE` |
| `aliases` | 사람이 확정한 매칭 사전 | 상품명·옵션명·Channel 조합 고유, 원문 보존 |
| `audit_issues` | 감사 Issue | Offer와 Listing 관계, 명시한 Channel과 Listing 일치 |

모든 자식 관계는 `workspace_id`를 포함한 복합 외래 키를 사용합니다. 다른 Workspace의 Product, SKU, Channel, Listing, Offer를 연결하는 쓰기는 DB 제약으로 거부됩니다. Product와 SKU는 BOM으로 연결하며 Listing과 Offer는 상품 페이지와 구매 가능한 판매 단위를 구분합니다. 전체 규칙은 [DOMAIN.md](DOMAIN.md)에 있습니다.

`channel_offers.channel_option_id`는 `NOT NULL DEFAULT 'BASE'`이며 Trigger가 `NULL` 또는 공백을 `BASE`로 정규화합니다. 금액은 `numeric(14, 2)`이고 음수를 허용하지 않습니다.

`audit_issues.channel_id`는 Listing이 없는 `MISSING_CHANNEL` Issue의 대상 Channel을 보존합니다. 상품 전체 Issue는 `NULL`일 수 있습니다. Listing과 Channel이 모두 지정되면 `(workspace_id, channel_id, listing_id)` 복합 FK가 둘의 불일치를 거부합니다.

Channel code는 DB에서도 `text`입니다. 현재 시드의 여섯 코드에 제한되지 않으며 Workspace별 고유성과 Entity 관계로 검증합니다.

## RLS와 권한

`public`의 모든 테이블에 RLS가 활성화되어 있습니다.

- `anon`은 테이블 접근과 RPC 실행 권한이 없습니다.
- `authenticated`는 `auth.uid()`와 `workspace_members`가 허용하는 Workspace의 데이터만 읽을 수 있습니다.
- `workspace_members`의 Insert, Update, Delete는 브라우저 사용자에게 허용하지 않습니다. 가입과 최초 Workspace 생성은 `service_role` 또는 관리자 SQL 같은 신뢰된 경계에서 수행합니다.
- `authenticated`는 `channel_offers.master_product_id`, `aliases`, `audit_issues.status/resolved_at`을 직접 쓰지 못합니다.
- 업무 쓰기는 공개 RPC `map_offer`, `update_issue_status`로만 진입합니다.

RLS는 조회 격리의 한 축이며 privileged 함수의 안전성을 대신하지 않습니다. 내부 함수는 함수 owner 권한으로 동작하므로 호출자의 멤버십을 직접 검증합니다.

## RPC write boundary

외부 API 이름은 다음과 같이 유지합니다.

```sql
public.map_offer(p_offer_id uuid, p_master_product_id uuid)
public.update_issue_status(p_issue_id uuid, p_status text)
```

`public` 함수는 빈 `search_path`를 사용하는 얇은 `SECURITY INVOKER` wrapper입니다. 실제 쓰기는 노출 스키마 밖의 `seller_audit_private` 함수가 수행합니다. 내부 함수는 `SECURITY DEFINER`, 빈 `search_path`, 완전 수식된 객체명을 사용합니다.

두 내부 함수는 먼저 `auth.uid()`가 존재하는지 확인하고 대상 행의 `workspace_id`와 `workspace_members`를 직접 join합니다. 따라서 함수 owner의 권한으로 실행되더라도 호출자가 속하지 않은 Workspace의 행을 처리하지 않습니다. `seller_audit_private`는 Data API 노출 스키마가 아니며 `anon`에는 사용·실행 권한이 없습니다. `authenticated`에는 공개 wrapper가 내부 구현을 호출하는 데 필요한 schema usage와 함수 execute만 부여하며 테이블 직접 DML 권한은 부여하지 않습니다.

### `map_offer`

하나의 트랜잭션에서 다음을 수행합니다.

1. 호출자가 속한 Workspace의 Offer를 잠급니다.
2. 대상 Product가 동일한 Workspace에 있는지 검증합니다.
3. `channel_offers.master_product_id`를 변경합니다.
4. Listing 상품명, Offer 옵션명, Channel code 원문으로 Alias를 upsert합니다.
5. 해당 Offer에 직접 연결된 `OPEN` 또는 `IN_PROGRESS` `UNMATCHED` Issue만 `RESOLVED`로 바꿉니다.

Alias upsert 등 중간 단계가 실패하면 Offer 변경과 Issue 해결을 포함한 전체 호출이 rollback됩니다. Listing 수준 Issue(`offer_id IS NULL`)와 사용자가 `IGNORED`로 분류한 Issue는 자동 해결하지 않습니다.

### `update_issue_status`

허용 상태는 `OPEN`, `IN_PROGRESS`, `RESOLVED`, `IGNORED`입니다. `NULL`이나 다른 값은 거부합니다. `RESOLVED` 전이에서는 기존 값이 없을 때만 `resolved_at`을 기록하며 다른 상태로 되돌리면 `resolved_at`을 `NULL`로 만듭니다.

향후 Supabase `SellerRepository` 구현은 다음 형태로 공개 RPC만 호출해야 합니다.

```ts
await supabase.rpc('map_offer', {
  p_offer_id: offerId,
  p_master_product_id: productId,
})

await supabase.rpc('update_issue_status', {
  p_issue_id: issueId,
  p_status: 'RESOLVED',
})
```

## TypeScript와 PostgreSQL 경계

애플리케이션 도메인은 camelCase를 유지하고 저장소 계층에서 DB의 snake_case로 변환합니다. React 컴포넌트가 Supabase row를 직접 도메인 타입으로 간주하지 않습니다.

| TypeScript | PostgreSQL |
| --- | --- |
| `workspaceId` | `workspace_id` |
| `sabangnetCode` | `sabangnet_code` |
| `productName` | `product_name` |
| `productType` | `product_type` |
| `normalPrice` | `normal_price` |
| `skuCode` | `sku_code` |
| `channelCode` | `channel_code` |
| `channelId` | `channel_id` |
| `channelProductId` | `channel_product_id` |
| `listingId` | `listing_id` |
| `channelOptionId` | `channel_option_id` |
| `sellerCode` | `seller_code` |
| `salePrice` | `sale_price` |
| `masterProductId` | `master_product_id` |
| `sourceChannel` | `source_channel` |
| `issueType` | `issue_type` |
| `offerId` | `offer_id` |
| `detectedAt` | `detected_at` |
| `resolvedAt` | `resolved_at` |

`numeric`은 PostgREST 응답에서 문자열로 전달될 수 있으므로 저장소 경계에서 유한한 숫자인지 확인한 뒤 도메인 `number`로 변환합니다. UUID와 timestamp도 저장소 경계에서 검증합니다.

## 로컬 DB Contract 검증

현재 runner는 저장소 의존성을 추가하지 않고 임시 PGlite 0.5.8 PostgreSQL WASM 런타임을 사용합니다. PowerShell에서는 다음과 같이 실행할 수 있습니다.

```powershell
$sellerAuditQa = Join-Path $env:TEMP ('seller-audit-db-qa-' + [guid]::NewGuid())
npm.cmd install --prefix $sellerAuditQa --no-save --package-lock=false --ignore-scripts '@electric-sql/pglite@0.5.8'
node supabase/tests/pglite/run.mjs (Join-Path $sellerAuditQa 'node_modules/@electric-sql/pglite/dist/index.js')
npm.cmd uninstall --prefix $sellerAuditQa --no-save --package-lock=false '@electric-sql/pglite'
```

GitHub Actions도 동일한 pin과 runner를 사용합니다. Contract는 마이그레이션 적용, 10개 테이블, 익명 접근 거부, Workspace A/B 격리, 교차 Workspace Product 연결 거부, 직접 DML 차단, 두 RPC 성공 경로, 매핑 원자성, Issue 상태 전이를 확인해야 합니다.

PGlite는 PostgreSQL 엔진을 검증하지만 Supabase Auth, PostgREST와 API gateway를 포함하지 않습니다. 실제 Supabase 프로젝트를 연결한 뒤에는 별도 개발 프로젝트에서 pgTAP/RLS, Data API와 Auth 통합을 다시 검증해야 합니다.

현재 PGlite Contract에서는 세 마이그레이션과 10개 테이블 생성, 직접 DML 차단, Workspace A/B의 자기 RPC 성공, 다른 Workspace Offer·Product·Issue 접근 거부, Alias 실패 시 전체 rollback과 Issue 상태 전이가 통과했습니다. 실제 Supabase 배포와 Auth/PostgREST 통합은 아직 검증하지 않았습니다.

## 라이브 적용 전 절차

Docker가 실행되는 개발 환경에서는 다음 순서로 로컬 스택을 확인합니다.

```sh
npx --yes supabase start
npx --yes supabase db reset
npx --yes supabase test db
npx --yes supabase db lint --local
```

호스팅 프로젝트에는 먼저 별도 개발 프로젝트를 연결하고 마이그레이션을 검토한 뒤 적용합니다.

```sh
npx --yes supabase login
npx --yes supabase link --project-ref <development-project-ref>
npx --yes supabase db push
```

현재 라이브 적용 상태는 미실행입니다.
