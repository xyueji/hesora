// 零依赖 CSV 工具：导出（BOM + CRLF）与 RFC4180 风格解析。
const BOM = '\ufeff'

export const PRODUCT_IMPORT_COLUMNS = ['编码', '名称', '基本单位', '零售价', '批发价', '进价', '追踪方式']
export const OPENING_STOCK_IMPORT_COLUMNS = ['商品编码', '数量', '成本单价', '批次号']

/** 转义单个字段：包含逗号/引号/换行时加双引号，内部引号翻倍。 */
export function csvEscape(v: string | number | null): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** 生成 CSV 文本：\ufeff BOM 开头，行以 CRLF 结尾。 */
export function buildCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [headers, ...rows].map((r) => r.map(csvEscape).join(','))
  return BOM + lines.join('\r\n') + '\r\n'
}

/** 解析 CSV 文本为二维数组：去 BOM；支持引号字段内嵌逗号/换行/转义引号；行分隔 \r\n 或 \n。 */
export function parseCsv(text: string): string[][] {
  let s = text.startsWith(BOM) ? text.slice(1) : text
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    rows.push(row)
    row = []
  }
  while (i < s.length) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      endField()
      i++
      continue
    }
    if (ch === '\r' && s[i + 1] === '\n') {
      endRow()
      i += 2
      continue
    }
    if (ch === '\n' || ch === '\r') {
      endRow()
      i++
      continue
    }
    field += ch
    i++
  }
  // 末尾若有内容（或未闭合引号），作为最后一行
  if (field !== '' || row.length > 0) endRow()
  // 丢弃末尾完全为空的行（来自结尾换行符）
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!
    if (last.length === 1 && last[0] === '') rows.pop()
    else break
  }
  s = ''
  return rows
}
