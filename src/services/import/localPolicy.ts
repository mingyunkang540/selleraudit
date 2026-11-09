// Only codes and source categories explicitly confirmed by the workbook owner are accepted.
export const LOCAL_APPROVED_BUNDLE_SKUS = ['AL502', 'AL510'] as const
export const LOCAL_APPROVED_SKU_CATEGORIES = ['기타', '스티커', '박스(부자재)', '아이스 땡스보틀', '로켓배송'] as const
export const LOCAL_SKU_COMPONENTS = {
  AL502: [{skuCode:'AL05',quantity:1},{skuCode:'A02',quantity:1}],
  AL510: [{skuCode:'AL05',quantity:1},{skuCode:'AL10',quantity:6}],
} as const
export const LOCAL_NON_COUNTED_SKUS = ['SP22','E01'] as const
export const LOCAL_MASTER_PARSER_VERSION = 'master-v1.0.0+local-approved-skus-v4'
