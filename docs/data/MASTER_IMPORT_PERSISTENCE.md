# Master Workbook Dry-run Persistence

## Purpose

Supabase 모드의 ADMIN과 EDITOR는 브라우저에서 완료한 Master Workbook Dry-run 결과를 중앙 Import 기록으로 저장하고 함께 검토할 수 있다. 저장 범위는 `ImportBatch`, `RawImportRow`, `ImportValidationIssue`, `IMPORT_VALIDATED` ActivityLog다. Product, SKU, ProductComponent(BOM)는 변경하지 않는다.

현재 구현 판정은 다음과 같다.

```text
LOCAL IMPLEMENTATION = GO
REMOTE ACCEPTANCE = HOLD
```

SellerAudit 전용 Supabase Development 프로젝트가 없어 원격 Migration, Auth, RLS와 RPC 인수 테스트는 실행하지 않았다.

## Persistence Flow

```text
.xlsx 선택
→ 브라우저 Master Dry-run
→ Product / SKU / BOM 후보와 검증 이슈 확인
→ "검증 결과 저장"
→ import persistence service가 payload 변환
→ public.persist_master_import_dry_run(...)
→ seller_audit_private.persist_master_import_dry_run(...)
→ ImportBatch + RawImportRow + ImportValidationIssue + ActivityLog
```

한 번의 RPC와 한 PostgreSQL 트랜잭션으로 네 종류의 기록을 저장한다. Raw Row 또는 Issue 하나라도 유효하지 않거나 insert가 실패하면 Batch와 ActivityLog를 포함한 전체 작업이 rollback된다. 같은 파일 hash의 재검증은 새 Batch로 저장할 수 있으며 DB unique 제약으로 막지 않는다. UI는 저장 중 버튼을 비활성화하고 성공한 현재 preview의 재저장을 차단한다.

Mock 모드는 브라우저 Dry-run만 제공한다. 중앙 저장 UI를 업무 DB 저장처럼 표시하지 않는다.

## RPC Boundary

브라우저가 호출하는 공개 경계는 다음 함수다.

```sql
public.persist_master_import_dry_run(
  p_workspace_id uuid,
  p_source_filename text,
  p_source_file_hash text,
  p_summary jsonb,
  p_raw_rows jsonb,
  p_issues jsonb
) returns uuid
```

반환값은 생성된 Batch ID다. 공개 wrapper는 `SECURITY INVOKER`이며, 실제 원자적 쓰기는 `seller_audit_private`의 `SECURITY DEFINER` 함수가 `search_path = ''`와 fully-qualified table 이름으로 수행한다. 클라이언트는 actor ID, role, Batch status, parser version 또는 source scope를 전달하지 않는다. private 함수가 `auth.uid()`와 현재 `workspace_members`를 조회해 권한을 다시 확인한다.

RPC는 다음 상수를 DB에서 고정한다.

| 항목 | 값 |
| --- | --- |
| `source_type` | `MASTER_WORKBOOK` |
| `source_scope_key` | `WORKBOOK` |
| `parser_version` | `master-v1.0.0` |
| `status` | `REVIEW_REQUIRED` |
| `validation_revision` | `1` |
| `applied_count` / `failed_count` / `remaining_count` | `0` |
| `validated_at` | DB의 `now()` |

DB는 JSON 배열·필수 문자열·양의 원본 행번호·허용된 severity/blocking scope·0 이상의 count·64자리 lowercase SHA-256 형식을 검사한다. Excel parser 규칙 전체를 SQL에 복제하지는 않는다.

## Role Policy

| 기능 | ADMIN | EDITOR | VIEWER / 비활성 멤버 / 익명 |
| --- | :---: | :---: | :---: |
| Dry-run 결과 저장 | 허용 | 허용 | 거부 |
| 저장된 Batch 목록·요약 | 허용 | 허용 | VIEWER는 Batch metadata만 조회 가능 |
| Raw Row·Validation Issue 상세 | 허용 | 허용 | 거부 |
| ActivityLog 조회 | 허용 | 거부 | 거부 |

저장 RPC는 `ACTIVE` 상태이면서 `ADMIN` 또는 `EDITOR`인 현재 멤버만 허용한다. Workspace ID를 바꿔 호출하거나 `INVITED`·`DISABLED` 상태에서 호출하면 거부된다. VIEWER는 기존 앱 정책대로 Master Import 화면에 접근할 수 없다.

## Batch Status Policy

저장되는 모든 Batch는 차단 이슈 수와 관계없이 `REVIEW_REQUIRED`다. 다음 조건이 아직 없기 때문이다.

- 원본 `.xlsx` binary의 서버 보관과 서버 측 hash 검증
- 공식 review/approval
- Master diff와 Apply 기능

중앙 저장 성공은 검증 근거가 공유됐다는 뜻이며 Apply 가능 판정이 아니다. `READY_TO_APPLY`로 자동 전환하지 않는다.

## Count Semantics

| 필드 | 단위와 의미 |
| --- | --- |
| `row_count` | DB에 저장된 물리 `RawImportRow` 수 |
| `product_candidate_count` | 브라우저 Dry-run의 Product 후보 수 |
| `sku_candidate_count` | 브라우저 Dry-run의 SKU 후보 수 |
| `bom_candidate_count` | 브라우저 Dry-run의 BOM 구성 후보 수 |
| `valid_count` | `VALID`로 판정된 후보 수 |
| `warning_count` | `WARNING`으로 판정된 후보 수 |
| `error_count` | `ERROR`로 판정된 후보 수 |
| `deferred_count` | `DEFERRED`로 판정된 후보 수 |

`row_count`의 분모는 원본 물리 행이고, 상태 count의 분모는 Product + SKU + BOM 후보다. 한 물리 행이 여러 후보를 만들 수 있으므로 두 합계는 같지 않아도 된다. Issue 건수 역시 Candidate count와 다른 값이다.

## Client-observed Hash Limitation

`source_file_hash`는 브라우저가 선택된 파일 byte stream에서 계산한 **client-observed SHA-256**이다. 파일명은 표시용이고 source identity가 아니다.

이번 단계는 원본 binary를 DB 또는 Supabase Storage에 업로드하지 않으며 서버가 byte stream을 다시 hash하지 않는다. 따라서 저장된 hash를 `server-verified hash`라고 표현하거나 Apply의 신뢰 근거로 사용할 수 없다.

## Raw Preservation

브라우저 Dry-run의 `rawRows`를 다음 값과 함께 `raw_import_rows`에 저장한다.

- `source_sheet`
- `original_row_number`
- nullable `source_block`
- `raw_cells`

`raw_cells`에는 주소, 원래 타입과 값, 수식, cached value, 오류 코드를 포함한 parser 관측값을 JSON 배열로 보존한다. 저장 과정에서 원본 값을 normalize해 덮어쓰지 않는다. 일반 authenticated 사용자의 직접 `INSERT`, `UPDATE`, `DELETE`는 계속 차단한다.

## Issue Mapping

| Browser preview | Database |
| --- | --- |
| `code` | `issue_code` |
| `severity` | `severity` |
| `blockingScope` | `blocking_scope` |
| `fieldPath` | `field_path` |
| `observedValue` | `observed_value` |
| `expectedRule` | `expected_rule` |
| `message` | `message` |

새 이슈의 `status`는 `OPEN`, `validation_revision`은 `1`이다. RPC는 `sourceSheet + sourceRow`로 같은 Batch의 Raw Row를 찾아 `raw_import_row_id`를 연결한다. `relatedRows`의 숫자 행번호는 해당 이슈의 `sourceSheet`와 결합해 `related_raw_row_ids`로 변환한다. 클라이언트가 Raw UUID를 보내지 않으며, 존재하지 않는 행을 임의 UUID로 만들지도 않는다. 잘못된 참조는 전체 transaction을 실패시킨다. Batch-level schema issue는 `source_row`와 `raw_import_row_id`가 `NULL`일 수 있다.

## ActivityLog

성공한 저장 한 번에 ActivityLog를 정확히 한 건 생성한다.

```text
action_type = IMPORT_VALIDATED
entity_type = IMPORT_BATCH
entity_id = 생성된 Batch ID
actor_user_id = auth.uid()
actor_ref = 현재 Workspace membership의 actor_ref
```

`workspace_members.actor_ref`는 DB가 멤버십마다 생성하는 안정적인 무작위 UUID다. 이메일이나 이름을 actor reference로 사용하지 않으며 클라이언트가 값을 보내지 않는다. `changed_fields`에는 status, parser version과 count 요약만 넣는다. 원본 row, 전체 `raw_cells`, hash, 이메일, token, password 또는 key는 기록하지 않는다.

## Shared Review

Supabase 모드의 ADMIN과 EDITOR는 같은 Workspace에서 최근 저장된 Batch 20개를 최신순으로 보고 다음을 함께 확인할 수 있다.

- filename, 저장 시각, 저장자 기록 여부, `REVIEW_REQUIRED` 상태
- 원본 물리 행 수와 Product/SKU/BOM 후보 수
- 후보 상태 count와 Validation Issue 목록
- Issue가 연결된 Raw Row 상세

목록과 상세는 선택한 Workspace로 제한한다. 새로고침하거나 다른 ADMIN/EDITOR가 로그인해도 중앙 DB의 동일한 검증 결과를 조회할 수 있다. 이 화면은 review evidence 조회이며 Issue 상태 변경이나 reviewed value 수정 기능을 제공하지 않는다.

## Candidate Persistence Limitation

Product, SKU, BOM 후보 **건수**는 Batch에 저장하지만 Candidate row 전체 snapshot은 저장하지 않는다. 후보 탭의 전체 행은 현재 브라우저 Dry-run 세션에서만 볼 수 있다. 저장된 Batch Detail은 후보 count, Validation Issue와 Raw evidence만 제공한다.

후보 persistence, reviewed value, Master diff와 approval은 후속 설계 대상이다. 저장된 Raw와 count만으로 당시 후보 snapshot을 완전히 재현할 수 있다고 주장하지 않는다.

## Security

- 공개 RPC의 `EXECUTE`는 `authenticated`와 trusted `service_role`에만 부여하고 `PUBLIC`·`anon`은 revoke한다.
- private schema 구현은 Data API에 노출하지 않는다.
- Import table의 직접 client DML 권한을 열지 않는다.
- DB 함수는 `auth.uid()`와 현재 ACTIVE Workspace role을 검사한다.
- Batch·Raw·Issue·ActivityLog는 Workspace 범위 RLS와 read grant를 함께 적용한다.
- 브라우저에는 publishable key만 사용하며 `service_role` 또는 secret key를 넣지 않는다.
- UI 권한 처리는 사용성 경계이고 RPC와 RLS가 실제 보안 경계다.

## Remote Acceptance

로컬 DB contract는 Migration 구조, atomic rollback, 역할 거부, Workspace isolation, Raw·Issue 연결과 ActivityLog 생성을 검증한다. Fake Supabase 브라우저 테스트는 저장·공유 검토 UX를 검증한다. 두 테스트 모두 실제 Supabase Auth, PostgREST, RLS 또는 원격 RPC 실행을 증명하지 않는다.

SellerAudit Development 프로젝트가 준비되면 실제 ADMIN, EDITOR, VIEWER, DISABLED 계정과 별도 Workspace를 사용해 다음을 확인해야 한다.

- ADMIN/EDITOR 저장과 공유 조회 허용
- VIEWER·DISABLED·익명 저장 거부
- 교차 Workspace 저장·조회 거부
- malformed payload 전체 rollback
- Batch, Raw, Issue와 ActivityLog의 원자적 생성
- Frontend secret 미노출

현재 결과는 `REMOTE ACCEPTANCE = HOLD`다.

## Current Stop Line

이번 단계는 Master Workbook Dry-run의 검증 결과 저장과 공유 조회까지만 완료한다. 다음 기능은 구현하지 않는다.

- Product, SKU, ProductComponent INSERT 또는 UPDATE
- Master Apply, 승인, `READY_TO_APPLY` 실행 UI
- Product/SKU/BOM Candidate snapshot 저장
- Validation Issue 해결 또는 reviewed value 수정
- 원본 `.xlsx` binary의 DB·Storage 업로드와 서버 SHA-256 검증
- Sales, Marketing, Barcode 또는 Channel Import persistence
- 직원 초대, Role 변경 UI와 Production 배포
