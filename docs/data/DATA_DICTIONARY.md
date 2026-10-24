# SellerAudit Data Dictionary v1

This is a read-only inventory of the four supplied business workbooks, inspected on 2026-10-24. It describes source evidence and candidate mappings; it does not approve a schema, define an import contract, or load data. The actual master and sales filenames omit the `(1)` and `(2)` suffixes named in the work prompt. Source files remain outside this repository.

## Identity rules retained from the Foundation

| Concept | Source evidence | Candidate identity | Status |
| --- | --- | --- | --- |
| Selling Product | Master `단가표!B6=100051`, `E6=점보` | `Product.sabangnetCode` | VERIFIED, with duplicate/collision exceptions in the source. |
| Physical SKU | Master `코드DB!E23=AL00`, `C23=점보`, `D23=라벤더` | `Sku.skuCode` | VERIFIED for this example; not every code in `코드DB` is an inventory SKU. |
| Physical SKU | Master `코드DB!E60=AQ01`, `C60=1호`, `D60=아쿠아`; barcode `단품!C45=AQ01` | `Sku.skuCode` | VERIFIED for this example: `AQ01` is the 1호 아쿠아 unit, barcode `8809866423136`. |
| Product composition | Master `단가표!F6=AL00 1개` | `ProductComponent` candidate | LIKELY as a whole workbook; textual BOM requires reconciliation. |
| Name-mapping code | Master `상품DB!C4=P000` | Legacy alias/reference only | VERIFIED as a separate namespace; it is **not** the Product master key. |

`Product ≠ SKU`. Existing `Product`, `Sku`, `ProductComponent`, `ChannelListing`, `ChannelOffer`, `Alias` and `AuditIssue` remain the Foundation contract ([domain](../DOMAIN.md), [database](../DATABASE.md)). The new files supply evidence for possible cost, barcode, sales and advertising concepts only; no entity is added in this step.

## Column dictionary locations

The source analysis documents contain the column-level dictionary, including source column, example, business meaning, data type, nullability, candidate entity/field, confidence (`HIGH`, `MEDIUM`, `LOW`) and limitations. Sheets with several independent blocks are kept separate; same-row values across those blocks must not be treated as one record.

| Source file | Detailed column dictionary | Primary grain |
| --- | --- | --- |
| `★★땡스소윤_전체 상품 단가표_마스터파일_ver00.xlsx` | [Master source](MASTER_SOURCE_ANALYSIS.md#source-dictionary-master-workbook) | Product/channel row, plus independent reference and planning blocks. |
| `땡스소윤 냉동용기 바코드 Update 260930.xlsx` | [Barcode source](BARCODE_SOURCE_ANALYSIS.md) | See source analysis. |
| `★2026년 땡스소윤 매출 데이터.xlsx` | [Sales source](SALES_SOURCE_ANALYSIS.md) | See source analysis; date semantics depend on channel/report. |
| `★2026년 땡스소윤 광고 데이터.xlsx` | [Advertising source](AD_SOURCE_ANALYSIS.md) | See source analysis; do not presume product-level grain. |

### Cross-source field index

This table brings the fields that determine identity, joins and reporting grain together. The linked source tables above contain **every other meaningful column**, including cost components, pricing tiers, channel codes, barcode variants, normalized names, report-only fields and empty advertising templates. `M`, `B`, `S`, `A` below abbreviate the four Source File names in the order of the table above; candidate entities/fields are not necessarily implemented.

| Source File | Sheet | Source Column | Example | Business Meaning | Data Type | Nullable | Candidate Entity | Candidate Field | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M | 단가표 | B `사방넷품번` | `100051` | selling Product code | code/text | yes, 3/215 | Product | `sabangnetCode` | HIGH | 27 excess occurrences; `100526` conflict. |
| M | 단가표 | E `모델명` | `점보` | Product/model display name | text | no | Product | `productName` | HIGH | Not a key. |
| M | 단가표 | F `구성 상세` | `AL00 1개` | textual BOM | text | no | ProductComponent candidate | `skuCode`, `quantity` | MEDIUM | Eight count mismatches; needs controlled parsing. |
| M | 단가표 | R `총원가` | `5940` | workbook total cost | decimal money | no | ProductCost candidate | `totalCost` | HIGH | Basis/effective date unknown. |
| M | 단가표 | S `정상가` | `13300` | list price | decimal money | no | Product | `normalPrice` | HIGH | Reference price, not transaction price. |
| M | 코드DB | E `상품코드` | `AL00` | inventory/logistics code | text | yes by row type | Sku candidate | `skuCode` | MEDIUM | `AL00` identifies lavender jumbo; registry mixes other code types. |
| B | 단품 | C `상품코드` | `AL00` | physical single-unit code | text | no, 51/51 | Sku candidate | `skuCode` | HIGH | All 51 values match master 코드DB!E. |
| B | 단품 | E `바코드` | `8809866420050` | EAN-13 for the single unit | text after normalization | no, 51/51 | BarcodeIdentifier candidate | `barcode` | HIGH | Other pack-level sheets can reuse code with different barcode. |
| S | 로우데이터 | A `주문일자` | `2026-01-01` | channel-dependent source/reporting date | Excel date/text | no | SalesFact candidate | `sourceDate`, `dateBasis` | HIGH | Not universally an order date. |
| S | 로우데이터 | B `쇼핑몰명` | `자사몰` | source sales channel label | text | no | Channel candidate | `channelId` via alias | HIGH | 22 labels; canonical mapping unverified. |
| S | 로우데이터 | C `상품명+옵션` | `땡스소윤 냉동용기 점보(3200ml) 쿨라벤더` | source product/option name | text | yes, 1,174 | SalesFact candidate | `sourceProductOptionName` | HIGH | No Product FK. |
| S | 로우데이터 | D `상품명_색상` | `점보 쿨라벤더` | normalization lookup key | text | yes, 2 | Alias candidate | `sourceNormalizedKey` | HIGH | 91.96% of non-null rows match master 상품DB!E. |
| S | 로우데이터 | E `옵션별칭` | `AL00` | optional SKU/BOM-like text | text | yes, 3,788 | SalesFact staging | `sourceOptionAlias` | MEDIUM | Can contain several codes, not a verified FK. |
| S | 로우데이터 | F `수량` | `1` | source sale quantity | integer | no | SalesFact candidate | `quantity` | HIGH | 79 zero-quantity rows have positive amount. |
| S | 로우데이터 | G `결제금액` | `12600` | row payment/sales amount | integer or numeric text | no | SalesFact candidate | `grossSales` | HIGH | Seven negative text cells omitted by SUMIFS. |
| A | 자사몰 | C `날짜` | `2026-10-01` | daily report date | Excel date | no, 91/91 | MarketingDailyFact candidate | `reportingDate` | HIGH | Attribution basis not stated. |
| A | 자사몰 | H `브랜드검색 노출` | `919` | ad impressions | integer | yes, 13/91 | MarketingDailyFact candidate | `impressionCount` | HIGH | Only 13 active dates. |
| A | 자사몰 | M `브랜드검색 매출` | `14318900` | attributed sales amount | decimal money | yes, 13/91 | MarketingDailyFact candidate | `attributedSales` | MEDIUM | Not directly comparable to source order/payment amount. |
| A | 자사몰 | O `브랜드검색 광고비` | blank | ad spend | decimal money candidate | yes, 91/91 | MarketingDailyFact candidate | `adSpend` | MEDIUM | No observed value; ROAS is `#DIV/0!`. |

## Key findings and relationship register

| Relationship | Grade | Evidence and limitation |
| --- | --- | --- |
| Product Master ↔ SKU | LIKELY | Master `단가표!F` and `코드DB!E` share code vocabulary. The specific `100051 → AL00×1` path is directly observed, but workbook-wide SKU identity and all compositions are not validated. |
| Product ↔ BOM | LIKELY | `단가표!F` lists component codes and quantities, but eight rows disagree with stated count `H`; one code `AL24` lacks exact `코드DB!E` match. |
| SKU ↔ Barcode / Logistics Unit | LIKELY | All 51 barcode `단품!C` codes have literal matches in master `코드DB!E`; `AL00` maps to `단품!E15=8809866420050`. Other barcode sheets reuse codes across pack levels, and official SKU scope is unconfirmed. See [barcode analysis](BARCODE_SOURCE_ANALYSIS.md). |
| Product ↔ Sales Row | LIKELY | Sales has no direct Product key. Its normalized key `로우데이터!D` exactly matches master `상품DB!E` in 115,174/125,240 non-null rows (91.96%), but that name table has no FK to master `단가표!B`. `E=AL00` provides a worked candidate route for `100051`; it is not a general FK. |
| Product ↔ Sales direct key | NOT POSSIBLE | No Sabangnet code, channel item ID or order ID appears in the Sales row. |
| Product ↔ Price / Cost | VERIFIED | Within the master snapshot, `단가표!B6/R6/S6 = 100051/5940/13300`; no effective date or cost-basis confirmation. |
| Sales ↔ Channel | LIKELY | `로우데이터!B` has 22 source channel labels used by the reports, but each needs explicit mapping to SellerAudit `Channel.channelCode`. |
| Advertising ↔ Product | NOT POSSIBLE | No Product code, listing/offer ID, product name or option name appears in the advertising workbook. |
| Sales ↔ Advertising | UNVERIFIED | Advertising has only sheet/date-level metrics for 13 days and no Product, listing or order key. A channel/date comparison may become possible after sales date-basis and channel mapping are settled. |

## Key suitability by source

| Source and grain | Best observed key | Why a tempting alternative fails |
| --- | --- | --- |
| Master `단가표`, product/channel row | Source file + sheet + physical row for lossless staging. `B` is the **candidate** Product business key after reconciliation. | `B` has 27 excess occurrences across 212 non-null values; `100526` names seven different sets. `(B, AH channel)` still collides six times. |
| Barcode workbook, physical barcode/pack row | Source file + sheet + physical row for lossless staging. `단품!C` is a SKU candidate. | 393 barcodes contain only 380 unique values across sheets; 21 product codes are reused for separate single-pack/carton barcodes. |
| Sales `로우데이터`, source sales row | Source file + sheet + physical row for lossless staging. | No order or order-line ID. Even full `A:G` repeats in 11,164 groups with 57,649 excess rows; value-based deduplication would discard potentially real sales. |
| Advertising `자사몰`, daily/media metric | Sheet + reporting date + media group is a candidate after unpivoting. | Date alone will repeat across channel sheets; Product/SKU/order/campaign IDs are absent. Only 13 dates have brand-search metrics, and ad spend is missing. |

`단가표!R/S` can relate to an existing Product candidate, but historical cost/price facts, barcode identifiers and daily marketing measures have no direct Foundation entity. They remain **candidate** concepts for Prompt 2. `광고 데이터` has no product code or name, so advertising-to-Product matching is **NOT POSSIBLE** from the supplied file alone. Its channel/date comparison with Sales is only a prospective aggregate comparison, not order or product attribution.

## Dates and money are source-specific

The sales workbook uses different date bases for different channels. Its `로우데이터` has 125,242 rows, but no order ID or order-line ID, so row uniqueness cannot be elevated to a transaction primary key. Workbook notes explicitly identify 스마트스토어(도착보장) as `PAYMENT_DATE`, 쿠팡(로켓배송) as `EXPECTED_INBOUND_DATE`, and other covered channels as Sabangnet `ORDER_DATE`. 컬리(샛별배송) has a January `PAYMENT_DATE` note only; later months must stay `OTHER`/unverified until supported. Retain `source_date`, `date_basis` and a separately governed `reporting_date` as **proposal**, without implementing it here. See the [sales analysis](SALES_SOURCE_ANALYSIS.md) for sheet- and month-level evidence.

The advertising `날짜` is a reporting date column, but the ad attribution basis is not stated. Its brand-search sales amount is therefore not directly comparable to sales order, payment, expected-inbound, or settlement amounts. Master prices are reference offers rather than observed transaction prices; costs lack an effective date. Do not infer a single currency/tax/return treatment across these files.

The existing [SCM export analysis](../SCM_SOURCE_ANALYSIS.md) describes a different set of channel listing exports. It remains separate from these four business workbooks.
