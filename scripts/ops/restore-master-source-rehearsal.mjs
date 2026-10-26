/* global process */
import { assert, loadOps, restoreSource, safeError } from './_shared/sourceRecovery.mjs'

const args = process.argv.slice(2)
async function main() {
  assert((args.length === 2 || args.length === 3) && args[0] === '--source-file-id' &&
    (args.length === 2 || args[2] === '--delete-first'), 'USAGE_SOURCE_FILE_ID_REQUIRED')
  const { admin, env } = await loadOps()
  const result = await restoreSource(admin, env, args[1], { deleteFirst: args.length === 3 })
  process.stdout.write(`RESTORE VERIFIED sourceFileId=${result.source.id} bucket=${result.source.storage_bucket} ` +
    `objectPath=${result.source.storage_object_path} sha256=${result.manifest.backupSha256} ` +
    `bytes=${result.manifest.backupByteSize} state=${result.state}\n`)
}
main().catch(error => { process.stderr.write(`RESTORE HOLD code=${safeError(error)}\n`); process.exitCode = 1 })
