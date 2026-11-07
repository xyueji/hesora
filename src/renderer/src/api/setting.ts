import { call } from './call'

export const settingApi = {
  get: (key: string) => call<string | null>('setting:get', key),
  set: (key: string, value: string) => call<void>('setting:set', { key, value }),
  getAll: () => call<Record<string, string>>('setting:getAll'),
  remove: (key: string) => call<void>('setting:remove', key)
}
