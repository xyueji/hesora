import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createSettingService } from '../../src/main/services/setting/setting.service'
const svc = () => createSettingService(openMemDb())
describe('setting.service', () => {
  let s: ReturnType<typeof createSettingService>
  beforeEach(() => { s = svc() })
  it('set then get roundtrip', () => {
    s.set('opening.done', '1')
    expect(s.get('opening.done')).toBe('1')
  })
  it('get missing returns null', () => expect(s.get('nope')).toBeNull())
  it('set upserts existing key', () => {
    s.set('k', 'a'); s.set('k', 'b')
    expect(s.get('k')).toBe('b')
  })
  it('getAll returns record of all keys', () => {
    s.set('a', '1'); s.set('b', '2')
    expect(s.getAll()).toEqual({ a: '1', b: '2' })
  })
  it('rejects empty key', () => { expect(() => s.set('', 'v')).toThrow() })
  it('remove deletes key', () => { s.set('k','v'); s.remove('k'); expect(s.get('k')).toBeNull() })
})

it('keeps license and sync secrets outside the generic setting API', () => {
  const db = openMemDb()
  db.prepare("INSERT INTO app_setting VALUES ('sync.webdav.password', 'secret')").run()
  const settings = createSettingService(db)
  expect(settings.getAll()).toEqual({})
  expect(settings.get('sync.webdav.password')).toBeNull()
  expect(() => settings.set('license.start', 'new')).toThrow()
  expect(() => settings.remove('sync.webdav.password')).toThrow()
})
