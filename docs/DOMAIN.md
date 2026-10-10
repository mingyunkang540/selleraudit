# SellerAudit Domain Rules

이 문서는 SellerAudit의 Product, SKU, 채널 데이터 관계를 정의하는 기준입니다. UI, 저장소, Import 설계와 데이터베이스 변경은 다음 규칙을 유지해야 합니다.

## 1. 사방넷 품번은 판매상품 Master 코드다

`Product.sabangnetCode`는 사용자가 판매상품을 식별하는 기준 코드입니다. 예시 `100051`은 판매상품 Master를 가리키며 SKU 코드가 아닙니다.

## 2. AL00, AQ01 등은 실제 물류·재고 SKU다

`Sku.skuCode`는 입출고와 재고가 움직이는 최소 실물 단위입니다. `AL00`, `AQ01`과 같은 코드를 사용합니다.

## 3. P000, SET001 계열 코드는 사용하지 않는다

Product를 `P000`, `SET001` 같은 별도 가상 SKU 코드로 표현하지 않습니다. 판매상품은 사방넷 품번, 실제 물류 단위는 SKU 코드로 구분합니다.

## 4. Product와 SKU는 서로 다른 Entity다

Product는 고객에게 판매하는 상품 Master이고 SKU는 실제 물류·재고 단위입니다. 두 Entity의 코드, 상태와 수명 주기를 합치지 않습니다.

## 5. Product와 SKU는 BOM으로 연결한다

`ProductComponent`가 Product와 SKU를 연결하며 `quantity`로 구성 수량을 기록합니다. 구성이 확인된 단품 Product는 BOM 한 행으로 SKU와 연결합니다. 예를 들어 Product `100051 점보 쿨라벤더 1개`는 SKU `AL00 × 1`로 구성됩니다.

## 6. Channel Listing은 채널 상품 페이지다

`ChannelListing`은 한 채널에 등록된 상품 페이지를 나타냅니다. 채널 상품번호, 노출 상품명, URL과 동기화 시각은 Listing에 속합니다.

## 7. Channel Offer는 실제 판매 옵션 또는 판매 단위다

`ChannelOffer`는 Listing 안에서 고객이 실제로 구매하는 옵션 또는 판매 단위입니다. 옵션 코드, 옵션명, 판매자 코드, 가격과 연결된 Product는 Offer에 속합니다. 옵션이 없는 상품은 `channelOptionId = 'BASE'`를 사용합니다.

## 8. 하나의 Listing에 여러 Product가 존재할 수 있다

세트나 옵션형 채널 페이지에서는 Listing 하나 아래의 여러 Offer가 서로 다른 Product Master에 연결될 수 있습니다. 따라서 Listing과 Product를 1:1로 가정하지 않고 매핑은 Offer 단위로 저장합니다.

## 9. 실제 SCM 데이터는 RAW → NORMALIZED → MASTER로 처리한다

향후 Import는 원본을 보존하는 `RAW`, 소스별 차이를 정리한 `NORMALIZED`, SellerAudit의 Product·SKU·BOM·Listing·Offer로 반영하는 `MASTER` 단계를 따릅니다. 변환 경계와 오류 기록을 건너뛰고 원본 파일을 Master 테이블에 직접 쓰지 않습니다.

## 10. 실제 SCM 파일 확인 전에는 Adapter와 Import schema를 추측하지 않는다

컬럼 이름, 인코딩, 코드 규칙, 옵션 표현, 파일 간 관계는 실제 원본 파일로 확인해야 합니다. 그 전에는 Excel/CSV parser, 채널별 Adapter, Import History, 자동매칭 또는 Audit 탐지 규칙을 구현하지 않습니다. 현재 `src/adapters/`는 interface boundary만 제공합니다.

## Channel code rule

`ChannelCode`는 비어 있지 않은 채널 식별 문자열이며 NAVER, COUPANG 같은 현재 시드 목록에 제한되지 않습니다. `WCONCEPT`, `CUSTOM_MARKET` 또는 신규 자체몰을 추가하기 위해 도메인 타입을 수정해서는 안 됩니다. 데이터 유효성은 코드가 비어 있지 않은지, 워크스페이스에 해당 Channel이 존재하는지, 관계 Entity의 `workspaceId`가 일치하는지로 검증합니다.

## Write boundary

현재 브라우저 데모는 `SellerRepository`의 `mapOffer`, `updateIssueStatus`를 통해서만 상태를 변경합니다. 향후 Supabase 구현체는 각각 `map_offer`, `update_issue_status` RPC를 호출해야 합니다. React 컴포넌트가 Offer, Alias 또는 Audit Issue 테이블을 직접 수정하지 않습니다.
