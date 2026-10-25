import { captureMasterWorkbook } from '../../adapters/master'
import { MasterImportParseError, type MasterImportPreview } from '../../types/import'
import { validateMasterCapture } from './masterValidator'

export async function analyzeMasterWorkbook(input: ArrayBuffer, fileName: string): Promise<MasterImportPreview> {
  if (!fileName.toLocaleLowerCase('en-US').endsWith('.xlsx')) {
    throw new MasterImportParseError('UNSUPPORTED_FILE_TYPE', '현재 Master Dry-run은 .xlsx 파일만 지원합니다.')
  }
  if (input.byteLength === 0) {
    throw new MasterImportParseError('WORKBOOK_READ_FAILED', '파일을 분석하지 못했습니다.')
  }

  try {
    const capture = captureMasterWorkbook(input)
    return validateMasterCapture(capture, fileName)
  } catch (error) {
    if (error instanceof MasterImportParseError) throw error
    throw new MasterImportParseError('WORKBOOK_READ_FAILED', '파일을 분석하지 못했습니다.')
  }
}

export type { MasterImportPreview } from '../../types/import'
