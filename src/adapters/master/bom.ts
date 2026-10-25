export interface ParsedBomToken {
  readonly skuCode: string
  readonly quantity: number
  readonly rawToken: string
  readonly validQuantity: boolean
}

export interface ParsedBom {
  readonly tokens: readonly ParsedBomToken[]
  readonly unparsedText: string
}

const BOM_TOKEN = /([★]?[A-Z][A-Z0-9]*)\s*(-?\d+(?:\.\d+)?)\s*개/g

export function parseBom(rawText: string): ParsedBom {
  const tokens: ParsedBomToken[] = []
  const unmatchedParts: string[] = []
  let previousEnd = 0

  for (const match of rawText.matchAll(BOM_TOKEN)) {
    const start = match.index ?? 0
    unmatchedParts.push(rawText.slice(previousEnd, start))
    const quantity = Number(match[2])
    tokens.push(Object.freeze({
      skuCode: match[1],
      quantity,
      rawToken: match[0].trim(),
      validQuantity: Number.isInteger(quantity) && quantity > 0,
    }))
    previousEnd = start + match[0].length
  }
  unmatchedParts.push(rawText.slice(previousEnd))

  return Object.freeze({
    tokens: Object.freeze(tokens),
    unparsedText: unmatchedParts.join('').replace(/[\s,，/+]/g, ''),
  })
}
