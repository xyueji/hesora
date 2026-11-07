// 打印 HTML 模板（纯函数，无 Electron 依赖，可在 Node/Vitest 中直接测试）。
// 生成自包含 HTML：小票（58mm 热敏）与 A4 单据。所有动态值必须经 escapeHtml 转义。

export interface ReceiptItemPrintRow {
  name: string
  spec?: string
  unit: string
  qty: number
  price: number
  amount: number
}

export interface ReceiptPrintData {
  widthMm?: 58 | 80
  shopName: string
  docNo: string
  date: string
  items: ReceiptItemPrintRow[]
  total: number
  paymentMethod: string
  remark: string
  footer: string
}

export interface A4PrintData {
  title: string
  shopName: string
  partnerName: string
  warehouseName: string
  warehouseInName?: string
  docNo: string
  date: string
  items: ReceiptItemPrintRow[]
  stocktakeItems?: Array<{
    name: string
    spec: string
    unit: string
    bookQty: number
    actualQty: number
    difference: number
  }>
  total: number
  remark: string
  printDate: string
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmt(n: number): string {
  return Number(n).toFixed(2)
}

function esc(s: string | null | undefined): string {
  return escapeHtml(String(s ?? ''))
}

/** 58mm 热敏小票：等宽字体、窄边距、明细逐行"名称 数量x单价 金额"。 */
export function renderReceiptHtml(data: ReceiptPrintData): string {
  const width = data.widthMm === 80 ? 80 : 58
  const rows = data.items
    .map(
      (it) => `<tr>
  <td colspan="2">${esc(it.name)} ${esc(it.spec)}</td>
</tr>
<tr>
  <td>${esc(it.unit)} ${fmt(it.qty)} x ${fmt(it.price)}</td>
  <td class="r">${fmt(it.amount)}</td>
</tr>`
    )
    .join('\n')
  const payLine = data.paymentMethod ? `<div class="line">收款方式：${esc(data.paymentMethod)}</div>` : ''
  const remarkLine = data.remark ? `<div class="line">备注：${esc(data.remark)}</div>` : ''
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(data.docNo)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${width}mm; max-width: 100%; padding: 0 3mm; font-family: 'Courier New', monospace, sans-serif; font-size: 11px; color: #000; }
  h1 { font-size: 15px; text-align: center; margin-bottom: 4px; }
  .meta, .line { line-height: 1.5; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 1px 0; }
  td.r { text-align: right; }
  .total { font-size: 14px; font-weight: bold; text-align: right; }
  .footer { text-align: center; margin-top: 8px; }
  @page { margin: 0; }
</style>
</head>
<body>
<h1>${esc(data.shopName)}</h1>
<div class="meta">单号：${esc(data.docNo)}</div>
<div class="meta">日期：${esc(data.date)}</div>
<hr>
<table>
${rows}
</table>
<hr>
<div class="total">合计：¥${fmt(data.total)}</div>
${payLine}
${remarkLine}
<div class="footer">${esc(data.footer)}</div>
</body>
</html>`
}

/** A4 单据：表格式明细 + 头部信息 + 打货人/收货人签字行。 */
export function renderA4Html(data: A4PrintData): string {
  const rows = (data.stocktakeItems ?? data.items).map((it, i) => {
    const numbers = 'bookQty' in it ? [it.bookQty, it.actualQty, it.difference] : [it.qty, it.price, it.amount]
    return `<tr>
  <td>${i + 1}</td>
  <td>${esc(it.name)}</td>
  <td>${esc(it.spec)}</td>
  <td>${esc(it.unit)}</td>
  ${numbers.map((value) => `<td class="r">${fmt(value)}</td>`).join('')}
</tr>`
  }).join('\n')
  const columns = data.stocktakeItems ? ['账面数量', '实盘数量', '差异'] : ['数量', '单价', '金额']
  const remarkLine = data.remark ? `<div class="remark">备注：${esc(data.remark)}</div>` : ''
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(data.title)} ${esc(data.docNo)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Microsoft YaHei', sans-serif; font-size: 12px; color: #000; padding: 10mm 12mm; }
  h1 { font-size: 18px; text-align: center; margin-bottom: 2px; }
  .shop { text-align: center; color: #444; margin-bottom: 10px; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #000; padding: 4px 6px; }
  th { background: #f0f0f0; }
  td.r, th.r { text-align: right; }
  .total { text-align: right; font-weight: bold; margin-bottom: 8px; }
  .remark { margin-bottom: 8px; }
  .sign { display: flex; justify-content: space-between; margin-top: 24px; }
  @page { size: A4; margin: 0; }
</style>
</head>
<body>
<h1>${esc(data.title)}</h1>
<div class="shop">${esc(data.shopName)}</div>
<div class="meta">
  <span>往来单位：${esc(data.partnerName) || '—'}</span>
  <span>仓库：${esc(data.warehouseName) || '—'}</span>
  ${data.warehouseInName ? `<span>调入仓库：${esc(data.warehouseInName)}</span>` : ''}
  <span>单号：${esc(data.docNo)}</span>
  <span>日期：${esc(data.date)}</span>
</div>
<table>
<thead>
<tr>
  <th style="width:36px">序号</th>
  <th>商品名称</th>
  <th>规格</th>
  <th style="width:70px">单位</th>
  ${columns.map((label) => `<th class="r" style="width:90px">${label}</th>`).join('')}
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
${data.stocktakeItems ? '' : `<div class="total">合计：¥${fmt(data.total)}</div>`}
${remarkLine}
<div class="sign">
  <span>打货人：＿＿＿＿＿＿</span>
  <span>收货人：＿＿＿＿＿＿</span>
</div>
<div style="margin-top:16px; color:#666;">打印时间：${esc(data.printDate)}</div>
</body>
</html>`
}
