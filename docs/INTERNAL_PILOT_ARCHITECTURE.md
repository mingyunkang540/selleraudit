# SellerAudit Internal Pilot Architecture (Prompt 2.1, 설계안)

이 문서는 [Data Model V2 Proposal](data/DATA_MODEL_V2_PROPOSAL.md)의 업무 Entity와 RAW → NORMALIZED → MASTER 경계를 유지하면서 땡스소윤 내부 파일럿의 인증·권한·운영 경계를 정의한다. Workspace Role/Status, Supabase Auth·중앙 Repository, Import Batch/Raw/Candidate/Issue persistence와 ActivityLog가 로컬에 구현됐다. `selleraudit-dev`에는 7개 Migration이 적용됐고 5E 역할별 DB contract는 통과했다. 실제 이메일/비밀번호 Auth 브라우저 인수와 회사 배포는 아직 완료되지 않았다.

## 1. 현재 상태와 목표 구조

`workspaces`와 `(workspace_id, user_id)` PK를 가진 `workspace_members`는 재사용한다. Migration은 `ADMIN/EDITOR/VIEWER`, `INVITED/ACTIVE/DISABLED`, ACTIVE 기반 RLS와 trusted RPC의 역할 검사를 적용한다. 실제 Supabase/Auth 통합은 구현됐지만 운영 데이터를 넣거나 직원을 초대하기 전에 아래 Pilot Gate의 남은 항목을 완료해야 한다.

```text
직원 브라우저 (HTTPS)
  → 정적 SellerAudit Web App
  → Supabase Auth (직원별 로그인/세션)
  → RLS/신뢰된 RPC (매 요청의 활성 Workspace 멤버십·역할 확인)
  → 중앙 PostgreSQL (Workspace별 업무 데이터·ActivityLog)
```

한 직원은 둘 이상의 Workspace에 속할 수 있다. 브라우저의 선택 Workspace는 쿼리 범위일 뿐 권한 증거가 아니다. 실제 접근 가능 여부는 `auth.uid()`와 대상 행의 `workspace_id`를 기준으로 DB의 **현재 ACTIVE 멤버십**에서 판단한다. 땡스소윤은 첫 Workspace일 뿐 사용자 수나 Workspace 수를 스키마에 고정하지 않는다. 파일럿 규모는 소수 직원(예: 3~5명)으로 제한해 검증하되 이 숫자를 코드의 권한 조건으로 쓰지 않는다.

## 2. Authentication과 Workspace Membership

**추천: Supabase Auth 이메일/비밀번호 + 관리자 초대/프로비저닝.** 공개 Sign Up을 끄고, 신뢰된 관리자 경계에서 사용자를 초대한다. 직원은 로그인, 로그아웃, 세션 갱신, 비밀번호 재설정을 이용한다. 비밀번호와 재설정 토큰은 앱 DB나 ActivityLog에 저장하지 않는다. 초기 계정/Workspace 생성은 운영자가 신뢰된 경계에서 수행하고, 이후 초대·역할 변경은 ADMIN용 신뢰된 API/RPC가 처리한다. Auth 관리용 비밀 키는 브라우저에 전달하지 않는다. Google/Kakao/Naver 로그인, MFA, SSO는 파일럿 뒤로 미룬다.

Auth User는 **신원**, WorkspaceMember는 **Workspace별 권한**이다. 한 Auth User의 두 Workspace 멤버십은 서로 독립적인 역할과 상태를 가질 수 있다. 새 `workspace_members.status`는 `INVITED`, `ACTIVE`, `DISABLED`이며 기존 행만 `ACTIVE`로 변환하고 신규 행은 `INVITED`가 기본값이다. `updated_at`은 역할·상태 변경 시 갱신된다. `created_at`은 유지한다. 초대 시각·가입 시각·비활성 시각은 향후 ActivityLog의 타임스탬프로 추적하고, 실제 운영에서 별도 검색/정책 수요가 확인되면 컬럼을 추가한다. 초대된 Auth 사용자 ID가 확인된 뒤 `INVITED` 멤버십을 만들고, 이메일 확인과 관리자 승인 절차가 끝난 후 신뢰된 경계에서 `ACTIVE`로 바꾼다. `INVITED`와 `DISABLED`는 업무 데이터 읽기/쓰기가 모두 거부된다. 이미 존재하는 Auth 사용자의 다른 Workspace 초대도 공개 가입이 아닌 관리자 작업이다.

퇴사 또는 Workspace 접근 해제는 우선 멤버십을 `DISABLED`로 바꾼다. 계정 전체 차단이 필요하면 Auth 관리자 차단도 병행하지만, **기존 액세스 토큰의 만료 전 유효성에 기대지 않고** 모든 RLS/업무 RPC에서 DB의 현재 멤버십을 재확인해야 한다. 로그아웃은 세션 정리이며 권한 회수의 유일한 수단이 아니다. 마지막 ACTIVE ADMIN을 비활성화·강등·삭제하는 작업은 원자적으로 거부한다. 동시 역할 변경은 해당 멤버십/Workspace를 잠그거나 동등한 직렬화 절차로 처리하고 변경 직전 ADMIN 수를 다시 확인한다.

현재 Auth FK가 `ON DELETE CASCADE`인 `workspace_members`와 달리 과거 ActivityLog는 사용자 삭제로 사라져서는 안 된다. 기본 운영은 소프트 비활성화다. 법적 삭제 절차로 Auth User를 실제 삭제할 때는 ActivityLog의 `actor_user_id`를 nullable `ON DELETE SET NULL`로 두고, 별도의 무작위·Workspace 범위 `actor_ref` 스냅샷으로 행위의 연속성을 보존한다. 이메일/표시명은 로그에 기본 저장하지 않으며, 삭제 요청 시 `actor_ref` 재식별 가능성·보존 기간도 개인정보 정책으로 재평가한다.

## 3. Authorization / Role Model

회사 직급을 역할로 쓰지 않는다. 역할은 `ADMIN`, `EDITOR`, `VIEWER` 세 가지이며, 멤버십이 `ACTIVE`일 때만 아래 권한을 행사한다. **읽기**는 RLS+GRANT, **쓰기**는 기존 RPC 경계를 확장하거나 신뢰된 backend/RPC의 서버 측 검증으로 처리한다. 버튼 숨김은 사용성일 뿐 보안 경계가 아니다. `service_role`·Auth admin secret은 서버에만 두고 브라우저의 role claim이나 전달된 `workspace_id`를 신뢰하지 않는다.

| Action | ADMIN | EDITOR | VIEWER |
| --- | :---: | :---: | :---: |
| Dashboard/Product/SKU/Channel/Sales/Marketing/Audit 조회 | 허용 | 허용 | 허용 |
| Import Batch/검증 결과 조회 | 허용 | 허용 | 허용¹ |
| Import 업로드·Dry-run·snapshot 저장 | 허용 | 허용 | 거부 |
| Candidate override·Issue decision | 허용 | 읽기 전용 | 거부 |
| Import 승인·Apply/재적용 | 허용 | 거부 | 거부 |
| Offer Mapping/Alias 변경 | 허용 | 허용 | 거부 |
| Audit Issue 상태 변경 | 허용 | 허용 | 거부 |
| ActivityLog 조회 | 허용 | 거부 | 거부 |
| 사용자 초대·비활성화 | 허용 | 거부 | 거부 |
| Role 변경 | 허용 | 거부 | 거부 |
| Workspace 설정·보안 변경 | 허용 | 거부 | 거부 |

¹ 원본 셀/파일과 내부 검증 상세에는 민감한 데이터가 있을 수 있다. VIEWER에게는 정제된 배치 상태/요약만 노출하고 RawImportRow·원본 파일 접근은 ADMIN/EDITOR로 제한한다. Workspace 삭제는 파일럿 UI에서 누구에게도 열지 않고 별도 운영 절차로 보류한다.

`workspace_members.role`은 **text + CHECK**다. 세 고정 값에 충분하고, enum은 값 변경/제거가 번거로우며 별도 roles table은 아직 필요 없는 동적 RBAC을 만든다. Prompt 5A Migration은 기존 `OWNER → ADMIN`, `ADMIN → ADMIN`, `MEMBER → VIEWER`를 **보수적 초깃값**으로 변환한다. OWNER/ADMIN 중복 또는 MEMBER의 실제 편집 필요성은 운영자가 확인해 조정한다. 기존 `MEMBER`의 편집 권한을 무단 승계하지 않는다. CHECK 교체와 데이터 변환은 한 트랜잭션으로 수행한다. 이후 기본 Role은 `VIEWER`로 두고 초대한 관리자가 명시적으로 높인다.

새 Migration은 모든 현재/신규 업무 테이블의 `workspace_id`와 `ACTIVE` 멤버십 기반 조회 경계를 적용하고, `workspace_members` 자체 읽기는 자기 ACTIVE 멤버십만 허용한다. 기존 `map_offer`와 `update_issue_status`도 대상 행을 잠그고 `ACTIVE + ADMIN/EDITOR`를 DB에서 검사하도록 개정했다. 사용자 관리와 Import 승인은 후속 신뢰된 경계에서 `ACTIVE + ADMIN`을 확인해야 한다. `SECURITY DEFINER`는 RLS를 우회할 수 있으므로 함수 내부의 멤버십·role·대상 Workspace 검증과 최소 GRANT가 필수다. 권한 회수 직후 기존 세션으로 조회/RPC를 시도하는 거부 테스트, A/B Workspace 교차 접근 테스트, VIEWER 직접 RPC 호출 테스트를 로컬 DB 계약에 포함했다.

## 4. Activity Logging

`AuditIssue`는 시스템이 발견한 가격 불일치·미매칭 같은 **업무 문제**, `ImportValidationIssue`는 원본 수용 과정의 **검증 문제**, `ActivityLog`는 사용자의 **행위 기록**이다. 수명과 접근 권한이 달라 합치지 않는다. 모든 조회/클릭은 기록하지 않는다.

| 필드 | 권장 계약 |
| --- | --- |
| `id`, `workspace_id` | UUID PK와 테넌트 키 |
| `actor_user_id`, `actor_ref` | 검증된 `auth.uid()`의 nullable FK, 삭제 후에도 남는 무작위 식별자 |
| `action_type` | 허용된 액션 코드 |
| `entity_type`, `entity_id` | 변경 대상 종류/ID; 삭제·복합 대상은 상관 ID로 보완 |
| `changed_fields` | 허용 목록의 필드별 `{before, after}` JSONB; 변경 없는 이벤트는 빈 객체 |
| `correlation_id`, `created_at` | 한 Import/명령의 이벤트 연결 ID와 서버 시각 |

전체 `before_data`/`after_data` 스냅샷은 디버깅이 쉽지만 원본 셀, 개인정보, 토큰이 복제되고 저장량·삭제 비용이 커진다. **파일럿은 변경 필드만 허용 목록으로 저장**한다. 예를 들어 Offer 매핑은 `master_product_id`의 이전/새 UUID, Audit은 `status`의 이전/새 값만 기록한다. 원본 파일·RawImportRow·비밀번호·토큰·이메일·민감 메모는 넣지 않는다. 중요한 행위의 상세 재현은 별도 업무 행과 Import Batch/Raw의 권한 관리된 원본을 참조한다. 로그는 앱 사용자에게 append-only이며 ADMIN만 Workspace 범위에서 읽고, 직접 INSERT/UPDATE/DELETE는 거부한다. 보존 기간과 export/delete 정책은 실제 데이터/법무 검토 후 확정한다.

최소 action: `IMPORT_CREATED`, `IMPORT_VALIDATED`, `IMPORT_REVIEWED`, `IMPORT_APPLIED`, `IMPORT_FAILED`, `IMPORT_CONFLICT_RESOLVED`, `OFFER_MAPPED`, `OFFER_REMAPPED`, `ALIAS_CHANGED`, `AUDIT_STATUS_CHANGED`, `PRODUCT_PROMOTED`, `WORKSPACE_MEMBER_INVITED`, `WORKSPACE_MEMBER_ROLE_CHANGED`, `WORKSPACE_MEMBER_DISABLED`. 성공한 쓰기와 로그는 **동일 트랜잭션**에서 commit/rollback한다. Import 실패는 실패한 트랜잭션이 rollback된 뒤 신뢰된 경계에서 별도 트랜잭션으로 `IMPORT_FAILED`와 제한된 오류 코드·correlation ID를 기록한다. 로그 기록 실패 시 성공한 업무 쓰기를 단독 commit하지 않는다. actor는 클라이언트 인자가 아니라 검증된 Auth 컨텍스트에서 도출한다. 자동 작업은 별도 신뢰된 시스템 actor 규칙을 수립한 뒤 기록한다.

## 5. Import 권한과 중앙 Persistence

초기 파일럿은 **정책 B: EDITOR는 업로드·Dry-run·snapshot 저장과 shared review 조회까지, ADMIN만 reviewed override와 Issue decision**을 채택한다. 승인·Apply는 5E 범위에 없다. Dry-run과 Human Review는 Master 쓰기가 없는 단계다. `ImportBatch`, `RawImportRow`, `ImportCandidate`, `ImportValidationIssue`의 변경은 신뢰된 경계에서만 처리한다. 상세 계약은 [Import Contract](data/IMPORT_CONTRACT.md)와 [Candidate Review](data/IMPORT_CANDIDATE_REVIEW.md)를 따른다.

운영 Persistence 추천은 **전용 managed Supabase 프로젝트의 PostgreSQL + Auth**다. 기존 스키마와 RLS·RPC 설계를 재사용할 수 있다. 실제 연결 전에는 현재 SQL 및 후속 Pilot Migration을 개발 프로젝트에서 적용/검증해야 한다. UI는 `SellerRepository` 계약의 운영 구현체를 통해 중앙 데이터를 읽고, 쓰기 후 관련 목록을 refetch/invalidate한다. 다른 직원의 화면은 재조회/주기 갱신으로 변경을 관찰하도록 먼저 설계하고, Supabase Realtime은 요구와 부하가 확인된 후 선택한다. 즉시 push 동기화를 약속하지 않는다. 동시 수정은 원자적 RPC와 `updated_at`/version 기반 충돌 감지로 보호하고, 오래된 화면의 마지막 쓰기 덮어쓰기를 거부·재검토하게 한다.

`MockRepository`/localStorage는 Development, Demo Mode, 오프라인 UI 테스트에 남겨둘 수 있다. **내부 파일럿의 실제 데이터에는 사용하지 않는다.** Demo와 운영 데이터의 저장 위치·화면 상태를 분리하고, Demo 데이터를 운영 DB로 자동 동기화하지 않는다.

## 6. 배포와 Docker

권장 파일럿은 브라우저용 정적 프런트엔드를 안정적인 HTTPS 호스팅에 배포하고, 데이터/Auth는 전용 managed Supabase 프로젝트에 둔다. 직원별 설치나 특정 Windows 버전이 필요 없다. 파일럿 주소 접근 범위는 회사의 네트워크/계정 정책으로 제한하고, 브라우저에는 공개 가능한 Supabase URL/anon key만 넣는다. 비밀 키와 관리자 초대 API는 trusted backend에 둔다.

회사 상시 켜진 PC 또는 소형 서버로 **정적 프런트엔드만** 호스팅하는 대안도 가능하다. 초기 비용이 낮고 내부망에 둘 수 있지만 PC가 꺼지면 웹 앱 접속이 중단된다. 클라우드 DB는 별도로 살아 있어도 직원은 화면에 접속할 수 없다. 재부팅·Windows Update·IP 변경·내부 DNS/TLS·모니터링·접근 제어의 담당자가 필요하며 장기 운영 기준으로 고정하지 않는다. 자격증명과 세션을 다루므로 단순 HTTP 내부망을 기본안으로 삼지 않고 TLS를 제공한다.

managed Supabase와 정적 호스팅 파일럿에는 **Docker가 필요 없다**. Docker는 정적 배포의 재현성을 높일 수 있지만 이미지/패치 운영 부담을 추가한다. DB/Auth까지 자체 호스팅해야 한다는 명시적 요구가 생기면 컨테이너 기반 self-host를 별도 설계할 수 있으나, 백업·업데이트·보안·가용성 책임이 회사에 옮겨간다. 프로덕션에서도 managed 서비스를 쓰면 Docker는 필수가 아니며, 별도 백엔드가 생길 때 배포 수단 중 하나로 판단한다.

| 단계 | Persistence / Auth | 배포와 종료 조건 |
| --- | --- | --- |
| Development | Mock/localStorage; 별도 개발 Supabase는 통합 검증용 | Vite 로컬 실행; 실사용 데이터 금지 |
| Internal Pilot | 전용 중앙 Postgres + Supabase Auth, Workspace/Role/Log | HTTPS 정적 웹, 소수 초대 직원; 아래 Gate 통과 |
| Internal Production | 안정화된 중앙 DB/Auth, 백업·복구·모니터링 | 안정 도메인/TLS, 장애 대응 주체와 목표 |
| SaaS Beta | 별도 production 프로젝트, 다중 Workspace/초대/Role | 테넌트 격리·온보딩·운영 검증 |
| SaaS Production | production DB/Auth, 복구·관측 운영 | Billing/구독/사용량 제한은 후속 제품 결정 |

## 7. Backup / Recovery

DB의 업무·Raw 행은 제공 플랜의 백업/PITR 기능과 보존 기간을 **실제 계약에서 확인**하고, 파일럿 시작 전에 백업 주기·보존·담당자를 문서화한다. 관리형 DB 백업은 Storage에 둔 원본 파일을 포함하지 않으므로 Excel/CSV 원본은 접근 제한된 별도 저장소에 암호화 보관하고 독립 백업한다. `RawImportRow`도 Import 재현을 위해 승인된 retention 동안 보존한다. 사용자 다운로드와 업로드 경로에 민감정보가 남지 않도록 한다.

파일럿 전에는 격리된 복원 환경에 DB를 복구하고, Workspace/멤버십/Import 원본 참조/ActivityLog와 핵심 Product–SKU–BOM 관계를 읽어 복원 성공을 검증한다. DB와 파일 백업의 시점을 맞춰 원본 누락을 확인한다. 담당자는 허용 가능한 데이터 손실(RPO), 복구 시간(RTO), 보존 기간, 백업 암호화·키 관리 및 복원 절차를 확정한다. 숫자는 운영 요구를 듣기 전 임의로 보장하지 않는다. 백업 존재만으로 Gate를 통과하지 않는다.

## 8. SaaS 이전과 실행 순서

PostgreSQL 테이블의 Workspace 키·복합 FK·RLS 경계를 유지하면 Pilot에서 SaaS로 갈 때 Product/SKU/BOM 등의 **도메인 스키마를 새로 만들 필요는 없다**. 다만 SaaS 전용 프로젝트로 데이터 이동, Auth 사용자/세션·초대 이전, 비밀 키 교체, 파일 원본 이전, Workspace별 검증, rollback 계획은 별도 작업이다. Auth 사용자 ID와 FK 연속성은 이전 경로에 따라 검증하고, 보장할 수 없으면 재초대/ID 매핑을 계획한다. Pilot DB를 공개 SaaS 프로젝트로 곧바로 승격하지 않는다. 테넌트별 RLS/GRANT/RPC 거부 테스트를 실제 Supabase Auth/Data API까지 확장한다.

순서는 (1) V0.2 Import 구조와 **로컬** dry-run/승격 계약 설계·검증, (2) 전용 개발 Supabase에서 Auth·Role·ActivityLog·active membership·중앙 Repository 및 RLS/DB 계약 구현, (3) Pilot Gate와 백업 복원 리허설, (4) 실제 직원 초대와 실제 데이터 Import, (5) 안정화 후 Sales/Marketing 확장이다. 파일럿 전에 V0.3의 모든 Logistics/Price/Cost 기능을 완료할 필요는 없다. 반대로 **실제 공유 데이터 입력과 직원 접속은 보안/중앙 저장소가 완성되기 전 금지**한다. Prompt 3의 상세 Import Contract는 별도 요청 시 설계할 수 있지만 이 문서에서 착수하지 않는다.

## 9. Pilot Readiness Gate

아래 항목은 모두 **구현과 증거**가 있어야 통과한다. 이 문서 작성만으로는 어느 항목도 완료되지 않는다.

- [ ] 전용 중앙 DB와 `SellerRepository` 운영 구현체가 실제 직원 브라우저 간 같은 Product를 공유하며, 쓰기 후 다른 세션에서 재조회로 보인다.
- [ ] 공개 가입이 꺼지고 이메일 로그인/로그아웃/비밀번호 재설정/초대·비활성화 흐름이 검증된다.
- [ ] 모든 기존/신규 테이블의 RLS·GRANT와 RPC가 `ACTIVE` 멤버십 및 Workspace/Role을 검사한다. A/B Workspace 교차 조회·쓰기, DISABLED 기존 토큰, VIEWER의 `map_offer` 직접 호출이 거부된다.
- [ ] ADMIN/EDITOR/VIEWER Matrix와 마지막 ADMIN 보호·역할 변경 경쟁 조건을 통합 테스트한다.
- [ ] 변경 성공과 ActivityLog가 원자적이며 ADMIN만 Workspace 로그를 읽는다. 사용자 비활성화/삭제 후 과거 로그가 남는다.
- [ ] Import Dry-run/검토와 ADMIN 승인/Apply, 충돌 차단, 재적용 방지, 실패 기록이 검증된다. 실제 원본의 미확정 Product/SKU/BOM은 승격하지 않는다.
- [ ] DB·원본 파일 백업의 보존/담당자/RPO/RTO를 정하고 격리 환경 복원 리허설을 통과한다.
- [ ] HTTPS·접근 제어·안정 주소·장애 대응 담당자를 확인하고 브라우저 빌드에 `service_role`/Auth admin secret이 없음을 검사한다.
- [ ] 핵심 E2E, 실제 Supabase Auth/Data API 통합, DB/RLS 계약과 회귀 테스트가 통과한다.

## 10. 공식 근거와 범위

Supabase의 [Auth 사용자/관리자 초대](https://supabase.com/docs/guides/auth/users), [비밀번호 로그인/재설정](https://supabase.com/docs/guides/auth/passwords), [공개 가입 설정](https://supabase.com/docs/guides/auth/general-configuration), [세션](https://supabase.com/docs/guides/auth/sessions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [관리형 백업](https://supabase.com/docs/guides/platform/backups), [self-hosting](https://supabase.com/docs/guides/self-hosting)을 검토했다. 백업 제공 범위와 Auth 세션 동작은 사용 플랜/설정과 구현 시점에 다시 확인한다.

| 분류 | 결정 |
| --- | --- |
| KEEP | `Workspace`와 기존 도메인 Entity/Workspace isolation 원칙 |
| EXTEND | `WorkspaceMember`의 Role/상태/갱신 시각, 모든 RLS/RPC의 활성 멤버·역할 검사, 운영 `SellerRepository` |
| NEW | `ActivityLog`, 파일럿 Auth·프로비저닝·중앙 운영 경계 |
| DEFER | 소셜 로그인/MFA/SSO, 동적 RBAC·roles table, Realtime, 자체 DB 호스팅/Docker, Billing/사용량 제한 |
