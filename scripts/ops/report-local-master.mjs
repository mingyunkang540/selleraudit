import { createHash } from 'node:crypto'
import { log } from 'node:console'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { createServer } from 'vite'

const [sourceArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !outputArg) throw new Error('Provide the source workbook and a new report path.')
const source = resolve(sourceArg)
const output = resolve(outputArg)
const bytes = await readFile(source)
const digest = createHash('sha256').update(bytes).digest('hex')
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { analyzeMasterWorkbook } = await vite.ssrLoadModule('/src/services/import/index.ts')
  const policy = await vite.ssrLoadModule('/src/services/import/localPolicy.ts')
  const result = await analyzeMasterWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'source.xlsx', {
    approvedBundleSkuCodes: policy.LOCAL_APPROVED_BUNDLE_SKUS,
    approvedSkuCategories: policy.LOCAL_APPROVED_SKU_CATEGORIES,
  })
  const issues = result.issues.filter(issue => issue.blockingScope === 'BATCH')
  const clean = value => String(value ?? '—').replaceAll('|', '\\|').replace(/\r?\n/g, ' / ')
  const lines = [
    '# Master 파일 검토 목록',
    '',
    '실제 Master에 적용하지 않은 분석 결과입니다. 원본 파일과 기존 저장 기록은 수정하지 않았습니다.',
    '',
    `- 분석 기준: ${policy.LOCAL_MASTER_PARSER_VERSION}`,
    `- 원본 SHA-256: ${digest}`,
    `- 차단 이슈: ${issues.length}건`,
    '- AL24의 실제 코드, 수량이 생략된 구성의 해석, 묶음 상품의 구성수 의미는 확인이 필요합니다.',
    '',
    '| 번호 | 시트 / 행 | 이슈 | 확인 내용 | 원본 값 |',
    '| ---: | --- | --- | --- | --- |',
    ...issues.map((issue, i) => `| ${i + 1} | ${clean(issue.sourceSheet)} / ${clean(issue.sourceRow)} | ${clean(issue.code)} | ${clean(issue.message)} | ${clean(issue.observedValue)} |`),
    '',
  ]
  await writeFile(output, lines.join('\n'), { encoding: 'utf8', flag: 'wx' })
  log(`Review report created: ${output}`)
} finally { await vite.close() }
