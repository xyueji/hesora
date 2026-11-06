import { describe, expect, it } from 'vitest'
import { buildCsv, csvEscape, parseCsv } from '../../src/shared/csv'

describe('csvEscape', () => {
  it('普通值原样返回', () => {
    expect(csvEscape('abc')).toBe('abc')
    expect(csvEscape(123)).toBe('123')
    expect(csvEscape(null)).toBe('')
  })

  it('含逗号/引号/换行时加引号并转义内部引号', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('a"b')).toBe('"a""b"')
    expect(csvEscape('a\nb')).toBe('"a\nb"')
    expect(csvEscape('a,b"c')).toBe('"a,b""c"')
  })
})

describe('buildCsv', () => {
  it('以 BOM 开头，行以 CRLF 结尾', () => {
    const csv = buildCsv(['a', 'b'], [['1', '2'], ['3', '4']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toBe('\ufeffa,b\r\n1,2\r\n3,4\r\n')
  })

  it('字段转义后的构建', () => {
    const csv = buildCsv(['名称', '备注'], [['商品,A', null]])
    expect(csv).toContain('"商品,A"')
    expect(csv).toContain('"商品,A",') // null → 空字段
  })
})

describe('parseCsv', () => {
  it('解析简单行与多种换行', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('解析引号字段：逗号、换行、转义引号', () => {
    const rows = parseCsv('a,"b,1","c""q""","多\n行"')
    expect(rows).toEqual([['a', 'b,1', 'c"q"', '多\n行']])
  })

  it('去除 BOM', () => {
    const rows = parseCsv('\ufeffa,b\nc,d')
    expect(rows[0]).toEqual(['a', 'b'])
  })

  it('构建后解析可往返', () => {
    const headers = ['编码', '名称', '备注']
    const data = [['A001', '商品,甲', '含"引号"\n与换行']]
    const rows = parseCsv(buildCsv(headers, data))
    expect(rows).toEqual([headers, data[0]])
  })

  it('空字段与 null', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']])
    const csv2 = buildCsv(['h'], [[null]])
    expect(csv2.endsWith('\r\n')).toBe(true)
  })
})
