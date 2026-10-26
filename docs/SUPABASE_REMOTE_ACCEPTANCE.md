# SellerAudit Supabase 원격 인수 결과

## 상태와 근거 범위

프로젝트 소유자는 2026-10-25 아래 원격 인수 결과를 제공했다. 이번 작업에서 read-only Supabase 연결로 프로젝트 identity와 현재 remote migration version 5개를 별도로 확인했다. Auth/RLS/RPC의 실제 동작 결과와 acceptance 데이터 cleanup은 프로젝트 소유자가 제공한 결과이며 이번 문서 작업에서 다시 실행하지 않았다.

| 항목 | 값 |
| --- | --- |
| Project | `selleraudit-dev` |
| Project ref | `yzpkhvuftusnshdqfnim` |
| Region | `ap-northeast-2` |
| Project status | `ACTIVE_HEALTHY` |
| 인수 일자 | 2026-10-25 |

read-only 연결로 확인한 remote migration version은 다음과 같다.

```text
20261009015155
20261010064046
20261010080630
20261025090000
20261025090001
```

## Prompt 5D 결과

```text
REMOTE SCHEMA: GO
REMOTE AUTH: GO
REMOTE RLS: GO
REMOTE IMPORT: GO
OVERALL REMOTE ACCEPTANCE: GO
```

프로젝트 소유자가 제공한 검증 범위:

- ACTIVE ADMIN, EDITOR, VIEWER 접근과 DISABLED VIEWER 거부
- Workspace A 접근과 별도 QA Workspace 격리
- ADMIN과 EDITOR의 `persist_master_import_dry_run` 성공
- VIEWER와 DISABLED의 persistence 거부
- VIEWER의 ImportBatch metadata 조회와 Raw·Validation Issue detail·ActivityLog 거부
- EDITOR의 Raw·Validation Issue detail 조회와 ActivityLog 거부
- ADMIN ActivityLog 조회
- malformed payload 실패 시 Batch·Raw·Issue·ActivityLog가 남지 않는 atomic rollback
- 브라우저 실제 로그인
- acceptance 전용 생성 데이터 cleanup

제공된 Security Advisor 결과에는 critical/high finding이 없었다. `Leaked Password Protection Disabled` warning은 Pilot 전 보안 작업으로 남긴다.

## Prompt 5E 경계

Prompt 5D 인수는 위 5개 Migration에 적용된다. 이후 Candidate Snapshot과 Human Review 구현을 증명하지 않는다.

5E의 Candidate Snapshot/Review, FK index, review 권한 잠금 Migration을 같은 Development 프로젝트에 적용해 remote migration list 8개가 저장소와 일치한다.

```text
20261025114440
20261025115414
20261026093754
```

Migration 적용 뒤 Security Advisor에서는 새 finding이 없었고 기존 `Leaked Password Protection Disabled` warning 한 건만 남았다. Performance Advisor가 Candidate main Raw composite FK의 미색인 INFO를 보고해 `20261025115414_index_import_candidate_raw_row_fk.sql`로 보완했고 해당 INFO가 해소됐다. 기존 테이블의 FK index INFO 2건과 unused index INFO는 별도 성능 정리 항목으로 남아 있다. `20261026093754_lock_import_review_authorization.sql`은 Candidate/Issue review 중 ADMIN membership과 Batch 행까지 잠가 권한 변경과 검토 저장을 직렬화한다. 원격 함수 정의에서 두 잠금을 확인했다.

## Prompt 5E DB Contract 결과

기존 ACTIVE ADMIN/EDITOR/VIEWER/DISABLED 사용자의 `user_id`를 JWT claim으로 재현한 `authenticated` role에서 다음을 원격 DB transaction으로 검증했다.

- ADMIN/EDITOR Candidate persistence PASS
- ADMIN Candidate review와 Issue review PASS
- EDITOR review DENY
- VIEWER/DISABLED persistence와 Candidate SELECT DENY
- Cross Workspace persistence DENY
- stale review revision DENY
- malformed Candidate 전체 rollback PASS
- `IMPORT_VALIDATED`와 `IMPORT_REVIEWED` ActivityLog 생성 PASS
- `products`, `skus`, `product_components` row count 불변 PASS

모든 fixture는 `BEGIN/ROLLBACK`으로 정리했다. 확인 시점의 acceptance Batch와 Candidate 잔여 행은 각각 0건이다. `products`, `skus`, `product_components`도 검증 전후 모두 0건으로 변하지 않았다.

이 검증은 원격 PostgreSQL의 role/RLS/RPC 계약을 확인한다. 추가로 기존 ADMIN, VIEWER, DISABLED 계정의 실제 이메일/비밀번호 Auth 로그인에 성공했다. ADMIN의 실제 사용자 토큰으로 Candidate와 Issue를 저장·조회했고, 브라우저에서 Candidate override와 Issue resolution을 기록했다. normalized value, Candidate status와 Batch의 `REVIEW_REQUIRED` 상태는 유지됐다. VIEWER와 DISABLED는 실제 사용자 토큰의 Candidate 조회·저장 RPC가 거부됐고 브라우저에서도 Import 접근이 차단됐다.

이 live 검증에서 만든 `__SELLERAUDIT_5E_ACCEPTANCE_ADMIN__1793006964342.xlsx` Batch 1건과 그 Candidate·Issue·Raw·ActivityLog를 정확한 ID와 생성자·파일명으로 대조한 뒤 정리했다. 정리 후 해당 Batch, Candidate, Issue 잔여 행은 모두 0건이다. 당시 EDITOR 자격증명 오류로 보류했던 실제 세션 검증은 아래와 같이 2026-10-26 완료했다. 비밀번호 값은 로그나 문서에 기록하지 않았다.

```text
REMOTE 5E ACCEPTANCE = GO
DB CONTRACT = PASS
LIVE AUTH / BROWSER = PASS (ADMIN, EDITOR, VIEWER, DISABLED)
```

2026-10-26 실제 EDITOR Auth 세션에서 `땡스소윤 DEV`의 ACTIVE EDITOR membership만 노출되고 `SellerAudit QA Workspace`가 보이지 않음을 확인했다. 같은 access token으로 7-argument Candidate persistence RPC를 호출해 Batch·Raw·Candidate·Validation Issue와 `IMPORT_VALIDATED`를 저장했다. Batch의 생성자와 Workspace, `REVIEW_REQUIRED`, validation revision 1을 확인했다. EDITOR는 네 종류의 상세 행을 읽을 수 있었고 ActivityLog 직접 조회는 거부됐다. 유효한 ID·revision·payload로 시도한 Candidate/Issue review는 모두 권한 때문에 거부됐으며, 두 행의 review metadata·normalized 값·상태는 변경되지 않았다. privileged 조회에서 해당 fixture의 `IMPORT_REVIEWED`는 0건이었다.

실제 EDITOR token의 Workspace 목록에는 존재하는 QA Workspace 행이 보이지 않았다. QA Workspace ID로 Batch·Raw·Candidate·Issue를 조회한 결과는 모두 0건이었고, 같은 ID로 persistence를 시도하면 거부됐다. privileged 조회상 QA Workspace의 해당 네 테이블에도 행이 0건이므로 상세 행 조회 결과만으로 RLS를 단독 입증하지는 않는다. 별도 DB 역할/RLS 계약 검증과 실제 Workspace 비노출·persistence 거부를 함께 근거로 삼았다. QA Workspace에는 검증용 fixture를 생성하지 않았다. 브라우저에서도 EDITOR 로그인, Master Import 접근, 저장된 Batch와 Candidate·Issue 상세 조회, review 제어의 읽기 전용 상태를 확인했다. 이 검증은 `scripts/remote-5e-editor-acceptance.mjs`를 사용했으며 비밀번호·token을 출력하거나 추적 파일로 저장하지 않았다.

검증용 Batch `9ba550cc-2931-4074-a050-224a0ef46b51`과 Raw·Candidate·Issue·ActivityLog의 정확한 ID, Workspace, EDITOR 생성자, 파일명을 대조한 뒤 한 transaction에서 해당 5개 행만 삭제했다. 사후 정확한 ID 조회는 모두 0건이었다. `products`, `skus`, `product_components`는 검증 전후 각각 0건이며, `channels`, `channel_listings`, `channel_offers`, `aliases`, `audit_issues`도 전후 0건이다. Security Advisor에는 새 finding이 없고 기존 `Leaked Password Protection Disabled` warning만 남았다.

로컬 `.env.remote-test.local.txt`는 Git에서 제외하며 테스트 계정의 이메일·비밀번호를 담는다. `node scripts/remote-5e-auth-check.mjs`로 네 계정의 실제 Auth 로그인과 표시 가능한 멤버십을 다시 검사하고, `node scripts/remote-5e-browser-roles.mjs`로 VIEWER·DISABLED의 브라우저 접근 차단을 다시 검사할 수 있다. 이 두 스크립트는 Import 기록을 생성하거나 삭제하지 않는다. EDITOR 인수 스크립트의 `api` 단계는 원격 fixture를 생성하므로 정확한 ID를 기록하고 수동 cleanup할 수 있을 때만 재실행한다.

`db reset --linked`를 실행하거나 기존 테스트 계정·Workspace를 삭제하지 않는다. Development 결과를 Production 인수로 취급하지 않는다.
