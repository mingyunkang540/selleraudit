# Pilot Master Apply v1 (6A)

SellerAudit Development의 첫 Master 반영 경로다. 서버 검증된 Master `.xlsx`의 저장된 Candidate를 읽어, 적용 미리보기를 계산한 다음 ACTIVE ADMIN의 명시적 확인으로 `products`, `skus`, `product_components`에만 새 행을 만든다. Production 배포와 기존 Master 수정·삭제는 범위 밖이다.

## 흐름과 권한

```text
원본 등록·private 업로드·서버 SHA-256 검증
→ 브라우저 Dry-run
→ Raw / Candidate / Issue 중앙 저장
→ 필요하면 ADMIN reviewed override 또는 Issue decision
→ read-only Master 적용 미리보기
→ ADMIN 확인
→ 한 transaction에서 Product → SKU → BOM 생성
→ 상품 Master / SKU / Product 360에서 조회
```

Preview는 ACTIVE ADMIN·EDITOR가 볼 수 있다. Apply는 ACTIVE ADMIN만 실행한다. VIEWER, INVITED, DISABLED, 익명 사용자와 다른 Workspace 사용자는 DB RPC에서 거부한다. 화면의 버튼 숨김은 사용성 조치이며 보안 경계는 RPC 권한·멤버십 재확인이다.

## 적용 규칙

Candidate의 effective value는 `normalized_values || reviewed_values`다. reviewed value의 명시적인 JSON `null`도 override로 취급한다. `candidate_status = VALID`만 적용 대상이다. WARNING, ERROR, DEFERRED는 각각 검토 필요·오류·보류로 제외하며 Human Review만으로 상태를 승격하지 않는다. Batch 범위의 OPEN 차단 이슈가 있으면 Apply 전체를 막는다.

| 종류 | 생성에 필요한 값 | 기존 값이 같으면 | 기존 값이 다르면 |
| --- | --- | --- | --- |
| Product | 비어 있지 않은 `sabangnetCode`, `productName`; `productType` SINGLE/SET | UNCHANGED | CONFLICT |
| SKU | 비어 있지 않은 `skuCode`, `modelName` | UNCHANGED | CONFLICT |
| BOM | 연결 가능한 Product·SKU, 양의 정수 `quantity` | UNCHANGED | CONFLICT |

Product는 `sabangnet_code`, `product_name`, `category`, `product_type`만 Candidate에서 매핑하고 `normal_price = NULL`, `status = ACTIVE`로 생성한다. SKU는 `sku_code`, `model_name`, `color`, `status = ACTIVE`를 저장한다. BOM은 `(workspace_id, product_id, sku_id, quantity)`를 저장한다. BOM의 `productSourceRow`가 같은 Batch의 Product Candidate를 가리키면 그 Candidate의 reviewed `sabangnetCode`를 따른다. 채널 반복 Product variant는 canonical source row의 Product를 사용하고 중복 Product를 만들지 않는다. 연결할 Product/SKU는 이번 transaction에서 생성됐거나 같은 Workspace Master에 이미 존재할 수 있다.

필수값이 부족하면 SKIPPED_INVALID, BOM 연결이 불가능하면 SKIPPED_DEPENDENCY다. 어떤 CONFLICT든 전체 Apply를 중단하고 기존 Master를 그대로 둔다. Preview는 읽기 전용 계산이며 Apply는 transaction 안에서 권한·Batch 상태·SourceFile 서버 hash·Issue·Candidate·Master 충돌을 다시 계산한다. Preview 시점 이후의 데이터 변경으로 Apply 결과가 달라지면 Apply 쪽 재검증이 우선한다.

## Source trust와 Batch 상태

Apply는 `source_hash_verification = SERVER_VERIFIED`, `source_file_id` 존재, 연결된 SourceFile의 `verification_status = VERIFIED`, 서버 계산 SHA-256과 Batch hash 일치를 요구한다. 과거 CLIENT_OBSERVED Batch는 적용할 수 없다.

이 Pilot은 `REVIEW_REQUIRED`에서 바로 `APPLIED` 또는 `PARTIALLY_APPLIED`로 전환한다. 모든 Candidate가 NEW/UNCHANGED면 APPLIED, 일부가 제외되면 PARTIALLY_APPLIED다. `READY_TO_APPLY`나 정식 Approval 단계는 없다. 적용 완료 Batch의 재실행은 거부하며 중복 row를 만들지 않는다. `applied_count`는 실제 NEW Candidate 수, `remaining_count`는 미적용 Candidate 수로 기록한다. `failed_count`는 SQL 실패 횟수로 사용하지 않는다. 성공 시 `IMPORT_APPLIED / IMPORT_BATCH` ActivityLog 한 건을 남긴다. transaction 실패나 conflict에서는 성공 로그를 남기지 않는다.

## 안전 경계

- CREATE ONLY: 기존 Product, SKU, BOM의 UPDATE·DELETE는 하지 않는다.
- `channels`, `channel_listings`, `channel_offers`, `aliases`, `audit_issues`에는 쓰지 않는다.
- 100526 중복, AL24 미등록 SKU, BOM 수량 불일치, AL510 중간 묶음의 기존 ERROR/WARNING/DEFERRED 판정을 자동 NEW로 승격하지 않는다.
- validation revision 2, review carry-forward, Storage 자동 backup/retention, Production 배포는 이번 단계에서 하지 않는다.

로컬·원격 인수 결과와 정확한 테스트 fixture 정리는 [원격 인수 기록](../SUPABASE_REMOTE_ACCEPTANCE.md)을 따른다.
