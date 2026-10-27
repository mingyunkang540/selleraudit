# SellerAudit Supabase 원격 인수 결과

## 상태와 근거 범위

프로젝트 소유자는 2026-10-25 아래 원격 인수 결과를 제공했다. 이번 작업에서 read-only Supabase 연결로 프로젝트 identity와 현재 remote migration version 5개를 별도로 확인했다. Auth/RLS/RPC의 실제 동작 결과와 acceptance 데이터 cleanup은 프로젝트 소유자가 제공한 결과이며 이번 문서 작업에서 다시 실행하지 않았다.

| 항목 | 값 |
| --- | --- |
| Project | `selleraudit-dev` |
| Project ref | `yzpkhvuftusnshdqfnim` |
| Region | `ap-northeast-2` |
| Project status | `ACTIVE_HEALTHY` |
| 인수 일자 | 2026-10-25 |

read-only 연결로 확인한 remote migration version은 다음과 같다.

```text
20261009015155
20261010064046
20261010080630
20261025090000
20261025090001
```

## Prompt 5D 결과

```text
REMOTE SCHEMA: GO
REMOTE AUTH: GO
REMOTE RLS: GO
REMOTE IMPORT: GO
OVERALL REMOTE ACCEPTANCE: GO
```

프로젝트 소유자가 제공한 검증 범위:

- ACTIVE ADMIN, EDITOR, VIEWER 접근과 DISABLED VIEWER 거부
- Workspace A 접근과 별도 QA Workspace 격리
- ADMIN과 EDITOR의 `persist_master_import_dry_run` 성공
- VIEWER와 DISABLED의 persistence 거부
- VIEWER의 ImportBatch metadata 조회와 Raw·Validation Issue detail·ActivityLog 거부
- EDITOR의 Raw·Validation Issue detail 조회와 ActivityLog 거부
- ADMIN ActivityLog 조회
- malformed payload 실패 시 Batch·Raw·Issue·ActivityLog가 남지 않는 atomic rollback
- 브라우저 실제 로그인
- acceptance 전용 생성 데이터 cleanup

제공된 Security Advisor 결과에는 critical/high finding이 없었다. `Leaked Password Protection Disabled` warning은 Pilot 전 보안 작업으로 남긴다.

## Prompt 5E 경계

Prompt 5D 인수는 위 5개 Migration에 적용된다. 이후 Candidate Snapshot과 Human Review 구현을 증명하지 않는다.

5E의 Candidate Snapshot/Review, FK index, review 권한 잠금 Migration을 같은 Development 프로젝트에 적용해 remote migration list 8개가 저장소와 일치한다.

```text
20261025114440
20261025115414
20261026093754
```

Migration 적용 뒤 Security Advisor에서는 새 finding이 없었고 기존 `Leaked Password Protection Disabled` warning 한 건만 남았다. Performance Advisor가 Candidate main Raw composite FK의 미색인 INFO를 보고해 `20261025115414_index_import_candidate_raw_row_fk.sql`로 보완했고 해당 INFO가 해소됐다. 기존 테이블의 FK index INFO 2건과 unused index INFO는 별도 성능 정리 항목으로 남아 있다. `20261026093754_lock_import_review_authorization.sql`은 Candidate/Issue review 중 ADMIN membership과 Batch 행까지 잠가 권한 변경과 검토 저장을 직렬화한다. 원격 함수 정의에서 두 잠금을 확인했다.

## Prompt 5E DB Contract 결과

기존 ACTIVE ADMIN/EDITOR/VIEWER/DISABLED 사용자의 `user_id`를 JWT claim으로 재현한 `authenticated` role에서 다음을 원격 DB transaction으로 검증했다.

- ADMIN/EDITOR Candidate persistence PASS
- ADMIN Candidate review와 Issue review PASS
- EDITOR review DENY
- VIEWER/DISABLED persistence와 Candidate SELECT DENY
- Cross Workspace persistence DENY
- stale review revision DENY
- malformed Candidate 전체 rollback PASS
- `IMPORT_VALIDATED`와 `IMPORT_REVIEWED` ActivityLog 생성 PASS
- `products`, `skus`, `product_components` row count 불변 PASS

모든 fixture는 `BEGIN/ROLLBACK`으로 정리했다. 확인 시점의 acceptance Batch와 Candidate 잔여 행은 각각 0건이다. `products`, `skus`, `product_components`도 검증 전후 모두 0건으로 변하지 않았다.

이 검증은 원격 PostgreSQL의 role/RLS/RPC 계약을 확인한다. 추가로 기존 ADMIN, VIEWER, DISABLED 계정의 실제 이메일/비밀번호 Auth 로그인에 성공했다. ADMIN의 실제 사용자 토큰으로 Candidate와 Issue를 저장·조회했고, 브라우저에서 Candidate override와 Issue resolution을 기록했다. normalized value, Candidate status와 Batch의 `REVIEW_REQUIRED` 상태는 유지됐다. VIEWER와 DISABLED는 실제 사용자 토큰의 Candidate 조회·저장 RPC가 거부됐고 브라우저에서도 Import 접근이 차단됐다.

이 live 검증에서 만든 `__SELLERAUDIT_5E_ACCEPTANCE_ADMIN__1793006964342.xlsx` Batch 1건과 그 Candidate·Issue·Raw·ActivityLog를 정확한 ID와 생성자·파일명으로 대조한 뒤 정리했다. 정리 후 해당 Batch, Candidate, Issue 잔여 행은 모두 0건이다. 당시 EDITOR 자격증명 오류로 보류했던 실제 세션 검증은 아래와 같이 2026-10-26 완료했다. 비밀번호 값은 로그나 문서에 기록하지 않았다.

```text
REMOTE 5E ACCEPTANCE = GO
DB CONTRACT = PASS
LIVE AUTH / BROWSER = PASS (ADMIN, EDITOR, VIEWER, DISABLED)
```

2026-10-26 실제 EDITOR Auth 세션에서 `땡스소윤 DEV`의 ACTIVE EDITOR membership만 노출되고 `SellerAudit QA Workspace`가 보이지 않음을 확인했다. 같은 access token으로 7-argument Candidate persistence RPC를 호출해 Batch·Raw·Candidate·Validation Issue와 `IMPORT_VALIDATED`를 저장했다. Batch의 생성자와 Workspace, `REVIEW_REQUIRED`, validation revision 1을 확인했다. EDITOR는 네 종류의 상세 행을 읽을 수 있었고 ActivityLog 직접 조회는 거부됐다. 유효한 ID·revision·payload로 시도한 Candidate/Issue review는 모두 권한 때문에 거부됐으며, 두 행의 review metadata·normalized 값·상태는 변경되지 않았다. privileged 조회에서 해당 fixture의 `IMPORT_REVIEWED`는 0건이었다.

실제 EDITOR token의 Workspace 목록에는 존재하는 QA Workspace 행이 보이지 않았다. QA Workspace ID로 Batch·Raw·Candidate·Issue를 조회한 결과는 모두 0건이었고, 같은 ID로 persistence를 시도하면 거부됐다. privileged 조회상 QA Workspace의 해당 네 테이블에도 행이 0건이므로 상세 행 조회 결과만으로 RLS를 단독 입증하지는 않는다. 별도 DB 역할/RLS 계약 검증과 실제 Workspace 비노출·persistence 거부를 함께 근거로 삼았다. QA Workspace에는 검증용 fixture를 생성하지 않았다. 브라우저에서도 EDITOR 로그인, Master Import 접근, 저장된 Batch와 Candidate·Issue 상세 조회, review 제어의 읽기 전용 상태를 확인했다. 이 검증은 `scripts/remote-5e-editor-acceptance.mjs`를 사용했으며 비밀번호·token을 출력하거나 추적 파일로 저장하지 않았다.

검증용 Batch `9ba550cc-2931-4074-a050-224a0ef46b51`과 Raw·Candidate·Issue·ActivityLog의 정확한 ID, Workspace, EDITOR 생성자, 파일명을 대조한 뒤 한 transaction에서 해당 5개 행만 삭제했다. 사후 정확한 ID 조회는 모두 0건이었다. `products`, `skus`, `product_components`는 검증 전후 각각 0건이며, `channels`, `channel_listings`, `channel_offers`, `aliases`, `audit_issues`도 전후 0건이다. Security Advisor에는 새 finding이 없고 기존 `Leaked Password Protection Disabled` warning만 남았다.

로컬 `.env.remote-test.local.txt`는 Git에서 제외하며 테스트 계정의 이메일·비밀번호를 담는다. `node scripts/remote-5e-auth-check.mjs`로 네 계정의 실제 Auth 로그인과 표시 가능한 멤버십을 다시 검사하고, `node scripts/remote-5e-browser-roles.mjs`로 VIEWER·DISABLED의 브라우저 접근 차단을 다시 검사할 수 있다. 이 두 스크립트는 Import 기록을 생성하거나 삭제하지 않는다. EDITOR 인수 스크립트의 `api` 단계는 원격 fixture를 생성하므로 정확한 ID를 기록하고 수동 cleanup할 수 있을 때만 재실행한다.

`db reset --linked`를 실행하거나 기존 테스트 계정·Workspace를 삭제하지 않는다. Development 결과를 Production 인수로 취급하지 않는다.

## Prompt 5F 원본 Storage 및 서버 SHA-256 인수 (2026-10-26)

정확한 Development 프로젝트 `selleraudit-dev` (`yzpkhvuftusnshdqfnim`)에 `20261026121803_private_master_source_verification.sql`, `20261026121915_move_5f_trusted_functions_private.sql`을 적용했다. 로컬/원격 Migration version은 10개가 일치한다. private `seller-audit-import-sources` bucket은 50 MiB 제한과 XLSX MIME allowlist를 가지며, `verify-master-import-source` 및 `create-master-source-download-url` Edge Function v2는 JWT 검증을 켜고 배포했다. service-role secret은 Edge 서버에서만 사용한다. v2 배포 후 네 역할의 알 수 없는 SourceFile 접근 거부를 별도 smoke check로 확인했다.

실제 ADMIN·EDITOR·VIEWER·DISABLED Auth 세션과 작은 acceptance XLSX로 다음을 검증했다.

| 범위 | 결과 |
| --- | --- |
| ADMIN·EDITOR 등록, private 업로드, 서버 SHA-256 검증 | PASS |
| client/server hash 및 byte 크기 일치, VERIFIED 재호출 멱등성 | PASS |
| VIEWER·DISABLED 등록·업로드·검증·metadata·signed URL 거부 | PASS |
| 익명 함수 호출·private direct download, 인증 사용자의 direct Storage SELECT 거부 | PASS |
| ADMIN 60초 signed URL 발급과 다운로드 byte hash 일치 | PASS |
| 같은 경로 overwrite/update 거부 | PASS |
| 다른 hash, 없는 객체, 잘못된 byte 크기의 실패 처리와 미검증 저장 거부 | PASS |
| 기존 7-argument persistence 거부, 검증된 SourceFile로 Batch·Raw·Candidate·Issue·Log 원자 저장 | PASS |
| Batch의 SourceFile ID·server hash·`SERVER_VERIFIED`·`REVIEW_REQUIRED` | PASS |
| ADMIN Candidate/Issue review 허용, EDITOR review 거부 | PASS |
| 다른 Workspace 등록·객체 경로 업로드·조회·저장 거부 | PASS |
| Product·SKU·BOM Master 불변 | PASS |

`scripts/remote-5f-source-acceptance.mjs`의 기본, `post`, `finish` 단계가 위 실제 Auth/Storage/Edge/DB 경계를 검사했다. Legacy `CLIENT_OBSERVED` Batch의 Candidate·Issue 새 review 거부는 PGlite DB contract에서 검증했다. 화면 동작은 Supabase-mode fake API E2E에서 검증했다. 실제 브라우저에서 원본 다운로드 버튼을 누르는 별도 수동 검사는 수행하지 않았으므로 signed URL의 실제 byte 다운로드 검증을 그 네트워크 동작의 근거로 사용한다.

인수 fixture는 SourceFile ID 5개, Storage 객체 4개(없는 객체 검증 fixture 1개), Batch ID 2개와 정확한 Raw 2개·Candidate 2개·Issue 1개·ActivityLog 6개를 기록했다. Workspace·등록자·파일명·object path·Batch 연결을 대조한 뒤 객체는 경로마다 하나씩, DB 행은 ID마다 한 transaction에서 삭제했다. 사후 exact ID 조회 결과 SourceFile·Batch·Raw·Candidate·Issue·ActivityLog는 모두 0건이고 해당 Workspace의 Storage 객체도 0건이다. Product·SKU·BOM은 전후 각각 0건이다. 임시 ID 기록 파일은 확인 후 삭제했다.

Security Advisor의 새 finding은 0건이다. 기존 `Leaked Password Protection Disabled` warning 1건은 남아 있으며 [Supabase 비밀번호 보호 설정](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)이 Pilot 운영 전 과제다. Production에는 배포하지 않았다.

```text
LOCAL 5F = GO
REMOTE STORAGE = PASS
REMOTE SERVER HASH = PASS
REMOTE RLS = PASS
REMOTE VERIFIED PERSISTENCE = PASS
OVERALL REMOTE 5F = GO
```

원본 검증은 Approval이나 Apply가 아니다. `READY_TO_APPLY`, Product/SKU/BOM Apply, validation revision 2와 Storage 자동 정리는 범위 밖이다. 상세 신뢰 계약과 backup 한계는 [원본 보관·검증](data/IMPORT_SOURCE_STORAGE.md)에 기록했다.

## Prompt 5G 원본 백업·동일 경로 복구 리허설 (2026-10-26)

5F commit `1830f5d`에서 분기한 5G는 DB·RLS·Edge·UI를 바꾸지 않고, `selleraudit-dev` (`yzpkhvuftusnshdqfnim`)의 전용 fixture 한 건에 [백업·복구 절차](ops/SOURCE_BACKUP_RESTORE.md)를 실행했다. 일반 ADMIN 세션으로 SourceFile 등록·private 업로드·서버 검증을 완료한 뒤, trusted local ops로 exact object를 백업하고 SHA-256/15,921 byte를 DB의 검증값과 대조했다. Storage API로 exact path 하나를 삭제하고 부재를 확인했으며, 같은 bucket/path에 `upsert: false`로 복원했다. Trusted download와 기존 ADMIN 60초 signed-download의 hash/size가 모두 일치했고 SourceFile metadata는 변하지 않았다.

최종 fixture SourceFile ID는 `b4cdd47e-2bae-4902-b177-bd56f4091cde`, object path는 `bfa4dc64-f4f9-428e-b8f9-61ff36d27db8/b4cdd47e-2bae-4902-b177-bd56f4091cde/source.xlsx`, SHA-256은 `e387c806c3362c7ff8b003143ba1ccc7067371c718c69175e46bc062a5d3caec`이었다. 정확한 object path, SourceFile ID, ActivityLog ID `911454df-cc04-48e6-8ff6-19a8a88c4b60`, 로컬 fixture 백업을 정리했다. 사후 SQL exact ID 조회와 전체 count에서 SourceFile/Storage object/관련 ActivityLog 모두 0건이며 다른 object 수는 전후 0건으로 같았다.

로컬 검증은 unit 61, 기본 E2E 16, Supabase-mode E2E 18, typecheck, lint, build, PGlite 10 migration·16 table DB contract가 통과했다. 원격 migration 수는 전후 10개, 기존 Edge Function은 각각 v2로 동일하다. Security Advisor 새 finding은 0건이며 기존 `Leaked Password Protection Disabled` warning 1건은 별도 Pilot 전 과제로 남긴다.

```text
LOCAL 5G = GO
REMOTE 5G = GO
OVERALL 5G = GO
```

이는 Development fixture 한 건의 복구 절차 증거다. 로컬 백업은 production/off-site/durable backup이 아니다. 자동 백업·retention·source 재검증·Approval·Apply는 구현하지 않았다.

## Prompt 6A Pilot Master Apply 인수 (2026-10-27)

`selleraudit-dev` (`yzpkhvuftusnshdqfnim`)에 create-only Pilot Apply Migration을 적용했다. 원격 Migration version은 `20261027111722`이며 저장소 파일은 `supabase/migrations/20261027111722_pilot_master_apply_v1.sql`이다. Production에는 적용하지 않았다. `scripts/remote-6a-apply-acceptance.mjs`는 실제 ADMIN 브라우저와 ADMIN/EDITOR/VIEWER/DISABLED Auth 세션을 사용하고, `.env.ops.local`의 서버 전용 secret key는 정확한 ID 조회·정리에만 사용한다. 비밀번호·token·secret key·서명 URL은 출력하거나 커밋하지 않았다.

전용 `__SELLERAUDIT_6A_APPLY__<unique>.xlsx`는 상품 1, SKU 1, BOM 1을 포함한다. 실제 브라우저에서 파일 선택, private Storage 업로드, 서버 byte SHA-256 검증, Dry-run과 Candidate 중앙 저장을 수행했다. 저장된 Batch의 Apply Preview는 Product/SKU/BOM 각각 `NEW 1`이었고 ADMIN의 명시적 확인 뒤 세 Master 행이 한 번 생성됐다. `applied_count=3`, `remaining_count=0`, Batch `APPLIED`, `IMPORT_APPLIED` ActivityLog 정확히 1건을 확인했다. 완료 Batch의 두 번째 Apply는 거부됐다.

브라우저에서 Apply 성공 링크를 통해 상품 Master로 이동한 뒤 새 품번을 검색했고, Product 360의 `SKU 구성 (BOM)`에서 새 SKU와 수량을 확인했다. SKU Master 검색에서도 같은 SKU가 보였다. 이는 실제 Development 원격 데이터를 읽은 UI 결과다.

별도 서버 검증된 충돌 fixture는 동일 품번에 다른 Product명을 사용했다. Preview `CONFLICT 1`/`canApply=false`, ADMIN Apply 거부, 기존 Product명 불변을 확인했다. EDITOR는 실제 Auth 세션에서 Preview 허용·Apply 거부, VIEWER와 DISABLED는 Preview·Apply 모두 거부됐다. 다른 QA Workspace의 정확한 Batch ID를 대상으로 한 ADMIN Preview·Apply도 거부됐다.

최종 통과 fixture의 정확한 Master UUID는 Product `62c47fec-f3cb-4603-a55b-9bfa816a1b61`, SKU `97ced05b-fc85-4590-bed7-11ecb2a1f953`, ProductComponent `212fc8fc-b0f0-4c1a-8765-fa20d7365590`이었다. Batch는 `0cc48897-03d4-421a-ba78-96336c198329`, `60f27433-9331-4ea8-957f-38059a63a6f4`, SourceFile은 `bb4e1c52-b720-4660-83f0-d96779d5979e`, `75a675d9-bd0a-4f51-a953-27fe974c8651`이었다. 스크립트가 이들과 연결된 Raw/Candidate/Issue/ActivityLog의 정확한 UUID 및 두 Storage object path를 기록하고 FK 역순으로 정리했다. 사후 모든 해당 UUID·object 조회는 0건이며, Workspace의 Product/SKU/BOM/Batch/Raw/Candidate/Issue/ActivityLog/SourceFile count는 인수 전후 모두 0건으로 일치했다. 테스트 중 중단된 두 이전 fixture도 각각 정확한 ID로 정리해 전후 count 0을 확인했다. 광범위 prefix 삭제는 사용하지 않았다.

로컬 PGlite는 11개 Migration과 새 Preview/Apply 계약을 통과했다. unit 64건, 기본 Chromium E2E 16건, Supabase 모의 E2E 21건, typecheck, lint, build도 통과했다. 실제 제공된 Master Workbook을 로컬에서 재분석해 `100526` 중복 7개가 모두 ERROR, `AL24` BOM이 ERROR, `AL510` SKU가 DEFERRED, BOM 수량 불일치 이슈가 8건임을 확인했다. 이들을 자동 NEW로 승격하지 않았다.

Migration 전후 Security Advisor는 같은 기존 `Leaked Password Protection Disabled` WARN 한 건만 보고했다. 새 보안 finding은 0건이다. Performance Advisor의 미색인 FK INFO 5건은 전후 동일하며 신규 성능 경고는 없다. 기존 warning의 [Supabase 설정 안내](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)는 별도 Pilot 운영 결정 사항이다.

```text
LOCAL 6A = PASS
REMOTE APPLY CONTRACT = PASS
REMOTE UI END-TO-END = PASS
REMOTE CLEANUP = PASS
OVERALL 6A = GO (Development Pilot only)
```

6A GO는 Development에서 이 한 흐름을 실제로 수행할 수 있다는 의미다. 기존 Master UPDATE/DELETE, 정식 Approval, `READY_TO_APPLY`, validation revision 2와 Production readiness를 뜻하지 않는다.

## Prompt 6B Pilot Master Safe Update 인수 (2026-10-27)

Development 프로젝트 `selleraudit-dev` (`yzpkhvuftusnshdqfnim`)에 `20261027143410_pilot_master_safe_update_v1.sql`을 적용했다. 저장소와 원격의 Migration은 12개이며 Production에는 적용하지 않았다. `scripts/remote-6b-safe-update-acceptance.mjs`가 실제 ADMIN 브라우저, 네 역할의 Auth 세션, 서버 검증된 private 원본과 정확한 ID 기반 정리를 수행했다. 비밀번호·token·secret key·signed URL은 출력하거나 커밋하지 않았다.

첫 Workbook을 ADMIN 브라우저에서 업로드·검증·저장·확인해 Product, SKU, BOM을 각각 한 건 생성했다. 두 번째 Workbook은 같은 business key의 Product명·카테고리, SKU 모델명·색상, BOM 수량을 변경했다. 브라우저 Preview의 `UPDATE 1` 세 건과 필드별 변경 전후 값, ADMIN 확인 창의 신규·변경 수 및 삭제 없음 안내, Apply 완료 수를 확인했다. Product/SKU/ProductComponent UUID는 생성 시와 변경 후 같았다. Product Master, SKU Master, Product 360 화면에도 변경된 값이 표시됐다.

세 번째 Product-only Workbook은 기존 SKU/BOM을 생략하고 Product 카테고리만 변경했다. `Product UPDATE 1`, `SKU/BOM UPDATE 0`으로 성공 적용한 뒤 기존 SKU/BOM UUID·값·연결이 유지됨을 확인했다. 따라서 누락 항목의 자동 삭제가 없다는 검증은 거부된 Batch에 의존하지 않는다. 별도 Product type `SINGLE → SET` Batch는 `CONFLICT 1`로 Preview되고 Apply가 거부됐다. 완료 Batch의 재실행도 거부됐다.

실제 EDITOR는 UPDATE Preview를 읽고 Apply가 거부됐다. VIEWER/DISABLED의 Preview·Apply는 거부됐고, ADMIN도 다른 Workspace의 Batch에 Preview·Apply할 수 없었다. `IMPORT_APPLIED` 요약의 신규/변경/동일/제외 수와 각 Master UPDATE의 `sourceBatchId`, 실제 변경 필드 `before`/`after` 로그를 확인했다. 로컬 DB contract는 실패 중 Master와 ActivityLog 원자 rollback을 검증했다.

최종 fixture의 Master UUID는 Product `f2f8f678-2b93-41da-bc4f-e593ed4029c3`, SKU `c896b0cc-6be0-46ea-97a7-b8f528a10390`, ProductComponent `68450344-3ff6-4ad1-8f98-b58f72200ff2`였다. CREATE/UPDATE/OMISSION/CONFLICT Batch ID는 각각 `eb034ed6-8fae-4c65-bd8a-b8feda9a5cb7`, `05cce25b-deab-41df-b67a-d183cdaba1fe`, `6dadb5e9-45d8-4e66-9988-ced6157653f8`, `6968ed09-3b0f-4003-b517-7e0cde388c95`였다. 대응 SourceFile 네 건, exact Storage path 네 개, Raw/Candidate/Issue/ActivityLog의 정확한 ID를 스크립트가 추적해 정리했다. 사후 fixture의 모든 정확한 ID·Storage object 조회는 0건이고, Workspace의 9개 관련 테이블 count는 실행 전후 일치했다. 작업 중 한 번 중단된 별도 fixture도 저장된 exact ID만 정리하고 count 일치를 확인한 뒤 처음부터 다시 실행했다. 광범위 prefix 삭제는 사용하지 않았다.

로컬에서는 PGlite 12개 Migration·6A/6B DB contract·16개 테이블, unit 64건, 기본 E2E 16건, Supabase-mode E2E 23건, typecheck, lint, build가 통과했다. Migration 전후 Security Advisor의 새 finding은 0건이며 기존 `Leaked Password Protection Disabled` WARN 1건만 남았다. Performance Advisor의 미색인 FK INFO 5건과 미사용 index INFO 7건도 전후 동일하다.

```text
LOCAL 6B = PASS
REMOTE UPDATE CONTRACT = PASS
REMOTE UI = PASS
REMOTE CLEANUP = PASS
OVERALL 6B = GO (Development Pilot only)
```

6B GO는 반복 Workbook의 제한된 CREATE·UPDATE 흐름에 대한 Development 인수다. DELETE, business key rename, Product type 자동 변경, 정식 Approval, `READY_TO_APPLY`, validation revision 2 및 Production 배포는 포함하지 않는다.
