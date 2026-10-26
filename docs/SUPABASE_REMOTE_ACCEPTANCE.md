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

이 live 검증에서 만든 `__SELLERAUDIT_5E_ACCEPTANCE_ADMIN__1793006964342.xlsx` Batch 1건과 그 Candidate·Issue·Raw·ActivityLog를 정확한 ID와 생성자·파일명으로 대조한 뒤 정리했다. 정리 후 해당 Batch, Candidate, Issue 잔여 행은 모두 0건이다. `SELLERAUDIT_EDITOR_EMAIL`/`SELLERAUDIT_EDITOR_PASSWORD`로 로그인하면 Supabase Auth가 `invalid_credentials`를 반환해 EDITOR의 실제 사용자 세션 인수는 아직 실행하지 못했다. 비밀번호 값은 로그나 문서에 기록하지 않았다.

```text
REMOTE 5E ACCEPTANCE = HOLD
DB CONTRACT = PASS
LIVE AUTH / BROWSER = PARTIAL (ADMIN, VIEWER, DISABLED PASS; EDITOR PENDING)
```

GO로 변경하려면 EDITOR 계정의 로컬 자격증명을 바로잡아 실제 사용자 세션에서 Candidate persistence/조회와 review 거부를 확인하고, 필요한 cross-Workspace 경계를 브라우저/Data API로 다시 확인해야 한다. 생성한 fixture는 매번 정확한 ID로 정리한다.

로컬 `.env.remote-test.local.txt`는 Git에서 제외하며 테스트 계정의 이메일·비밀번호를 담는다. `node scripts/remote-5e-auth-check.mjs`로 네 계정의 실제 Auth 로그인과 표시 가능한 멤버십을 다시 검사하고, `node scripts/remote-5e-browser-roles.mjs`로 VIEWER·DISABLED의 브라우저 접근 차단을 다시 검사할 수 있다. 이 두 스크립트는 Import 기록을 생성하거나 삭제하지 않는다.

`db reset --linked`를 실행하거나 기존 테스트 계정·Workspace를 삭제하지 않는다. Development 결과를 Production 인수로 취급하지 않는다.
