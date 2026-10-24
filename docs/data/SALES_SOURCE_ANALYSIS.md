# 매출 원본 분석

## 범위와 판정 기준

- 원본: `★2026년 땡스소윤 매출 데이터.xlsx`
- 원본 위치: 사용자 로컬 `카카오톡 받은 파일` 폴더. 저장소에는 복사하지 않았다.
- 파일 크기: 11,786,095 bytes
- SHA-256: `3eb2ae69f0cfd289e3110a88145cc63e870c6791ea45f7b36994d2ed0da5d84e`
- 분석일: 2026-10-24
- 분석 방법: 수식과 캐시 값을 각각 읽고, `로우데이터`는 행 단위 스트리밍 집계로 분석했다. 원본은 수정하거나 재저장하지 않았다.

이 문서에서 **Evidence**는 셀 값, 수식, 주석 또는 실제 중복·Null 집계로 확인한 사실이다. **Inference**는 그 사실에서 도출한 후보 해석이며 구현 계약이 아니다. 기존 SellerAudit의 `Product ≠ SKU`, `Product ↔ SKU = ProductComponent(BOM)` 규칙을 유지한다.

## 핵심 결론

1. 사실상 원천 테이블은 `로우데이터!A:L`의 125,242행이다. 기간은 2026-01-01부터 2026-10-18까지이며 채널 표기는 22종이다.
2. 한 행에 주문번호, 주문상세번호, 채널 상품 ID 또는 사방넷 품번이 없다. 따라서 한 행이 개별 주문 라인인지, 일부 소스가 이미 집계된 판매 행인지 확정할 수 없다. 이 파일 안에서 자연키 또는 업무 PK는 만들 수 없다.
3. `주문일자`라는 헤더와 달리 날짜 의미는 채널별로 다르다. 스마트스토어 도착보장은 결제일, 쿠팡 로켓배송은 입고예정일, 나머지 일반 채널은 사방넷 주문일이라는 주석이 있다. 단일 `sales_date`로 합치면 의미를 잃는다.
4. 사방넷 품번 `100051`은 매출 파일 어디에도 없다. 매출 행을 Product에 직접 연결할 키는 없다. 이름 정규화 표와 `AL00` 같은 SKU형 텍스트는 후보 증거일 뿐이다.
5. `결제금액` 7건은 음수인데 문자열로 저장되어 `SUMIFS` 합계에서 제외된다. 합계는 숫자 셀만 4,379,426,441원이며, 문자열 음수 -48,190원을 숫자로 정규화하면 4,379,378,251원이다.
6. 연간·월간 대시보드는 원천이 아니라 계산 보고서다. 1월 월간 합계는 `컬리(FBK)` 85,800원을 포함하지만 연간 B2C 합계는 제외한다. 4~8월 월간 `총매출`은 땡스공구를 포함하고 9~10월은 명시적으로 제외한다. `총매출`의 범위가 월별로 동일하지 않다.

## Workbook 구조

`Excel 최대 범위`는 서식이나 잔존 셀까지 포함한다. `논리 범위`는 값 또는 수식이 실제로 있는 범위다. 반복 헤더는 각 시트 내부에서 다시 나타나는 동일 헤더를 뜻한다.

| 시트 | 상태 | 헤더 / 데이터 영역 | 논리 행·열 | 병합 | 수식 | 숨김·반복 헤더·특이사항 |
| --- | --- | --- | ---: | ---: | ---: | --- |
| `2026년` | 표시 | KPI 헤더 3~4행, 채널별 헤더 17~18행, 데이터 5~16행·19~45행 | 실제 2~45행, `B:Q` (Excel 최대 1,016×26) | 13 | 409 | 20, 21, 23, 24, 26, 27, 45행 숨김. 같은 시트 내 반복 헤더 없음. 연간 목표·실적·채널 월합계 보고서다. |
| `26년10월 매출` | 표시 | 상세 헤더 8행, 일별 계산 16~46행 | 31일×`A:X` | 0 | 780 | 실제 원천이 아닌 수식 보고서. 55~57행은 숨김 서식 행. |
| `26년9월 매출` | 표시 | 상세 헤더 8행, 일별 계산 16~45행 | 30일×`A:X` | 0 | 709 | 수식 보고서. 55~57행 숨김. |
| `26년8월 매출` | 표시 | 상세 헤더 8행, 일별 계산 16~46행 | 31일×`A:W` | 0 | 727 | 수식 보고서. 56~58행 숨김. |
| `26년7월 매출` | 표시 | 상세 헤더 8행, 일별 계산 16~46행 | 31일×`A:W` | 0 | 727 | 수식 보고서. 56~58행 숨김. |
| `26년6월 매출` | 표시 | 상세 헤더 8행, 일별 계산 16~45행 | 30일×`A:W` | 0 | 706 | 수식 보고서. 55~57행 숨김. |
| `26년5월 매출` | 표시 | 상세 헤더 8행, 일별 계산 16~46행 | 31일×`B:X` | 0 | 727 | 수식 보고서. 56~58행 숨김. |
| `26년4월 매출` | 표시 | 상세 헤더 8행, 일별 계산 16~45행 | 30일×`B:X` | 0 | 707 | 수식 보고서. 55~57행 숨김. |
| `26년3월 매출` | 표시 | 상세 헤더 8행, 일별 계산 16~46행 | 31일×`B:X` | 0 | 727 | 수식 보고서. 56~58행 숨김. |
| `26년2월 매출` | 표시 | 상세 헤더 8행, 일별 계산 16~43행 | 28일×`A:W` | 0 | 692 | 수식 보고서. 57~59행 숨김. |
| `26년1월 매출` | 표시 | 상세 헤더 9행, 일별 계산 17~47행 | 본표 31일×`B:X`; 잔존 블록 `AI:AN` | 0 | 771 | `AI67:AK69`에 `#REF!` 셀 6개가 있는 이전 기간 잔존 블록. XML에는 `#REF!` 문자열이 17회 나타난다. 본표의 매출 계산과 분리해야 한다. |
| `로우데이터` | 표시 | 헤더 1행, 데이터 2~125,243행 | 125,242행×12열 `A:L` | 0 | 624,140 | 필터가 저장되어 데이터 35행만 표시되고 125,207행은 숨김 상태다. 필터 조건은 2026-10-18·자사몰·특정 레드진저 상품이다. 반복 헤더 없음. `AH46339:AH46341`에 비교용 문구 3개가 고립되어 있다. |
| `상품명+옵션명(매칭)` | 표시 | 헤더 1행, 데이터 2~2,574행 | 2,573행×5열 | 0 | 94 | 반복 헤더 없음. 판매 행의 D열을 정규화하는 lookup 표다. |
| `상품명 정리` | **숨김** | 헤더 1행, 데이터 2~110행 | 109행×2열 | 0 | 0 | 정규화 상품명 보조 목록. 반복 헤더 없음. |

월별 시트는 같은 형식의 보고서 템플릿을 반복하지만 시트 안에 헤더 행이 반복 삽입된 구조는 아니다. `로우데이터`의 숨김 행은 삭제된 행이 아니라 저장 당시 적용된 AutoFilter 결과다.

## 보고서 시트 Column Dictionary

보고서 시트는 import source가 아니라 원천 검증과 reconciliation 용도다. 아래 좌표는 수식 템플릿의 실제 위치를 추적하기 위한 것이다. 실제 적재 시에는 열 방향 채널을 행으로 unpivot하더라도 원천 Fact로 재적재하지 않는다.

### `2026년` 연간 보고서

| Source File | Sheet | Source Column / Coordinate | Example | Business Meaning | Data Type | Nullable | Candidate Entity | Candidate Field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 매출 데이터 | `2026년` | B (`B5:B16`, `B19:B45`) | `B2C`, `공동구매`, `광고` | KPI/채널 행의 상위 구분 | text | yes; 병합 셀 아래 행은 blank | Reporting view | `businessSegment` | HIGH | 원천 Fact dimension이 아니라 보고서 행 그룹이다. |
| 매출 데이터 | `2026년` | C (`C5:C16`, `C19:C45`) | `2026 실적`, `자사몰`, `B2C 합계` | KPI명 또는 채널 label | text | 일부 | Reporting view / Channel lookup | `metricName` or `channelName` | HIGH | KPI 블록과 채널 블록에서 의미가 달라 행 범위와 함께 읽어야 한다. |
| 매출 데이터 | `2026년` | D (`D5:D16`, `D19:D45`) | `=SUM(E6:P6)` | 1~12월 합계 | formula / KRW | 일부 | Reporting view | `annualAmount` | HIGH | 채널 상세에서는 월합계, KPI에서는 연간 목표·실적·전년 합계다. |
| 매출 데이터 | `2026년` | E:P; `E=1월` … `P=12월` (`E4:P16`, `E18:P45`) | `E6=E44`, `N19=SUMIFS(...)` | 월별 목표·실적·전년 매출 및 채널 월매출 | formula or hardcoded KRW | 미래월·미사용 셀 blank/0 | Reporting view | `monthlyAmount[month]` | HIGH | KPI header는 `E4:P4`, 채널 header는 `E18:P18`. B2C는 raw 집계, 공동구매는 수기값을 포함한다. |
| 매출 데이터 | `2026년` | Q (`Q18:Q45`) | `Q19=D19/$D$44` | B2C 내 채널 매출 비중 | formula ratio / `-` | 일부 | Reporting view | `salesShare` | HIGH | 공동구매 합계 `Q45`는 `-`; 저장 Fact가 아닌 파생값이다. |

### 월별 보고서 공통 필드

| Source File | Sheet / Period | Source Column / Coordinate | Example | Business Meaning | Data Type | Nullable | Candidate Entity | Candidate Field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 매출 데이터 | 1월, 3~5월 | B2; B3:B5 | `1월`; `총매출`, `일평균매출`, `예상 마감` | 보고 월과 KPI metric label | text | no | Reporting view | `reportingMonth`, `metricName` | HIGH | 1월과 3~5월은 한 열 오른쪽으로 배치된다. |
| 매출 데이터 | 1월, 3~5월 | C2; C3:C5 | `목표액`; `539,000,000` | KPI별 목표액·목표 일평균·월 목표 | header text + formula/hardcoded KRW | 0 또는 일부 blank | Reporting view | `targetAmount` | HIGH | `C4`는 월 목표를 월 일수로 나눈 목표 일평균. `C5`는 월 목표를 재사용한다. |
| 매출 데이터 | 1월, 3~5월 | D2; D3:D5 | `실적`; `D3=SUM(D12:X12)` | 당월 누적 실적·현재 일평균·예상 마감액 | header text + formula / KRW | 0 허용 | Reporting view | `actualAmount`, `actualDailyAverage`, `forecastAmount` | HIGH | 1월 총매출은 `D3=SUM(D12:X12)`. 총매출 포함 범위는 월별로 동일하지 않다. |
| 매출 데이터 | 1월, 3~5월 | E2; E3:E5 | `달성률`; `D3/C3` | 실적/목표 비율 | header text + formula ratio | 분모 0이면 blank/0 | Reporting view | `attainmentRate` | HIGH | 총매출·일평균·마감 예상 각각의 목표 대비 비율이다. |
| 매출 데이터 | 2월, 6~10월 | A2; A3:A5 | `10월`; `총매출`, `일평균매출`, `예상 마감` | 보고 월과 KPI metric label | text | no | Reporting view | `reportingMonth`, `metricName` | HIGH | 1월·3~5월 템플릿보다 한 열 왼쪽이다. |
| 매출 데이터 | 2월, 6~10월 | B2; B3:B5 | `목표액`; `547,000,000` | KPI별 목표액·목표 일평균·월 목표 | header text + formula/hardcoded KRW | 0 또는 일부 blank | Reporting view | `targetAmount` | HIGH | `B4`는 월 목표를 월 일수로 나눈 목표 일평균. `B5`는 월 목표를 재사용한다. |
| 매출 데이터 | 2월, 6~10월 | C2; C3:C5 | `실적`; `C3=SUM(C11:V11)` | 당월 누적 실적·현재 일평균·예상 마감액 | header text + formula / KRW | 0 허용 | Reporting view | `actualAmount`, `actualDailyAverage`, `forecastAmount` | HIGH | 예시는 10월. 총매출 포함 범위는 월별로 동일하지 않다. |
| 매출 데이터 | 2월, 6~10월 | D2; D3:D5 | `달성률`; `C3/B3` | 실적/목표 비율 | header text + formula ratio | 분모 0이면 blank/0 | Reporting view | `attainmentRate` | HIGH | 총매출·일평균·마감 예상 각각의 목표 대비 비율이다. |
| 매출 데이터 | 1월 | B17:B47 | `2026-01-01` | 보고 일자 bucket | Excel date | no | Reporting view | `reportingDate` | HIGH | 채널별 source date 의미는 서로 다르다. |
| 매출 데이터 | 2월, 6~10월 | A16:A43 / A16:A45 / A16:A46 | `2026-10-01` | 보고 일자 bucket | Excel date | no | Reporting view | `reportingDate` | HIGH | 말일에 따라 28·30·31개 행. 2월 `A16:A43`, 6·9월 `A16:A45`, 7·8·10월 `A16:A46`. |
| 매출 데이터 | 3~5월 | B16:B46 / B16:B45 | `2026-03-01` | 보고 일자 bucket | Excel date | no | Reporting view | `reportingDate` | HIGH | 3·5월 `B16:B46`, 4월 `B16:B45`. |
| 매출 데이터 | 1월 | C17:C47 | `=SUM(D17:W17)` | 일반 채널 일매출 합계 | formula / KRW | 0 허용 | Reporting view | `dailyTotalAmount` | HIGH | X `땡스공구`는 합계 수식에서 제외된다. |
| 매출 데이터 | 2월, 6~10월 | B16:B43 / B16:B45 / B16:B46 | `=SUM(C16:V16)` | 일반 채널 일매출 합계 | formula / KRW | 0 허용 | Reporting view | `dailyTotalAmount` | HIGH | W `땡스공구`와 9~10월 X `그 외 공구`는 합계 수식에서 제외된다. |
| 매출 데이터 | 3~5월 | C16:C46 / C16:C45 | `=SUM(D16:W16)` | 일반 채널 일매출 합계 | formula / KRW | 0 허용 | Reporting view | `dailyTotalAmount` | HIGH | X `땡스공구`는 합계 수식에서 제외된다. |
| 매출 데이터 | 1~10월 | 채널 일매출 열; 아래 좌표표 참조 | `2,690,830` | 날짜·채널별 결제금액 합계 | formula / KRW; 공구 일부 hardcoded | 0 허용 | Reporting view | `dailyChannelAmount` | HIGH | 일반 채널은 `SUMIFS(로우데이터!G:G, ...)`; 텍스트 음수는 제외된다. 컬리 열은 복수 raw label을 합산할 수 있다. |
| 매출 데이터 | 1월 | B16:X16 | `01/12~01/18 새해맞이 프로모션` | 채널별 수기 프로모션 메모 | multiline text | yes | Promotion candidate | `sourceNote` | MEDIUM | label은 `B16`, 메모는 해당 채널 열에 위치한다. 구조화된 행사 ID가 아니다. |
| 매출 데이터 | 2~10월 | A15:W15 또는 A15:X15 | `10/13 라이브방송` | 채널별 수기 프로모션 메모 | multiline text | yes | Promotion candidate | `sourceNote` | MEDIUM | 9~10월은 X까지, 나머지는 W/X 템플릿 범위에 메모가 있을 수 있다. 날짜 문자열 형식이 일정하지 않다. |
| 매출 데이터 | 1월 | B10:B12 labels; C10:X12 values | `2024년 매출`, `2025년 매출`, `2026년 매출` | 연도별 월 합계와 채널 매출 비교 | label + formula/hardcoded KRW | 2024·빈 채널 일부 blank | Reporting view | `comparisonYear`, `monthlyAmountByChannel` | HIGH | C는 전체 합계, D:X는 상세표와 같은 채널 순서다. 2026 값은 일별 표 합계다. |
| 매출 데이터 | 2·6~10월 | A9:A11 labels; B9:X11 values | `2025년 매출`, `2026년 매출` | 연도별 월 합계와 채널 매출 비교 | label + formula/hardcoded KRW | 과거·미사용 채널 일부 blank | Reporting view | `comparisonYear`, `monthlyAmountByChannel` | HIGH | B는 전체 합계, C:X는 채널/수기 공구 열이다. |
| 매출 데이터 | 3~5월 | B9:B11 labels; C9:X11 values | `2025년 매출`, `2026년 매출` | 연도별 월 합계와 채널 매출 비교 | label + formula/hardcoded KRW | 과거·미사용 채널 일부 blank | Reporting view | `comparisonYear`, `monthlyAmountByChannel` | HIGH | C는 전체 합계, D:X는 채널/수기 공구 열이다. |
| 매출 데이터 | 1월 | B13 label; C13:X13 values | `평균 매출` | 현재까지의 일평균 매출 | label + array formula / KRW | 0 또는 blank 가능 | Reporting view | `dailyAverageAmount` | HIGH | 합계 및 채널별 파생값이다. |
| 매출 데이터 | 2·6~10월 / 3~5월 | A12; B12:X12 / B12; C12:X12 | `평균 매출` | 현재까지의 일평균 매출 | label + array formula / KRW | 0 또는 blank 가능 | Reporting view | `dailyAverageAmount` | HIGH | 좌측/우측 배치에 따라 합계와 채널 열이 한 칸 이동한다. |
| 매출 데이터 | 1월 | B14 label; C14:X14 values | `예상 마감 매출` | 일평균×월 일수의 마감 예상액 | label + formula / KRW | 0 또는 blank 가능 | Reporting view | `forecastAmount` | HIGH | 실제 확정 매출이 아니라 계산 전망이다. |
| 매출 데이터 | 2·6~10월 / 3~5월 | A13; B13:X13 / B13; C13:X13 | `예상 마감 매출` | 일평균×월 일수의 마감 예상액 | label + formula / KRW | 0 또는 blank 가능 | Reporting view | `forecastAmount` | HIGH | 실제 확정 매출이 아니라 계산 전망이다. |
| 매출 데이터 | 1월 | B15 label; C15:X15 values | `YoY` | 2026/2025 증감률 | label + formula ratio | 기준값 0·blank이면 blank/error 처리 | Reporting view | `yearOverYearRate` | HIGH | 저장 Fact가 아닌 파생값이다. |
| 매출 데이터 | 2·6~10월 / 3~5월 | A14; B14:X14 / B14; C14:X14 | `YoY` | 2026/2025 증감률 | label + formula ratio | 기준값 0·blank이면 blank/error 처리 | Reporting view | `yearOverYearRate` | HIGH | 좌측/우측 템플릿에서 좌표만 다르고 의미는 같다. |

### 월별 채널 열 좌표

동일한 채널 순서를 생략 없이 적었다. 범위 안에서 `열=채널` 순서로 읽는다.

| Period / Sheet | Header | Daily Rows | Channel Column Mapping | Confidence / Notes |
| --- | --- | --- | --- | --- |
| 1월 `26년1월 매출` | `B9:X9` | `D17:X47` | D=자사몰; E=스마트스토어; F=스마트스토어(도착보장); G=쿠팡; H=쿠팡(로켓배송); I=컬리; J=카카오톡스토어; K=카카오톡선물하기; L=오늘의집; M=11번가; N=ESM옥션; O=ESM지마켓; P=토스쇼핑; Q=퀸잇; R=Wconcept; S=T deal; T=SSF SHOP; U=우리의식탁; V=베네피아; W=비즈마켓; X=땡스공구 | HIGH. I `컬리` 수식은 컬리 계열 label을 합산하며 상단에 `컬리(FBK)` 표기가 있다. |
| 2월 `26년2월 매출` | `A8:W8` | `C16:W43` | C=자사몰; D=스마트스토어; E=스마트스토어(도착보장); F=쿠팡; G=쿠팡(로켓배송); H=컬리; I=카카오톡스토어; J=카카오톡선물하기; K=오늘의집; L=11번가; M=ESM옥션; N=ESM지마켓; O=토스쇼핑; P=퀸잇; Q=Wconcept; R=T deal; S=SSF SHOP; T=우리의식탁; U=베네피아; V=비즈마켓; W=땡스공구 | HIGH. |
| 3~5월 `26년3월 매출`~`26년5월 매출` | `B8:X8` | 3·5월 `D16:X46`; 4월 `D16:X45` | D=자사몰; E=스마트스토어; F=스마트스토어(도착보장); G=쿠팡; H=쿠팡(로켓배송); I=컬리; J=카카오톡스토어; K=카카오톡선물하기; L=오늘의집; M=11번가; N=ESM옥션; O=ESM지마켓; P=토스쇼핑; Q=퀸잇; R=Wconcept; S=T deal; T=SSF SHOP; U=우리의식탁; V=베네피아; W=비즈마켓; X=땡스공구 | HIGH. 3~5월은 2월 템플릿보다 한 열 오른쪽이다. |
| 6~8월 `26년6월 매출`~`26년8월 매출` | `A8:W8` | 6월 `C16:W45`; 7·8월 `C16:W46` | C=자사몰; D=스마트스토어; E=스마트스토어(도착보장); F=쿠팡; G=쿠팡(로켓배송); H=컬리; I=카카오톡스토어; J=카카오톡선물하기; K=오늘의집; L=11번가; M=ESM옥션; N=ESM지마켓; O=토스쇼핑; P=퀸잇; Q=Wconcept; R=T deal; S=SSF SHOP; T=우리의식탁; U=베네피아; V=비즈마켓; W=땡스공구 | HIGH. 2월과 같은 열 배치다. |
| 9~10월 `26년9월 매출`, `26년10월 매출` | `A8:X8` | 9월 `C16:X45`; 10월 `C16:X46` | C=자사몰; D=스마트스토어; E=스마트스토어(도착보장); F=쿠팡; G=쿠팡(로켓배송); H=컬리; I=카카오톡스토어; J=카카오톡선물하기; K=오늘의집; L=11번가; M=ESM옥션; N=ESM지마켓; O=토스쇼핑; P=퀸잇; Q=Wconcept; R=T deal; S=SSF SHOP; T=우리의식탁; U=베네피아; V=비즈마켓; W=땡스공구; X=그 외 공구 | HIGH. W/X는 수기 공구액이며 B 일합계에서 제외된다. |

## `로우데이터` Column Dictionary

Null 수는 125,242개 데이터 행 기준이다. Candidate Entity/Field는 다음 단계의 모델 후보이며 현재 DB에 존재한다고 가정하지 않는다.

| Source File | Sheet | Source Column | Example | Business Meaning | Data Type | Nullable | Candidate Entity | Candidate Field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 매출 데이터 | `로우데이터` | A `주문일자` | `2026-01-01` | 채널별 집계에 사용한 source date | Excel date 119,365행 / ISO text 5,877행 | no | SalesFact candidate | `sourceDate`, `reportingDate`, `dateBasis` | HIGH | 헤더는 주문일자지만 실제 basis는 결제일·입고예정일·주문일이 섞인다. 291 calendar dates. 문자열은 9/15~9/30에 집중된다. |
| 매출 데이터 | `로우데이터` | B `쇼핑몰명` | `스마트스토어` | 판매 채널 또는 채널 운영 유형 | text | no | Channel / SalesFact | `channelId` lookup from `channelName` | HIGH | 22종. `스마트스토어`와 `스마트스토어(도착보장)`, `쿠팡`과 `쿠팡(로켓배송)`처럼 날짜 의미가 다른 subtype을 보존해야 한다. |
| 매출 데이터 | `로우데이터` | C `상품명+옵션` | `땡스소윤 냉동용기 점보(3200ml) 쿨라벤더` | 채널에서 가져온 원문 상품·옵션 표현 | text | yes, 1,174 | SalesFact candidate | `sourceProductOptionName` | HIGH | 상품명과 옵션명이 분리되지 않는다. 채널 listing/offer ID는 없다. |
| 매출 데이터 | `로우데이터` | D `상품명_색상` | `점보 쿨라벤더` | 사람이 정리한 lookup key | text | yes, 2 | SalesFact staging / Alias candidate | `sourceNormalizedKey` | HIGH | H:K를 찾는 VLOOKUP key. Product ID가 아니다. 공백 trim 후 1,494개 고유값. |
| 매출 데이터 | `로우데이터` | E `옵션별칭` | `AL05 3개, AL07 3개` | SKU형 코드와 구성 수량을 담은 수기 문자열 | text | yes, 3,788 | SalesFact raw / SKU·BOM candidate evidence | `sourceOptionAlias` | MEDIUM | 109,593행에서 코드 패턴을 1개 이상 찾지만 56,695행은 복수 코드다. 파서·Master 검증 없이 FK나 BOM으로 확정하지 않는다. |
| 매출 데이터 | `로우데이터` | F `수량` | `1` | 원천 판매/집계 수량 | integer | no | SalesFact candidate | `quantity` | HIGH | 합계 181,522. 음수 없음, 0이 79행이며 모두 쿠팡 로켓배송이다. 0수량·양수금액 행 때문에 모든 채널에서 단가 계산에 사용할 수 없다. |
| 매출 데이터 | `로우데이터` | G `결제금액` | `12600`, 문자열 `-6290` | 행의 결제/매출 금액 | integer 125,235행 / numeric-looking text 7행 | no | SalesFact candidate | `grossSales` | HIGH | KRW로 보이나 통화·VAT·환불 규칙은 별도 명시가 없다. 문자열 음수 7건은 수식 합계에서 빠진다. 0원 12행. |
| 매출 데이터 | `로우데이터` | H `상품명+옵션명(매칭)` | `점보 쿨라벤더` | lookup으로 얻은 표준 상품+색상명 | formula text | no | SalesFact staging / Alias candidate | `normalizedProductOptionName` | MEDIUM | D→매칭표 A:B. 9,606행은 `매칭필요`. Product FK가 아니다. |
| 매출 데이터 | `로우데이터` | I `상품명(매칭)` | `점보 단품` | lookup으로 얻은 표준 상품명 | formula text | no | SalesFact staging / Product candidate label | `normalizedProductName` | MEDIUM | D→매칭표 A:C. 사방넷 품번으로 연결되지 않는다. |
| 매출 데이터 | `로우데이터` | J `색상(매칭)` | `쿨라벤더` | 표준 색상명 | formula text, 정수 `0` 113행 | no | SalesFact staging / Variant attribute candidate | `normalizedColor` | MEDIUM | `0`은 실제 색상보다 누락 표식일 가능성이 높다. 타입 정규화가 필요하다. |
| 매출 데이터 | `로우데이터` | K `구성구분` | `단품`, `단품세트`, `세트구성`, `구성품` | 정규화된 판매 구성 분류 | formula text | no | SalesFact staging | `compositionType` | HIGH | `매칭필요` 9,606행, `-` 2행 포함. Product.productType과 같은 enum이라고 단정하지 않는다. |
| 매출 데이터 | `로우데이터` | L `월` | `1월` | A에서 계산한 월 label | formula text 122,923행 / hardcoded text 2,319행 | no | Derived field | `reportingMonth` | HIGH | 중복 파생값이므로 Fact 저장보다 날짜에서 계산하는 편이 안전하다. |
| 매출 데이터 | `로우데이터` | AH 고립 셀 | `25년 4월 매출` | 비교 작업 잔존 문구 | text | 사실상 yes | Import provenance | ignored note | HIGH | `AH46339:AH46341` 3개뿐이며 행 레코드의 일부가 아니다. |

## 매칭·정리 시트 Column Dictionary

| Source File | Sheet | Source Column | Example | Business Meaning | Data Type | Nullable | Candidate Entity | Candidate Field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 매출 데이터 | `상품명+옵션명(매칭)` | A `상품명+옵션명` | `점보 쿨라벤더` | `로우데이터!D`의 lookup key | text | no | Alias candidate | `rawProductName` or `sourceNormalizedKey` | HIGH | 2,573행, trim 전 2,544개 고유. 중복 key 29개, 그중 결과 충돌 3개. source channel이 없어 현재 Alias unique contract에 그대로 넣을 수 없다. |
| 매출 데이터 | `상품명+옵션명(매칭)` | B `쇼핑몰명` | `점보 쿨라벤더` | 표준 상품+옵션명 | text / formula 94행 | yes, 7 | Alias candidate | `normalizedProductOptionName` | HIGH | 헤더와 실제 값이 불일치한다. 쇼핑몰명이 아니다. |
| 매출 데이터 | `상품명+옵션명(매칭)` | C `상품명(매칭)` | `점보 단품` | 표준 상품명 label | text | yes, 3 | Product candidate label | `productName` candidate | MEDIUM | Sabangnet code가 없어 Product identity가 아니다. |
| 매출 데이터 | `상품명+옵션명(매칭)` | D `색상(매칭)` | `쿨라벤더` | 표준 색상 | text | yes, 4 | Variant attribute candidate | `color` | MEDIUM | 현재 Product에는 color field가 없다. |
| 매출 데이터 | `상품명+옵션명(매칭)` | E `구성구분` | `세트구성` | 표준 구성 분류 | text | yes, 3 | SalesFact staging | `compositionType` | HIGH | 6개 값. Product.productType으로 직접 치환하지 않는다. |
| 매출 데이터 | `상품명 정리` | A `상품구분` | `1호` | 상품군/검색 분류 | text | no | Product classification candidate | `familyName` | MEDIUM | 80개 고유값, 숨김 보조표. |
| 매출 데이터 | `상품명 정리` | B `상품명` | `1호 단품` | 정규화 상품명 허용 목록 | text | no | Product candidate label | `productName` candidate | MEDIUM | 109행, 108개 고유값. Sabangnet code는 없다. |

## 행 수, 값 범위와 데이터 품질

### 원천 Fact 후보 요약

- 데이터 행: 125,242
- 정규화한 날짜 범위: 2026-01-01 ~ 2026-10-18, 291일
- 채널 label: 22개
- 수량 합계: 181,522
- 숫자형 결제금액 합계: 4,379,426,441원
- 문자열 음수 포함 정규화 합계: 4,379,378,251원
- `매칭필요`: 9,606행(7.67%), D 기준 161개 고유 key
- A:G가 완전히 같은 중복 그룹: 11,164개, 첫 행 외 중복 57,649행, 최대 동일 반복 1,803회
- `상품명+옵션` Null 1,174행, `상품명_색상` Null 2행, `옵션별칭` Null 3,788행
- `수량=0` 79행, `결제금액=0` 12행

A:G 중복은 주문번호가 없으므로 정상적인 동일 상품 복수 주문인지, 이미 집계된 같은 행인지, 파일 중복인지 판정할 수 없다. import technical key는 최소 `file_hash + sheet + original_row_number`여야 하며, 값 기반 dedupe를 자동 적용하면 안 된다.

### 채널별 요약

금액은 숫자형 셀만 합계한 값이다. `미매칭`은 H/I 중 하나가 `매칭필요`인 행이다.

| 쇼핑몰명 | 행 | 기간 | 수량 | 결제금액 | 미매칭 |
| --- | ---: | --- | ---: | ---: | ---: |
| 11번가 | 141 | 01-01 ~ 10-05 | 226 | 4,335,160 | 0 |
| ESM옥션 | 178 | 01-14 ~ 10-18 | 238 | 5,352,629 | 0 |
| ESM지마켓 | 969 | 01-01 ~ 10-16 | 1,243 | 27,813,870 | 1 |
| SSF SHOP | 34 | 01-01 ~ 09-15 | 36 | 1,036,600 | 0 |
| T deal | 4 | 01-02 ~ 04-06 | 4 | 134,200 | 0 |
| Wconcept | 244 | 01-04 ~ 10-11 | 244 | 4,885,990 | 0 |
| 베네피아 | 167 | 01-02 ~ 10-17 | 263 | 4,546,010 | 0 |
| 비즈마켓 | 8 | 02-09 ~ 09-16 | 8 | 509,600 | 0 |
| 스마트스토어 | 38,054 | 01-01 ~ 10-18 | 52,984 | 878,528,430 | 59 |
| 스마트스토어(도착보장) | 6,698 | 01-01 ~ 10-18 | 6,903 | 393,524,220 | 10 |
| 오늘의집 | 42,190 | 01-01 ~ 10-18 | 43,855 | 649,185,920 | 948 |
| 우리의식탁 | 195 | 01-09 ~ 09-18 | 208 | 10,855,900 | 28 |
| 자사몰 | 20,852 | 01-01 ~ 10-18 | 24,819 | 1,235,444,330 | 7,215 |
| 카카오톡선물하기 | 489 | 01-01 ~ 10-12 | 495 | 22,158,300 | 0 |
| 카카오톡스토어 | 638 | 01-01 ~ 09-27 | 697 | 33,664,740 | 0 |
| 컬리 | 6,037 | 01-01 ~ 10-18 | 6,605 | 277,967,140 | 1,345 |
| 컬리(FBK) | 2 | 01-30 ~ 01-31 | 2 | 85,800 | 0 |
| 컬리(샛별배송) | 468 | 02-02 ~ 10-18 | 483 | 21,265,700 | 0 |
| 쿠팡 | 5,287 | 01-01 ~ 10-18 | 8,696 | 45,263,370 | 0 |
| 쿠팡(로켓배송) | 2,059 | 01-07 ~ 10-13 | 32,971 | 744,042,492 | 0 |
| 퀸잇 | 447 | 01-11 ~ 10-16 | 447 | 17,080,200 | 0 |
| 토스쇼핑 | 81 | 01-03 ~ 10-18 | 95 | 1,745,840 | 0 |

## 날짜 의미 분석

`주문일자` 하나로 저장하면 안 된다. 다음 판정은 월별 시트 상단의 `집계기준` 주석을 근거로 한다.

| 적용 소스 / 기간 | 후보 date_basis | 판정 | Evidence | 남은 불확실성 |
| --- | --- | --- | --- | --- |
| `스마트스토어(도착보장)`, 1~10월 | `PAYMENT_DATE` | **HIGH / VERIFIED** | 모든 월별 시트에 `결제일 기준`이 반복 명시됨. | 결제취소·환불 반영일은 없음. |
| `쿠팡(로켓배송)`, 1~10월 | `EXPECTED_INBOUND_DATE` | **HIGH / VERIFIED** | 모든 월별 시트에 `입고예정일 기준`이 반복 명시됨. | 실제 판매일·정산일과 다르며 79행은 수량 0, 금액 양수. |
| `컬리(샛별배송)`, 1월 주석 | `PAYMENT_DATE` | **HIGH for rule, 적용 행 없음** | 1월 시트에 `결제일 기준` 명시. 실제 샛별배송 raw 행은 2월부터 존재한다. | 2~10월 시트에는 이름만 있고 basis 문구가 생략되어 동일 규칙 지속 여부를 파일만으로 확정할 수 없다. |
| `컬리(샛별배송)`, 2~10월 raw | `PAYMENT_DATE` 후보 | **MEDIUM / LIKELY** | 1월 기준 주석과 이후 월 동일 채널 label. | 월별로 명시되지 않아 source 확인 필요. 확정 전 `OTHER` 또는 nullable basis로 보존 가능. |
| 일반 채널: 자사몰, 스마트스토어, 쿠팡, 컬리, 오늘의집 등 | `ORDER_DATE` | **HIGH / VERIFIED** | 월별 시트에 `나머지 채널: 사방넷 주문일 기준` 명시. 판정 범위는 workbook rule이다. | 실제 채널 주문일과 사방넷 수집일 차이는 검증하지 못함. |
| `컬리(FBK)` 1월 2행 | `OTHER` | **LOW / UNVERIFIED** | 월별 표에는 컬리와 합산되지만 별도 date basis 주석이 없음. | 주문·결제·입고 중 무엇인지 확인 필요. |
| `땡스공구` 1~8월 수기 보고값 | `SETTLEMENT_DATE` 후보 | **LOW / UNVERIFIED** | 1~8월 시트는 `정산금액 기준`이라고 적어 금액 basis만 확인된다. raw에는 땡스공구 행이 없다. | 문구는 일자 자체가 정산일인지 보장하지 않는다. |
| `땡스공구`, `그 외 공구` 9~10월 | `OTHER` | **LOW / UNVERIFIED** | 월별 수기 금액이며 `합계 미포함` 표기. raw 행 없음. | source date, 정산 기간, 건별 grain이 모두 없음. |

권고하는 최소 개념은 다음과 같다. 이는 설계 제안일 뿐 이 문서에서 구현하지 않는다.

```text
source_date     원본에 기록된 날짜
reporting_date  보고서 bucket에 사용한 날짜
date_basis      ORDER_DATE | PAYMENT_DATE | EXPECTED_INBOUND_DATE | SETTLEMENT_DATE | OTHER
```

초기 적재에서 `source_date = reporting_date`로 보존하더라도 `date_basis`를 채널 규칙과 함께 기록해야 한다. `DELIVERY_DATE`를 뒷받침하는 열이나 주석은 발견하지 못했다.

## Key, 중복과 Foreign Key 후보

| 후보 | Null / Unique | 판정 | Evidence |
| --- | --- | --- | --- |
| 주문번호·주문상세 ID | 열 자체가 없음 | **NOT POSSIBLE** | 행을 주문 단위로 식별할 값이 없다. |
| A `주문일자` | Null 0, 반복 | PK 불가 | 291일 bucket. |
| B `쇼핑몰명` | Null 0, 22종 반복 | Channel FK 후보 | channelName alias로는 쓸 수 있으나 canonical channelCode 매핑이 필요하다. |
| C `상품명+옵션` | Null 1,174, 4,532종 | Alias 후보 | 채널별 원문 증거. mutable text이며 Listing/Offer ID가 아니다. |
| D `상품명_색상` | Null 2, trim 후 1,494종 | 정규화 lookup key | 매칭표 A로 연결되지만 Product key는 아니다. |
| E `옵션별칭` | Null 3,788, 1,088종 | SKU/BOM 텍스트 후보 | 188개 코드 패턴을 찾았으나 자유 텍스트, 다중 코드, 수량 표현이 섞인다. |
| A:G composite | 11,164개 중복 그룹, 57,649개 excess | PK 불가 | 최대 동일 반복 1,803회. 주문 ID가 없어 정상 복수 주문과 중복 적재를 구분할 수 없다. |
| `file_hash + sheet + original_row_number` | 이 snapshot에서 유일 | technical row key | RAW provenance용으로만 적합. 파일 개정 간 동일 업무행 identity는 아니다. |
| 매칭표 A | 2,573행, trim 전 2,544종 | unique key 부적합 | duplicate key 29개. 3개 key는 서로 다른 정규화 결과를 가진다. |

매칭표의 충돌 3건은 다음과 같다.

- `땡스소윤 냉동용기 베스트팩A 혼합 13종색상: 쿨라벤더`: 표준 full name이 `베스트팩A...`와 `첫살림세트 8P 핑크`로 충돌한다.
- `...8호 색상: 투명그레이 / 옵션: 2호(1350ml)`: full name 표기만 `2호 단품 투명그레이`와 `2호 투명그레이`로 다르다.
- `...쉿크릿 할인코드 '1004'...소분칸칸이 세트`: 표준 상품명과 full name이 서로 다른 두 버전이다.

이 충돌을 먼저 해소하지 않고 lookup 행 순서에 의존하면 같은 source key가 파일 행 순서에 따라 다른 정규화 결과를 낸다.

## Product Master와의 실제 연결 증거

Master 원본의 `단가표!B`와 `상품DB!E:I`를 읽기 전용으로 대조했다. 아래 수치는 양쪽 텍스트의 앞뒤 공백을 제거한 비교다.

| 비교 | 결과 | 관계 판정 |
| --- | --- | --- |
| Sales에 Sabangnet code `100051` 또는 다른 `단가표!B` 값이 있는가 | `100051` 0건. Sales의 6자리 숫자는 결제금액이며 Product code 열이 없다. | **NOT POSSIBLE** |
| `로우데이터!D` → Master `상품DB!E` source name | D non-null 125,240행 중 115,174행(91.96%) exact match. D 고유 1,494개 중 1,289개 match. 이름 정규화 관계만 확인하며 Product identity는 확인되지 않는다. | **VERIFIED** |
| `로우데이터!H` → Master `상품DB!F` normalized full name | 114,792행, 656개 고유 label match. 판정 범위는 label vocabulary overlap이다. | **VERIFIED** |
| `로우데이터!I` → Master `상품DB!G` normalized product name | 115,366행, 232개 고유 label match. 판정 범위는 label vocabulary overlap이다. | **VERIFIED** |
| `로우데이터!I` → `단가표!E` 모델명 | 5,848행만 match, 고유 이름 14개로 coverage가 낮고 이름 join이 모호하다. | **UNVERIFIED** |
| Sales 매칭표 A:E ↔ Master `상품DB!E:I` | Sales 2,573행·trim key 2,489개, Master 2,527행·key 2,444개. 공통 key 2,444개, 완전 동일 tuple 2,416행으로 동일 계열 normalization snapshot으로 보이나 revision 차이가 있다. | **LIKELY** |

중요한 경계는 `상품DB!E:I` 자체에 `단가표!B` Sabangnet code가 없다는 점이다. 따라서 91.96% 이름 match는 정규화 가능성을 입증하지만 `Product.id` 또는 `Product.sabangnetCode`를 입증하지 않는다.

제한된 worked example은 존재한다.

```text
Sales row example
상품명_색상 = 점보 쿨라벤더
옵션별칭 = AL00
수량 = 1
상품명(매칭) = 점보 단품

Master 단가표 row 6
사방넷품번 = 100051
모델명 = 점보
구성 상세 = AL00 1개
```

이 예시는 `Sales 옵션별칭 AL00 → SKU AL00 → ProductComponent → Product 100051` 경로가 가능한 한 사례다. 전체 125,242행 가운데 옵션별칭에서 SKU형 code를 하나 이상 찾은 행은 109,593행이고, 그중 56,695행은 복수 code다. `옵션별칭`이 Null인 3,788행과 non-null이지만 code를 찾지 못한 11,861행도 있다. 그러므로 이 경로는 **LIKELY candidate**이며 Master SKU/BOM을 정규화한 뒤 row별로 검증해야 한다. 이름이나 code token만으로 자동 Product FK를 생성하지 않는다.

## 파일 간 관계 판정

| 관계 | 판정 | Evidence / Boundary |
| --- | --- | --- |
| Sales ↔ Channel | **LIKELY** | B에 22개 source channel label이 있고 월별 보고서가 같은 label로 집계한다. canonical `channelId`는 이름 alias 매핑 후 생성한다. |
| Product ↔ Sales (direct) | **NOT POSSIBLE** | Sales에 Sabangnet code와 channel listing/offer ID가 없다. |
| Product ↔ Sales (normalization candidate) | **LIKELY** | D가 Master `상품DB!E`와 91.96% row match하고 H/I가 normalization vocabulary와 일치한다. 그러나 `상품DB!E:I`에서 `단가표!B`로 이어지는 FK가 없다. |
| SKU ↔ Sales | **LIKELY** | E에 `AL00`, `AQ01` 등 SKU형 token이 존재한다. 자유 텍스트와 복수 구성 때문에 parser 및 SKU registry 검증이 필요하다. |
| Product/BOM ↔ Sales | **UNVERIFIED** | simple example `100051 → AL00×1`은 연결되지만 set rows의 E는 BOM-like text이며 검증된 Product code가 없다. |
| Product ↔ observed price | **UNVERIFIED** | G는 행 결제금액이고 단가 열이 아니다. 수량 0행도 있어 `G/F`를 일괄 unit price로 계산할 수 없다. |
| Sales ↔ Advertising | **UNVERIFIED** | 이 문서 범위에서는 Sales의 channel/date aggregate만 확인했다. 광고 원본의 grain과 Product key는 별도 광고 분석에서 확인해야 하며 Product FK 없이 이름으로 강제 결합하지 않는다. |

## 보고 grain과 금액 reconciliation

### 원천 행 grain

가장 보수적인 정의는 다음이다.

```text
source sales row
= source_date + channel label + source product/option text
  + optional normalized key/SKU-like text + quantity + payment amount
```

주문 line 또는 일별 aggregate라고 확정하지 않는다. 동일 A:G 행이 대량 반복되고 주문 ID가 없으며, 쿠팡 로켓배송에는 수량 0·양수 금액 행이 있다.

### 대시보드 합계 불일치

- raw 숫자 결제금액: 4,379,426,441원.
- 연간 `2026년` B2C 실적: 4,379,340,641원.
- 차이 85,800원은 `컬리(FBK)` 2행의 합계와 정확히 같다. 1월 월간 표는 FBK를 `컬리`와 합산하지만 연간 표는 제외한다.
- 문자열 음수 7건 합계 -48,190원은 Excel `SUMIFS`의 숫자 합계에서 제외된다. 모두 자사몰 행이다.
- 4~8월 월간 `총매출`은 `땡스공구` 수기 금액을 포함한다. 9~10월은 `땡스공구: 합계 미포함`으로 규칙이 바뀐다.
- `그 외 공구`는 9~10월 별도 수기 열이며 raw에 대응 행이 없다.

따라서 `gross_sales`는 source row 금액과 보고서 총매출을 같은 값으로 간주하지 않고, 포함 범위와 source provenance를 함께 기록해야 한다.

## 구현 전 반드시 결정할 사항

1. 22개 `쇼핑몰명` label을 SellerAudit `Channel.channelCode`에 대응시키는 명시적 mapping.
2. 컬리 샛별배송 2~10월 날짜가 계속 결제일인지, 컬리 FBK 날짜가 무엇인지.
3. 문자열 음수 7건이 환불·할인·수기 보정 중 무엇이며 수량을 양수로 둔 이유.
4. 쿠팡 로켓배송 수량 0·양수 금액 79행의 업무 의미와 수량 metric 제외 여부.
5. 땡스공구·그 외 공구의 원천 행, 정산 기간, 보고서 포함 규칙.
6. 매칭표 충돌 3건과 Sales/Master normalization snapshot 차이 157행의 owner review.
7. Product 연결은 `상품DB` name normalization에서 끝내지 말고 Sabangnet code 또는 검증된 SKU/BOM bridge로 승인하는 절차.

이 문서는 Prompt 1의 read-only 분석 결과다. Migration, parser, import, Supabase 적재, UI, 자동 매칭 또는 Dashboard 구현은 포함하지 않는다.
