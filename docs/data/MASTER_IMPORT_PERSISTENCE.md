# Master Workbook Dry-run Persistence

## Purpose and Status

Supabase 모드의 ADMIN과 EDITOR는 브라우저 Master Workbook Dry-run 결과를 중앙 Import 기록으로 저장하고 함께 검토할 수 있다. 저장 범위는 `ImportBatch`, `RawImportRow`, `ImportCandidate`, `ImportValidationIssue`, `IMPORT_VALIDATED` ActivityLog다. ADMIN은 Candidate reviewed override와 Issue decision을 별도 `IMPORT_REVIEWED` 이력으로 저장할 수 있다. 저장된 검증 Batch는 6A Pilot Apply의 입력이 된다. 적용 규칙은 [Pilot Master Apply](PILOT_MASTER_APPLY.md)에 별도로 기록한다.

```text
LOCAL 5E IMPLEMENTATION = GO
REMOTE 5D ACCEPTANCE = GO (PROJECT OWNER REPORTED, 2026-10-25)
REMOTE 5E ACCEPTANCE = GO
REMOTE 5F ACCEPTANCE = GO (EXACT FIXTURE CLEANUP PASS)
REMOTE 6A ACCEPTANCE = GO (CREATE-ONLY APPLY + EXACT FIXTURE CLEANUP PASS)
```

5D 프로젝트 identity와 기존 remote migration 5개는 read-only 연결로 확인했다. 5D Auth/RLS/RPC 동작 결과는 프로젝트 소유자가 제공한 결과다. 자세한 범위는 [Remote Acceptance](../SUPABASE_REMOTE_ACCEPTANCE.md)를 참고한다.

## Persistence Flow

```text
.xlsx 선택
→ private SourceFile 등록 및 업로드
→ Edge Function이 저장된 byte의 SHA-256 재계산
→ 브라우저 Master Dry-run
→ Product / SKU / BOM 후보와 검증 이슈 확인
→ "검증 결과 저장"
→ public.persist_verified_master_import_dry_run(... source_file_id ...)
→ Batch + Raw + Candidate + Issue + IMPORT_VALIDATED
→ ADMIN Human Review
→ reviewed override 또는 Issue decision + IMPORT_REVIEWED
→ 적용 미리보기 + ADMIN 확인
→ Product / SKU / BOM create-only Apply + IMPORT_APPLIED
```

한 persistence RPC transaction에서 Batch, Raw, Candidate, Issue와 ActivityLog를 생성한다. 후보 count 불일치, 잘못된 Candidate shape/status/kind 또는 존재하지 않는 Raw 좌표가 하나라도 있으면 전체 작업을 rollback한다. 같은 파일 hash의 재검증은 새 Batch로 저장할 수 있다.

Mock 모드는 브라우저 Dry-run만 제공한다. 중앙 persistence, Human Review와 Pilot Apply는 Supabase 모드에서만 사용할 수 있다.

## Migration

Prompt 5E Migration은 다음 파일이다.

```text
20261025114440_import_candidate_snapshot_and_review.sql
20261025115414_index_import_candidate_raw_row_fk.sql
```

첫 Migration은 `public.import_candidates`, Validation Issue의 `review_revision`, Candidate snapshot immutability trigger, 7-argument persistence와 두 review RPC, RLS/grant를 추가한다. 두 번째 Migration은 Candidate main Raw composite FK lookup index를 보완한다. 기존 Migration을 수정하거나 legacy Batch를 backfill하지 않는다.

## Persistence RPC

5E의 7-argument RPC는 이제 브라우저에서 실행할 수 없다. 5F의 새 persistence 경계는 다음 함수다.

```sql
public.persist_verified_master_import_dry_run(
  p_workspace_id uuid,
  p_source_file_id uuid,
  p_summary jsonb,
  p_raw_rows jsonb,
  p_candidates jsonb,
  p_issues jsonb
) returns uuid
```

기존 6-argument와 7-argument 공개 persistence 함수는 migration history 때문에 남아 있지만 `authenticated`의 `EXECUTE`는 revoke한다. 새 RPC는 SourceFile의 `VERIFIED` 상태를 잠금 상태에서 확인하고 파일명과 hash를 DB 서버 검증 metadata에서 가져온다. [원본 보관·검증](IMPORT_SOURCE_STORAGE.md)을 참고한다.

공개 wrapper는 `SECURITY INVOKER`다. private `SECURITY DEFINER` 구현은 `search_path = ''`, fully-qualified relation, `auth.uid()`와 현재 ACTIVE Workspace role 검사를 사용한다. 클라이언트는 actor ID, role, Batch status, parser version, validation revision 또는 Raw UUID를 보내지 않는다.

DB는 다음 값을 고정한다.

| 항목 | 값 |
| --- | --- |
| `source_type` | `MASTER_WORKBOOK` |
| `source_scope_key` | `WORKBOOK` |
| `parser_version` | `master-v1.0.0` |
| Batch `status` | `REVIEW_REQUIRED` |
| `validation_revision` | `1` |
| 저장 직후 apply 관련 count | 모두 `0` |

## Candidate Snapshot

`public.import_candidates`는 다음 계약을 가진다.

- kind: `PRODUCT`, `SKU`, `BOM_COMPONENT`
- candidate status: `VALID`, `WARNING`, `ERROR`, `DEFERRED`
- unique: `(workspace_id, import_batch_id, validation_revision, kind, candidate_ordinal)`
- same-Workspace/Same-Batch composite FK로 Batch와 main Raw Row 연결
- `sourceSheet + sourceRow`를 trusted function이 Raw UUID로 해석
- 실제 추가 provenance만 `supporting_raw_row_ids`에 저장
- `normalized_values`, source/provenance, status와 issue codes는 trigger로 immutable
- `reviewed_values`, `review_note`, `review_revision`, reviewer/time은 별도 review state

Product/SKU/BOM candidate count와 상태별 count는 실제 `p_candidates`에서 다시 계산해 summary와 비교한다. payload의 summary만 신뢰하지 않는다. kind별 normalized JSON shape와 value type도 trusted function에서 검사한다.

Candidate 구조와 검토 의미는 [Candidate Review](IMPORT_CANDIDATE_REVIEW.md)를 따른다.

## Review RPCs

Candidate review:

```sql
public.review_import_candidate(
  p_candidate_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_reviewed_values jsonb,
  p_resolution text
) returns void
```

Issue review:

```sql
public.review_import_validation_issue(
  p_issue_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_status text,
  p_resolution text
) returns void
```

두 함수는 ACTIVE ADMIN만 허용하고 Batch가 `REVIEW_REQUIRED`인지, Batch와 entity의 validation revision이 같은지, expected review revision이 최신인지 transaction 안에서 확인한다. stale revision은 거부한다.

Candidate review는 kind별 allowlist와 값 타입을 검사한다. override가 있으면 nonblank resolution/note가 필요하다. 값 변경 없이 검토 근거만 기록할 때는 빈 object와 nonblank note를 사용할 수 있다. 성공하면 reviewed state와 `review_revision`을 갱신하고 `IMPORT_REVIEWED / IMPORT_CANDIDATE` ActivityLog를 정확히 한 건 생성한다.

Issue review 상태는 `OPEN`, `RESOLVED`, `ACKNOWLEDGED`, `DEFERRED`다. non-OPEN 상태는 nonblank resolution이 필수다. `OPEN`으로 되돌리면 resolution을 `NULL`로 지운다. 성공하면 `IMPORT_REVIEWED / IMPORT_VALIDATION_ISSUE` ActivityLog를 같은 transaction에서 한 건 생성한다.

## Role Policy

| 기능 | ACTIVE ADMIN | ACTIVE EDITOR | ACTIVE VIEWER | INVITED / DISABLED / 익명 |
| --- | :---: | :---: | :---: | :---: |
| Dry-run + Candidate snapshot 저장 | Yes | Yes | No | No |
| Batch metadata 조회 | Yes | Yes | Yes | No |
| Raw, Candidate, Issue 상세 조회 | Yes | Yes | No | No |
| Candidate / Issue review mutation | Yes | No | No | No |
| ActivityLog 조회 | Yes | No | No | No |

`import_candidates`의 RLS SELECT는 ACTIVE ADMIN/EDITOR에게만 허용한다. `authenticated`에는 table `SELECT`만 부여하고 직접 `INSERT`, `UPDATE`, `DELETE`를 주지 않는다. Validation Issue 상태도 직접 DML로 바꾸지 않는다.

## Batch and Revision Semantics

Human Review 전후 Master Batch는 `REVIEW_REQUIRED`다. Candidate override 또는 Issue `RESOLVED`만으로 상태를 변경하지 않는다. 6A에서 별도 ADMIN Apply를 성공하면 `APPLIED` 또는 `PARTIALLY_APPLIED`로 직접 전환한다. 다음 Approval 경로는 여전히 사용하지 않는다.

```text
READY_TO_APPLY
APPLYING
정식 Approval
```

`candidate_status`는 validation revision 시점의 immutable 판정이다. reviewed value와 Issue decision은 판정을 덮어쓰지 않는다. 후속 revalidation은 새 `validation_revision` Candidate snapshot을 추가해야 하며 5E는 revision 2 생성을 구현하지 않는다.

## Raw and Issue Provenance

Raw Row는 source sheet, 실제 Excel 행번호, nullable block과 parser가 관측한 `raw_cells`를 보존한다. Candidate와 Issue는 client-provided UUID 대신 source 좌표를 같은 Batch의 Raw UUID로 변환한다. 존재하지 않는 좌표는 전체 persistence를 실패시킨다.

한 Issue가 여러 Candidate 또는 Raw Row에 관련될 수 있으므로 `candidate_id` 단일 FK를 추가하지 않는다. `raw_import_row_id`, `related_raw_row_ids`와 Candidate `issue_codes`를 이용한다.

## ActivityLog

Persistence 성공 시 다음 로그를 한 건 생성한다.

```text
action_type = IMPORT_VALIDATED
entity_type = IMPORT_BATCH
```

Candidate/Issue review 성공 시 대상 entity로 `IMPORT_REVIEWED`를 한 건 생성한다. actor는 `auth.uid()`와 membership의 opaque `actor_ref`에서 가져오고 client가 전달하지 않는다. `changed_fields`에는 revision, Candidate kind 또는 Issue code, field name과 status change만 둔다. password, token, key, email, 전체 Excel row, `raw_cells`, binary 또는 hash를 넣지 않는다.

## Shared Review UI and Legacy Batches

저장된 Batch 상세는 요약, Candidate, Issue와 Raw evidence를 구분해 표시한다. Candidate 상세는 Source Evidence, Normalized Values, Reviewed Values와 Related Issues를 구분한다. ADMIN에게만 review control을 제공하고 EDITOR는 같은 내용을 read-only로 본다.

5C legacy Batch에는 Candidate snapshot이 없다. 이 Batch를 삭제하거나 Raw에서 Candidate를 추정해 만들지 않는다. UI는 기존 Batch/Issue/Raw를 계속 보여주고 Candidate snapshot이 없는 이전 저장 기록이라는 안내를 표시한다.

## Client-observed Hash and Storage Boundary

5E 이전 Batch의 `source_file_hash`는 client-observed SHA-256이다. 5F의 새 Batch는 private Storage 원본을 서버가 읽어 계산한 SHA-256을 기록하며 `source_file_id`와 `SERVER_VERIFIED` trust flag를 가진다. 6A Apply는 SourceFile의 VERIFIED 상태와 서버 hash 일치를 transaction 안에서 다시 확인한다. 원본 검증이나 Human Review만으로 Apply가 자동 실행되지는 않는다.

## Master Data Protection

Persistence와 review는 다음 table을 쓰지 않는다. 6A Apply만 별도 trusted RPC에서 `products`, `skus`, `product_components`의 새 행을 생성한다.

```text
products
skus
product_components
channels
channel_listings
channel_offers
aliases
audit_issues
```

Human Review는 Master 변경, diff, approval 또는 Apply가 아니다. 6A는 기존 Master를 수정하거나 삭제하지 않고 값 충돌을 감지하면 전체 Apply를 거부한다.

## Security

- 브라우저에는 publishable key만 사용한다.
- `service_role`, secret key, Auth admin key, DB password와 JWT secret을 frontend에 넣지 않는다.
- public wrapper는 `SECURITY INVOKER`, privileged implementation은 private schema에 둔다.
- privileged function은 empty `search_path`, fully-qualified relation, `auth.uid()`와 ACTIVE membership/role 검사를 사용한다.
- UI guard는 사용성 경계이고 RLS, grants와 trusted RPC가 실제 보안 경계다.

## Remote Acceptance

5E 원격 인수는 ADMIN·EDITOR·VIEWER·DISABLED 실제 Auth/브라우저까지 GO다. 5F Migration 2개와 Edge Function 2개를 `selleraudit-dev`에 배포했고 원격 Storage/hash/역할 검증과 정확한 fixture cleanup이 통과했다. 6A Migration과 실제 브라우저 create-only Apply, Master 화면 조회·충돌 방지·정확한 fixture cleanup도 통과했다. [Remote Acceptance](../SUPABASE_REMOTE_ACCEPTANCE.md)에 범위와 증거를 기록했다.

```text
REMOTE 5E ACCEPTANCE = GO
REMOTE 5F ACCEPTANCE = GO
REMOTE 6A ACCEPTANCE = GO
```

5F 역할별 원격 결과와 정리 범위는 Remote Acceptance 문서에 별도로 기록한다.

## Current Stop Line

5F는 private 원본 보관·서버 hash 검증·검증된 중앙 저장·Human Review 기록까지였고, 6A는 Development에서 create-only Master Apply를 추가한다. 다음 기능은 구현하지 않는다.

- 기존 Product, SKU, ProductComponent UPDATE/DELETE 또는 automatic correction
- 정식 approval, `READY_TO_APPLY` 또는 기존 Master merge
- revalidation revision 2 생성과 Candidate status 자동 변경
- Sales, Marketing, Barcode 또는 Channel Import persistence
- Production 배포
