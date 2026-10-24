# SellerAudit Import Error Codes v1 (설계안)

[Import Contract v1](IMPORT_CONTRACT.md)의 검증/적용 결과에 쓰는 코드다. 이 파일은 코드와 DB enum을 생성하지 않는다. `Severity`는 운영 우선순위, `Blocking`은 **기본 적용 차단 범위**다. `BATCH`는 전체 Apply 금지, `CANDIDATE`는 해당 후보/원본 행만 금지, `NONE`은 적용 자체를 막지 않는다. Source별 정책이 다를 때 표에 구체적으로 쓴다. Catalog에 없는 오류를 클라이언트가 임의의 non-blocking 코드로 보낼 수 없고, 관리자 확인도 DB unique/FK·필수값 위반을 면제하지 않는다. REVIEW/해결 후에는 새 validation revision과 preview가 필수다.

| Code | Meaning | Severity | Blocking | Source | Detection | User Resolution |
| --- | --- | --- | --- | --- | --- | --- |
| `UNSUPPORTED_SOURCE` | 선택한 source type을 처리할 Adapter가 없거나 실제 구조와 맞지 않음 | ERROR | BATCH | 전체 | 명시 type/scope와 지원 signature 대조 실패 | 올바른 source 선택 또는 지원 Adapter 버전 준비 |
| `SOURCE_SCHEMA_MISMATCH` | 필수 sheet/header/열 위치·반복 블록 구조가 지원 계약과 다름 | ERROR | BATCH | 전체 | 필수 열 누락·이름/위치 변경·토스 반복 `옵션명` 자리 변경 | 원본 export 양식 확인; 새 schema를 검증한 Adapter 버전으로 재처리 |
| `MISSING_REQUIRED_FIELD` | 대상 후보의 필수 값이 없음 | ERROR | Master/Channel=BATCH; Sales/Marketing/Barcode=CANDIDATE (Barcode V1 Apply 보류) | Master, Channel, Sales, Marketing, Barcode | 품번 공백, 필수 Listing/Offer ID·날짜 등 Null/빈값 | 공식 원본 수정 또는 근거 있는 reviewed value 입력 후 재검증 |
| `INVALID_DATA_TYPE` | 원본 셀 타입/표현이 허용된 값으로 정규화되지 않음 | ERROR | Master/Channel=BATCH; Sales/Marketing/Barcode=CANDIDATE (Barcode V1 Apply 보류) | 전체 | text/code/date/quantity 변환 실패; 원문 타입 보존 | 필드와 원본 셀을 확인해 source 수정/검토값 지정 |
| `DUPLICATE_BUSINESS_KEY` | 서로 다른 Master 후보가 같은 사방넷 품번을 요구 | ERROR | BATCH | Master | `100526` 158–164행 등 batch 내부·기존 Master 충돌 비교 | 공식 품번/상품 identity 정정; 이름·행번호 suffix 금지 |
| `UNKNOWN_SKU` | BOM code가 승인된 실물 SKU registry에 없음 | ERROR | BATCH | Master | `AL24` 등 token과 공식 SKU 대조 실패 | SKU 종류/코드를 소유자 확인 후 등록 또는 BOM 정정 |
| `UNPARSEABLE_BOM` | BOM 문자열에서 code/수량 후보를 확정할 수 없음 | ERROR | BATCH | Master | `단가표!F` tokenize 실패·중간 묶음 의미 불명 | 공식 구성표/검토값으로 code·수량을 확인 |
| `INVALID_QUANTITY` | 수량 파싱 실패·정수/양수 제약 위반 | ERROR | Master=BATCH; Fact=CANDIDATE | Master, Sales | BOM `quantity <= 0` 또는 수량 비정상 표현; Sales의 진짜 타입 오류 | 원본/공식 수량 수정. Sales의 유효 숫자 0은 이 코드가 아님 |
| `BOM_QUANTITY_MISMATCH` | BOM token 수량 합계와 별도 구성 수량이 불일치 | ERROR | BATCH | Master | `단가표!F/H` 비교; 확인된 8건 포함 | 묶음 코드·포장 의미 검토 후 공식 구성 수량 확정 |
| `UNKNOWN_CHANNEL` | source channel/surface를 승인된 Channel로 연결할 수 없음 | WARNING | Sales/Marketing=NONE; Channel export=BATCH | Channel, Sales, Marketing | Workspace별 명시적 Channel mapping 부재 | Sales/Marketing은 원본 label·nullable channel 유지; Channel export는 관리자 mapping 승인 |
| `UNKNOWN_DATE_BASIS` | 날짜가 주문/결제/입고예정/보고 중 무엇인지 불명 | WARNING | NONE; 날짜 자체가 불가하면 `INVALID_DATA_TYPE` | Sales, Marketing | Source label/주석과 승인 날짜 규칙 불일치 | `OTHER`/미확정과 원본 날짜 보존; 업무 기준 확인 뒤 재검증 |
| `INVALID_MONEY` | 금액이 유한 decimal로 안전하게 파싱되지 않음 | ERROR | Master=BATCH; Fact=CANDIDATE | Master Price/Cost, Sales, Marketing | 숫자/문자열 구분 후 decimal 변환 실패·Excel 오류 | 통화·소수점/천단위·원본 오류 확인 후 정정 |
| `AMBIGUOUS_ALIAS` | 이름/옵션 alias가 복수 Product 후보에 연결 | WARNING | NONE for Fact; Product 매핑 승격은 별도 차단 | Sales, Channel | source 이름 사전의 충돌 3건·복수 후보 발견 | ADMIN/EDITOR가 근거를 검토; 확정 전 Product FK NULL |
| `DUPLICATE_APPLY` | 동일 source identity가 이미 다른 batch에서 적용됨 | ERROR | BATCH | 전체 | Workspace/type/scope/hash의 활성 적용 중복 | 기존 적용 결과 확인; 재처리는 명시적 보정/대체 계획. 같은 batch 재호출은 no-op |
| `EXCEL_CELL_ERROR` | 필요한 셀의 cached result가 `#REF!`/`#DIV/0!` 등 | ERROR | 필요한 Master/Channel 필드=BATCH; 필요한 Sales/Marketing 필드=CANDIDATE; 미사용 이미지/파생값=NONE | 전체 | formula text·cached value·error type 분리 | 원본 수식/입력 수정; 미사용 값은 Raw만 보존 |
| `FORMULA_CACHE_UNTRUSTED` | 필요 수식의 cached value가 없거나 최신인지 확인 불가 | WARNING | 필요한 Master/Channel 승격값=BATCH; 필요한 Sales/Marketing 값=CANDIDATE; 미사용 값=NONE | Master Price/Cost, Channel, Sales, Marketing | 수식 존재·cached result 없음/오류 또는 재계산 시각 불명 | 원본 소유자가 재계산·저장한 snapshot 제공 후 재검증 |
| `BARCODE_SCOPE_UNVERIFIED` | 바코드가 어느 단일 SKU 포장/수량에 속하는지 불명 | WARNING | CANDIDATE | Barcode | `AG001` 합포/카톤·공유 barcode·다중 SKU 세트 대조 | 공식 포장단위/수량 관계 확인; 그전 Raw/Issue에 보류 |
| `MISSING_OPTION_ID` | Channel Offer의 실제 option ID 또는 parent Listing ID가 없음 | ERROR | BATCH(V1 Channel 부분 적용 미허용) | Channel | 옵션 시트의 관계/ID 누락·고아 옵션 | 옵션 포함 export 재수급 또는 공식 무옵션 판매 단위 확인 |
| `NEGATIVE_MONEY_UNVERIFIED` | 파싱된 음수 매출의 환불/조정 의미 미확정 | WARNING | NONE; 확인 전 별도 집계 주석 | Sales | text `"-6290"` 등 음수 7건의 원문 타입/값 확인 | 취소·환불·정산 정의 확인; 행은 물리적으로 보존 |
| `ZERO_QUANTITY_POSITIVE_SALES` | 수량 0인데 양수 금액이 있음 | WARNING | NONE | Sales | 쿠팡 로켓배송 79행과 같은 조합 | 업무 의미 검토; 단가 계산에서 제외하고 Fact 행은 유지 |
| `EMPTY_MARKETING_BLOCK` | 매체 지표가 전부 비어 있음 | INFO | NONE; Fact 대상 아님 | Marketing | 네이버DA/네이버톡톡 등 블록의 실제 입력값 전부 Null | Raw는 보존; 신규 값이 채워지기 전 Fact 없음 |
| `STALE_PREVIEW` | 검증 revision/참조 데이터/diff가 승인한 preview 이후 변경됨 | ERROR | BATCH | 전체 | apply 직전 서버 재검산과 preview token 불일치 | Dry-run 다시 실행하고 ADMIN이 새 diff 승인 |
| `CONCURRENT_APPLY` | 같은 Workspace·source type/scope에 다른 Apply가 진행 중 | WARNING | BATCH(현재 시도 대기/거부) | 전체 | DB 소유 apply lock/lease 충돌 | 선행 batch 완료 확인 후 재시도; client 자체 잠금 금지 |

## BatchFailureCode (ValidationIssue와 별도)

`FAILED` batch에는 다음 허용 코드와 correlation ID를 저장한다. 사용자에게 원본 셀이나 내부 DB 오류를 그대로 노출하지 않는다. 권한 거부는 접근 주체에게만 일반적인 거부를 반환하고 타 Workspace batch의 존재를 알리지 않는다.

| Code | 의미 | 자동 재시도 | 처리 |
| --- | --- | --- | --- |
| `STORAGE_TEMPORARY_FAILURE` | 업로드·읽기·검증 중 일시 Storage 장애 | 가능 | 동일 immutable 객체/hash를 확인한 뒤 안전하게 재시도 |
| `SOURCE_FILE_UNAVAILABLE` | Batch가 가리키는 객체가 없거나 hash·version 불일치 | 불가 | Apply 중단, 운영자 복원/원본 재검증 |
| `SOURCE_CAPTURE_FAILURE` | 파일 손상 또는 Raw capture를 완료할 수 없음 | 원인 확인 후 | 부분 Raw를 적용에 사용하지 않고 원본·Adapter 점검 |
| `DATABASE_TEMPORARY_FAILURE` | DB 접속/일시 트랜잭션 장애 | 가능 | commit 여부와 source-row key를 재조회한 뒤 재시도 |
| `APPLY_AUTH_REVOKED` | 승인 actor의 ACTIVE ADMIN 권한이나 승인이 Apply 도중 무효화됨 | 불가 | 새 chunk 중단; 권한·승인 재확인 후 명시적으로 재개 |
| `UNEXPECTED_FAILURE` | 분류되지 않은 기술 예외 | 자동 재시도 금지 | 제한된 운영 로그·correlation ID로 조사 |

## 해석 규칙

- `blocking_scope`는 issue 생성 시 rule version과 source policy로 결정해 저장한다. 위 표의 조건부 값은 실제 field/kind에 따라 **서버에서만** 선택한다. UI의 확인 버튼이 hard error를 `NONE`으로 바꾸지 못한다.
- `ERROR`가 한 Sales 행에만 발생하면 해당 행은 `DEFERRED`로 남을 수 있지만 file schema 오류는 전체 batch를 차단한다. Master의 Product/SKU/BOM hard error는 한 batch를 전부 차단한다.
- `WARNING`은 영향·원본 row·검토 actor를 preview에 드러내고 정책에 따른 확인을 요구한다. `ACKNOWLEDGED`는 warning에만 허용한다. `INFO`는 품질/제외 근거다.
- 기술적인 Storage/DB 일시 실패는 `ImportValidationIssue`로 가장하지 않는다. batch failure와 correlation ID로 기록하고 안전한 retry를 수행한다. 권한 거부는 타 Workspace 행의 존재를 노출하지 않는다.
- 이 카탈로그의 코드/심각도는 설계 기본값이다. 실제 Adapter 구현 시 원본 소유자와 검증한 rule version을 함께 고정하고 회귀 사례를 작성한다.
