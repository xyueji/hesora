import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import type { RouteLocationNormalized } from 'vue-router'
import {
  activeKey,
  closeAll,
  closeOthers,
  closeTab,
  openTab,
  tabs
} from '../../src/renderer/src/stores/tabs'

function route(path: string, fullPath: string, title: string, pattern = path): RouteLocationNormalized {
  return {
    path,
    fullPath,
    matched: pattern === path ? [] : [{ path: pattern } as never],
    meta: { title },
    name: undefined,
    params: {},
    query: {},
    hash: '',
    redirectedFrom: undefined
  } as unknown as RouteLocationNormalized
}

describe('renderer tabs store', () => {
  beforeEach(() => {
    tabs.value = []
    activeKey.value = ''
  })

  it('opens a tab per route and keeps one tab per route pattern', () => {
    openTab(route('/product/edit/1', '/product/edit/1', '商品编辑', '/product/edit/:id?'))
    openTab(route('/product/edit/2', '/product/edit/2', '商品编辑', '/product/edit/:id?'))
    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]!.path).toBe('/product/edit/2')
    expect(activeKey.value).toBe('/product/edit/:id?')
  })

  it('home tab is not closable while others are', () => {
    openTab(route('/', '/', '经营概况'))
    openTab(route('/customer/list', '/customer/list', '客户'))
    expect(tabs.value.find((t) => t.key === '/')?.closable).toBe(false)
    expect(tabs.value.find((t) => t.key === '/customer/list')?.closable).toBe(true)
    expect(closeTab('/')).toBeNull()
    expect(tabs.value).toHaveLength(2)
  })

  it('closing a tab removes it and keeps the rest', () => {
    openTab(route('/', '/', '经营概况'))
    openTab(route('/customer/list', '/customer/list', '客户'))
    openTab(route('/supplier/list', '/supplier/list', '供应商'))
    const closed = closeTab('/customer/list')
    expect(closed?.key).toBe('/customer/list')
    expect(tabs.value.map((t) => t.key)).toEqual(['/', '/supplier/list'])
  })

  it('closeOthers keeps the active tab and the home tab', () => {
    openTab(route('/', '/', '经营概况'))
    openTab(route('/customer/list', '/customer/list', '客户'))
    openTab(route('/supplier/list', '/supplier/list', '供应商'))
    closeOthers('/supplier/list')
    expect(tabs.value.map((t) => t.key)).toEqual(['/', '/supplier/list'])
  })

  it('closeAll keeps only the home tab', () => {
    openTab(route('/', '/', '经营概况'))
    openTab(route('/customer/list', '/customer/list', '客户'))
    closeAll()
    expect(tabs.value.map((t) => t.key)).toEqual(['/'])
  })

  it('falls back to the route name when no title is provided', async () => {
    const r = route('/x', '/x', 'x')
    ;(r as { meta: Record<string, unknown> }).meta = {}
    openTab(r)
    await nextTick()
    expect(tabs.value[0]!.title).toBeTruthy()
  })
})
