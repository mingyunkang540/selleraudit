# Master Workbook 원본 보관과 서버 검증 (5F)

## 신뢰 경계

Supabase 모드의 Master `.xlsx` 원본은 private `seller-audit-import-sources` bucket에 저장한다. bucket은 public이 아니며, 객체당 최대 50 MiB와 XLSX MIME type만 허용한다. 객체 경로는 서버 등록 RPC가 발급한 `<workspace_uuid>/<source_file_uuid>/source.xlsx`다. 사용자가 전달한 파일명은 이 경로에 쓰이지 않고 DB metadata에만 남는다. Mock 모드는 원본을 브라우저에서만 분석한다.

브라우저의 SHA-256은 **client-observed claim**이다. `register_master_import_source`가 ACTIVE ADMIN/EDITOR의 현재 멤버십과 파일명·크기·hash 형식을 검사한 뒤 `import_source_files`에 원본 ID와 정확한 경로를 등록한다. 브라우저는 해당 경로에 `upsert: false`로 최초 업로드만 할 수 있다. Storage INSERT RLS는 등록자, Workspace, `PENDING_UPLOAD`, 정확한 bucket/path를 다시 확인한다. 브라우저용 Storage SELECT/UPDATE/DELETE 정책은 없다.

`verify-master-import-source` Edge Function은 JWT로 사용자를 확인하고 DB에서 현재 Workspace 역할을 다시 읽는다. service-role key는 Edge 서버에서만 사용한다. 서버가 private object를 다운로드해 실제 byte 길이와 SHA-256을 계산하고, service-role 전용 `finalize_master_import_source_verification` RPC가 결과와 `IMPORT_SOURCE_VERIFIED` 로그를 원자적으로 기록한다. 크기가 다르거나 객체가 없으면 `VERIFICATION_FAILED`, hash가 다르면 `HASH_MISMATCH`, 일치하면 `VERIFIED`다. `VERIFIED` 재호출은 멱등이며 로그를 중복 생성하지 않는다. `HASH_MISMATCH`는 같은 등록을 재시도하지 않고 새 SourceFile이 필요하다.

`import_source_files`는 Workspace, 원래 파일명, bucket/path, content type, client-observed 크기/hash, server-verified 크기/hash/Storage object ID, 검증 상태·오류 코드, 등록자·검증자·시각을 보관한다. 원본 binary는 DB에 저장하지 않는다. ADMIN/EDITOR만 해당 Workspace metadata를 조회한다. VIEWER, DISABLED, 익명은 등록·검증·원본 상세·다운로드를 할 수 없다.

`create-master-source-download-url`은 ACTIVE ADMIN/EDITOR와 `VERIFIED` 상태를 확인한 뒤 60초 signed URL을 발급한다. 브라우저가 private path를 직접 읽는 경로는 열지 않는다. 발급된 URL은 만료 전에는 접근 수단이므로 로그나 ActivityLog에 저장하지 않는다.

Storage 업로드와 DB 등록·검증은 하나의 DB transaction이 아니다. 업로드 실패나 연결 중단 시 등록만 남거나 객체만 남을 수 있다. `VERIFICATION_FAILED`는 원인을 확인해 재검증할 수 있지만, 원본 byte가 바뀌었다면 새 SourceFile로 다시 등록해야 한다. 자동 삭제, retention scheduler, orphan sweep은 5F 범위 밖이다. 원격 인수 fixture는 기록한 source UUID와 정확한 object path 하나씩 대조한 뒤 삭제한다. prefix 또는 bucket 전체 삭제를 하지 않는다.

## 저장 및 Review 계약

새 중앙 저장은 `persist_verified_master_import_dry_run(workspace_id, source_file_id, summary, raw_rows, candidates, issues)`만 사용한다. RPC는 잠긴 SourceFile의 `VERIFIED` 상태를 검사하고 파일명과 hash를 **DB의 서버 검증값**에서 가져온다. 한 transaction에서 Batch, Raw, Candidate, Issue, ActivityLog를 저장하고 Batch를 SourceFile에 연결한다. Batch의 `source_hash_verification`은 `SERVER_VERIFIED`, 상태는 계속 `REVIEW_REQUIRED`다. 기존 7-argument client-hash persistence RPC의 browser EXECUTE는 제거했다.

5E 이전 Batch는 `CLIENT_OBSERVED`이고 `source_file_id`가 없다. 기록 조회는 유지하지만 새로운 Candidate/Issue review mutation은 거부한다. 검증된 Batch의 Review도 ADMIN만 저장할 수 있고 EDITOR는 읽기 전용이다. Review는 원본 ID, server SHA-256, parser version, validation revision을 근거로 한다. 원본이 바뀌면 새 SourceFile과 새 Batch, parser가 바뀌면 새 Batch가 필요하다. 향후 재검증에서 기존 Review를 새 판정의 근거로 자동 재사용하지 않는다. validation revision 2 생성, Approval, Apply는 구현하지 않았다.

DB metadata backup은 Storage binary backup이 아니다. Pilot 운영 전 Storage 객체의 별도 backup/restore rehearsal가 필요하다. 원본의 영구 보존이나 변조 불가능성을 보증하지 않는다.

구현은 [Migration](../../supabase/migrations/20261026121803_private_master_source_verification.sql), [권한 보완](../../supabase/migrations/20261026121915_move_5f_trusted_functions_private.sql), [Remote Acceptance](../SUPABASE_REMOTE_ACCEPTANCE.md)를 참고한다.
