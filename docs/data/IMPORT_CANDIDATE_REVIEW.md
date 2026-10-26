# Master Import Candidate Snapshot과 Human Review

## Purpose and Status

Prompt 5E는 Master Workbook Dry-run의 Product, SKU, BOM Candidate를 `import_candidates`에 저장하고 ADMIN이 reviewed override와 Validation Issue 결정을 기록할 수 있게 한다.

```text
LOCAL 5E IMPLEMENTATION = GO
REMOTE 5E ACCEPTANCE = HOLD (DB CONTRACT PASS, LIVE AUTH/BROWSER PARTIAL)
```

기존 5D 원격 Auth/RLS/Import 인수 결과와 5E 원격 인수는 별도다. [Remote Acceptance](../SUPABASE_REMOTE_ACCEPTANCE.md)를 참고한다.

## Four Separate Records

```text
Raw evidence
→ 원본에서 관측한 셀과 행

Normalized Candidate
→ validation revision 시점의 parser 해석

Reviewed Values
→ 사람이 확인한 부분 override

Issue Resolution
→ 이슈에 대한 사람의 결정
```

이 네 기록은 서로 덮어쓰지 않는다. Human Review는 validation, approval 또는 Apply가 아니다.

## Candidate Snapshot

`public.import_candidates`는 다음 핵심 값을 저장한다.

| 영역 | 필드 | 의미 |
| --- | --- | --- |
| 범위 | `workspace_id`, `import_batch_id` | 같은 Workspace와 Batch에 묶인 snapshot |
| Raw 연결 | `source_sheet`, `source_row`, `raw_import_row_id`, `supporting_raw_row_ids` | 원본 좌표, 주 근거 행과 실제 추가 근거 행 |
| 버전 | `validation_revision`, `candidate_ordinal` | revision과 kind 범위의 안정된 순서 |
| 종류 | `kind` | `PRODUCT`, `SKU`, `BOM_COMPONENT` |
| 출처 | `source_block`, `source_field_map` | 원본 block과 필드별 셀 주소 |
| 판정 | `normalized_values`, `candidate_status`, `issue_codes` | immutable parser 결과 |
| 사람 검토 | `reviewed_values`, `review_note`, `review_revision`, `reviewed_by`, `reviewed_at` | 별도 override와 optimistic concurrency metadata |

DB ID는 UUID다. 브라우저 candidate 문자열 ID를 DB identity로 쓰지 않는다. persistence payload의 `sourceSheet + sourceRow`를 trusted function이 같은 Batch의 Raw 좌표와 연결한다. 연결할 Raw가 없으면 전체 transaction을 실패시킨다. `supporting_raw_row_ids`에는 실제 추가 provenance만 넣으며 의미 없는 자기 참조를 넣지 않는다.

Candidate uniqueness는 다음 범위에 revision을 포함한다.

```text
workspace + batch + validation revision + kind + candidate ordinal
```

## Validation Revision

5E는 `validation_revision=1`만 생성한다. 후속 revalidation은 기존 snapshot을 수정하거나 삭제하지 않고 새 revision을 추가해야 한다.

## Normalized Snapshot and Reviewed Override

`normalized_values`와 `candidate_status`는 저장 후 수정하지 않는다. 사람의 검토는 `reviewed_values`에 변경할 필드만 기록한다.

```json
{
  "normalized_values": {
    "sabangnetCode": "100526",
    "productName": "기존 이름"
  },
  "reviewed_values": {
    "sabangnetCode": "OWNER_CONFIRMED_CODE"
  }
}
```

UI도 Parser 값과 검토 후 값을 별도 영역에 표시한다. reviewed value가 있어도 당시 `candidate_status`는 바뀌지 않는다. 새 판정은 후속 revalidation이 새 snapshot을 만들 때만 가능하다.
각 검토 필드는 Parser 값 유지, 새 값 입력, 허용된 경우 명시적 `null` 지정 중 하나를 선택한다. 이미 저장된 `null`은 다른 필드를 다시 검토할 때도 보존한다.

## Review Field Allowlist

| Candidate kind | 수정 가능한 필드 | 수정할 수 없는 대표 필드 |
| --- | --- | --- |
| `PRODUCT` | `sabangnetCode`, `productName`, `category`, `productType`, `rawBomText`, `sourceQuantity`, `sourceChannel` | `variantOfSourceRow`, provenance, status, issue codes |
| `SKU` | `skuCode`, `modelName`, `color`, `sourceCategory` | `registryStatus`, provenance, status, issue codes |
| `BOM_COMPONENT` | `skuCode`, `quantity` | `productSourceRow`, `rawToken`, provenance, status, issue codes |

Trusted review RPC는 변경 field와 note가 모두 없는 빈 review, 알 수 없는 필드, provenance/derived field override, 잘못된 값 타입과 override에 대한 공백 note를 거부한다. 값 변경 없이 확인 근거만 남기는 review는 빈 `reviewed_values` 객체와 nonblank note로 기록할 수 있다.

## Review Revision

Candidate와 Issue는 각각 `review_revision`을 사용한다. 클라이언트는 읽은 `validation_revision`과 `review_revision`을 review 요청에 포함하고 DB가 현재 값과 비교한다. 다른 사용자가 먼저 저장했거나 revision이 달라졌다면 stale 요청을 거부하고 최신 데이터를 다시 읽게 한다.

성공한 review는 다음을 한 transaction에서 처리한다.

- reviewed value 또는 Issue decision 갱신
- `review_revision + 1`
- `reviewed_by = auth.uid()`와 DB `reviewed_at`
- `IMPORT_REVIEWED` ActivityLog 정확히 한 건

ActivityLog에는 revision, Candidate kind 또는 Issue code, 검토한 필드명과 상태 변화만 남긴다. 원본 Excel 행 전체, `raw_cells`, 파일 binary, 이메일, password, token 또는 key를 넣지 않는다.

## Issue Status Semantics

| 상태 | 의미 | Resolution |
| --- | --- | --- |
| `OPEN` | 아직 결정하지 않았거나 다시 연 상태 | `NULL` |
| `RESOLVED` | 사람이 근거를 확인해 해결 결정을 기록 | nonblank 필수 |
| `ACKNOWLEDGED` | Warning 등을 인지하고 확인 | nonblank 필수 |
| `DEFERRED` | 현재 확정할 수 없어 이후 처리 | nonblank 필수 |

`RESOLVED`는 Candidate `VALID` 또는 Batch `READY_TO_APPLY`를 뜻하지 않는다. `UNKNOWN_SKU`, `DUPLICATE_BUSINESS_KEY`, `BOM_QUANTITY_MISMATCH`를 근거 없이 안전한 값으로 취급하지 않는다. 한 Issue가 여러 Candidate 또는 Raw Row와 관련될 수 있으므로 단일 `candidate_id` FK를 추가하지 않고 `raw_import_row_id`, `related_raw_row_ids`와 Candidate의 `issue_codes`로 evidence를 연결한다.

## Role Permissions

모든 권한은 현재 `ACTIVE` Workspace membership을 DB에서 다시 확인한다.

| 기능 | ADMIN | EDITOR | VIEWER | INVITED / DISABLED |
| --- | :---: | :---: | :---: | :---: |
| Batch metadata 조회 | Yes | Yes | Yes | No |
| Raw, Candidate, Issue 상세 조회 | Yes | Yes | No | No |
| Candidate / Issue review 저장 | Yes | No | No | No |
| ActivityLog 조회 | Yes | No | No | No |
| Dry-run + Candidate snapshot 저장 | Yes | Yes | No | No |

일반 authenticated 사용자의 `import_candidates` 직접 `INSERT`, `UPDATE`, `DELETE`와 `import_validation_issues.status` 직접 변경은 차단한다. mutation은 role, Workspace, Batch 상태, validation revision과 review revision을 검증하는 trusted RPC만 통한다. 브라우저는 publishable key만 사용한다.

## Trusted RPC Boundary

5E의 public RPC signature는 다음과 같다.

```text
persist_master_import_dry_run(uuid, text, text, jsonb, jsonb, jsonb, jsonb) returns uuid
review_import_candidate(uuid, integer, integer, jsonb, text) returns void
review_import_validation_issue(uuid, integer, integer, text, text) returns void
```

첫 RPC는 Batch, Raw, Candidate, Issue를 하나의 transaction으로 저장한다. 두 review RPC는 Candidate와 Issue를 각각 검토한다. 5C의 6개 인자 `persist_master_import_dry_run`은 역사적 호환을 위해 남아 있지만 `authenticated` 실행 권한은 회수했으므로 브라우저가 Candidate 없는 새 Batch를 만들 수 없다.

## Legacy Batch Behavior

5C에서 저장된 기존 Batch에는 Candidate row가 없다. 이 Batch를 삭제하거나 Raw에서 가짜 Candidate를 backfill하지 않는다. UI는 Batch와 기존 Issue/Raw evidence를 계속 보여주고 Candidate 영역에는 snapshot이 없는 이전 저장 기록이라는 안내를 표시한다. legacy Batch는 review RPC의 대상이 아니다.

## Preserved Data Cases

- `100526`: `DUPLICATE_BUSINESS_KEY`를 유지한다. 임의로 `100526-1` 같은 코드를 만들지 않는다.
- `AL24`: `UNKNOWN_SKU`를 유지한다. 새 SKU를 자동 생성하지 않는다.
- BOM quantity mismatch 8건: source quantity나 BOM quantity를 자동 보정하지 않는다.
- `AL510` 등 intermediate bundle: 임의로 분해하지 않고 `DEFERRED` 의미를 유지한다.

ADMIN은 공식 근거를 확인한 값을 override로 기록할 수 있지만 이 기록은 Master 생성 또는 변경을 실행하지 않는다.

## Batch Lifecycle and Progress

모든 5E Master Batch는 `REVIEW_REQUIRED`를 유지한다. Candidate reviewed count와 Issue 상태별 count는 진행 현황으로 표시할 수 있지만 100%가 Apply 가능을 뜻하지 않는다.

```text
Human Review
≠ Validation
≠ Approval
≠ Apply
```

## No Apply and No Storage

5E는 `products`, `skus`, `product_components`, `channels`, `channel_listings`, `channel_offers`, `aliases`, `audit_issues`를 쓰지 않는다. `READY_TO_APPLY`, 승인, diff, merge 또는 Apply API도 제공하지 않는다.

원본 `.xlsx` binary를 Supabase Storage에 업로드하지 않고 서버에서 SHA-256을 다시 계산하지 않는다. `source_file_hash`는 계속 브라우저가 관측한 `client-observed SHA-256`이며 server-verified source로 표현하지 않는다.

## Remote Status

5E Migration 2개는 정확한 `selleraudit-dev` 프로젝트에 적용됐다. 역할별 persistence/review denial, cross-Workspace, stale revision, atomic rollback, ActivityLog와 Master table row count 불변은 원격 DB contract에서 통과했다. 실제 로그인·브라우저 인수는 ADMIN·VIEWER·DISABLED에서 통과했지만 EDITOR 계정의 자격증명 오류로 다음 상태를 유지한다.

```text
REMOTE 5E ACCEPTANCE = HOLD
DB CONTRACT = PASS
LIVE AUTH / BROWSER = PARTIAL (EDITOR PENDING)
```

다음 단계는 Apply가 아니다. Private Source File Storage, server-verified SHA-256과 revalidation/review consistency를 별도 단계로 검토한다.
