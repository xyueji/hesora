import { describe, it, expect } from 'vitest'
import { routeChannel } from '../../src/preload/lan-routing'
import { LOCAL_CHANNEL_PREFIXES, HOST_ONLY_PREFIXES } from '../../src/shared/channels'

describe('routeChannel 真值表', () => {
  const localChannels = ['license:check', 'trial:status', 'update:check', 'host:status', 'window:minimize', 'print:receipt', 'csv:export', 'auth:login']
  const hostOnlyChannels = ['backup:now', 'sync:push']
  const businessChannels = ['sale:create', 'product:query', 'inventory:queryStock', 'customer:list']

  it('local 前缀通道：无论 lanConnected 都走 local', () => {
    for (const ch of localChannels) {
      expect(routeChannel(ch, false)).toBe('local')
      expect(routeChannel(ch, true)).toBe('local')
    }
    expect(LOCAL_CHANNEL_PREFIXES.length).toBe(8)
  })

  it('backup:/sync:：lanConnected=false 走 local（主机本机备份），true 时 blocked（客户端不能备份到云盘）', () => {
    for (const ch of hostOnlyChannels) {
      expect(routeChannel(ch, false)).toBe('local')
      expect(routeChannel(ch, true)).toBe('blocked')
    }
  })

  it('业务通道：lanConnected=false 走 local（离线兜底），true 走 host', () => {
    for (const ch of businessChannels) {
      expect(routeChannel(ch, false)).toBe('local')
      expect(routeChannel(ch, true)).toBe('host')
    }
  })

  it('shared/channels.ts 与 host-protocol.ts 同源（下沉后唯一来源）', () => {
    expect(LOCAL_CHANNEL_PREFIXES).toEqual(['license:', 'trial:', 'update:', 'host:', 'window:', 'print:', 'csv:', 'auth:'])
    expect(HOST_ONLY_PREFIXES).toEqual(['backup:', 'sync:'])
  })
})
