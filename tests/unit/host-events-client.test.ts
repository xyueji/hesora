// v1.4 终审 S1/S6 补齐：客户端事件通道 connect() 幂等，杜绝首次配对成功建立 2 条 WSS。
// completeSession 里 client.setConnected(true) 会经 onStateChanged 触发一次 connectEvents()，
// 末尾又显式调一次 connectEvents()；守卫必须保证只创建一个 WebSocket。
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 记录 new WebSocket 的次数；用一个可控的 EventEmitter 假实现替代 ws。
const sockets: FakeWs[] = []

class FakeWs {
  on = vi.fn()
  close = vi.fn()
  constructor(public url: string) {
    sockets.push(this)
  }
}

vi.mock('ws', () => ({ WebSocket: FakeWs, default: { WebSocket: FakeWs } }))

import { createHostEventsClient } from '../../src/main/host/host-events-client'

beforeEach(() => {
  sockets.length = 0
})

function client() {
  return createHostEventsClient({
    getBaseUrl: () => 'https://host:18650',
    getToken: () => 'tok',
    getFingerprintHex: () => 'aa'.repeat(32),
    onRevoked: () => {},
    log: () => {}
  })
}

/** 让 connect() 内部的动态 import('ws')（Vite 转换后为宏任务）跑完。 */
async function flush(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 20))
}

describe('host events client connect idempotency', () => {
  it('连续两次 connect() 只创建 1 个 WebSocket（幂等守卫）', async () => {
    const c = client()
    c.connect()
    c.connect() // 第二次：import('ws') 尚未回来或 socket 已建立，都必须被挡住
    await flush()
    expect(sockets.length).toBe(1)
    c.close()
  })

  it('close() 之后不再 connect（closedByUs 守卫）', async () => {
    const c = client()
    c.connect()
    await flush()
    expect(sockets.length).toBe(1)
    c.close()
    c.connect()
    await flush()
    expect(sockets.length).toBe(1)
  })

  it('不同 client 实例各自建立自己的连接', async () => {
    const a = client()
    const b = client()
    a.connect()
    b.connect()
    await flush()
    expect(sockets.length).toBe(2)
    a.close()
    b.close()
  })
})
