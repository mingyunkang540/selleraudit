# Master source analysis

Source: `★★땡스소윤_전체 상품 단가표_마스터파일_ver00.xlsx` (read-only, supplied 2026-10-24; 290,422 bytes; SHA-256 `ecf54338543e9187af7dc9c796eda365c1925df905bd19ba2524c8e6b25d6dc7`). The request names a `(1)`-suffixed file; the supplied file has no suffix. Counts below describe the supplied file, not a presumed alternate revision. Analysis used `openpyxl` to read formulas and cached values; no spreadsheet was changed or copied into the repository.

## Workbook structure

| Sheet | Size | Header / first data row | Merged cells | Formulas | Hidden sheet / columns | Repeated headers or layout |
| --- | ---: | --- | ---: | ---: | --- | --- |
| `단가표` | 220 × 42 (`A:AP`) | row 5 / row 6 | 0 | 2,697 | visible; `I`, `L:Q` hidden | One table, rows 6–220 (215 records); rows 200–220 repeat 21 earlier products as a separate aqua-channel section without its own header. |
| `행사기획서` | 71 × 25 (`A:Y`) | row 12 / row 13 | 11 | 707 | visible | Campaign-specific planning form; rows 4–7 contain inputs, row 11 contains coupon/fee assumptions. Not a product-master source. |
| `기획SIMUL` | 35 × 19 (`A:S`) | row 8 / row 9 | 8 | 169 | visible; one hidden column | Scenario calculator, not a list of master products. |
| `원가DB` | 42 × 48 (`A:AV`) | row 4 / row 5 | 0 | 30 | visible | Multiple independent side-by-side tables in one sheet: box, unit product cost, transport, inner packing, storage, carton, MSRP, fulfillment, strip and bundle costs. `B:M` has 30 populated box rows; other tables have different lengths. |
| `가격DB` | 35 × 28 (`A:AB`) | row 2 / row 3 | 9 | 150 | visible; 11 hidden columns | Side-by-side online discount bands, derived online prices, group-buy bands and prior-operation bands. Prices are policy/reference values, not observed sales. |
| `상품DB` | 2,529 × 9 (`A:I`) | row 2 / row 3 for `E:I`; row 3 is another header for `A:C`, with data at row 4 | 0 | 0 | visible | Two independent side-by-side tables. `A:C` is an internal product-name/code lookup ending at row 138; `E:I` is a 2,527-row source-name normalization lookup. Do not join same-row values across the two blocks. |
| `코드DB` | 491 × 25 (`A:Y`) | row 3 / row 5 for inventory code list; lookup legends and secondary lists have separate headers | 18 | 117 | visible | `B:J` has category divider rows (e.g. 4, 83, 94, 229), not one flat table; `L:O`, `R:U`, `W:Y` are separate legends/lookups. |

`행사기획서` has 123 formulas containing `#REF!` and 22 cached errors; `기획SIMUL` has 38 such formulas and 10 cached errors. Their lookup/calculation output is not reliable as an import source. `단가표` cached price results should also be treated as a snapshot: many prices are XLOOKUP-based on `가격DB` and are not recalculated by reading the XLSX. Excel data validation extensions elicited an `openpyxl` read warning, but no save was performed.

The main code is `단가표!B` (six-digit Sabangnet selling-product number, e.g. `100051`). `단가표!F` contains a textual component list with physical codes such as `AL00 1개`; `코드DB!E` contains logistics codes by model and color. `상품DB!C` uses a separate `P000`/`SET001` name-mapping namespace and must **not** become SellerAudit's product or SKU identifier. `단가표!AJ:AO` holds channel-specific product/listing codes. There is no row-level effective date for prices or costs. `행사기획서!C5` is a free-text campaign period (`2026.09.07 - 09.22`); `코드DB!B` is labeled inbound date but mostly category labels/blank, so it is not a reliable date field.

## Key and data-quality findings

- `단가표` has 215 candidate product rows and 212 non-null Sabangnet codes. There are 185 distinct non-null codes. A raw unique constraint on `B` would reject 27 excess occurrences: all 21 rows 200–220 repeat earlier codes, plus six excess occurrences of the `100526` collision. Verify exact channel scope before deduplication.
- `100526` occurs **seven** times in rows 158–164 for different `점보/1호/3호/5호/7호/8호/9호 2개` products. It is a genuine conflicting candidate key, not identical duplicate rows. A chosen Product identity and correction rule needs owner review before import.
- `(B 사방넷품번, AH 채널구분)` still has six excess collisions, all `100526`/`쿠팡`. Adding model name `E` makes the 212 coded rows unique in this snapshot, but a name is mutable and not a durable primary key. Source row position is the only universally available technical identifier for the 215-row snapshot.
- Rows 115, 141, 142 have a blank Sabangnet code. Rows 200–220 are channel variants: for example `100051` row 6 has channel `공통`, while row 200 has `오늘의집_아쿠아`; `단가표!AN6=3887146` and `AM200=3887146`. Product and channel offer/listing context must stay separate.
- `단가표!F` resembles a BOM but is not a normalized BOM. A basic `CODE N개` extraction yields 44 distinct component codes; `AL24` appears once with no exact `코드DB!E` match. Eight rows have a parsed component quantity total different from `H` (e.g. row 85: 9 versus 8; row 139: 31 versus 27). Bundled subassemblies such as `AL510` account for some but not all mismatches; no automatic BOM expansion is justified yet.
- `코드DB!E` has 474 populated cells but only 456 distinct literal values. Repeats include `D08`, `D16`, `D17`, `D18`, two `★AL10`, and `(소모품)` 14 times. Category/context and code normalization are needed before claiming uniqueness. `코드DB!J` can hold packaging-work component text; a code row is not always one saleable SKU.
- `상품DB!C` has 135 populated data codes in rows 4–138, all distinct there, but does not join by literal code to `단가표!B`. `상품DB!E` has 2,527 populated source-name rows but only 2,499 distinct strings; the other normalization columns have fewer rows or many repeats. These are aliases, not unique products.
- Cost source granularity differs: `단가표!I:N` unit components are largely blank for sets, while `R` total cost and `S` MSRP are populated for all 215 rows. `R` is a workbook value; its inclusions/tax basis are not proven by this file. Do not calculate profit by assuming `R = I + O + Q` (`Q` is text such as `박스11`).

## Source dictionary (master workbook)

Each row gives source column, example, business meaning, type, nullable in candidate rows, candidate SellerAudit entity.field, confidence, and limitation. Candidate fields are conceptual unless already present in `src/types/domain.ts`; no schema change is made.

### `단가표` (rows 6–220)

| Column | Example | Meaning | Type | Nullable | Candidate entity.field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A `순번` | 1 | display order | formula integer | no | import provenance.row | HIGH | `ROW()-5`; not identity. |
| B `사방넷품번` | `100051` | selling-product code | code/text | yes (3) | Product.sabangnetCode | HIGH | 27 excess occurrences; `100526` conflicts. Preserve leading zeros if they ever occur. |
| C `구분` | `단품` | single/set classification | enum text | no | Product.productType | HIGH | 45 single, 167 set among 212 coded rows. |
| D `카테고리` | `냉동용기` | merchandise category | text | no | Product.category | HIGH | Seven observed categories. |
| E `모델명` | `점보` | selling-product/model name | text | no | Product.productName | HIGH | Name not unique. |
| F `구성 상세` | `AL00 1개` | textual component/BOM description | text | no | ProductComponent candidate | HIGH | Must be parsed and reconciled, not a guaranteed FK. |
| G `용량 ml` | `3200` | container capacity | mixed number/`-` | yes | Product.capacityMl candidate | MEDIUM | Not applicable to sets; `-` is missing, not zero. |
| H `구성수` | `1` | stated component count | integer | no | Product.componentCount candidate | MEDIUM | Sometimes disagrees with literal `F` quantities. |
| I `제품원가` | `1632` | base item cost | decimal KRW | yes | ProductCost.baseCost candidate | MEDIUM | Hidden; mostly blank for sets. |
| J `운송비` | `32` | allocated transport cost | decimal KRW | yes | ProductCost.transportCost candidate | MEDIUM | Historical allocation source in `원가DB`. |
| K `인포장` | `250` | inner packing cost | decimal KRW | yes | ProductCost.innerPackCost candidate | MEDIUM | Meaning from workbook label. |
| L `택배포장` | `100` | parcel packing cost | decimal KRW | yes | ProductCost.parcelPackCost candidate | MEDIUM | Hidden. |
| M `보관료` | `86.8` | storage allocation | decimal KRW | yes | ProductCost.storageCost candidate | MEDIUM | Hidden. |
| N `카톤박스` | `67.5` | carton allocation | decimal KRW | yes | ProductCost.cartonCost candidate | MEDIUM | Hidden. |
| O `포장단가` | `536.3` | sum of J:N | formula decimal KRW | yes | ProductCost.packagingCost candidate | HIGH | Hidden; formula for 31 rows. |
| P `원가합 제품+포장` | `2168.3` | base plus packing cost | mixed formula/value KRW | yes | ProductCost.productPackCost candidate | HIGH | Hidden; not same as total cost `R`. |
| Q `기타부대비용…` | `박스11` | box/other-cost label | text | no | ProductCost.ancillaryCostLabel candidate | LOW | Hidden; text is not a monetary amount. |
| R `총원가` | `5940` | workbook total product cost | decimal KRW | no | ProductCost.totalCost candidate | HIGH | Basis and effective date unverified. |
| S `정상가` | `13300` | list/MSRP price | integer KRW | no | Product.normalPrice | HIGH | Same selling code can appear in multiple channel rows. |
| T `상시가` | `12900` | everyday offer price | formula/value KRW | yes (2) | PricePolicy.everydayPrice candidate | HIGH | Derived from price bands, not transaction price. |
| U `상시 할인율` | `0.0301` | everyday discount against MSRP | formula ratio | no | PricePolicy.everydayDiscountRate candidate | HIGH | Formula-derived. |
| V `기본행사가` | `11300` | basic event price | formula/value KRW | yes (2) | PricePolicy.basicEventPrice candidate | HIGH | Event tier, not dated campaign. |
| W `기본 할인율` | `0.1504` | basic event discount against MSRP | formula ratio | no | PricePolicy.basicEventDiscountRate candidate | HIGH | Formula-derived. |
| X `중형행사가` | `10600` | mid-tier event price | formula/value KRW | yes (2) | PricePolicy.midEventPrice candidate | HIGH | Formula-derived. |
| Y `중형 할인율` | `0.2030` | mid-tier discount against MSRP | formula ratio | no | PricePolicy.midEventDiscountRate candidate | HIGH | Formula-derived. |
| Z `대형행사가` | `9900` | large-event price | formula/value KRW | yes (2) | PricePolicy.largeEventPrice candidate | HIGH | Formula-derived. |
| AA `대형 할인율` | `0.2556` | large-event discount against MSRP | formula ratio | no | PricePolicy.largeEventDiscountRate candidate | HIGH | Formula-derived. |
| AB `원데이/라이브` | `9300` | one-day/live price | formula/value KRW | yes (2) | PricePolicy.livePrice candidate | HIGH | Formula-derived. |
| AC `원데이 할인율` | `0.3008` | one-day/live discount against MSRP | formula ratio | no | PricePolicy.liveDiscountRate candidate | HIGH | Formula-derived. |
| AD `공구가` | blank | group-buy price | KRW candidate | yes (all 215) | PricePolicy.groupBuyPrice candidate | LOW | No observed values; cannot validate. |
| AE `공구 할인율` | blank | group-buy discount | ratio candidate | yes (all 215) | PricePolicy.groupBuyDiscountRate candidate | LOW | No observed values; cannot validate. |
| AF `원가율` | `0` | cost ratio calculation | formula ratio | yes | Profitability.costRate candidate | LOW | Cached zeros and blanks; denominator/semantics require review. |
| AG `개당 상시가기준` | `12900` | everyday price per component | formula decimal KRW | yes | PricePolicy.unitEverydayPrice candidate | MEDIUM | Derived, not channel offer. |
| AH `채널구분` | `공통` | intended channel/section | text | yes | ChannelListing.channel candidate | MEDIUM | Includes `오늘의집_아쿠아`; not necessarily a canonical channel code. |
| AI `사용여부` | `Y` | active flag | Y/N | yes | Product.status candidate | MEDIUM | Blank for aqua duplicates; may apply to row/listing instead. |
| AJ `자사몰` | `P00000DC` | self-hosted listing code | code/text | yes | ChannelListing.externalProductCode candidate | HIGH | 124 populated cells; not SellerAudit master code. |
| AK `쿠팡` | `…` | Coupang listing code | code/text | yes | ChannelListing.externalProductCode candidate | MEDIUM | Sparse (39 populated); verify exact channel identifier. |
| AL `네이버` | `9428553251` | Naver listing code | code/text | yes | ChannelListing.externalProductCode candidate | HIGH | Numeric-looking, preserve as text. |
| AM `오늘의집` | `1340321` | Ohouse listing code | code/text | yes | ChannelListing.externalProductCode candidate | HIGH | May include aqua section variant. |
| AN `오늘의집 아쿠아` | `3887146` | Ohouse aqua listing code | code/text | yes | ChannelListing.externalProductCode candidate | MEDIUM | Relationship to duplicated rows requires reconciliation. |
| AO `컬리` | channel code | Kurly listing code | code/text | yes | ChannelListing.externalProductCode candidate | MEDIUM | Sparse; code namespace not validated. |
| AP `비고` | note | free-text comment | text | yes | import provenance.note | LOW | Only four nonblank rows. |

### Supporting sheets

The following columns are meaningful but have distinct grains. Their fields are candidates only; the requested data-model design belongs to the next prompt.

| Sheet / columns | Example | Meaning | Type | Nullable | Candidate entity.field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `상품DB!A:C` | `점보` / `점보` / `P000` | master/individual display name and *internal mapping* code | text/text/code | yes outside rows 4–138 | ProductAlias.sourceName / legacyCode | MEDIUM | `P000`/`SET...` must not replace Sabangnet code. `A` name repeats; `C` unique only in this block. |
| `상품DB!E:I` | `1호3개 5호3개세트 쿨라벤더` / normalized name / base name / `쿨라벤더` / `세트구성` | source-to-normalized name, color and composition lookup | text | some (`F:I`) | ProductAlias.sourceName/normalizedName/color/compositionType | MEDIUM | 2,527 source strings; nonunique source and normalized names. Not aligned row-wise with A:C. |
| `코드DB!B:J` | category / `점보` / `라벤더` / `AL00` / quantity / pack size / pack count / note / `AL00 2개` | logistics/packaging code registry and inbound planning fields | date-or-label/text/code/integer/formula/text | many | Sku.skuCode/modelName/color; LogisticsUnit candidate | MEDIUM | Category divider rows, reused codes, mixed inventory and packaging-work codes. `B` is labelled inbound date but usually not an actual date. |
| `코드DB!L:O`, `R:U` | `A=냉동용기`, `L=라벤더` | code-prefix and color legends | text | yes | CodeLegend candidate | MEDIUM | Separate side tables, not row-linked to B:J. |
| `코드DB!W:Y` | `[AC00] 냉동용기 점보` / `AC00` / `크림화이트` | item-name/management-name/option lookup | text/code/text | yes | SkuAlias candidate | LOW | Separate list, requires key validation. |
| `원가DB!B:M` | `박스11`, size, use, manufacturing/purchase cost, order quantity, supplier, parcel size/fee, weight, pack cost, other cost | shipping-box reference and allocations | text, number, formula | some | PackagingCost/LogisticsUnit candidate | MEDIUM | 30 populated box rows; no effective date. |
| `원가DB!O:P`, `R:S`, `U:V`, `X:Y`, `AA:AB`, `AD:AE` | `점보` / `1632`, `32`, `250`, `86.8`, `67.5`, `13300` | name-to-product-cost, transport, inner-pack, storage, carton, MSRP lookup tables | text/decimal KRW | yes | CostComponent or PriceReference candidate | MEDIUM | Same row across blocks is not a single business record. Mostly historical (`24년`) headings. Name is not a stable FK. |
| `원가DB!AG:AH`, `AJ:AK`, `AM:AN` | fulfillment service/fee, strip production, bundle cost | additional cost references | text/decimal KRW | yes | CostComponent candidate | LOW | Mixed category labels and amounts. |
| `가격DB!A:F` | 300000 / 0.3 / 0.4 / 0.46 / 0.51 / 0.53 | MSRP band and five online discount tiers | KRW/ratio | no within band rows | PricePolicyBand candidate | HIGH | Rows 3–35; band lookup via XLOOKUP, not product-specific. |
| `가격DB!H:R` | 300000 / derived prices and discount rates | online tier derived-price display | KRW/ratio/formula | some | PricePolicyBand candidate | MEDIUM | Duplicate representation of A:F, hidden rate columns. |
| `가격DB!T:X`, `Z:AB` | group-buy price/margin; old operation discounts | independent policy bands | KRW/ratio/text | some | PricePolicyBand candidate | MEDIUM | No product code or effective date. |
| `행사기획서!B4:G7`, `K11:P11` | `네이버 추석+`, text period, coupon/fee | single campaign scenario parameters | text/number/date-as-text | some | CampaignPlan candidate | LOW | 123 broken-reference formulas in sheet. |
| `행사기획서!A:X` rows 12+ | channel product code, proposed price, fee, margin and target | planned line items | mixed | many | CampaignPlanLine candidate | LOW | `B` product-code lookup uses `#REF!`; not an observed order or canonical master feed. |
| `기획SIMUL!B:S` | component quantities, discounted scenario | what-if simulation inputs/outputs | mixed | many | Scenario candidate | LOW | 38 broken-reference formulas, 10 cached errors. |

For exact source coordinates in these independent blocks, use the map below. The group table above supplies business meaning, type, nullability, candidate fields, confidence and notes. All mapped columns inherit this document's Source File. Blank separator columns are deliberately omitted.

| Sheet / block | Meaningful Source Columns (Excel letter = source header or role) |
| --- | --- |
| `원가DB` box | `B=박스No.`, `C=사이즈(mm)`, `D=용도`, `E=생산원가`, `F=매입원가`, `G=발주단위 수량`, `H=공급업체`, `I=택배사이즈`, `J=택배비`, `K=박스 무게`, `L=삽지+포장비`, `M=기타부대비용` |
| `원가DB` cost/price | `O/P=품명/24년 원가`, `R/S=품명/운송비`, `U/V=품명/24년 인포장`, `X/Y=품명/보관비`, `AA/AB=품명/카톤`, `AD/AE=품명/정상가` |
| `원가DB` service/other | `AG/AH=품명/풀필먼트 단가`, `AJ/AK=품명/띠지제작비`, `AM/AN=품명/쿠팡 단일구성세트 단가` |
| `가격DB` online rate bands | `A=정상가`, `B=상시`, `C=기본`, `D=중형`, `E=대형`, `F=원데이` |
| `가격DB` derived online | `H=정상가`, `I/J=상시가/율`, `K/L=기본가/율`, `M/N=중형가/율`, `O/P=대형가/율`, `Q/R=원데이가/율` |
| `가격DB` group-buy/legacy | `T=정상가`, `U=행사가`, `V=최대할인율`, `W=업체마진율`, `X=업체마진`, `Z=기존 정상가 구간`, `AA=기존 상시율`, `AB=기존 행사율` |
| `상품DB` legacy lookup | `A=마스터 상품명`, `B=단품 상품명`, `C=사방넷 품번코드` (label misleading: values are `P000`/`SET...`, not numeric `단가표!B`) |
| `상품DB` name normalization | `E=상품명+옵션명`, `F=쇼핑몰명`, `G=상품명(매칭)`, `H=색상(매칭)`, `I=구성구분` |
| `코드DB` logistics | `B=입고일`, `C=상품명`, `D=옵션명`, `E=상품코드`, `F=입고예정수량`, `G=박스당 수량`, `H=입고박스 수`, `I=비고1`, `J=포장작업 코드` |
| `코드DB` legends/lookup | `L:O=구분 코드·의미`, `R:S=구분 코드·의미`, `T:U=색상 코드·의미`, `W=상품명`, `X=관리명`, `Y=옵션` |
| `행사기획서` line | `A=No`, `B=관리코드`, `C=상품명`, `D=채널상품코드`, `E=채널상품명`, `F=구분`, `G=총원가`, `H=정상가`, `I=상시가`, `J=행사가`, `K=할인율`, `L=자사부담 쿠폰액`, `M=채널부담 쿠폰액`, `N=최종가`, `O=최종가 할인율`, `P=수수료`, `Q=공급가`, `R=마진액`, `S=마진률`, `T=배송/부대비용`, `U=실질마진액`, `V=실질마진률`, `W=목표수량`, `X=목표매출` |
| `기획SIMUL` inputs/outputs | `B=단품 선택`, `C=수량`, `D=표시문구`, `E=원가합`, `F=단가정상가`, `G=원가합계`, `H=정상가합계`, `J=시뮬레이션 지표명`, `K=지표값`, `M=할인율`, `N=판매가`, `O=최종쿠폰가`, `P=최종할인율`, `Q=공급가`, `R=실질마진액`, `S=실질마진률` |

## Relationship assessment

| Relationship | Grade | Evidence / boundary |
| --- | --- | --- |
| Product Master ↔ SKU | **LIKELY** | `단가표!B6=100051` and `F6=AL00 1개`; `코드DB!E23=AL00` is a directly observed example. Across the workbook, code types and textual compositions have not been fully validated as SKU FKs. |
| Product ↔ BOM | **LIKELY** | `단가표!F` carries quantities but has 8 `F`/`H` mismatches and at least one missing code; a verified normalized BOM does not exist yet. |
| SKU ↔ barcode/logistics unit | **LIKELY** | All 51 `단품` codes in the barcode workbook match `코드DB!E`, but cross-sheet packaging identity and official SKU scope remain unverified; see [barcode analysis](BARCODE_SOURCE_ANALYSIS.md). |
| Product ↔ price/cost | **VERIFIED** | In this workbook row, `B6=100051`, `R6=5940`, `S6=13300`. The grade only covers the source association; there is no effective date, currency/tax rule or change history. |
| Product ↔ channel listing | **LIKELY** | `AJ:AO` contain external channel codes, but repeated/blank `B` and channel variants prevent blind one-row-one-product import. |

These findings extend the existing [SCM export analysis](../SCM_SOURCE_ANALYSIS.md); they do not reclassify the prior exports or change the Foundation domain contract.

### Expanded supporting-sheet column dictionary

Every row below inherits Source File `★★땡스소윤_전체 상품 단가표_마스터파일_ver00.xlsx`. Source header is the direct business label when present; for code legends it names the observed role. Nullable counts use the stated row window for each block, which can include category dividers or empty scenario/template lines; they are descriptive, not import constraints. Cached formula values are examples only.

| Sheet | Source Column | Business Meaning (source header) | Example | Data Type | Nullable | Candidate Entity | Candidate Field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 원가DB | B | 박스No. | 박스01 | text | no in range | PackagingCost | boxNo | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | C | 사이즈 (mm) | 450*280*445 | text | no in range | PackagingCost | sizeMm | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | D | 용도 | 시즌2 홈쇼핑 대용량 | text | no in range | PackagingCost | intendedUse | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | E | 생산원가 | 734 | number | no in range | PackagingCost | productionCost | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | F | 매입원가 (생산원가+물류비) | 610 | number/formula | yes (10/30) | PackagingCost | purchaseCost | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | G | 발주단위 수량 | 300 | number | no in range | PackagingCost | orderQuantity | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | H | 공급업체 | 그린포장 | text | no in range | PackagingCost | supplier | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | I | 택배사이즈 | 중 | text | no in range | PackagingCost | parcelSize | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | J | 택배비 | 3050 | number | no in range | PackagingCost | parcelFee | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | K | 박스 무게 | 730 | number | yes (5/30) | PackagingCost | boxWeight | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | L | 삽지+ 포장비 | 910 | number | yes (4/30) | PackagingCost | insertPackCost | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | M | 기타부대비용 | 3960 | formula | yes (4/30) | PackagingCost | ancillaryCost | MEDIUM | 30 box rows; historical reference, no effective date |
| 원가DB | O | 품명 | 점보 | text | yes (17/38) | CostReference | modelName | MEDIUM | 24년 원가; independent side table, not row-linked to other blocks |
| 원가DB | P | 단가 | 1632 | number | yes (17/38) | CostReference | baseCost | MEDIUM | 24년 원가; independent side table, not row-linked to other blocks |
| 원가DB | R | 품명 | 점보 | text | yes (18/38) | CostReference | modelName | MEDIUM | transport allocation; independent side table, not row-linked to other blocks |
| 원가DB | S | 단가 | 32 | number | yes (19/38) | CostReference | transportCost | MEDIUM | transport allocation; independent side table, not row-linked to other blocks |
| 원가DB | U | 품명 | 점보 | text | yes (18/38) | CostReference | modelName | MEDIUM | 24년 inner pack; independent side table, not row-linked to other blocks |
| 원가DB | V | 인포장 | 250 | number/text | yes (18/38) | CostReference | innerPackCost | MEDIUM | 24년 inner pack; independent side table, not row-linked to other blocks |
| 원가DB | X | 품명 | 점보 | text | yes (18/38) | CostReference | modelName | MEDIUM | storage allocation; independent side table, not row-linked to other blocks |
| 원가DB | Y | 단가 | 86.8 | number/text | yes (18/38) | CostReference | storageCost | MEDIUM | storage allocation; independent side table, not row-linked to other blocks |
| 원가DB | AA | 품명 | 점보 | text | yes (18/38) | CostReference | modelName | MEDIUM | carton allocation; independent side table, not row-linked to other blocks |
| 원가DB | AB | 단가 | 67.5 | number/text | yes (18/38) | CostReference | cartonCost | MEDIUM | carton allocation; independent side table, not row-linked to other blocks |
| 원가DB | AD | 품명 | 점보 | text | yes (18/38) | PriceReference | modelName | MEDIUM | MSRP reference; independent side table, not row-linked to other blocks |
| 원가DB | AE | 소비자가 | 13300 | number | yes (18/38) | PriceReference | normalPrice | MEDIUM | MSRP reference; independent side table, not row-linked to other blocks |
| 원가DB | AG | 품명 | 대아→CJ 운송비 1파렛만 3.5톤으로 발송시 | text | yes (3/38) | CostReference | serviceName | LOW | fulfillment service; mixed labels; independent side table, not row-linked to other blocks |
| 원가DB | AH | 단가 | 150000 | number/text | yes (8/38) | CostReference | serviceCost | LOW | fulfillment service; mixed labels; independent side table, not row-linked to other blocks |
| 원가DB | AJ | 품명 | 점보 | text | yes (28/38) | CostReference | itemName | LOW | strip-production reference; independent side table, not row-linked to other blocks |
| 원가DB | AK | 단가 | 523 | number | yes (31/38) | CostReference | stripCost | LOW | strip-production reference; independent side table, not row-linked to other blocks |
| 원가DB | AM | 품명 | 점보세트 | text | yes (26/38) | CostReference | itemName | LOW | Coupang bundle reference; independent side table, not row-linked to other blocks |
| 원가DB | AN | 단가 | 880 | number | yes (26/38) | CostReference | bundleCost | LOW | Coupang bundle reference; independent side table, not row-linked to other blocks |
| 가격DB | A | 정상가(원) | 300000 | number | yes (2/33) | PricePolicyBand | normalPrice | HIGH | online discount lookup band, no effective date |
| 가격DB | B | 상시 | 0.3 | number | yes (2/33) | PricePolicyBand | everydayRate | HIGH | online discount lookup band, no effective date |
| 가격DB | C | 기본 | 0.4 | number | yes (2/33) | PricePolicyBand | basicRate | HIGH | online discount lookup band, no effective date |
| 가격DB | D | 중형 | 0.46 | number | yes (2/33) | PricePolicyBand | midRate | HIGH | online discount lookup band, no effective date |
| 가격DB | E | 대형 | 0.51 | number | yes (2/33) | PricePolicyBand | largeRate | HIGH | online discount lookup band, no effective date |
| 가격DB | F | 원데이 | 0.53 | number | yes (2/33) | PricePolicyBand | liveRate | HIGH | online discount lookup band, no effective date |
| 가격DB | H | 정상가(원) | 300000 | number | yes (2/33) | PricePolicyBand | normalPrice | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | I | 상시 | 210000 | formula/text | yes (2/33) | PricePolicyBand | everydayPrice | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | J | everydayRate | 0.3 | number | yes (2/33) | PricePolicyBand | everydayRate | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | K | 기본 | 180000 | formula/text | yes (2/33) | PricePolicyBand | basicPrice | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | L | basicRate | 0.4 | number | yes (2/33) | PricePolicyBand | basicRate | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | M | 중형 | 162000 | formula/text | yes (2/33) | PricePolicyBand | midPrice | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | N | midRate | 0.46 | number | yes (2/33) | PricePolicyBand | midRate | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | O | 대형 | 147000 | formula/text | yes (2/33) | PricePolicyBand | largePrice | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | P | largeRate | 0.51 | number | yes (2/33) | PricePolicyBand | largeRate | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | Q | 원데이 | 141000 | formula/text | yes (2/33) | PricePolicyBand | livePrice | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | R | liveRate | 0.53 | number | yes (2/33) | PricePolicyBand | liveRate | MEDIUM | derived online band display; alternating price/rate fields |
| 가격DB | T | 정상가(원) | 300000 | number | yes (7/33) | GroupBuyPolicyBand | normalPrice | MEDIUM | group-buy reference band |
| 가격DB | U | 행사가 | 129000 | number | yes (7/33) | GroupBuyPolicyBand | eventPrice | MEDIUM | group-buy reference band |
| 가격DB | V | 최대할인율 | 0.57 | number | yes (7/33) | GroupBuyPolicyBand | maxDiscountRate | MEDIUM | group-buy reference band |
| 가격DB | W | 업체마진율 | 0.33 | number | yes (7/33) | GroupBuyPolicyBand | vendorMarginRate | MEDIUM | group-buy reference band |
| 가격DB | X | 업체마진 | 42570 | number | yes (7/33) | GroupBuyPolicyBand | vendorMargin | MEDIUM | group-buy reference band |
| 가격DB | Z | 정상가(원) | 300,000~ | text | yes (3/33) | LegacyPriceBand | normalPriceRange | LOW | prior operating policy; text range |
| 가격DB | AA | 상   시 | 0.15 | number | yes (3/33) | LegacyPriceBand | everydayRate | LOW | prior operating policy; text range |
| 가격DB | AB | 행사 | 0.51 | number | yes (3/33) | LegacyPriceBand | eventRate | LOW | prior operating policy; text range |
| 상품DB | A | 마스터 상품명 | 점보 | text | no in range | LegacyNameCode | masterName | MEDIUM | legacy P/SET code; never Product.sabangnetCode |
| 상품DB | B | 단품 상품명 | 점보 | text | yes (115/135) | LegacyNameCode | singleName | MEDIUM | legacy P/SET code; never Product.sabangnetCode |
| 상품DB | C | 사방넷 품번코드 | P000 | text | no in range | LegacyNameCode | legacyCode | MEDIUM | legacy P/SET code; never Product.sabangnetCode |
| 상품DB | E | 상품명+옵션명 | 1호3개 5호3개세트 쿨라벤더 | text | no in range | ProductAlias | sourceProductOptionName | MEDIUM | independent name-normalization block, not aligned with A:C |
| 상품DB | F | 쇼핑몰명 | 1호 3개+5호 3개세트 쿨라벤더 | text | yes (3/2527) | ProductAlias | normalizedFullName | MEDIUM | independent name-normalization block, not aligned with A:C |
| 상품DB | G | 상품명(매칭) | 1호 3개+5호 3개세트 | text | yes (3/2527) | ProductAlias | normalizedProductName | MEDIUM | independent name-normalization block, not aligned with A:C |
| 상품DB | H | 색상(매칭) | 쿨라벤더 | text | yes (4/2527) | ProductAlias | color | MEDIUM | independent name-normalization block, not aligned with A:C |
| 상품DB | I | 구성구분 | 세트구성 | text | yes (3/2527) | ProductAlias | compositionType | MEDIUM | independent name-normalization block, not aligned with A:C |
| 코드DB | B | 입고일 | 구성품 | text | yes (473/487) | LogisticsCode | inboundDateOrCategory | MEDIUM | mixed category dividers, packaging and logistics codes |
| 코드DB | C | 상품명 | 점보 | text | yes (13/487) | LogisticsCode | modelName | MEDIUM | mixed category dividers, packaging and logistics codes |
| 코드DB | D | 옵션명 | 그레이 | text | yes (79/487) | LogisticsCode | optionName | MEDIUM | mixed category dividers, packaging and logistics codes |
| 코드DB | E | 상품코드 | AG00 | text | yes (13/487) | LogisticsCode | sourceCode | MEDIUM | mixed category dividers, packaging and logistics codes |
| 코드DB | F | 입고예정수량 | 0 | number | yes (473/487) | LogisticsCode | expectedInboundQuantity | MEDIUM | mixed category dividers, packaging and logistics codes |
| 코드DB | G | 박스당 수량 | 26 | number/text | yes (341/487) | LogisticsCode | boxQuantity | MEDIUM | mixed category dividers, packaging and logistics codes |
| 코드DB | H | 입고박스 수 | 0 | formula/number/text | yes (341/487) | LogisticsCode | expectedBoxCount | MEDIUM | mixed category dividers, packaging and logistics codes |
| 코드DB | I | 비고1 | 한정기간 러브모모 | text | yes (288/487) | LogisticsCode | note | MEDIUM | mixed category dividers, packaging and logistics codes |
| 코드DB | J | 포장작업 코드 | AG00 2개 | text | yes (394/487) | LogisticsCode | packingWorkCode | MEDIUM | mixed category dividers, packaging and logistics codes |
| 코드DB | L | 구분 | 색 상 | text | yes (485/487) | CodeLegend | typeHeading | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | M | A | B | text | yes (462/487) | CodeLegend | typeCode | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | N | 냉동용기 | 바코드 냉동용기 | text | yes (462/487) | CodeLegend | typeMeaning | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | O | extraMeaning | >(기존 휴케이에스 출고) | text | yes (485/487) | CodeLegend | extraMeaning | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | R | 구분 | A | text | yes (465/487) | CodeLegend | typeCode | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | S | typeMeaning | 냉동용기 | text | yes (466/487) | CodeLegend | typeMeaning | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | T | 색 상 | G | text | yes (482/487) | CodeLegend | colorCode | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | U | colorMeaning | 그레이 | text | yes (482/487) | CodeLegend | colorMeaning | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | W | 상품명 | [AC00] 냉동용기 점보 | text | yes (476/487) | CodeLegend | sourceItemName | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | X | 관리명 | AC00 | text | yes (476/487) | CodeLegend | managementName | LOW | separate lookup legends; row alignment with B:J is invalid |
| 코드DB | Y | 옵션 | 크림화이트 | text | yes (476/487) | CodeLegend | optionName | LOW | separate lookup legends; row alignment with B:J is invalid |
| 행사기획서 | A | No | 1 | number | yes (1/59) | CampaignPlanLine | sequence | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | B | 관리코드 | =IFERROR(_xlfn.XLOOKUP(C13,#REF!,#REF!),"") | formula | yes (1/59) | CampaignPlanLine | managementCode | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | C | 상품명 | blank | unobserved | yes (59/59) | CampaignPlanLine | productName | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | D | 채널상품코드 | 565115 | number | yes (25/59) | CampaignPlanLine | channelProductCode | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | E | 채널상품명 | 오집단독 아쿠아 입문용! 소분 냉동용기 3P세트 | text | yes (25/59) | CampaignPlanLine | channelProductName | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | F | 구분 | =IFERROR(_xlfn.XLOOKUP(C13,#REF!,#REF!),"") | formula | yes (39/59) | CampaignPlanLine | productType | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | G | 총원가 | =IFERROR(_xludf.XLOOKUP(C13,#REF!,#REF!),"") | formula | yes (33/59) | CampaignPlanLine | totalCost | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | H | 정상가 | 17600 | number | yes (25/59) | CampaignPlanLine | normalPrice | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | I | 상시가 | =IFERROR(_xludf.XLOOKUP(C14,#REF!,#REF!),"") | formula | yes (40/59) | CampaignPlanLine | everydayPrice | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | J | 행사가 | 13800 | number | yes (25/59) | CampaignPlanLine | eventPrice | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | K | 할인율 | 0.2159090909090909 | formula | yes (1/59) | CampaignPlanLine | discountRate | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | L | 자사부담  쿠폰액 | 0 | number | yes (1/59) | CampaignPlanLine | selfCoupon | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | M | 채널부담  쿠폰액 | 828 | formula | yes (39/59) | CampaignPlanLine | channelCoupon | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | N | 최종가 | 12972 | formula | yes (1/59) | CampaignPlanLine | finalPrice | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | O | 최종가  할인율 | 0.26295454545454544 | formula | yes (1/59) | CampaignPlanLine | finalDiscountRate | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | P | 수수료 | 0.15 | formula/number | yes (1/59) | CampaignPlanLine | feeRate | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | Q | 공급가 | 11026.199999999999 | formula | yes (1/59) | CampaignPlanLine | supplyPrice | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | R | 마진액 | 0 | formula | yes (1/59) | CampaignPlanLine | marginAmount | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | S | 마진률 | 0 | formula | yes (1/59) | CampaignPlanLine | marginRate | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | T | 배송/부대비용 | 0 | number | yes (1/59) | CampaignPlanLine | deliveryOtherCost | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | U | 실질마진액 | #VALUE! | formula | yes (1/59) | CampaignPlanLine | actualMarginAmount | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | V | 실질마진률 | 0 | formula | yes (1/59) | CampaignPlanLine | actualMarginRate | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | W | 목표수량 | blank | unobserved | yes (59/59) | CampaignPlanLine | targetQuantity | LOW | planned scenario, not transaction data; broken #REF formulas |
| 행사기획서 | X | 목표매출 | 0 | formula | yes (1/59) | CampaignPlanLine | targetSales | LOW | planned scenario, not transaction data; broken #REF formulas |
| 기획SIMUL | B | 단품 선택 | 점보  | text | yes (8/27) | Scenario | componentName | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | C | 수량 | 2 | number/formula | yes (16/27) | Scenario | quantity | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | D | 개, | 점보 2개, | formula | yes (8/27) | Scenario | displayText | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | E | 원가합 | 0 | formula | yes (8/27) | Scenario | componentCost | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | F | 단가정상가 | 0 | formula | yes (8/27) | Scenario | listUnitPrice | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | G | 원가합계 | 0 | formula | yes (8/27) | Scenario | extendedCost | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | H | 정상가합계 | 0 | formula | yes (8/27) | Scenario | extendedPrice | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | J | 채널수수료 | 총 구성수량 | text | yes (12/27) | Scenario | metricName | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | K | 0.06 | 27 | formula | yes (15/27) | Scenario | metricValue | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | M | 할인율 | 0.1 | number | yes (17/27) | Scenario | discountRate | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | N | 판매가 | 0 | formula | yes (17/27) | Scenario | salePrice | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | O | 최종쿠폰가 | 0 | formula | yes (17/27) | Scenario | postCouponPrice | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | P | 최종할인율 | #DIV/0! | formula | yes (17/27) | Scenario | finalDiscountRate | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | Q | 공급가 | 0 | formula | yes (17/27) | Scenario | supplyPrice | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | R | 실질마진액 | -5357 | formula | yes (17/27) | Scenario | actualMarginAmount | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
| 기획SIMUL | S | 실질마진률 | 0 | formula | yes (17/27) | Scenario | actualMarginRate | LOW | what-if calculator, not master or observed sale; broken #REF formulas |
