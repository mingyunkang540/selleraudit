# SellerAudit database foundation

SellerAudit V0.1의 데이터베이스 경계는 `supabase/migrations/20261009015155_seller_audit_foundation.sql`과 `20261010064046_audit_channel_context.sql`에 정의되어 있다. 두 마이그레이션은 로컬 파일로 작성·검증했으며, 현재 연결된 Supabase 프로젝트가 없으므로 라이브 데이터베이스에는 적용하지 않았다.

## 범위

Foundation 스키마는 다음 테이블을 만든다.

| 테이블 | 역할 | 주요 무결성 규칙 |
| --- | --- | --- |
| `workspaces` | 테넌트 루트 | UUID PK |
| `workspace_members` | Auth 사용자와 워크스페이스 연결 | `(workspace_id, user_id)` PK, 신뢰된 서버 프로비저닝 전용 |
| `products` | 사방넷 품번 기준 판매상품 Master | 워크스페이스별 `sabangnet_code` 고유 |
| `skus` | 실제 물류/재고 SKU | 워크스페이스별 `sku_code` 고유 |
| `product_components` | Product ↔ SKU BOM | 워크스페이스 복합 FK, `quantity > 0` |
| `channels` | 워크스페이스 채널 | 워크스페이스별 `channel_code` 고유 |
| `channel_listings` | 채널 상품 페이지 | 워크스페이스/채널별 `channel_product_id` 고유 |
| `channel_offers` | 실제 판매 옵션/판매 단위 | 워크스페이스 복합 FK, 가격 음수 금지, 옵션 없는 상품은 `BASE` |
| `aliases` | 사람이 확정한 상품명 매칭 사전 | 원문 상품명·옵션명·채널 조합 고유, 원문 보존 |
| `audit_issues` | 감사 이슈 | 워크스페이스 복합 FK, Offer가 있으면 같은 Listing 참조, 명시한 Channel과 Listing 일치 |

모든 자식 관계는 `workspace_id`를 포함한 복합 외래 키를 사용한다. 다른 워크스페이스의 Product, SKU, Channel, Listing, Offer를 연결하는 쓰기는 데이터베이스 제약으로 거부된다. 금액은 정확한 십진 연산을 위해 `numeric(14, 2)`를 사용하며 음수를 허용하지 않는다. PostgreSQL의 제약 및 데이터 타입 지침은 [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)와 [Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html)를 따른다.

`channel_offers.channel_option_id`는 `NOT NULL DEFAULT 'BASE'`이다. Insert/Update에서 `NULL` 또는 공백 문자열이 들어와도 트리거가 `BASE`로 정규화한다. 따라서 TypeScript의 `ChannelOffer.channelOptionId`는 항상 문자열로 취급할 수 있다.

`audit_issues.channel_id`는 Listing이 없는 `MISSING_CHANNEL` 이슈의 대상 채널을 보존한다. 상품 전체에 해당하는 이슈는 `NULL`을 허용한다. 후속 마이그레이션은 기존 Listing 연결 이슈의 채널을 채우고, `(workspace_id, channel_id, listing_id)` 복합 FK로 명시한 채널과 Listing의 불일치를 거부한다. 이전 localStorage 데모 문서는 Listing으로 채널을 복원하며, 근거가 없는 상품 단위 이슈에는 채널을 추측하지 않는다.

실제 SCM RAW/NORMALIZED 테이블, Import Engine, Adapter, 자동매칭, 실제 Audit 알고리즘은 이 마이그레이션에 포함하지 않는다.

## 보안 경계

`public`의 모든 테이블에 RLS를 활성화했다. Supabase는 노출 스키마의 테이블마다 RLS를 켜고, grants와 policies를 함께 설계할 것을 요구한다. 자세한 기준은 [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)와 [Securing your API](https://supabase.com/docs/guides/api/securing-your-api)를 참고한다.

- `anon`에는 테이블 권한과 RPC 실행 권한이 없다.
- `authenticated`는 자신의 `workspace_members` 행과 그 행이 허용하는 워크스페이스 데이터만 읽을 수 있다.
- `authenticated`에는 Workspace, Member, Product, SKU, BOM, Channel, Listing을 직접 생성·수정·삭제하는 권한이 없다.
- 매핑에 필요한 최소 컬럼 쓰기와 이슈 상태 변경에 필요한 최소 컬럼 쓰기만 부여한다. 앱은 아래 RPC를 사용해야 한다.
- `workspace_members`의 Insert/Update/Delete는 `authenticated`에 허용하지 않는다. 가입 처리는 서버의 `service_role` 또는 관리자 SQL 같은 신뢰된 프로비저닝 경계에서 수행한다. 브라우저에 `service_role` 키를 노출하면 안 된다.
- 마이그레이션은 `auto_expose_new_tables = false`를 사용하고 필요한 grants를 명시한다. 이는 2026년 Data API의 신규 테이블 자동 노출 변경과 일치한다. 변경 내용은 [Supabase breaking-change changelog](https://supabase.com/changelog?types=breaking-change)에서 확인할 수 있다.

### `map_offer`

```sql
public.map_offer(p_offer_id uuid, p_master_product_id uuid)
```

하나의 트랜잭션에서 다음을 수행한다.

1. 호출자가 접근 가능한 Offer, Listing, Channel을 잠그고 읽는다.
2. 대상 Product가 같은 워크스페이스에 있으며 호출자에게 보이는지 확인한다.
3. `channel_offers.master_product_id`를 갱신한다.
4. Listing 상품명, Offer 옵션명, Channel 코드를 가공하지 않은 원문 그대로 `aliases`에 upsert한다.
5. 해당 Offer에 직접 연결된 `OPEN`/`IN_PROGRESS` 상태의 `UNMATCHED` 이슈만 `RESOLVED`로 바꾸고 `resolved_at`을 기록한다.

Listing 수준의 `UNMATCHED` 이슈(`offer_id IS NULL`)는 한 Offer를 매핑했다고 자동 해결하지 않는다. 같은 Listing의 다른 Offer가 아직 미매핑일 수 있기 때문이다. Listing 수준 이슈의 해소 규칙은 실제 Matching/Audit 단계에서 정의한다. 사용자가 이미 `IGNORED`로 분류한 이슈도 수동 결정을 보존하기 위해 자동으로 `RESOLVED`로 덮어쓰지 않는다.

### `update_issue_status`

```sql
public.update_issue_status(p_issue_id uuid, p_status text)
```

허용 상태는 `OPEN`, `IN_PROGRESS`, `RESOLVED`, `IGNORED`이다. `NULL`과 그 밖의 값은 명시적으로 거부한다. `RESOLVED`로 바꿀 때 `resolved_at`을 최초 한 번 기록하고, 다른 상태로 되돌리면 `resolved_at`을 `NULL`로 만든다.

두 RPC 모두 `SECURITY INVOKER`이며 빈 `search_path`와 완전 수식된 테이블명을 사용한다. 따라서 호출자의 grants와 RLS가 그대로 적용된다. 실행 권한은 기본 `PUBLIC`/`anon`에서 회수하고 `authenticated`와 `service_role`에만 부여한다. 이 선택은 [Supabase Database Functions 보안 지침](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker)을 따른다.

프론트엔드 호출 예시는 다음과 같다.

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

## TypeScript ↔ PostgreSQL 경계

애플리케이션 도메인은 camelCase를 유지하고, 저장소/서비스 계층에서 DB의 snake_case로 변환한다. React 컴포넌트가 Supabase row를 직접 도메인 타입으로 간주하지 않는다.

| TypeScript | PostgreSQL |
| --- | --- |
| `workspaceId` | `workspace_id` |
| `sabangnetCode` | `sabangnet_code` |
| `productName` | `product_name` |
| `productType` | `product_type` |
| `normalPrice` | `normal_price` |
| `skuCode` | `sku_code` |
| `modelName` | `model_name` |
| `productId` | `product_id` |
| `skuId` | `sku_id` |
| `channelCode` | `channel_code` |
| `channelName` | `channel_name` |
| `channelId` | `channel_id` |
| `channelProductId` | `channel_product_id` |
| `productUrl` | `product_url` |
| `lastSyncedAt` | `last_synced_at` |
| `listingId` | `listing_id` |
| `channelOptionId` | `channel_option_id` |
| `optionName` | `option_name` |
| `sellerCode` | `seller_code` |
| `salePrice` | `sale_price` |
| `masterProductId` | `master_product_id` |
| `rawProductName` | `raw_product_name` |
| `rawOptionName` | `raw_option_name` |
| `sourceChannel` | `source_channel` |
| `issueType` | `issue_type` |
| `offerId` | `offer_id` |
| `detectedAt` | `detected_at` |
| `resolvedAt` | `resolved_at` |
| `createdAt` | `created_at` |
| `updatedAt` | `updated_at` |

`numeric` 값은 Supabase/PostgREST 응답에서 문자열로 전달될 수 있으므로 저장소 경계에서 유한한 숫자인지 확인한 뒤 도메인 `number`로 변환한다. UUID와 timestamp도 저장소 경계에서 문자열 형식을 검증한다.

## 로컬 적용

Supabase CLI 명령은 현재 버전의 `--help`로 확인한 형식을 사용한다. CLI 워크플로는 [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction)와 [Local development](https://supabase.com/docs/guides/local-development)를 참고한다.

Docker가 실행 중인 개발 환경에서:

```bash
cd seller-audit
npx --yes supabase start
npx --yes supabase db reset
```

RLS 검증과 정적 검사:

```bash
npx --yes supabase test db
npx --yes supabase db lint --local
npx --yes supabase migration list --local
```

현재 작업 환경에는 Docker/로컬 Supabase PostgreSQL이 없어 `supabase db lint --local`은 `127.0.0.1:54322` 연결 거부로 실행되지 않았다. 대신 저장소 의존성을 추가하지 않는 격리된 [PGlite](https://pglite.dev/) `0.5.8` PostgreSQL WASM 런타임에서 마이그레이션 전체와 `supabase/tests/pglite/foundation_contract.sql`을 실행했다. PGlite의 `exec`는 migration 같은 multi-statement SQL 실행 용도로 제공된다([PGlite API](https://pglite.dev/docs/api#exec)). 라이브 프로젝트에는 적용하지 않았다.

PGlite는 PostgreSQL 엔진 동작을 검증하지만 단일 사용자/단일 연결 런타임이며 Supabase Auth, PostgREST, API gateway를 포함하지 않는다. QA harness는 `anon`, `authenticated`, `service_role BYPASSRLS`, `auth.users`, `auth.uid()`를 테스트용으로 만들고 `request.jwt.claim.sub`를 기준으로 사용자를 전환했다. 따라서 실제 Supabase 통합의 pgTAP 및 Data API 검증은 별도로 필요하다. 이 한계는 [PGlite npm 문서](https://www.npmjs.com/package/@electric-sql/pglite)의 single user/connection 설명과 일치한다.

동일 검증은 프로젝트 의존성을 변경하지 않고 PowerShell에서 재현할 수 있다. `seller-audit` 폴더에서 실행한다.

```powershell
$sellerAuditQa = Join-Path $env:TEMP ('seller-audit-db-qa-' + [guid]::NewGuid())
npm.cmd install --prefix $sellerAuditQa --no-save --package-lock=false --ignore-scripts '@electric-sql/pglite@0.5.8'
node supabase/tests/pglite/run.mjs (Join-Path $sellerAuditQa 'node_modules/@electric-sql/pglite/dist/index.js')
npm.cmd uninstall --prefix $sellerAuditQa --no-save --package-lock=false '@electric-sql/pglite'
```

인증 사용자의 컬럼 단위 쓰기 권한은 `SECURITY INVOKER` RPC 실행에도 사용된다. 매핑과 Alias·이슈 갱신의 원자성은 `map_offer` 호출 경계에서 보장되며, 개별 테이블을 직접 쓰는 클라이언트까지 해당 업무 흐름을 강제하는 구조는 아니다. 실제 Supabase 저장소 구현은 반드시 RPC를 호출해야 한다.

호스팅 프로젝트에 적용할 때는 먼저 별도 개발 프로젝트에서 검증한 뒤 다음 순서로 진행한다.

```bash
cd seller-audit
npx --yes supabase login
npx --yes supabase link --project-ref <development-project-ref>
npx --yes supabase db push
```

워크스페이스와 최초 멤버는 브라우저가 아닌 신뢰된 서버 또는 관리자 SQL에서 같은 트랜잭션으로 생성한다.

```sql
begin;

insert into public.workspaces (name)
values ('Demo workspace')
returning id;

insert into public.workspace_members (workspace_id, user_id, role)
values ('<workspace-id>', '<auth-user-id>', 'OWNER');

commit;
```

## 검증 상태

- Supabase CLI `2.120.0`으로 `supabase init`과 `supabase migration new seller_audit_foundation`을 실행해 프로젝트 설정과 마이그레이션 파일을 생성했다.
- 격리된 PostgreSQL 런타임에서 마이그레이션이 성공적으로 실행되고 10개 테이블이 생성됨을 확인했다.
- 채널 누락 이슈를 Listing 없이 저장·필터링할 수 있고, 다른 워크스페이스의 채널 또는 같은 워크스페이스 내 채널/Listing 불일치가 거부됨을 확인했다.
- 저장된 SQL contract가 통과했다: 워크스페이스 교차 FK 거부, BOM 양수 제약, 가격 비음수 제약, 익명 접근 거부, 사용자 ID 누락 시 데이터 비노출/RPC 거부, 멤버 워크스페이스 격리, 멤버 자체 가입 거부, 비허용 컬럼 직접 수정 거부, Alias 실패 시 `map_offer` 전체 롤백, 인증 사용자 RPC 컬럼 권한, `BASE` 정규화, Alias 원문 보존, 정확한 Offer 이슈만 해결, Listing 수준 이슈 유지, `IGNORED` 유지, `NULL` status 거부, Issue `resolved_at` 전이.
- 테이블별 RLS 활성화, 익명 권한 회수, 인증 사용자 grants, RPC 권한, 워크스페이스 복합 FK, FK 인덱스를 정적으로 검토했다.
- 라이브 스키마 적용: 미실행.
- 공식 Supabase 로컬 스택의 `db lint` 및 pgTAP RLS 테스트: Docker/`psql` 부재로 미실행.
