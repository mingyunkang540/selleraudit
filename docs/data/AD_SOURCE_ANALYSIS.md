# 광고 데이터 원본 분석 (2026-10-24)

## 분석 범위와 판정 기준

- 원본: `★2026년 땡스소윤 광고 데이터.xlsx`
- SHA-256: `ba987e408d387fa92c5171b2798e52f2993aa6f0916cda67daf13d565ae0ecc3`
- 원본은 읽기 전용으로 분석했으며 저장소에 복사하거나 수정하지 않았다.
- 아래에서 **확인**은 셀 값·수식·병합·형식으로 직접 검증한 사실, **추론**은 헤더와 수치 관계를 근거로 한 해석, **미확인**은 업무 정의가 더 필요한 항목을 뜻한다.
- 현재 SellerAudit에는 광고 Fact Entity가 없다. 아래 `MarketingDailyFact`와 필드명은 Data Model V2 검토를 위한 **신규 후보**이며 구현된 계약이 아니다.

## 핵심 결론

**확인:** 이 파일은 Product나 SKU 단위가 아니다. 유효 데이터는 `자사몰` 시트의 2026-09-01~2026-11-30 일별 행이며, 광고 실적 값은 그중 2026-10-01~2026-10-13의 `브랜드검색` 열에만 들어 있다. 사방넷 품번, SKU code, 상품명, 옵션명, 바코드, Listing ID, Offer ID, 캠페인 ID가 없다.

**추론:** 현재 원본의 가장 세밀한 grain은 `판매 표면을 나타내는 시트 × 날짜`이고, 한 행 안에 `브랜드검색`, `네이버DA`, `네이버톡톡` 매체·상품군이 열 묶음으로 반복된다. 정규화한다면 `workspace + source sheet/sales surface + reporting date + advertising product/media` 단위의 Fact 후보가 자연스럽다. 시트명과 기존 SellerAudit `Channel`의 1:1 대응, 광고 매체와 판매 Channel의 동일성은 아직 검증되지 않았다.

**미확인:** 날짜의 업무 기준, 전환수의 정의, 광고매출의 귀속 기간, 취소·반품·VAT 포함 여부, 금액 통화, 광고비가 비어 있는 이유는 파일만으로 확정할 수 없다.

## Workbook 구조

Workbook의 시트는 모두 visible이다. 숨김 시트·숨김 행·숨김 열은 없고 Excel Table, AutoFilter, 정의된 이름도 없다. 실제 내용 범위와 서식만 남은 물리적 `max_row/max_column`을 구분해야 한다.

| 시트 | 헤더 | 실제 데이터 시작 | 실제 내용 | 물리적 범위 | 의미 있는 열 | 병합 | 수식 | 반복 헤더 |
| --- | --- | --- | --- | --- | ---: | --- | ---: | --- |
| `자사몰` | 4~5행, 2단 헤더 | 6행 | 날짜 91행, 예산/목표 2행, 합계 3행. 광고 값 입력 일별 행은 13행 | `A1:AO1052`, 실제 내용은 101행까지 | 22개 (`B:W`) | 12개. 헤더 묶음과 월 구간 `B6:B37`, `B38:B70`, `B71:B101` | 440개 | 시트 내부 반복 없음 |
| `네이버` | 4~5행, 2단 헤더 | 없음 | 제목·헤더만 존재, 데이터 0행 | `A1:AK5` | 18개 (`B:S`) | 9개 | 0개 | 시트 내부 반복 없음 |
| `29CM` | 4~5행, 2단 헤더 | 없음 | 제목·헤더만 존재, 데이터 0행 | `A1:AK972`, 실제 내용은 5행까지 | 18개 (`B:S`) | 9개 | 0개 | 시트 내부 반복 없음 |
| `오늘의집` | 4~5행, 2단 헤더 | 없음 | 제목·헤더만 존재, 데이터 0행 | `A1:AO973`, 실제 내용은 5행까지 | 18개 (`B:S`) | 9개 | 0개 | 시트 내부 반복 없음 |
| `외부채널 마케팅 비용` | 없음 | 없음 | 완전 빈 시트 | `A1:A1` | 0개 | 없음 | 0개 | 없음 |

네 개의 채널형 시트는 `주요이슈`, `날짜`, `결제수`, `매출`, `ROAS`, `광고비`라는 공통 상위 열을 사용한다. `네이버`, `29CM`, `오늘의집`은 같은 2단 헤더 템플릿을 반복하지만 실제 행이 없어 데이터 타입·키·Null 패턴을 검증할 수 없다. `자사몰`은 브랜드검색 블록만 노출·클릭·CTR·CVR까지 확장되어 다른 시트와 열 위치가 다르다.

## `자사몰` 행 구조와 데이터 범위

| 행 구분 | 원본 행 | 건수 | 확인된 내용 |
| --- | --- | ---: | --- |
| 제목 | 2 | 1 | `땡스소윤_자사몰` |
| 헤더 | 4~5 | 2 | 기본 지표와 광고 블록의 2단 헤더 |
| 9월 일별 | 6~35 | 30 | 2026-09-01~09-30, 입력 광고 값 없음 |
| 9월 예산/목표 | 36 | 1 | 라벨만 있고 목표 값 없음 |
| 9월 합계 | 37 | 1 | 합계/ROAS 수식. 입력값이 없어 대부분 0 또는 `#DIV/0!` |
| 10월 일별 | 38~68 | 31 | 2026-10-01~10-31. 10월 1~13일의 브랜드검색 지표만 입력 |
| 10월 예산/목표 | 69 | 1 | 라벨만 있고 목표 값 없음 |
| 10월 합계 | 70 | 1 | 브랜드검색 노출 `12,240`, 매출 `123,893,290`; 광고비가 없어 ROAS 오류 |
| 11월 일별 | 71~100 | 30 | 2026-11-01~11-30. 광고 지표 입력 없음 |
| 11월 합계 | 101 | 1 | 입력값이 없어 대부분 0 또는 `#DIV/0!` |

- 날짜 91개는 모두 비어 있지 않고 고유하며 2026-09-01부터 2026-11-30까지 하루 간격으로 연속된다.
- `B` 열 헤더는 `주요이슈`지만 값은 `26.09`, `26.10`, `26.11` 월 구분자다. 병합 때문에 각 월 첫 행에만 값이 있고 나머지는 물리적으로 Null이다. `26.09`, `26.10`은 text, `26.11`은 numeric으로 타입도 일관되지 않다.
- 일별 실제 입력은 10월 1~13일의 `H:M` 여섯 열뿐이다. 나머지 날짜 78개에는 상수형 광고 지표가 없다.
- 일별 합계 검산 결과 브랜드검색 노출 12,240, 클릭 5,229, 전환 2,306, 매출 123,893,290이다. Workbook의 10월 합계 행에는 노출과 매출만 합계 수식이 있고 클릭·전환 합계는 없다.
- `CTR(%)` 13개는 `클릭 ÷ 노출 × 100`, `CVR(%)` 13개는 `전환수 ÷ 클릭 × 100`과 반올림 오차 0.005%p 이내로 일치한다. 이는 계산 의미에 대한 강한 근거지만 원본 값 자체는 수식이 아닌 상수다.

## 수식과 계산 품질

`자사몰`의 수식은 440개이고 나머지 시트에는 수식이 없다. 저장된 계산 결과 기준으로 374개가 `#DIV/0!`이다.

| 범위 | 수식 | 개수 | 결과와 문제 |
| --- | --- | ---: | --- |
| 일별 `F` | `E / G` | 91 | 전체 91개 `#DIV/0!`. 매출과 광고비 입력이 없음 |
| 일별 `N` | `M / O` | 91 | 전체 91개 `#DIV/0!`. 13일간 매출은 있으나 브랜드검색 광고비가 없음 |
| 일별 `R` | `Q / S` | 91 | 전체 91개 `#DIV/0!`. 네이버DA 데이터 없음 |
| 일별 `V` | `U / W` | 91 | 전체 91개 `#DIV/0!`. 네이버톡톡 데이터 없음 |
| 11월 일별 `G` | `SUM(O,S,W)` | 30 | 세 광고비가 모두 비어 있어 저장 결과 0. 9~10월에는 같은 수식이 없음 |
| 월 합계 | 일별 열 `SUM` 및 ROAS 나눗셈 | 46 | 0 또는 `#DIV/0!`; 9·10월 `V` 합계 ROAS 수식은 없고 11월 `V101`에만 존재 |

ROAS는 비율형 수식과 `0%` 표시 형식을 사용한다. 반면 CTR/CVR 원본은 `36.67`처럼 percentage-point 값으로 저장되고 표시 형식은 `General`이다. 향후 Import에서 ROAS와 CTR/CVR를 같은 숫자 규칙으로 처리하면 100배 오류가 날 수 있다. 원본 값과 원본 단위를 먼저 보존하고 정규화 규칙을 별도로 승인해야 한다.

## 데이터 완전성

다음 비율은 `자사몰`의 날짜 상세 행 91개만 대상으로 계산했다. 수식 셀은 물리적 non-null이어도 유효 결과가 오류이면 논리적으로 Null로 분류했다.

| 지표 | 유효 입력 | Null/오류 | 비고 |
| --- | ---: | ---: | --- |
| 날짜 | 91/91 | 0 | 고유·연속 |
| 결제수 | 0/91 | 91 | 헤더만 존재 |
| 전체 매출 | 0/91 | 91 | 헤더만 존재 |
| 전체 광고비 | 0/91 | 91 | 11월 30행은 빈 하위 광고비 합계 수식 결과 0이므로 유효 입력으로 세지 않음 |
| 전체 ROAS | 0/91 | 91 | 전부 `#DIV/0!` |
| 브랜드검색 노출·클릭·CTR·CVR·전환·매출 | 각 13/91 | 각 78 | 2026-10-01~10-13만 입력 |
| 브랜드검색 광고비·ROAS | 0/91 | 91 | ROAS 전부 `#DIV/0!` |
| 네이버DA 전환·매출·광고비·ROAS | 0/91 | 91 | ROAS 전부 `#DIV/0!` |
| 네이버톡톡 전환·매출·광고비·ROAS | 0/91 | 91 | ROAS 전부 `#DIV/0!` |

브랜드검색 13일의 값 범위는 노출 659~1,318, 클릭 286~630, CTR 36.67~47.80%p, CVR 22.52~84.88%p, 전환 68~376, 매출 2,364,800~25,052,880이다. 금액 열에 통화 라벨은 없으며 Workbook의 정수형 금액 표시만으로 KRW를 확정하지 않는다.

## Column Dictionary — `자사몰`

모든 행의 Source File은 `★2026년 땡스소윤 광고 데이터.xlsx`이다. Nullable의 분모는 일별 날짜 행 91개이며 합계·예산/목표 행은 제외했다. `MarketingDailyFact`는 신규 후보 Entity다.

| Sheet | Source Column | Example | Business Meaning | Data Type | Nullable | Candidate Entity | Candidate Field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 자사몰 | B `주요이슈` | `26.09` | 실제 값 기준 월 그룹 라벨 | text/numeric 혼합 | 예, 병합 때문에 88/91 물리 Null | RawAdRow | `sourceMonthLabel` | MEDIUM | 헤더와 값 의미가 충돌. 날짜에서 월을 안전하게 도출 가능하므로 Master key로 사용하지 않음 |
| 자사몰 | C `날짜` | `2026-10-01` | 일별 보고 기준일 | Excel date | 아니오, 91/91 | MarketingDailyFact | `reportingDate` | HIGH | 날짜 자체는 확인됨. 주문일/결제일/광고 귀속일 중 무엇인지는 미확인 |
| 자사몰 | D `결제수` | 값 없음 | 자사몰 일별 결제 건수로 추정 | integer 후보 | 예, 0/91 | MarketingDailyFact | `paymentCount` | LOW | 값이 없어 단위·취소 반영 여부 검증 불가 |
| 자사몰 | E `매출` | 값 없음 | 자사몰 일별 전체 매출로 추정 | decimal money 후보 | 예, 0/91 | MarketingDailyFact | `grossSales` | LOW | 통화·세금·취소 반영 여부 미확인 |
| 자사몰 | F `ROAS` | `=E38/G38` → `#DIV/0!` | 전체 매출 ÷ 전체 광고비 | derived decimal ratio | 논리적 Null 91/91 | MarketingDailyFact | `overallRoas` | HIGH | 계산식은 명확하나 유효 값 없음. 0 division 정책 필요 |
| 자사몰 | G `광고비` | `=SUM(O71,S71,W71)` → `0` | 전체 광고비 | decimal money 후보 | 논리적 Null 91/91 | MarketingDailyFact | `totalAdSpend` | MEDIUM | 11월에만 하위 광고비 합계 수식. 9~10월은 공란이라 구조 불일치 |
| 자사몰 | H `브랜드검색 / 노출` | `919` | 브랜드검색 노출 수 | integer | 예, 13/91 입력 | MarketingDailyFact | `impressionCount` | HIGH | 광고 상품/매체 구분값 `BRAND_SEARCH` 후보 |
| 자사몰 | I `브랜드검색 / 클릭` | `337` | 브랜드검색 클릭 수 | integer | 예, 13/91 입력 | MarketingDailyFact | `clickCount` | HIGH | `H`와 함께 CTR 검산 가능 |
| 자사몰 | J `브랜드검색 / CTR(%)` | `36.67` | 클릭 ÷ 노출 × 100 | decimal percentage-point | 예, 13/91 입력 | MarketingDailyFact | `ctrPercent` | HIGH | 상수 값이며 Excel ratio가 아님. Import 시 100배 단위 주의 |
| 자사몰 | K `브랜드검색 / CVR(%)` | `59.94` | 전환 ÷ 클릭 × 100 | decimal percentage-point | 예, 13/91 입력 | MarketingDailyFact | `cvrPercent` | HIGH | 상수 값이며 Excel ratio가 아님 |
| 자사몰 | L `브랜드검색 / 전환수` | `202` | 브랜드검색 귀속 전환 수 | integer | 예, 13/91 입력 | MarketingDailyFact | `conversionCount` | HIGH | 전환이 주문·결제 중 무엇인지는 미확인 |
| 자사몰 | M `브랜드검색 / 매출` | `14,318,900` | 브랜드검색 귀속 매출로 추정 | decimal money | 예, 13/91 입력 | MarketingDailyFact | `attributedSales` | MEDIUM | 광고 귀속 기간·취소·VAT·통화 미확인 |
| 자사몰 | N `브랜드검색 / ROAS` | `=M38/O38` → `#DIV/0!` | 브랜드검색 매출 ÷ 광고비 | derived decimal ratio | 논리적 Null 91/91 | MarketingDailyFact | `roas` | HIGH | 광고비가 전부 비어 유효 값 없음 |
| 자사몰 | O `브랜드검색 / 광고비` | 값 없음 | 브랜드검색 광고비 | decimal money 후보 | 예, 0/91 | MarketingDailyFact | `adSpend` | MEDIUM | 헤더·ROAS 수식으로 의미 확인, 값은 없음 |
| 자사몰 | P `네이버DA / 전환수` | 값 없음 | 네이버 DA 귀속 전환 수 | integer 후보 | 예, 0/91 | MarketingDailyFact | `conversionCount` | MEDIUM | 광고 상품/매체 구분값 `NAVER_DA` 후보 |
| 자사몰 | Q `네이버DA / 매출` | 값 없음 | 네이버 DA 귀속 매출 | decimal money 후보 | 예, 0/91 | MarketingDailyFact | `attributedSales` | MEDIUM | 실제 값 없음 |
| 자사몰 | R `네이버DA / ROAS` | `=Q38/S38` → `#DIV/0!` | 네이버 DA 매출 ÷ 광고비 | derived decimal ratio | 논리적 Null 91/91 | MarketingDailyFact | `roas` | HIGH | 계산식은 명확하나 유효 값 없음 |
| 자사몰 | S `네이버DA / 광고비` | 값 없음 | 네이버 DA 광고비 | decimal money 후보 | 예, 0/91 | MarketingDailyFact | `adSpend` | MEDIUM | 실제 값 없음 |
| 자사몰 | T `네이버톡톡 / 전환수` | 값 없음 | 네이버톡톡 귀속 전환 수 | integer 후보 | 예, 0/91 | MarketingDailyFact | `conversionCount` | MEDIUM | 광고 상품/매체 구분값 `NAVER_TALK` 후보 |
| 자사몰 | U `네이버톡톡 / 매출` | 값 없음 | 네이버톡톡 귀속 매출 | decimal money 후보 | 예, 0/91 | MarketingDailyFact | `attributedSales` | MEDIUM | 실제 값 없음 |
| 자사몰 | V `네이버톡톡 / ROAS` | `=U38/W38` → `#DIV/0!` | 네이버톡톡 매출 ÷ 광고비 | derived decimal ratio | 논리적 Null 91/91 | MarketingDailyFact | `roas` | HIGH | 9·10월 합계 행에는 이 수식이 빠지고 11월 합계에만 존재 |
| 자사몰 | W `네이버톡톡 / 광고비` | 값 없음 | 네이버톡톡 광고비 | decimal money 후보 | 예, 0/91 | MarketingDailyFact | `adSpend` | MEDIUM | 실제 값 없음 |

## Column Dictionary — 빈 채널 템플릿

다음 구조는 `네이버`, `29CM`, `오늘의집`에 동일하게 존재한다. 세 시트 모두 데이터가 0행이므로 Example은 없고 타입·Nullable·업무 의미는 헤더와 수식 없는 빈 템플릿을 근거로 한 후보다. Source File은 동일하다.

| Sheet | Source Column | Example | Business Meaning | Data Type | Nullable | Candidate Entity | Candidate Field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 네이버·29CM·오늘의집 | B `주요이슈` | 없음 | 이슈 또는 월 그룹 메모 후보 | text 후보 | 미검증 | RawAdRow | `sourceIssueOrMonthLabel` | LOW | 자사몰에서는 실제로 월 라벨이므로 헤더만 신뢰할 수 없음 |
| 네이버·29CM·오늘의집 | C `날짜` | 없음 | 일별 보고 기준일 후보 | date 후보 | 미검증 | MarketingDailyFact | `reportingDate` | MEDIUM | 행이 없어 날짜 범위·중복 검증 불가 |
| 네이버·29CM·오늘의집 | D `결제수` | 없음 | 해당 판매 표면의 결제 건수 후보 | integer 후보 | 미검증 | MarketingDailyFact | `paymentCount` | LOW | 값 없음 |
| 네이버·29CM·오늘의집 | E `매출` | 없음 | 해당 판매 표면의 전체 매출 후보 | decimal money 후보 | 미검증 | MarketingDailyFact | `grossSales` | LOW | 값 없음 |
| 네이버·29CM·오늘의집 | F `ROAS` | 없음 | 전체 매출 ÷ 전체 광고비 후보 | derived decimal 후보 | 미검증 | MarketingDailyFact | `overallRoas` | LOW | 수식도 없음 |
| 네이버·29CM·오늘의집 | G `광고비` | 없음 | 전체 광고비 후보 | decimal money 후보 | 미검증 | MarketingDailyFact | `totalAdSpend` | LOW | 값·수식 없음 |
| 네이버·29CM·오늘의집 | H `브랜드검색 / 전환수` | 없음 | 브랜드검색 귀속 전환 수 | integer 후보 | 미검증 | MarketingDailyFact | `conversionCount` | MEDIUM | 자사몰과 달리 노출·클릭·CTR·CVR 열이 없음 |
| 네이버·29CM·오늘의집 | I `브랜드검색 / 매출` | 없음 | 브랜드검색 귀속 매출 | decimal money 후보 | 미검증 | MarketingDailyFact | `attributedSales` | MEDIUM | 값 없음 |
| 네이버·29CM·오늘의집 | J `브랜드검색 / ROAS` | 없음 | 브랜드검색 ROAS | derived decimal 후보 | 미검증 | MarketingDailyFact | `roas` | MEDIUM | 값·수식 없음 |
| 네이버·29CM·오늘의집 | K `브랜드검색 / 광고비` | 없음 | 브랜드검색 광고비 | decimal money 후보 | 미검증 | MarketingDailyFact | `adSpend` | MEDIUM | 값 없음 |
| 네이버·29CM·오늘의집 | L `네이버DA / 전환수` | 없음 | 네이버 DA 귀속 전환 수 | integer 후보 | 미검증 | MarketingDailyFact | `conversionCount` | MEDIUM | 값 없음 |
| 네이버·29CM·오늘의집 | M `네이버DA / 매출` | 없음 | 네이버 DA 귀속 매출 | decimal money 후보 | 미검증 | MarketingDailyFact | `attributedSales` | MEDIUM | 값 없음 |
| 네이버·29CM·오늘의집 | N `네이버DA / ROAS` | 없음 | 네이버 DA ROAS | derived decimal 후보 | 미검증 | MarketingDailyFact | `roas` | MEDIUM | 값·수식 없음 |
| 네이버·29CM·오늘의집 | O `네이버DA / 광고비` | 없음 | 네이버 DA 광고비 | decimal money 후보 | 미검증 | MarketingDailyFact | `adSpend` | MEDIUM | 값 없음 |
| 네이버·29CM·오늘의집 | P `네이버톡톡 / 전환수` | 없음 | 네이버톡톡 귀속 전환 수 | integer 후보 | 미검증 | MarketingDailyFact | `conversionCount` | MEDIUM | 값 없음 |
| 네이버·29CM·오늘의집 | Q `네이버톡톡 / 매출` | 없음 | 네이버톡톡 귀속 매출 | decimal money 후보 | 미검증 | MarketingDailyFact | `attributedSales` | MEDIUM | 값 없음 |
| 네이버·29CM·오늘의집 | R `네이버톡톡 / ROAS` | 없음 | 네이버톡톡 ROAS | derived decimal 후보 | 미검증 | MarketingDailyFact | `roas` | MEDIUM | 값·수식 없음 |
| 네이버·29CM·오늘의집 | S `네이버톡톡 / 광고비` | 없음 | 네이버톡톡 광고비 | decimal money 후보 | 미검증 | MarketingDailyFact | `adSpend` | MEDIUM | 값 없음 |

## Key와 중복 분석

| 검토 항목 | 판정 | 근거 |
| --- | --- | --- |
| `자사몰` 상세행 Primary Key 후보 | `sheet/source surface + reporting_date` | 91개 날짜가 모두 non-null·고유·연속. 한 시트 안에서는 날짜 단독도 고유하나 다른 채널 시트가 채워지면 중복될 수 있음 |
| 날짜 단독을 Workbook 전체 PK로 사용 | 부적합 | 네이버·29CM·오늘의집도 동일 날짜 축을 가질 템플릿이므로 향후 중복 예상 |
| 월 합계·예산/목표 행 | Fact PK 대상 아님 | 날짜 열에 `합계`, `예산/목표` 문자열이 들어가 상세행과 grain이 다름. 합계는 상세에서 재계산하고 목표는 별도 record type 검토 필요 |
| 사방넷 품번 | 없음 | `100051` 같은 Product business key가 존재하지 않음 |
| SKU code | 없음 | `AL00`, `AQ01` 같은 SKU key가 존재하지 않음 |
| 상품명·옵션명·바코드 | 없음 | Product/SKU/Listing/Offer 연결 근거 없음 |
| 광고 캠페인·광고그룹·소재 ID | 없음 | `브랜드검색`, `네이버DA`, `네이버톡톡`은 고정 열 그룹명일 뿐 row-level ID가 아님 |
| 시트명 | Channel 후보, 미검증 | `자사몰`, `네이버`, `29CM`, `오늘의집`이 판매 표면처럼 보이지만 기존 `channels.channel_code`와의 명시적 mapping 없음 |
| 중복 날짜 | 0 | `자사몰` 91개 상세 날짜 중 중복 0 |
| 반복 헤더 | 시트 내부 0 | 헤더는 4~5행에 한 번만 존재. 같은 템플릿이 채널형 시트 사이에서 반복됨 |

원본 추적용 key는 최소 `file_hash + sheet_name + original_row_number`를 보존해야 한다. 정규화된 상세 Fact 후보 key는 업무 정의 확인 후 `workspace_id + sales_surface/source_sheet + reporting_date + advertising_product/media` 조합을 검토할 수 있다. 파일에 캠페인 ID가 없으므로 캠페인 단위 유일성을 만들어내면 안 된다.

## 광고 granularity와 기존 SellerAudit 관계

| 관계 | 판정 | 근거와 한계 |
| --- | --- | --- |
| Advertising ↔ Product | **NOT POSSIBLE** | Product code·상품명·옵션명이 전혀 없어 `products` 또는 `channel_offers`에 연결할 증거가 없음 |
| Advertising ↔ SKU/BOM | **NOT POSSIBLE** | SKU code·바코드·구성 정보가 없음 |
| Advertising ↔ SellerAudit Channel | **LIKELY** | 시트명이 판매 채널/표면처럼 보임. 다만 광고 그룹명도 네이버 계열이고, 시트명과 `channels.channel_code` mapping이 명시되지 않음 |
| Advertising ↔ Date | **VERIFIED** | `자사몰`에 91개 연속 일자 존재. 날짜의 업무 기준은 별도 미확인 |
| Advertising ↔ Sales | **UNVERIFIED** | 동일 행의 `결제수`, 전체 `매출`, 전체 `광고비`, 전체 `ROAS` 배치는 비교 의도를 시사하지만 값이 비어 있고 매출 파일과 날짜·채널 기준도 확인되지 않았다. 채널/날짜 집계 비교는 향후 후보일 뿐이다. |
| Media metric calculation | **VERIFIED** | 브랜드검색 13일의 CTR·CVR은 원천 count와 일치한다. ROAS 수식 자체는 확인했으나 광고비 부재로 유효한 ROAS 결과는 없다. |

기존 DB의 Product·SKU·BOM·Listing·Offer는 이 원본을 자연스럽게 수용하지 못한다. 특히 `네이버DA`나 `브랜드검색`을 판매 `Channel` 또는 `ChannelListing`으로 저장하면 판매 표면과 광고 매체를 혼합하게 된다. Prompt 2에서 실제 원본 근거를 가진 별도 일별 Marketing/Advertising Fact와 media dimension 후보를 검토해야 한다.

## 매출 데이터와 연결 조건

이 파일만으로 확인되는 연결 후보는 날짜와 시트명뿐이다. 별도 매출 파일과 연결하려면 다음 조건을 먼저 확인해야 한다.

1. 광고 파일 `C 날짜`가 광고 플랫폼 집계일인지, 주문일·결제일 중 무엇인지 확인한다.
2. 매출 파일의 채널과 광고 시트명(`자사몰`, `네이버`, `29CM`, `오늘의집`) 사이에 명시적 mapping을 둔다.
3. `E 매출`과 광고 블록의 `매출`이 각각 전체 거래 매출과 광고 귀속 매출인지 확인한다.
4. 취소·반품, VAT, 쿠폰, 배송비, attribution window, 지연 전환 반영 규칙을 맞춘다.
5. 날짜 기준이 다르면 `sourceDate`, `reportingDate`, `dateBasis`를 분리하고 같은 날짜 문자열만으로 join하지 않는다.

Product 단위 광고 배분 근거가 없으므로 매출 파일에 Product가 있더라도 광고비를 Product별로 임의 배분해서는 안 된다. 초기 연결 가능성은 Channel/Date 수준 비교까지이며, 그마저도 날짜·채널 의미 확인 전에는 **UNVERIFIED** 상태로 유지한다.

## 발견한 데이터 문제

1. 광고비가 전부 비어 있어 모든 일별 ROAS 364개가 `#DIV/0!`이다.
2. `자사몰`의 실제 광고 값은 13일·브랜드검색 한 블록뿐이다. 네이버DA·네이버톡톡과 나머지 세 채널 시트는 데이터가 없다.
3. `주요이슈` 열에 이슈가 아니라 월 구분자가 들어가고 월 값 타입도 text/numeric으로 혼재한다.
4. CTR/CVR은 percentage-point 상수, ROAS는 ratio 수식이므로 숫자 단위가 다르다.
5. 11월만 전체 광고비 `G`를 하위 광고비 합계로 계산하고 9~10월은 공란이다.
6. 네이버톡톡 월 ROAS 수식은 9·10월 합계에 빠지고 11월 합계에만 있다.
7. 29CM·오늘의집 시트는 내용이 5행에서 끝나지만 서식 때문에 각각 972·973행까지 사용 범위로 보고된다. 물리적 `max_row`를 데이터 행 수로 사용하면 안 된다.
8. 통화, 전환 정의, 귀속 매출 정의, 날짜 기준에 대한 metadata가 없다.

## 확인이 필요한 업무 정의

- `날짜`는 광고 보고일, 주문일, 결제일 중 무엇인가.
- `결제수`와 광고별 `전환수`의 분모·중복·취소 반영 규칙은 무엇인가.
- 광고 블록의 `매출`은 클릭 후/노출 후 어느 attribution window를 사용하는가.
- 금액 단위는 KRW이며 VAT 포함인가.
- `자사몰`, `네이버`, `29CM`, `오늘의집`을 기존 SellerAudit Channel에 어떤 code로 연결할 것인가.
- 브랜드검색·네이버DA·네이버톡톡은 media, campaign type, advertising product 중 어떤 업무 차원인가.
- 광고비가 별도 원장이나 `외부채널 마케팅 비용` 시트에서 관리되는지, 현재 비어 있는 이유는 무엇인가.
- 9·10월 전체 광고비 수식 부재와 11월 수식 존재가 의도된 버전 차이인지 확인해야 한다.

## Prompt 1 Stop Line

이 분석은 Workbook 구조, Column Dictionary, key·Null·중복, grain과 연결 가능성만 기록한다. 광고 Fact schema, migration, parser, Import, 대시보드, 매출 결합, Product별 배분은 구현하지 않는다.
