/* global process */
import { assert, backupSource, loadOps, safeError } from './_shared/sourceRecovery.mjs'

const args = process.argv.slice(2)
async function main() {
  assert(args.length === 2 && args[0] === '--source-file-id', 'USAGE_SOURCE_FILE_ID_REQUIRED')
  const { admin } = await loadOps()
  const result = await backupSource(admin, args[1])
  process.stdout.write(`BACKUP VERIFIED sourceFileId=${result.source.id} directory=${result.directory} ` +
    `sha256=${result.manifest.backupSha256} bytes=${result.manifest.backupByteSize}\n`)
}
main().catch(error => { process.stderr.write(`BACKUP HOLD code=${safeError(error)}\n`); process.exitCode = 1 })
