# Master Workbook Import Dry-run

## 지원 범위

SellerAudit의 `데이터 가져오기 → Master Excel 분석`은 사용자가 선택한 `.xlsx` 파일을 브라우저 메모리에서 읽어 Product·SKU·BOM **후보**와 검증 이슈를 보여준다. 기본 Dry-run과 전체 Candidate preview는 브라우저 세션에서 수행한다. Supabase 모드의 ADMIN과 EDITOR는 Batch, Raw Row, Candidate Snapshot과 Validation Issue를 중앙 Import 기록으로 저장해 같은 Workspace에서 공유 검토할 수 있다. ADMIN은 Candidate review override와 Issue 결정을 기록할 수 있다. 원본 `.xlsx` binary는 DB·Storage에 저장하지 않는다. **Apply, Master 수정, 승인, 권한 관리**는 아직 없다.

현재 지원 양식은 [Master 원본 분석](MASTER_SOURCE_ANALYSIS.md)에 기록된 `★★땡스소윤_전체 상품 단가표_마스터파일_ver00.xlsx`의 구조다. 파일명으로 Source를 확정하지 않고 workbook 구조를 검사한다. 파일은 읽기 전용으로 사용하며 저장소에 포함하지 않는다.

## 지원 시트와 열

| 시트 | 사용 범위 | 처리 |
| --- | --- | --- |
| `단가표` | 5행 header, 6행 이후의 B 품번·C 구분·D 카테고리·E 모델명·F 구성 상세·H 구성수 | Product와 BOM 후보, 원본 행번호·셀 정보 |
| `코드DB` | B:Y의 구획별 코드 목록, 특히 E 상품코드와 C/D 모델·색상 | 코드 문맥을 보존한 SKU 후보와 제한된 BOM registry 검증 |
| `상품DB` | 독립 lookup 블록의 header | Master workbook signature 확인. `P000`/`SET001`을 Product/SKU 키로 사용하지 않음 |

`가격DB`와 `원가DB`는 이 단계의 Product·SKU·BOM 판단에 쓰지 않는다. `단가표!R:S`의 원가·가격도 Apply 대상이 아니다. 시트·필수 header가 없거나 위치가 달라지면 `SOURCE_SCHEMA_MISMATCH`를 표시한다.

## Parser 구조

브라우저 `File.arrayBuffer()` → SheetJS workbook 판독 → 원본 셀/행 추출 → Source별 후보 생성 → Master 검증 → Dry-run 요약 순서다. React 화면은 Parser와 업무 규칙을 실행하지 않고 서비스 결과만 렌더링한다. Raw에는 Sheet, 실제 Excel 행번호, Block, 셀 주소·원래 타입·원문값·수식·cached value·오류를 분리해 보존한다. Excel 수식을 실행하거나 오류를 숫자 0으로 치환하지 않는다. SHA-256은 브라우저가 계산한 `client-observed SHA-256`이다. 서버가 원본 binary에서 다시 검증한 hash가 아니므로 Apply 신뢰 근거로 사용하지 않는다.

## Validation

- 사방넷 품번은 문자열 Product business key다. 공백 품번에는 임의 코드를 만들지 않는다. `상품DB`의 내부 mapping 코드를 Product로 승격하지 않는다.
- 같은 품번이 서로 다른 상품 identity에 쓰이면 `DUPLICATE_BUSINESS_KEY`로 batch를 차단한다. `단가표` 후반의 채널 반복 행은 같은 Product인지 비교하고, 다른 Product로 자동 합치지 않는다.
- BOM의 `CODE N개` 토큰은 정수 양수만 허용한다. 유효한 코드에는 숫자가 없는 `IBAN`·`IBAKL`도 포함된다. 토큰을 완전히 해석하지 못하면 `UNPARSEABLE_BOM`, 잘못된 수량은 `INVALID_QUANTITY`다.
- 코드처럼 보인다는 이유만으로 `코드DB!E` 전체를 실제 SKU로 승인하지 않는다. 현재 BOM registry는 원본 분석에서 물리 용기와 구성품 근거가 확인된 `냉동용기`, `구성품` block으로 제한한다. 이 두 block 안에서도 모델명이 `+`로 결합된 `AL510` 같은 중간 묶음 행은 `DEFERRED_INTERMEDIATE_BUNDLE`로 보류한다. `로켓배송`, `스티커`, `박스(부자재)`, `아이스 땡스보틀` 등 나머지 block의 코드는 provenance를 가진 SKU 후보로 보존하지만 `DEFERRED_SOURCE_BLOCK`으로 분류한다. 보류 후보를 BOM이 참조하면 원본 소유자 확인 전 `UNKNOWN_SKU`로 차단한다.
- BOM 코드가 지원되는 SKU block 후보에 없으면 `UNKNOWN_SKU`, 완전 파싱된 BOM 수량 합과 `단가표!H`가 다르면 `BOM_QUANTITY_MISMATCH`다. 중간 묶음 코드는 자동 분해하지 않는다.
- 필수 셀의 Excel 오류·신뢰할 수 없는 수식 cache는 각각 `EXCEL_CELL_ERROR`·`FORMULA_CACHE_UNTRUSTED`로 처리한다. 상세 심각도와 차단 범위는 [Import Error Codes](IMPORT_ERROR_CODES.md)를 따른다.

검증 문제가 있어도 원본 행·후보·이슈를 함께 보여준다. 이 화면의 `정상`은 **이 파일 내 검증 통과**이며 기존 DB와 비교한 `NEW/CHANGED/UNCHANGED` 또는 Apply 승인이 아니다.

## 중앙 저장과 공유 검토

Supabase 모드에서 Dry-run이 끝나면 ADMIN과 EDITOR에게 `검증 결과 저장` 버튼을 제공한다. 한 번의 원자적 RPC로 Batch 요약, Raw Row, Validation Issue와 `IMPORT_VALIDATED` ActivityLog를 저장한다. 저장 중에는 버튼을 비활성화하고, 성공한 현재 preview는 다시 저장하지 않는다. 파일을 다시 선택하거나 분석하면 새 저장 시도가 가능하다.

저장된 Batch는 차단 이슈가 없어도 항상 `REVIEW_REQUIRED`다. 저장 성공은 공유 검토 기록이 만들어졌다는 뜻이고 Master Apply 가능 판정이 아니다. Mock 모드에는 `Supabase 모드에서만 공유 저장할 수 있습니다.`라고 표시한다.

같은 Workspace의 ADMIN과 EDITOR는 최근 저장된 Master 검증 20개의 요약, Product/SKU/BOM Candidate, Issue와 Raw evidence를 조회할 수 있다. ADMIN은 kind별 허용 필드만 `reviewed_values`에 저장하고 Issue를 해결·확인·보류·재오픈할 수 있다. EDITOR에게는 같은 자료를 read-only로 제공한다. Parser의 `normalized_values`와 사람이 확인한 `reviewed_values`는 화면에서도 분리한다. 자세한 RPC·권한·count 계약은 [Master Import persistence](MASTER_IMPORT_PERSISTENCE.md)와 [Candidate Review](IMPORT_CANDIDATE_REVIEW.md)를 따른다.

## 실제 원본 Dry-run 결과

2026-10-25에 SHA-256 `ecf54338543e9187af7dc9c796eda365c1925df905bd19ba2524c8e6b25d6dc7`인 원본을 읽기 전용으로 분석했다. Product 후보 215행, 코드DB SKU 후보 460행, BOM 구성 후보 850행을 추출했다. SKU 후보 중 현재 BOM registry 판정은 65행이고, 372행은 source block 확인 대기, 23행은 중간 묶음 확인 대기다. 보수적 분류에서 `UNKNOWN_SKU` 28건과 batch 차단 이슈 45건을 발견했다.

`100051`의 원본 6행과 채널 반복 200행, `AL00` 코드DB 23행은 정상 후보로 확인했다. `100526`은 7개 서로 다른 상품이 공유하는 충돌이고, `AL24`는 코드DB에서 확인되지 않았다. `AL510` 등 중간 묶음 참조는 확정 SKU로 자동 통과시키지 않는다. BOM 구성수 불일치 8행도 계속 탐지한다. 이 결과는 **Dry-run 기능 검증**이며 실제 Master Apply 가능 판정은 보류한다.

## 알려진 한계와 다음 단계

기존 Master DB와의 diff, revalidation, 승인, 원본 binary 보존, 서버 hash 검증과 원자적 Apply는 [Import Contract v1](IMPORT_CONTRACT.md)의 후속 구현 사항이다. 중앙 persistence는 Batch·Raw·Candidate·Issue·ActivityLog를 Workspace 범위로 저장하지만 이를 대신하지 않는다. `100526`의 공식 품번, `AL24`의 실물 SKU 여부, 수량 불일치의 정확한 구성은 원본 소유자가 확인해야 한다. review override 또는 Issue `RESOLVED`는 Candidate를 자동으로 `VALID`로 바꾸지 않으며 Batch도 `REVIEW_REQUIRED`에 남는다.
