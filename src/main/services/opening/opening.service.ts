import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type {
  OpeningPayload,
  OpeningStatus
} from '../../../shared/types/opening'
import { createInventoryService } from '../inventory/inventory.service'
import { createSettingService } from '../setting/setting.service'

export type DB = Database

const DONE_KEY = 'opening.done'

export function createOpeningService(db: DB) {
  const settings = createSettingService(db)
  const inventory = createInventoryService(db)

  const updateCustomer = db.prepare(
    'UPDATE customer SET opening_receivable = ? WHERE id = ?'
  )
  const updateSupplier = db.prepare(
    'UPDATE supplier SET opening_payable = ? WHERE id = ?'
  )

  return {
    save(payload: OpeningPayload): void {
      if (settings.get(DONE_KEY) === '1') {
        throw new BizError('OPENING_DONE', '期初已建账，不能再修改')
      }
      // better-sqlite3 nests transactions via SAVEPOINT, so calling
      // inventory.applyChanges (which opens its own transaction) inside this
      // outer transaction is safe: any failure rolls back everything.
      db.transaction(() => {
        const changes = payload.inventory.map((line) => ({
          product_id: line.product_id,
          warehouse_id: line.warehouse_id,
          batch_no: line.batch_no,
          change_qty: line.qty,
          unit_cost: line.unit_cost,
          source: 'opening' as const
        }))
        if (changes.length > 0) inventory.applyChanges(changes)
        for (const c of payload.customers) updateCustomer.run(c.receivable, c.customer_id)
        for (const s of payload.suppliers) updateSupplier.run(s.payable, s.supplier_id)
        settings.set(DONE_KEY, '1')
      })()
    },

    getStatus(): OpeningStatus {
      return { done: settings.get(DONE_KEY) === '1' }
    }
  }
}

export type OpeningService = ReturnType<typeof createOpeningService>
