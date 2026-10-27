# Pilot Master Safe Update v1 (6B)

6B는 [6A Pilot Apply](PILOT_MASTER_APPLY.md)의 서버 검증 SourceFile, Candidate eligibility, 역할 및 Workspace 경계를 유지하면서 반복 Master Workbook의 제한된 값 변경을 허용한다. Preview는 읽기 전용이며 Apply는 ACTIVE ADMIN이 명시적으로 확인한 뒤 서버가 현재 Master를 다시 비교하여 한 transaction에서 실행한다.

| Master | Business key | 신규 | 안전 변경 | 충돌 또는 제외 |
| --- | --- | --- | --- | --- |
| Product | `workspace_id + sabangnet_code` | `NEW` | 동일 `product_type`에서 `product_name`, `category`만 `UPDATE` | `product_type` 변경은 `CONFLICT` |
| SKU | `workspace_id + sku_code` | `NEW` | `model_name`, `color`만 `UPDATE` | 필수값·구조 문제는 기존 보수적 판정 유지 |
| BOM | `workspace_id + product_id + sku_id` | `NEW` | `quantity`만 `UPDATE` | Product/SKU 연결 불명확은 `SKIPPED_DEPENDENCY` |

비교값이 모두 같으면 `UNCHANGED`다. Candidate effective value는 `normalized_values`에 `reviewed_values`를 덮어쓴 값이며 명시적인 JSON `null`도 override로 유지한다. `candidate_status = VALID`만 NEW·UPDATE·UNCHANGED 대상이다. WARNING, ERROR, DEFERRED는 6A와 같이 제외한다. Batch 범위 OPEN 차단 이슈 또는 하나의 CONFLICT라도 있으면 Apply 전체를 거부한다.

Preview는 종류별 신규·변경·동일·충돌·제외 수와 UPDATE 대상 필드의 `before`/`after`만 반환한다. 원본 셀, 파일 byte, Auth 정보, review note, token, 서명 URL은 diff에 넣지 않는다. 변경할 NEW/UPDATE가 없으면 Apply를 실행하지 않는다.

Apply는 Product, SKU, BOM 순서로 INSERT 또는 허용된 필드의 UPDATE를 수행한다. 기존 UUID, business key, 상태, Product type, 가격, 생성 시각은 유지한다. SQL 실패나 로그 실패는 Master·Batch·ActivityLog 전체를 rollback한다. 각 UPDATE마다 실제 Master UUID에 연결된 `MASTER_PRODUCT_UPDATED`, `MASTER_SKU_UPDATED`, `MASTER_BOM_UPDATED` ActivityLog를 기록하고, Batch에는 `IMPORT_APPLIED` 요약 로그를 한 건 기록한다. `applied_count`는 6B부터 NEW + UPDATE Candidate 수, `remaining_count`는 미적용 Candidate 수다. 제외가 없으면 `APPLIED`, 있으면 `PARTIALLY_APPLIED`이며 완료 Batch 재실행은 거부한다.

새 Workbook에서 기존 행이 빠져도 삭제하거나 비활성화하지 않는다. Product 품번 또는 SKU 코드 변경은 기존 행의 rename이 아닌 새 business key로 해석한다. 기존 행은 그대로 남는다. Product type 자동 변경, merge/split, alias 생성, 정식 Approval, `READY_TO_APPLY`, validation revision 2, Production 배포는 범위 밖이다.

개발 프로젝트의 실제 인수와 exact-ID fixture 정리 결과는 [원격 인수 기록](../SUPABASE_REMOTE_ACCEPTANCE.md)에 기록한다.
