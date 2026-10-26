# SellerAudit Import Contract v1 (Prompt 3, 설계안)

**상태: 부분 구현 + 후속 계약.** Master Workbook의 브라우저 Parser·Dry-run과 Batch·Raw·Product/SKU/BOM Candidate·Validation Issue snapshot을 원자적으로 저장하는 shared review 범위가 로컬에 구현됐다. ADMIN은 normalized snapshot을 바꾸지 않고 reviewed override와 Issue 결정을 기록할 수 있다. 원본 binary Storage, server-verified hash, revalidation, approval과 Apply는 아직 후속 계약이다. 기존 5D 원격 인수는 GO이며 5E 원격 DB contract도 통과했다. 실제 Auth 브라우저 인수가 남아 최종 5E 판정은 HOLD다. 기준은 [Data Model V2](DATA_MODEL_V2_PROPOSAL.md), [Data Dictionary](DATA_DICTIONARY.md), [Internal Pilot Architecture](../INTERNAL_PILOT_ARCHITECTURE.md), [Master Import persistence](MASTER_IMPORT_PERSISTENCE.md), [Candidate Review](IMPORT_CANDIDATE_REVIEW.md) 및 각 [원본 분석](MASTER_SOURCE_ANALYSIS.md)이다. 오류 코드는 [별도 카탈로그](IMPORT_ERROR_CODES.md)에 정의한다.

## 1. Purpose

원본 파일의 물리적 행과 의미를 잃지 않으면서 검증된 Product/SKU/BOM 또는 Fact만 반영한다. `Source File → RAW → NORMALIZED → VALIDATION → REVIEW → DRY RUN → APPLY → MASTER/FACT → VERIFY`가 공식 경계다. **사방넷 품번은 Product Master 업무키, AL00/AQ01은 실물 SKU, Product↔SKU는 ProductComponent**, Listing은 상품 페이지, Offer는 구매 단위다. `P000`·`SET001`을 Master 코드로 만들지 않는다.

## 2. Scope

V0.2의 현재 구현은 **Master Workbook의 Product·SKU·BOM Dry-run, Candidate snapshot과 ADMIN human review**까지다. 중앙 저장은 Raw evidence, immutable normalized Candidate, reviewed override, Issue decision과 제한된 ActivityLog를 보존한다. 이 문서는 Barcode, Channel, Sales, Marketing의 후속 수용 원칙과 Apply 계약도 설계하지만, 해당 Adapter/승격이 구현됐다는 뜻이 아니다. 실제 직원과 실제 공유 데이터에는 Prompt 2.1의 Pilot Readiness Gate가 선행한다. 업로드 파일명이나 샘플 시드로 미확인 컬럼·상태·FK를 확정하지 않는다.

## 3. Import Principles

1. Raw 셀과 원본 binary는 변경 불가 원본으로 보존하고 정규화·사용자 수정값은 별도 버전으로 둔다.
2. Source-specific Adapter는 후보를 만들 뿐 Master/Fact를 쓰거나 Product를 자동 승인하지 않는다.
3. 모든 후보·이슈·승격에는 Workspace와 batch/row provenance를 연결한다. 다른 Workspace 참조는 DB 제약과 권한 검사로 거부한다.
4. Dry-run은 Master/Fact를 절대 변경하지 않는다. Apply는 최신 검증·승인된 preview에만 허용한다.
5. 같은 파일 재업로드·재검증은 허용하되 같은 source identity의 재적용은 no-op/거부로 처리한다. 값이 같은 **서로 다른 물리 Sales 행**은 합치지 않는다.
6. Source에서 빠졌다는 이유로 기존 Master를 삭제하거나 비활성화하지 않는다.

## 4. Pipeline

`상태`는 §5의 Batch 상태다. 단계는 각각 별도 상태가 아니며 실패·재시도는 명시된 경계에서 수행한다.

| 단계 | 입력 → 출력 | 정상 상태 | 실패 조건과 처리 | 재시도 / 권한 |
| --- | --- | --- | --- | --- |
| 1 RECEIVE | 인증된 업로드 → immutable private 원본 객체, 서버 계산 SHA-256, batch | `RECEIVED` | 크기·형식·Storage 실패는 batch 생성 전 거부 또는 `FAILED` | 일시 장애 재시도; ADMIN/EDITOR |
| 2 IDENTIFY | 파일 구조·명시된 source type/scope → Adapter 선택·schema signature | `VALIDATING` | 미지원/애매한 source는 `UNSUPPORTED_SOURCE`; 파일명만으로 판정 금지 | source 선택 수정 후 재검증; ADMIN/EDITOR |
| 3 RAW CAPTURE | 원본 시트/셀 → immutable RawImportRow | `VALIDATING` | 파일 손상·행 누락·용량 한계는 기술 실패; 원본 hash 대조 | 실패한 capture 전체 재시도; ADMIN/EDITOR |
| 4 NORMALIZE | Raw + versioned Adapter → typed Candidate snapshot | `VALIDATING` | 셀 타입/수식 오류는 행 이슈, 구조 파손은 batch 이슈 | parser 변경/수정 후 새 revision; ADMIN/EDITOR |
| 5 VALIDATE | 후보·참조 snapshot → Issue와 후보별 판정 | `VALIDATING`→`REVIEW_REQUIRED`; 검토 불필요하면 preview 생성 대기 | hard invariant 위반은 차단; warning은 확인 필요 | 수정·참조 변경 후 재검증; ADMIN/EDITOR |
| 6 REVIEW | 원본·후보·Issue → 별도 reviewed value/결정 | `REVIEW_REQUIRED` | 근거 없는 승인·hard error waiver 금지 | 5E 기록은 ADMIN; 새 판정에는 후속 revalidation 필요 |
| 7 DRY RUN | 최신 revision + 현재 Master/Fact → diff/preview token | 조건 충족 시 `READY_TO_APPLY`; 아니면 `REVIEW_REQUIRED` | diff 중 새 충돌·stale 참조 발견 시 재검증 | 반복 가능; ADMIN/EDITOR |
| 8 APPLY | 고정 preview + ADMIN 승인 → 원자적 Master 또는 chunk Fact | `APPLYING`→`APPLIED`/`PARTIALLY_APPLIED` | 권한·version·고유 제약·DB 실패 시 해당 트랜잭션 rollback | 안전한 resume만 ADMIN |
| 9 VERIFY | commit 결과 → 적용/보류/실패 수·provenance 재조회 | `APPLYING` | 집계/참조 불일치면 완료 금지·운영 장애 | 재조회·복구; trusted service |
| 10 COMPLETE | 검증된 결과 → batch terminal 기록/ActivityLog | `APPLIED` | 누락된 적용/로그가 있으면 완료 금지 | 완료 자체 재호출은 no-op; trusted service |

`VALIDATING`에는 구조 식별·파싱·정규화·검증을 묶어 상태 폭발을 막는다. 미리보기 생성은 metadata/Raw/Issue/후보 revision을 기록할 수 있지만 **Product/SKU/BOM/Listing/Offer/Fact와 운영 Alias는 쓰지 않는다**. 이를 UI의 임시 계산과 혼동하지 않는다.

현재 5E 구현은 브라우저 `IDENTIFY → RAW CAPTURE → NORMALIZE → VALIDATE` 결과를 Batch, Raw, Candidate, Issue와 ActivityLog로 같은 transaction에서 저장한다. ADMIN human review는 별도 reviewed override와 Issue decision을 기록하며 normalized Candidate와 Raw를 수정하지 않는다. 원본 객체 업로드, revalidation, diff, `READY_TO_APPLY`, 승인과 `APPLY` 단계는 실행하지 않는다.

## 5. ImportBatch Lifecycle

| 상태 | 의미 | 허용되는 다음 상태 |
| --- | --- | --- |
| `RECEIVED` | 원본 파일 접수·hash 기록 | `VALIDATING`, `FAILED`, `CANCELLED` |
| `VALIDATING` | Raw capture/normalize/validate 진행 | `REVIEW_REQUIRED`, `READY_TO_APPLY`(같은 작업의 dry-run 완료 시), `FAILED`, `CANCELLED` |
| `REVIEW_REQUIRED` | 오류·미확정 항목·경고 확인 대기 | `VALIDATING`, `READY_TO_APPLY`(새 검증/승인 완료 시), `CANCELLED` |
| `READY_TO_APPLY` | 최신 revision의 dry-run·ADMIN 승인에 필요한 조건 충족 | `VALIDATING`(stale), `APPLYING`, `CANCELLED` |
| `APPLYING` | 적용 트랜잭션 또는 Fact chunk 진행 | `APPLIED`, `PARTIALLY_APPLIED`, `FAILED` |
| `PARTIALLY_APPLIED` | Fact의 일부 **적용 가능 chunk**만 commit되고 중단 | `APPLYING`(같은 revision resume); 후속 보정 완료까지 이 상태 유지 |
| `APPLIED` | 모든 적용 가능 단위가 적용됨; 의도적 DEFERRED는 count로 남음 | terminal; 같은 apply는 no-op |
| `FAILED` | 기술/구조 실패 또는 적용 전 실패; 이미 commit된 Fact가 있으면 `PARTIALLY_APPLIED` | `VALIDATING` 또는 `APPLYING`(검증된 retry 경로), `CANCELLED` |
| `CANCELLED` | **적용 전** 취소 | terminal; Raw/이력 보존 |

상태 전이는 trusted service가 검사한다. `REVIEW_REQUIRED→READY_TO_APPLY`는 우회 전이가 아니다. 실제 구현은 새 validation revision과 최신 diff를 기록한 뒤에만 전이한다. 이미 Fact가 commit된 batch를 `CANCELLED`로 바꾸지 않는다. `PARTIALLY_APPLIED`를 끝내지 못하면 운영자에게 그대로 노출하고 별도 보정 batch를 연결하는 상태는 후속 계약으로 둔다. 상태·count·ActivityLog는 같은 성공 트랜잭션에서 갱신한다. Master Apply 실패처럼 원래 트랜잭션 전체가 rollback되면 별도 신뢰된 트랜잭션에서 `FAILED`와 제한된 실패 이벤트를 기록한다.

5E에서 저장하는 Master Dry-run Batch는 차단 이슈가 0건이어도 항상 `REVIEW_REQUIRED`, `validation_revision=1`이다. Human Review 완료율이나 Issue `RESOLVED`는 validation 또는 Apply 승인으로 승격되지 않는다. 원본 binary의 서버 검증, revalidation, diff, approval과 Apply가 없으므로 `READY_TO_APPLY`로 자동 전환하지 않는다. `source_type=MASTER_WORKBOOK`, `source_scope_key=WORKBOOK`, `parser_version=master-v1.0.0`은 DB trusted boundary에서 고정한다.

**최소 batch metadata:** `id`, `workspace_id`, `source_type`(V2의 `source_kind` 후보 명칭을 이 계약에서 통일), nullable 표시용 `source_channel`, non-null canonical `source_scope_key`, 표시용 `source_filename`, 원본 바이트 `source_file_hash`(SHA-256), `parser_version`, `status`, 원본 객체 참조·version·byte size, `created_by/created_at`, nullable `validated_at/applied_at`, `validation_revision`, `row_count`, `valid_count`, `warning_count`, `error_count`, `deferred_count`, `applied_count`, `failed_count`, `remaining_count`. `reviewed_at/by`는 승인 결정에 연결한다. `FAILED`는 허용 목록의 BatchFailureCode와 correlation ID만 보유한다. Count는 동일 revision 기준이고 행/후보 단위를 혼용하지 않으며 화면에 분모를 표시한다.

`row_count`는 실제 입력으로 판별한 물리 데이터 행 수이며 header·빈 서식 행은 제외한다. `valid/warning/error/deferred_count`는 **후보 단위**의 상호 배타적 최종 판정 수로, 후보 수를 분모로 표시한다. 한 물리 행이 여러 후보를 만들 수 있으므로 합계가 `row_count`와 같을 필요는 없다. `applied_count`는 실제 적용된 target 단위 수이며 `UNCHANGED`와 의도적 `DEFERRED`를 포함하지 않는다. `failed_count`는 Apply 시도 중 실패해 아직 commit되지 않은 **적용 가능 target 단위** 수다. `remaining_count`는 아직 시도하지 않았거나 재시도가 필요한 적용 가능 target 단위 수이며 `failed_count`를 포함한다. 성공적으로 재시도하면 두 값이 감소한다. `APPLIED`이면 `failed_count=remaining_count=0`, `PARTIALLY_APPLIED`이면 `remaining_count>0`이다. 검증 `error_count`와는 다르다. Preview/결과에는 행 수와 후보·target 수를 각각 명시한다.

5E persistence에서 `row_count`는 실제 저장된 `RawImportRow` 수다. `product_candidate_count`, `sku_candidate_count`, `bom_candidate_count`와 `valid/warning/error/deferred_count`는 저장된 Candidate snapshot을 기준으로 다시 검산한다. `applied_count`, `failed_count`, `remaining_count`는 모두 0으로 유지한다.

## 6. Raw Preservation

`RawImportRow`: `id`, `workspace_id`, `import_batch_id`, `source_sheet`, `original_row_number`, `raw_cells`(열 주소·순서·원래 타입·원문값·수식 텍스트·cached value/오류를 구분), nullable `source_section`/`source_block`. 물리 행의 기술 unique는 `(import_batch_id, source_sheet, original_row_number)`다. 같은 행 안 여러 독립 표/매체 블록은 Raw를 복제하지 않고 후보 식별자 `(raw_row_id, source_block, candidate_ordinal)`로 구분한다. CSV의 `source_sheet`는 명시된 sentinel `__CSV__`, 행 번호는 파일의 물리 line/record 좌표를 구분해 기록한다. Excel 병합 셀·숨김/필터 행·빈 템플릿과 원본 행번호를 잃지 않는다.

`null`, 빈 문자열, numeric `0`, text `"0"`, numeric `-6290`, text `"-6290"`는 Raw에서 다르다. Formula text와 cached result도 별도다. `#REF!`/`#DIV/0!`를 0으로 바꾸지 않는다. 원본 파일/Raw는 immutable이며 UI 수정은 정규화 후보의 별도 `reviewed_values`와 reviewer·시각·근거에 기록한다. 후속 재검증은 새 revision/snapshot을 만들고 이전 결정을 이력으로 남긴다. 한 batch의 Raw는 여러 검증 revision에서 재사용하지만 parser version 변경은 별도 batch 시도로 남긴다.

## 7. Source Identification

지원 source type 후보는 `MASTER_WORKBOOK`, `BARCODE_WORKBOOK`, `CHANNEL_EXPORT` + `source_channel`, `SALES_WORKBOOK`, `MARKETING_WORKBOOK`이다. 업로더가 source type과 Workspace를 명시하고, Adapter가 sheet/header/위치 signature를 검증한다. 파일명은 표시용이며 source 확정 근거가 아니다. `CHANNEL_EXPORT`의 판매 채널 code는 해당 Workspace에서 승인된 code만 사용한다. Sales의 `쇼핑몰명` 22 label과 광고 시트명은 곧바로 `channels.id`가 되지 않는다.

동일한 바이트 hash라도 Workspace, source type, channel/scope가 다르면 별개 source identity다. 같은 identity 재업로드는 기존 batch를 보여주거나 새 검사 시도를 만들 수 있으나 새 batch UUID만으로 재적용 권한이 생기지 않는다. source identity = `(workspace_id, source_type, source_scope_key, source_file_hash)`; `source_scope_key`는 CHANNEL_EXPORT의 승인 채널 code, 그 외 파일형 source의 고정된 비공백 scope(`WORKBOOK`)처럼 canonical하게 정한다. nullable SQL unique 키의 예외를 만들지 않는다. parser version은 **검증 결과의 버전**이며 적용 중복 키에서 제외한다.

## 8. Adapter Contract

Adapter는 명시된 type/scope에 대해 sheet/header/위치/schema signature를 확인하고 물리 셀을 읽어 Raw와 후보를 만든다. 선택은 단순 `canHandle(filename)`이 아니라 명시 선택 + signature 확인이다. `Master`의 `단가표`·`코드DB`·`상품DB`는 한 시트 안 독립 블록과 행 정렬되지 않은 lookup을 구분한다. 토스 채널 export는 상품/옵션 두 시트의 ID 관계 및 반복 `옵션명` 열의 **위치+헤더**를 확인한다. 스마트스토어/카페24/톡딜의 Listing 가격을 옵션 가격으로 꾸며내지 않는다. 상품/옵션 행 0개의 템플릿은 0-row 결과 또는 schema issue이지 가상의 Offer가 아니다. [채널 원본 분석](../SCM_SOURCE_ANALYSIS.md)을 따른다.

Adapter가 하지 않는 일: Product 자동매칭, Master 승인, DB 직접 DML, AuditIssue 생성, 권한 결정. Source마다 지원하는 schema signature를 version으로 관리한다. 필수 열 누락·이름 변경·위치 이동·중복 헤더 의미 변경은 `SOURCE_SCHEMA_MISMATCH`; 무관한 추가 열은 Raw에 남기고 warning으로만 처리할 수 있다. 수식 셀은 공식 source 규칙에서 cached value를 채택할 수 있으나 stale/오류이면 issue로 보류하고 Excel 수식을 DB에서 재계산하지 않는다.

## 9. Normalized Candidate Contract

후보 종류는 `Product`, `Sku`, `Bom`, `Barcode/Logistics`, `Listing`, `Offer`, `Sales`, `Marketing`이다. 공통 provenance는 `workspace_id`, `import_batch_id`, `raw_import_row_id`, `source_field_map`(후보 필드→원본 셀 주소), `parser_version`, `validation_revision`, 후보 kind, `(source_block,candidate_ordinal)`, `normalized_values`, nullable `reviewed_values`다. Raw 원문과 정규화·검토값을 혼합하지 않는다. 초기 V1은 RawImportRow의 버전된 JSON payload/검증 결과로 표현할 수 있고 별도 NormalizedRow 테이블은 만들지 않는다. 후보가 둘 이상의 Raw 행을 참조하면 `supporting_raw_row_ids`를 기록한다.

Master 5E는 `import_candidates`에 `PRODUCT`, `SKU`, `BOM_COMPONENT` snapshot을 저장한다. DB PK는 UUID이며 브라우저 candidate 문자열 ID를 신뢰하지 않는다. 각 kind 배열 순서로 `candidate_ordinal`을 1부터 부여하고 `(workspace_id, import_batch_id, validation_revision, kind, candidate_ordinal)`을 유일하게 유지한다. 클라이언트는 `sourceSheet + sourceRow`를 보내고 trusted RPC가 같은 Batch의 Raw UUID를 찾는다. 존재하지 않는 Raw 좌표 또는 summary/count 불일치는 Batch를 포함한 전체 persistence를 rollback한다.

`normalized_values`와 `candidate_status`는 해당 validation revision의 immutable parser 결과다. Human Review는 kind별 허용 필드만 `reviewed_values`에 부분 override로 기록한다. `PRODUCT`는 `sabangnetCode`, `productName`, `category`, `productType`, `rawBomText`, `sourceQuantity`, `sourceChannel`; `SKU`는 `skuCode`, `modelName`, `color`, `sourceCategory`; `BOM_COMPONENT`는 `skuCode`, `quantity`만 검토할 수 있다. `sourceSheet`, `sourceRow`, `sourceBlock`, `sourceFieldMap`, `variantOfSourceRow`, `registryStatus`, `productSourceRow`, `rawToken`, status와 issue code는 수정할 수 없다.

금액은 TS 경계에서 검증된 **십진 문자열**로 보존하고 DB는 `numeric`으로 저장한다. 부동소수점 계산으로 금액을 결정하지 않는다. 날짜는 raw type/serial/text, 파싱된 calendar date, 업무 `date_basis`를 분리한다. Parser/정규화 규칙을 함께 `parser_version`(예: `master-v1.0.0`)으로 관리하고 규칙이 바뀌면 version을 올린다. 독립 normalization version은 V1에서 두지 않는다. Git commit은 추적 metadata일 수 있지만 사람이 검토할 계약 버전을 대체하지 않는다.

## 10. Validation

후보 판정은 `VALID`(조건 충족), `WARNING`(적용 가능하지만 명시 확인 필요), `ERROR`(해당 scope의 Apply 차단), `DEFERRED`(증거 부족·현재 적용 대상 아님)이다. Severity(`INFO/WARNING/ERROR`)는 운영 우선순위이고 적용 차단과 별도로 `blocking_scope = NONE | CANDIDATE | BATCH`를 issue에 기록한다. 기본값은 [오류 코드 카탈로그](IMPORT_ERROR_CODES.md)의 rule+source policy에서 산출하며 사람이 임의로 hard invariant를 비차단으로 바꿀 수 없다. Master의 필수 Product/BOM 오류는 BATCH 차단; Sales 한 행의 금액 오류는 CANDIDATE 차단과 Fact 부분 적용 허용이다. WARNING의 적용 전 확인은 `reviewed_by/at`와 승인 revision에 남긴다.

`ImportValidationIssue` 최소 구조: `id`, `workspace_id`, `import_batch_id`, nullable `raw_import_row_id`, nullable `related_raw_row_ids`(예: `100526` 일곱 행), `issue_code`, `severity`, `blocking_scope`, `field_path`, 제한/마스킹된 `observed_value`, `expected_rule`, `message`, `status`(`OPEN/RESOLVED/ACKNOWLEDGED/DEFERRED`), nullable `resolution/reviewed_by/reviewed_at`. 집합 issue는 batch 수준 한 건과 영향 행 ID 목록으로 표현하며 V1에 범용 issue-row join table을 추가하지 않는다. 해결 후에도 원본 issue는 삭제하지 않고 새 검증 revision과 연결한다. `ACKNOWLEDGED`는 warning 확인에만 사용하고 uniqueness/FK/금액 파싱 오류를 면제하지 않는다.

## 11. Human Review

5E UI는 한 후보에서 Raw evidence, Normalized Values, Reviewed Values와 관련 Issue를 분리해 보여준다. ACTIVE ADMIN만 Candidate reviewed override와 Issue 결정을 저장할 수 있다. EDITOR는 같은 Raw/Candidate/Issue를 조회하지만 review mutation은 할 수 없다. VIEWER는 Batch metadata만 읽고 Candidate·Raw·Issue detail에 접근하지 못한다.

Candidate와 Issue는 각각 `review_revision`을 사용해 stale update를 거부한다. 성공한 review는 `reviewed_by=auth.uid()`, DB `reviewed_at`, nonblank note/resolution과 같은 transaction의 `IMPORT_REVIEWED` ActivityLog를 남긴다. Candidate review는 override와 근거가 모두 빈 경우, 허용 목록 밖 field, provenance/derived field, 잘못된 type을 거부한다. 근거가 있으면 빈 override `{}`도 허용한다. Issue의 `RESOLVED`, `ACKNOWLEDGED`, `DEFERRED`에는 nonblank resolution을 요구한다. `OPEN`으로 다시 열면 resolution은 `NULL`로 만든다.

Review는 validation이 아니다. Candidate에 reviewed value가 생기거나 Issue가 `RESOLVED`여도 `candidate_status`와 Batch `REVIEW_REQUIRED`는 그대로다. 충돌 해결은 `100526`에 임의 suffix를 붙이는 방식이 아니라 공식 근거를 확인한 ADMIN override로 남긴다. `AL24`, 수량 불일치와 intermediate bundle도 자동 생성·보정하지 않는다. 새 판정은 후속 revalidation이 새 `validation_revision` snapshot을 만들 때만 가능하다.

## 12. Dry-run

Dry-run은 최신 후보 revision과 읽기 snapshot에서 `NEW/UNCHANGED/CHANGED/CONFLICT/INVALID/DEFERRED`를 계산한다. Preview는 파일·원본/후보 행 수, Entity별 diff, 차단/경고, 영향 대상과 원본 row 링크, 보류 count, parser version, `validation_revision`, 참조 데이터 version/기준시각, 만료/preview token을 포함한다. 예시 숫자는 source와 계산 시점의 결과이지 계약상 고정값이 아니다. 관리자에게는 APPLY 전 `NEW N / CHANGED N / BLOCKED N / WARNINGS N` 및 의도적 deferred를 명시한다.

Dry-run은 Batch/Raw/Issue/preview metadata를 저장할 수 있지만 Master/Fact에 INSERT/UPDATE/DELETE하지 않는다. Preview token은 `(batch_id, validation_revision, diff fingerprint, 참조 snapshot/version)`에 묶는다. APPLY는 서버에서 잠금 후 최신 diff를 재검산하고 token이 stale이면 거부·재검토한다. Dry-run 반복은 Master/Fact에 영향을 주지 않는다.

## 13. Apply

ADMIN이 최신 preview를 확인·승인하고 trusted backend/RPC가 현재 ACTIVE ADMIN 멤버십, 대상 Workspace, batch 상태/revision, 차단 issue, idempotency key와 참조 version을 **트랜잭션 내부에서 다시 검사**한다. 승인 시각과 actor는 검증된 Auth에서 얻고 client role/actor를 신뢰하지 않는다. 이 조건을 충족한 후보만 Target으로 변환한다. 기존 business key의 `CHANGED`는 허용된 필드 diff만 적용하고 `CONFLICT`는 거부한다. `UNCHANGED`는 no-op. 원본에 없는 행은 삭제/자동 비활성화하지 않는다.

Master `Product+Sku+ProductComponent` Apply는 **한 batch의 한 트랜잭션**으로 원자화한다. 어느 BOM/unique/FK/ActivityLog 단계든 실패하면 전체 Master 변경을 rollback한다. 수정 전후 diff와 source provenance를 같은 commit에 남긴다. Fact는 §15의 chunk 정책을 사용한다. 확인된 source가 없는 Price/Cost/Logistics/Channel에 임의값을 만들지 않는다.

## 14. Idempotency

**Batch identity ≠ Apply identity.** Batch는 시도마다 UUID를 가질 수 있고 같은 hash를 parser version을 바꿔 재검증할 수 있다. Apply key는 §7의 scoped source identity `(workspace_id, source_type, source_scope_key, source_file_hash)`로 parser version과 파일명을 제외한다. 후속 DB 구현에서 이 key의 활성 적용을 unique로 보호하고, 트랜잭션에서 같은 source의 선행 적용 여부를 확인한다. 부분 적용 중인 Fact batch도 이 key의 소유권을 유지한다. `APPLIED` 파일 재호출은 기존 결과를 반환하는 no-op, 다른 batch의 같은 source 재적용은 `DUPLICATE_APPLY`로 거부한다. Parser 변경은 새로운 preview를 허용하지만 이미 적용된 동일 파일을 조용히 덮어쓰지 않는다. 재적용은 별도 보정/대체 계획과 ADMIN 승인 뒤에만 가능하다.

Master는 Workspace별 Product/SKU/BOM 업무키와 기존 unique/FK를 다시 검증한다. Sales/Marketing의 chunk 재시도에는 활성 Fact에 **교차 batch source-row key** `(apply key, source_sheet, source_block, original_row_number, fact_subkey)`를 unique로 보관한다. Sales는 `fact_subkey = ROW`, Marketing은 매체 블록이다. 같은 파일 안 같은 값의 서로 다른 물리 행은 행 번호가 달라 모두 남고, 중단 뒤 같은 chunk를 재실행해도 이미 commit된 Fact를 재삽입하지 않는다. 다른 hash의 파일 사이에 같은 거래가 있는지 증거가 없으므로 값 기반 dedupe를 하지 않고 중복 위험을 preview에 알린다.

## 15. Atomicity

Master는 batch 전체를 한 트랜잭션에 넣는다. Product 성공·SKU 성공·BOM 실패이면 셋 모두 rollback된다. `APPLIED` 상태, apply key 점유, provenance, ActivityLog도 같은 commit 경계다. Fact 대량 파일은 125,242행을 한 거대 트랜잭션이나 행별 트랜잭션으로 처리하지 않는다. **정해진 크기의 chunk별 원자적 트랜잭션**을 사용한다. chunk 안 Fact·교차 batch source-row key·진행 count·ActivityLog/상태를 함께 commit한다. 실패 chunk는 전체 rollback하고, 이전 chunk는 보존해 `PARTIALLY_APPLIED`와 committed/remaining count를 표시한다. 재시도는 같은 revision의 미완료 chunk만 처리한다. 의도적 invalid/deferred 행은 Fact로 만들지 않아도 `APPLIED`의 보류 count에 남을 수 있다.

동시 Apply는 `(workspace_id, source_type, source_scope_key)` 단위의 **DB 소유 apply lock/lease**로 직렬화한다. Master는 한 트랜잭션 잠금, Fact는 chunk 간에도 batch 소유권을 유지하는 회복 가능한 lease와 각 chunk 트랜잭션 잠금을 쓴다. Lease에는 owner batch와 단조 증가 `generation`(fencing token)을 둔다. **매 chunk/resume 트랜잭션은 잠금 행의 owner+generation+미만료, 승인 revision, 현재 승인 actor의 ACTIVE ADMIN 권한을 다시 확인한 뒤에만 Fact/count/log를 commit**한다. 권한 회수나 승인 무효화 시 새 chunk를 시작하지 않는다. 이미 commit된 chunk가 있으면 `PARTIALLY_APPLIED`, 없으면 `FAILED`로 남긴다. takeover는 generation을 증가시키고 commit된 row key와 상태를 재조회한다. 만료된 worker의 오래된 generation은 즉시 거부한다. 전 Workspace 단일 잠금은 다른 Source 작업까지 막으므로 사용하지 않는다. 다른 Source type이 같은 Master를 변경하는 경합은 대상 row version/unique/FK 검사와 stale preview 거부가 보호한다. 구현 방식은 Migration 단계에서 검증하되 클라이언트 메모리 잠금은 허용하지 않는다.

## 16. Source-specific Policies

| Source | Dry-run | Partial Apply | Blocking Rule | Main Target |
| --- | --- | --- | --- | --- |
| Master | 필수, V0.2 우선 | **불가**; Product/SKU/BOM batch 원자적 | 중복·빈 품번, 미확인 SKU, BOM 파싱/수량 불일치, 구조 오류는 전체 차단 | 승인 Product, Sku, ProductComponent; Price/Cost는 후속 |
| Barcode | 필수, 후속 | V1 미허용; 공식 단위 대응 확인 후 재결정 | 단일 SKU 포장/수량/공유 바코드 의미 미확인은 보류 | LogisticsUnit, BarcodeIdentifier |
| Channel | 필수, 후속 | V1 미허용; 채널·파일 snapshot 단위로 재결정 | 상품/옵션 ID·parent 관계·채널 상태/가격 의미 미확인은 차단/보류 | ChannelListing, ChannelOffer |
| Sales | 필수, 후속 | **허용**; 유효 물리 행만 chunk 적용, 오류 행 보류 | 파일 구조 오류는 batch 차단; 날짜·금액 오류는 해당 행 차단 | SalesFact |
| Marketing | 필수, 후속 | **허용**; 값이 있는 유효 매체 블록만 chunk 적용 | 구조/날짜 오류는 관련 scope 차단; 빈 블록은 Fact 없음 | MarketingFact |

### Master / BOM

`단가표!B`의 `100526` 일곱 행(158–164)은 서로 다른 상품 후보이므로 `DUPLICATE_BUSINESS_KEY` 집합 issue와 각 Raw 링크를 만들고 **Master batch Apply 전체를 차단**한다. 이름/행번호를 품번 suffix로 쓰지 않는다. 품번 공백 3행도 Product가 아니며 `MISSING_REQUIRED_FIELD`로 전체 차단한다. 공식 정정 후 별도 reviewed value로 재검증한다. `F`의 BOM 문자열은 tokenize → code/수량 후보 → 공식 SKU registry 대조 → `H` 수량 검산 → 승인 순서다. 미확인 `AL24`는 `UNKNOWN_SKU`로 ProductComponent를 만들지 않는다. 수량 불일치 8건, `UNPARSEABLE_BOM`/`INVALID_QUANTITY`도 hard block이다. `AL510` 같은 중간 묶음 코드를 임의로 분해하지 않는다. `100051 → AL00×1`은 확인 사례일 뿐 전체 규칙이 아니다. 중복 채널 section 21행을 별도 Product로 생성하지 않는다.

### Barcode / Channel

바코드는 **문자열**로 읽고 leading zero, 과학적 표기·numeric 변환 흔적을 검증한다. 관측된 13자리 값도 무조건 EAN-13로 선언하지 않는다. `SKU → LogisticsUnit → BarcodeIdentifier` 관계는 단일 SKU 포장과 수량이 확인된 때만 승격한다. `AG001`의 합포/카톤은 같은 source code라도 다른 단위/바코드다. 다중 SKU 세트, `판매미정`, 공유 바코드와 포장 수량 미확정은 DEFERRED/issue로 Raw에 남긴다. 바코드 전역 unique 금지. Barcode 이미지 열의 `#VALUE!`는 바코드 숫자 오류로 변환하지 않는다.

Channel은 채널 자체의 Listing ID와 실제 Offer ID가 있을 때만 연결한다. 토스의 67 Product/179 Option 관계는 parent key 검증 후 후보화하며 반복 옵션 헤더는 위치별로 판독한다. 옵션 행이 없는 스마트스토어·카페24·톡딜 추출물에 가상 `BASE` Offer를 만들지 않는다. 추가 export에서 실제 무옵션 판매 단위가 확인된 경우에만 Domain의 `BASE` 규칙을 사용한다. 상태/가격 의미가 미확정이면 Master 링크/가격을 추론하지 않는다.

### Sales

`로우데이터`의 **125,242 물리 행**은 주문 ID 없는 Source Sales Row다. A:G가 같아도 `DISTINCT`/값 기반 hash dedupe를 하지 않는다. `SalesFact` 하나는 검증된 물리 Raw 행 하나이며 `raw_import_row_id`와 교차 batch source-row key를 갖는다. `gross_sales`는 원본 `결제금액`의 decimal 정규화값이지 순매출/정산액이 아니다. 음수 text 7건은 원문 타입을 보존하고 금액 파싱 성공 후 환불/조정 의미가 미확정인 WARNING/REVIEW로 둔다. 수량 0·양수금액 79건은 삭제하지 않고 warning을 남기며 단가 계산에 쓰지 않는다. 잘못된 숫자/날짜는 그 행만 DEFERRED, 다른 유효 행은 chunk Apply 가능하다.

Product가 없더라도 `master_product_id = NULL`과 `match_status = UNMATCHED/REVIEW_REQUIRED`를 허용한다. 매칭 근거가 승인되면 `MATCHED`와 `DIRECT_CODE/SKU_BOM/ALIAS/MANUAL` 중 method를 기록한다. 코드 token/이름 유사도만으로 Product FK를 확정하지 않으며 fuzzy 자동매칭은 범위 밖이다. `쇼핑몰명` 22 label은 원문 보존; 승인된 매핑 없으면 `channel_id = NULL`로 둔다. `source_date`(원문/파싱), `reporting_date`, `date_basis`를 구분한다. 스마트스토어 도착보장 `PAYMENT_DATE`, 쿠팡 로켓배송 `EXPECTED_INBOUND_DATE`, 주석으로 확인된 일반 채널 `ORDER_DATE`, 컬리/FBK 등 미확인은 `OTHER`/미확정으로 보존한다. Excel serial/ISO/invalid/future/missing 날짜를 구분하고 미래라는 이유만으로 일괄 오류로 보지 않는다. 수기 공구 보고값을 없는 Raw 행으로 꾸며 SalesFact에 넣지 않는다.

### Marketing

grain은 `source_surface(sheet) + reporting_date + media_type`의 **값 있는 블록**이다. `자사몰` 2026-10-01~13 브랜드검색 값만 현재 관측된다. 네이버DA/네이버톡톡과 다른 빈 시트·월 합계·예산/목표 행은 Raw에 남기되 MarketingFact를 만들지 않는다. Product/SKU/Offer FK는 없다. 시트명과 판매 Channel의 연결도 명시적 승인 전 nullable이다. 광고비 공란과 수식 `#DIV/0!` ROAS를 0으로 바꾸지 않는다. 원본 `CTR/CVR`는 percentage-point 숫자(예 `36.67`), ROAS는 ratio 수식이다. 계산 가능한 파생 지표와 월 합계는 조회 시 계산을 우선하며 원본 수식·cached value는 Raw에 보존한다. 전환 정의·귀속 기간·통화/VAT가 확인되기 전에는 Product별 광고비 배분이나 Sales와 확정 결합을 하지 않는다.

## 17. Permissions

[Pilot Role Matrix](../INTERNAL_PILOT_ARCHITECTURE.md#3-authorization--role-model)를 따른다. VIEWER는 정제된 batch 요약/상태만 읽고 업로드·Raw·Candidate·상세 Issue·원본 파일·Dry-run·Review·Apply는 거부한다. EDITOR는 브라우저 Dry-run 결과 저장과 Raw/Candidate/Issue 공유 조회를 수행하지만 Candidate 또는 Issue review mutation, 승인과 Apply는 할 수 없다. ADMIN은 Candidate reviewed override와 Issue decision을 기록할 수 있지만 승인·Apply는 할 수 없다. Workspace 삭제/임의 rollback은 일반 UI 권한이 아니다. 모든 권한은 ACTIVE 멤버십을 DB/trusted boundary에서 재확인한다. persistence RPC는 ACTIVE ADMIN/EDITOR만, review RPC는 ACTIVE ADMIN만 허용한다. VIEWER, INVITED, DISABLED, anonymous와 교차 Workspace 호출을 거부한다.

## 18. Workspace Isolation

Batch, Raw, Issue, 후보, preview, 적용 대상, 원본 객체 metadata와 ActivityLog는 `workspace_id`를 가진다. Batch→Raw→Issue/Fact 및 Product/SKU/BOM·Channel/Offer FK는 동일 Workspace 복합 키로 묶고 RLS+GRANT로 행 접근을 제한한다. source hash가 같아도 Workspace 간 합치지 않는다. 5F Master 원본 객체 경로는 `<workspace_uuid>/<source_file_uuid>/source.xlsx`로 격리하되 **경로 자체는 권한 근거가 아니다**. Storage의 private bucket에도 별도 RLS/서버 검사로 현재 ACTIVE 멤버십과 Role을 적용한다. RLS가 없는 exposed table/view 또는 private 객체 공개 URL로 우회하지 않는다.

## 19. Activity Logging

`IMPORT_CREATED`, `IMPORT_VALIDATED`, `IMPORT_REVIEWED`, `IMPORT_APPLIED`, `IMPORT_FAILED`, `IMPORT_CONFLICT_RESOLVED`를 [ActivityLog 설계](../INTERNAL_PILOT_ARCHITECTURE.md#4-activity-logging)에 연결한다. Master Dry-run 저장 성공 시 Batch·Raw·Candidate·Issue와 같은 transaction에 `IMPORT_VALIDATED` 한 건을 생성한다. Candidate 또는 Issue review 성공 시 대상 entity와 같은 transaction에 `IMPORT_REVIEWED` 한 건을 생성한다. `actor_user_id`는 `auth.uid()`, `actor_ref`는 DB가 Workspace membership마다 생성한 opaque UUID를 사용한다. 클라이언트가 actor를 보내지 않으며 이메일·이름을 reference로 쓰지 않는다. `changed_fields`에는 validation/review revision, Candidate kind 또는 Issue code, 검토 필드명과 상태 변화만 남기고 hash, 원본 셀·이메일·token을 복제하지 않는다. Apply/실패와 Fact chunk logging은 후속 계약이다.

## 20. File Storage / Retention

5F Master Workbook은 private Object Storage에 원본 `.xlsx`를 저장하고 DB에 SourceFile metadata, client-observed 값, **서버가 저장된 byte에서 다시 계산한** SHA-256/크기를 기록한다. 새 Batch는 `SERVER_VERIFIED` SourceFile만 참조한다. Barcode/Channel/Sales/Marketing 파일은 아직 구현 범위가 아니다. 같은 key overwrite는 브라우저에 허용하지 않는다. Apply 직전 객체 version·size·hash 재확인은 후속 단계 계약이며 현재 Apply는 없다. 클라이언트 제공 hash/filename은 권한 또는 멱등성의 근거가 아니다. Original/Raw/Applied Fact/ActivityLog는 서로 다른 보존 정책 대상이다. 파일럿에서는 임의 자동 삭제를 기본으로 하지 않고 접근·백업·복구 담당자 및 retention을 운영 전에 정한다. DB 백업은 Storage 객체를 포함하지 않으므로 별도 백업과 복원 리허설이 필요하다. [5F 원본 계약](IMPORT_SOURCE_STORAGE.md)을 참고한다.

Object Storage와 DB는 하나의 ACID 트랜잭션이 아니다. 현재 5F는 등록→업로드→서버 검증→Batch 저장 순서로 진행하며, 중간 실패 시 남은 등록/객체는 정확한 ID와 path를 대조한 관리자 정리 대상이다. 자동 삭제는 없다. 백업 복원에서도 metadata와 실제 객체의 hash를 대조해야 한다.

원본에 미래 개인정보가 들어올 수 있으므로 수집 필드 최소화, Raw 접근 제한/암호화, 감사 가능성과 삭제 요청의 균형을 검토한다. 운영 로그·일반 UI 응답은 민감 필드를 마스킹하되 immutable Raw를 조용히 변형하고 완전한 원본이라고 주장하지 않는다. 민감 원본의 보관/삭제는 별도 정책을 확정한다. 앱 로그/ActivityLog에 전체 Raw 행, 파일 binary, Auth token/password/service key를 출력하지 않는다. private 객체 다운로드는 권한을 재검증한 인증 경로나 짧은 만료의 URL만 사용한다. 브라우저에 `service_role`을 넣지 않는다. [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [private bucket](https://supabase.com/docs/guides/storage/buckets/fundamentals), [DB backups](https://supabase.com/docs/guides/platform/backups)를 구현 시 다시 확인한다.

## 21. Error Handling

Parser/Schema 오류는 user-correctable source 문제와 기술 실패를 구분한다. Validation Issue는 Raw/후보와 연결된 업무/데이터 오류이며, Permission 오류는 상세 데이터의 존재를 누설하지 않는 접근 거부다. Storage/DB 일시 실패는 correlation ID와 안전한 retry 상태를 반환한다. 예상 밖 예외는 개인정보 없는 운영 로그를 남기고 batch를 완료 처리하지 않는다. 모든 사용자 메시지는 수정 가능한 필드/행과 처리 방식을 제공하되 raw 전체를 애플리케이션 로그에 출력하지 않는다. Issue 코드와 별도 BatchFailureCode 허용 목록·재시도 정책은 [Error Codes](IMPORT_ERROR_CODES.md) 참조.

## 22. Retry / Revalidation

5F에서는 검증 실패 원인을 확인한 뒤 서버 검증을 재시도할 수 있으나 hash mismatch 또는 원본 byte 변경은 새 SourceFile과 새 Batch가 필요하다. 같은 source hash·parser version·validation revision에서만 현재 Review 근거를 유지한다. Parser 변경 시 새 Batch가 필요하고 향후 재검증 결과에 이전 Review를 자동 이월하지 않는다. validation revision 2 생성, 승인, Apply, 부분 적용 resume은 아직 구현하지 않았다. `DUPLICATE_BUSINESS_KEY`, `UNKNOWN_SKU`, `SOURCE_SCHEMA_MISMATCH`는 자동 retry로 해결되지 않는다.

## 23. Schema Drift

각 Adapter는 지원 sheet/header·필수 열·위치 signature를 버전별로 명시한다. Header 누락/rename/필수 열 이동/반복 헤더 의미 변경은 `SOURCE_SCHEMA_MISMATCH`로 batch 차단한다. 추가 열은 Raw에 보존하고 미사용 상태를 warning으로 표시할 수 있지만 자동 의미 매핑은 하지 않는다. Source별로 고정 위치가 진짜 계약일 때만 position을 사용하고 헤더도 함께 검증한다. Excel 병합·숨김 행/필터, formula text와 cached result, error cells를 구분한다. 수식 결과가 stale인지 확인 불가하거나 오류이면 승인 대상 값으로 사용하지 않고 issue를 만든다. `가격/원가` 수식 결과를 관측 snapshot으로 기록할 수는 있어도 DB에서 Excel 공식을 재현하지 않는다.

## 24. Rollback Strategy

V1에는 **자동 hard rollback을 제공하지 않는다**. 적용 전/진행 중 트랜잭션 실패는 해당 트랜잭션 rollback이며, 이미 commit된 Fact chunk는 남아 `PARTIALLY_APPLIED`로 식별된다. 적용 후 발견된 잘못된 Master 변경은 승인된 이전값/원본 provenance와 ActivityLog·apply diff를 근거로 **보정 변경**을 새 batch/관리자 작업으로 수행한다. Fact는 잘못된 snapshot을 합계에서 제외하는 명시적 supersede/비활성화와 재검증 후 대체를 후속 계약으로 둔다. 단순 DELETE는 downstream 참조·감사 이력을 잃으므로 금지한다. V1의 Product 변경 추적은 ActivityLog의 허용 필드 old/new + 적용 diff + Raw provenance로 시작하고 별도 history table은 장기 시점 조회 요구가 확인되면 도입한다. 법적 데이터 삭제는 별도 절차다.

## 25. TypeScript Contract Draft

다음은 문서의 개념 초안이며 `src/` 구현 타입이 아니다. 메서드의 내부 구현은 권한/트랜잭션 경계를 따라야 한다.

```ts
type SourceType = 'MASTER_WORKBOOK' | 'BARCODE_WORKBOOK' | 'CHANNEL_EXPORT' | 'SALES_WORKBOOK' | 'MARKETING_WORKBOOK'
type BatchStatus = 'RECEIVED' | 'VALIDATING' | 'REVIEW_REQUIRED' | 'READY_TO_APPLY' | 'APPLYING' | 'PARTIALLY_APPLIED' | 'APPLIED' | 'FAILED' | 'CANCELLED'
type BlockingScope = 'NONE' | 'CANDIDATE' | 'BATCH'

interface ImportBatchContract {
  id: string; workspaceId: string; sourceType: SourceType; sourceScopeKey: string
  sourceFilename: string; sourceFileHashSha256: string; parserVersion: string
  status: BatchStatus; validationRevision: number; createdBy: string; createdAt: string
  rowCount: number; validCount: number; warningCount: number; errorCount: number
  deferredCount: number; appliedCount: number; failedCount: number; remainingCount: number
  validatedAt: string | null; appliedAt: string | null
}
interface RawCellContract {
  address: string; originalType: 'BLANK' | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'FORMULA' | 'ERROR'
  originalValue: string | number | boolean | null
  formulaText: string | null; cachedType: string | null
  cachedValue: string | number | boolean | null; errorCode: string | null
}
interface RawImportRowContract {
  id: string; workspaceId: string; importBatchId: string; sourceSheet: string
  originalRowNumber: number; rawCells: RawCellContract[]; sourceBlock: string | null
}
interface NormalizedCandidateContract<T> {
  id: string; workspaceId: string; importBatchId: string; rawImportRowId: string
  supportingRawRowIds: string[]; sourceBlock: string | null; candidateOrdinal: number; kind: string
  parserVersion: string; validationRevision: number; sourceFieldMap: Record<string, string>
  normalizedValues: T; reviewedValues: Partial<T> | null
}
interface ValidationIssueContract {
  id: string; workspaceId: string; importBatchId: string; rawImportRowId: string | null
  relatedRawRowIds: string[]; validationRevision: number
  issueCode: string; severity: 'INFO' | 'WARNING' | 'ERROR'; blockingScope: BlockingScope
  fieldPath: string | null; observedValue: unknown; expectedRule: string; message: string
  status: 'OPEN' | 'RESOLVED' | 'ACKNOWLEDGED' | 'DEFERRED'
  resolution: string | null; reviewedBy: string | null; reviewedAt: string | null
}
interface ValidationResult {
  batchId: string; validationRevision: number
  candidateCounts: { valid: number; warning: number; error: number; deferred: number }
  issues: ValidationIssueContract[]
}
interface ImportPreview {
  batchId: string; validationRevision: number; previewToken: string
  entityDiffs: Record<string, { new: number; unchanged: number; changed: number; conflict: number }>
  blockingIssues: number; warnings: number; deferred: number
  rows: Array<{ rawImportRowId: string; original: unknown; normalized: unknown; reviewed: unknown; issues: string[]; proposedDiff: unknown }>
}
type ApplyResult =
  | { batchId: string; status: 'APPLIED'; applied: number; deferred: number
      failed: 0; remaining: 0; unchanged: number; correlationId: string }
  | { batchId: string; status: 'PARTIALLY_APPLIED'; applied: number; deferred: number
      failed: number; remaining: number; unchanged: number; correlationId: string }
interface ImportService {
  inspect(input: { workspaceId: string; sourceType: SourceType; sourceScope?: string; file: Blob }): Promise<ImportBatchContract>
  validate(batchId: string): Promise<ValidationResult>
  preview(batchId: string): Promise<ImportPreview>
  apply(input: { batchId: string; previewToken: string }): Promise<ApplyResult>
}
interface AdapterRawRow {
  sourceSheet: string; originalRowNumber: number; sourceBlock: string | null; rawCells: RawCellContract[]
}
interface AdapterCandidate<T> {
  kind: string; sourceSheet: string; originalRowNumber: number
  sourceBlock: string | null; candidateOrdinal: number
  supportingSourceRows: Array<{ sourceSheet: string; originalRowNumber: number }>
  sourceFieldMap: Record<string, string>; normalizedValues: T
}
interface SourceAdapter<T> {
  readonly sourceType: SourceType; readonly parserVersion: string
  inspectStructure(file: Blob): Promise<{ supported: boolean; schemaSignature: string }>
  captureAndNormalize(file: Blob): AsyncIterable<{ raw: AdapterRawRow; candidates: AdapterCandidate<T>[] }>
}
```

`ImportService`는 lifecycle/권한/validation/preview/apply를 조정하고 Adapter는 source 구조·셀·후보만 담당한다. Adapter 출력에는 DB ID, Workspace ID, Batch ID, review 값이 없으며 trusted service가 Raw 저장 후 source 좌표를 ID로 연결한다. `validate`는 Issue/판정 revision을 반환하고 `preview`가 diff/token을 생성한다. UI에는 허용된 DTO만 반환하며 Raw 접근은 Role에 따라 제한한다. 위 `Blob`은 입력 개념 표기일 뿐 대용량 파일을 브라우저 메모리나 DB에 통째로 보관한다는 구현 결정이 아니다.

## 26. Security

인증된 actor의 현재 ACTIVE Workspace 멤버십/Role을 서버에서 확인한다. `service_role`·Auth admin secret은 브라우저에 넣지 않는다. 공개 Data API의 Import table은 GRANT+RLS를 모두 검토하고, 권한을 가진 함수도 함수 내부에서 대상 Workspace를 다시 확인한다. 민감 Raw와 원본 파일은 VIEWER에게 노출하지 않는다. Apply는 클라이언트가 보내는 actor ID·role·diff count를 신뢰하지 않는다. 오류·preview 응답에도 다른 Workspace의 존재/값을 누설하지 않는다. Storage 객체의 bucket과 DB 백업/원본 백업에는 각각 접근·보존 정책을 둔다. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)와 [Storage 권한](https://supabase.com/docs/guides/storage/security/access-control)을 후속 구현 전 재검토한다.

## 27. Recommended V0.2 Scope

**현재 단계:** `MASTER_WORKBOOK`의 Product·SKU·BOM Dry-run, Batch/Raw/Candidate/Issue 중앙 저장, ADMIN reviewed override와 Issue decision, `IMPORT_VALIDATED`/`IMPORT_REVIEWED` 기록까지 구현됐다. 적용 가능한 공식 코드/구성 증거가 부족한 `100526`·`AL24`·수량 불일치는 계속 당시 Candidate 판정과 이슈로 남는다. **다음 추천안:** private Source File Storage와 server-verified SHA-256, revalidation/review consistency를 별도 단계로 구현한다. 5E remote acceptance와 Pilot Gate를 통과하기 전 실제 공유 데이터 Apply를 허용하지 않는다.

## 28. Deferred Items

Barcode/Channel/Sales/Marketing Adapter·승격, 자동 fuzzy matching, Product별 광고 귀속, 주문/정산 ERP, PricePolicy, 자동 rollback, 범용 history table, 저장 기간 숫자와 SaaS 비용 정책, 자격을 갖춘 원본의 재적용/supersede 상세 프로토콜은 후속 범위다. Sales 파일 간 중복 거래를 식별할 주문 ID가 없으므로 **서로 다른 hash의 겹침을 자동 제거할 수 없다**. 채널의 실제 옵션 행, 공식 SKU/BOM 정정, 날짜·통화·VAT·광고 귀속 정의는 원본 소유자의 확인이 필요하다. 이 문서는 해당 불확실성을 임의값으로 채우지 않는다.
