// v1.3 Task 8: LAN 客户端重连状态机（纯逻辑，可注入时钟/定时器单测）。
// spec §7 裁定：断线后指数退避 1/2/4/8/16/30s + jitter(0-500ms) 循环重试，连上重置。
// 本模块只管"什么时候该重试"，真正发什么由调用方（lan-client 接线层）提供 attempt 回调。
import { randomInt } from 'node:crypto'

export const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const
export const JITTER_MAX_MS = 500

export interface ReconnectOpts {
  /** 重试动作；返回 true 表示已连上（重置退避），false/抛错继续退避 */
  attempt: () => Promise<boolean>
  /** 定时器实现（测试注入即时执行的假 setTimeout） */
  schedule?: (delayMs: number, fn: () => void) => unknown
  /** 取消定时器（测试用；默认 clearTimeout） */
  cancel?: (handle: unknown) => void
  /** 状态回调（可选） */
  onStateChange?: (state: ReconnectState, nextDelayMs: number | null) => void
  log?: (msg: string) => void
}

export type ReconnectState = 'idle' | 'backoff' | 'stopped'

/** 重连控制器：markDisconnected() 启动退避循环；markConnected() 重置。 */
export interface ReconnectController {
  markDisconnected(): void
  markConnected(): void
  stop(): void
  state(): ReconnectState
  /** 下次重试延迟（backoff 中才有意义；测试断言用） */
  nextDelayMs(): number | null
}

export function createReconnectController(opts: ReconnectOpts): ReconnectController {
  const schedule = opts.schedule ?? ((delayMs, fn) => setTimeout(fn, delayMs))
  const cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let st: ReconnectState = 'idle'
  let stopped = false
  let round = 0 // 已连续失败轮数（0-based → BACKOFF_SCHEDULE_MS[round]）
  let timer: unknown = null
  let generation = 0 // stop()/markConnected() 后使挂起的重试回调失效

  function nextDelay(): number {
    const idx = Math.min(round, BACKOFF_SCHEDULE_MS.length - 1)
    const base = BACKOFF_SCHEDULE_MS[idx] ?? 30_000
    // 指数退避封顶 30s 后恒定 + jitter(0-500ms)（spec §7 裁定）
    return base + randomInt(0, JITTER_MAX_MS + 1)
  }

  function loop(myGen: number): void {
    if (myGen !== generation || stopped) return
    const delay = nextDelay()
    opts.onStateChange?.('backoff', delay)
    opts.log?.(`reconnect in ${delay}ms (round ${round + 1})`)
    timer = schedule(delay, () => {
      if (myGen !== generation || stopped) return
      void (async () => {
        let ok = false
        try {
          ok = await opts.attempt()
        } catch {
          ok = false
        }
        if (myGen !== generation || stopped) return
        if (ok) {
          markConnected()
          return
        }
        round = Math.min(round + 1, BACKOFF_SCHEDULE_MS.length - 1)
        loop(myGen)
      })()
    })
  }

  function markDisconnected(): void {
    if (stopped) return
    if (st === 'backoff') return // 已在退避循环中，不重复排队（防双循环）
    round = 0
    st = 'backoff'
    generation++
    loop(generation)
  }

  function markConnected(): void {
    generation++ // 使挂起的重试回调失效
    if (timer !== null) {
      cancel(timer)
      timer = null
    }
    round = 0
    st = 'idle'
    opts.onStateChange?.('idle', null)
  }

  function stop(): void {
    generation++
    if (timer !== null) {
      cancel(timer)
      timer = null
    }
    stopped = true
    st = 'stopped'
    opts.onStateChange?.('stopped', null)
  }

  return { markDisconnected, markConnected, stop, state: () => (stopped ? 'stopped' : st), nextDelayMs: () => (!stopped && st === 'backoff' ? nextDelay() : null) }
}
