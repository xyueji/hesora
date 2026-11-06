import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { PageResult } from '../../../shared/types/common'
import type { FundAccount, FundAccountQuery, FundAccountType } from '../../../shared/types/fund'

export type DB = Database

const VALID_TYPES: FundAccountType[] = ['cash', 'bank', 'wechat', 'alipay', 'other']

interface FundAccountRow {
  id: number
  code: string
  name: string
  type: string
  opening_balance: number
  remark: string | null
  disabled: number
}

function requireText(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new BizError('VALIDATION', `${field}不能为空`)
  }
  return v.trim()
}

function toEntity(row: FundAccountRow): FundAccount {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as FundAccountType,
    opening_balance: row.opening_balance,
    remark: row.remark ?? undefined,
    disabled: row.disabled === 1
  }
}

export function createFundService(db: DB) {
  const insertFund = db.prepare(`
    INSERT INTO fund_account (code, name, type, opening_balance, remark)
    VALUES (@code, @name, @type, @opening_balance, @remark)
  `)

  function assertNameFree(name: string, excludeId?: number): void {
    const row = db.prepare('SELECT id FROM fund_account WHERE name = ?').get(name) as
      | { id: number }
      | undefined
    if (row && row.id !== excludeId) {
      throw new BizError('DUP_CODE', '账户名称已存在')
    }
  }

  function nextCode(): string {
    const row = db.prepare('SELECT COUNT(*) AS c FROM fund_account').get() as { c: number }
    return `FA${String(row.c + 1).padStart(3, '0')}`
  }

  function assertTypeValid(type: string): void {
    if (!VALID_TYPES.includes(type as FundAccountType)) {
      throw new BizError('VALIDATION', `不支持的账户类型：${type}`)
    }
  }

  function getById(id: number): FundAccount | null {
    const row = db.prepare('SELECT * FROM fund_account WHERE id = ?').get(id) as
      | FundAccountRow
      | undefined
    if (!row) return null
    return toEntity(row)
  }

  return {
    create(f: Omit<FundAccount, 'id'>): number {
      const name = requireText(f.name, '名称')
      assertTypeValid(f.type)
      let id = 0
      db.transaction(() => {
        assertNameFree(name)
        const code = f.code !== undefined && f.code !== '' ? requireText(f.code, '编码') : nextCode()
        id = Number(
          insertFund.run({
            code,
            name,
            type: f.type,
            opening_balance: f.opening_balance ?? 0,
            remark: f.remark ?? null
          }).lastInsertRowid
        )
      })()
      return id
    },

    update(id: number, f: Partial<FundAccount>): void {
      db.transaction(() => {
        const existing = db.prepare('SELECT id FROM fund_account WHERE id = ?').get(id) as
          | { id: number }
          | undefined
        if (!existing) throw new BizError('NOT_FOUND', '资金账户不存在')

        const cols: string[] = []
        const vals: Record<string, unknown> = {}
        if (f.code !== undefined && f.code !== '') {
          cols.push('code = @code')
          vals['code'] = requireText(f.code, '编码')
        }
        if (f.name !== undefined) {
          const name = requireText(f.name, '名称')
          assertNameFree(name, id)
          cols.push('name = @name')
          vals['name'] = name
        }
        if (f.type !== undefined) {
          assertTypeValid(f.type)
          cols.push('type = @type')
          vals['type'] = f.type
        }
        if (f.opening_balance !== undefined)
          cols.push('opening_balance = @opening_balance'),
            (vals['opening_balance'] = f.opening_balance)
        if (f.remark !== undefined) cols.push('remark = @remark'), (vals['remark'] = f.remark)
        if (cols.length > 0) {
          cols.push("updated_at = datetime('now','localtime')")
          vals['id'] = id
          db.prepare(`UPDATE fund_account SET ${cols.join(', ')} WHERE id = @id`).run(vals)
        }
      })()
    },

    getById,

    disable(id: number): void {
      db.prepare(
        "UPDATE fund_account SET disabled = 1, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
    },

    enable(id: number): void {
      db.prepare(
        "UPDATE fund_account SET disabled = 0, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
    },

    remove(_id: number): void {
      throw new BizError('IN_USE', '资金账户不允许删除，请停用')
    },

    query(q: FundAccountQuery): PageResult<FundAccount> {
      const pageSize = Math.min(Math.max(Math.trunc(Number(q.pageSize) || 20), 1), 200)
      const page = Math.max(Math.trunc(Number(q.page) || 1), 1)
      const where: string[] = []
      const params: Record<string, unknown> = {}
      if (!q.includeDisabled) where.push('disabled = 0')
      if (q.keyword) {
        where.push('(code LIKE @kw OR name LIKE @kw)')
        params['kw'] = `%${q.keyword}%`
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS c FROM fund_account ${whereSql}`)
            .get(params) as { c: number }
        ).c
      )
      const rows = db
        .prepare(
          `SELECT * FROM fund_account ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`
        )
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as FundAccountRow[]
      return { list: rows.map(toEntity), total }
    }
  }
}

export type FundService = ReturnType<typeof createFundService>
