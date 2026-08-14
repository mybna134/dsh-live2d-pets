import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { makePetRoutes, PET_API_PREFIX, PET_ASSET_PREFIX } from './routes.ts'
import { PetService } from './service.ts'
import type { Config } from './index.ts'

/** 伪 IncomingMessage：EventEmitter + method/headers；body 在微任务中按 chunk 吐出。 */
type FakeReq = EventEmitter & { method: string; headers: Record<string, string> }
function fakeReq(method: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as FakeReq
  req.method = method
  req.headers = { 'content-type': 'application/json' }
  ;(req as unknown as { destroy(): void }).destroy = () => { /* no-op */ }
  if (body === undefined) {
    queueMicrotask(() => req.emit('end'))
  } else {
    queueMicrotask(() => { req.emit('data', Buffer.from(body)); req.emit('end') })
  }
  return req as unknown as IncomingMessage
}

/** 伪 ServerResponse：记录状态码/头/响应体。 */
function fakeRes() {
  const state = { status: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0) }
  return {
    state,
    writeHead: (status: number, headers: Record<string, string> = {}) => { state.status = status; state.headers = headers },
    end: (chunk?: unknown) => {
      if (chunk instanceof Buffer) state.body = Buffer.concat([state.body, chunk])
      else if (chunk !== undefined) state.body = Buffer.concat([state.body, Buffer.from(String(chunk))])
    },
  }
}

const BASE_CONFIG: Config = { enabled: true, size: 160, model: 'hiyori', debug: false, customModels: [] }

function makeRoutes() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-live2d-pets-route-'))
  mkdirSync(join(dir, 'assets', 'vendor'), { recursive: true })
  writeFileSync(join(dir, 'assets', 'vendor', 'pixi.min.js'), 'fake-pixi-js')
  process.env.DSH_HOME = join(dir, 'home')

  const handlers = new Map<string, Array<(payload?: unknown, next?: () => void) => unknown>>()
  const ctx = {
    on: (event: string, fn: (payload?: unknown, next?: () => void) => unknown) => {
      const list = handlers.get(event) ?? []
      list.push(fn)
      handlers.set(event, list)
    },
    effect: (fn: () => () => void) => { fn() },
  } as unknown as Context
  const service = new PetService(ctx, () => BASE_CONFIG)
  const settings = {
    view: () => ({ value: BASE_CONFIG, writable: true }),
    write: vi.fn(async () => {}),
  }
  const routes = makePetRoutes({ service, packageRoot: dir, settings })
  const route = (path: string) => routes.find((r) => r.path === path)
  const cleanup = () => { delete process.env.DSH_HOME; rmSync(dir, { recursive: true, force: true }) }
  return { route, settings, cleanup }
}

/** GET 路由的 handler 不返回 Promise，等一个事件循环轮次让异步完成。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('makePetRoutes API 路由', () => {
  it('GET /state 返回 200 + 快照 JSON', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    route(`${PET_API_PREFIX}/state`)!.handler(fakeReq('GET'), res as never)
    await flush()
    expect(res.state.status).toBe(200)
    const body = JSON.parse(res.state.body.toString('utf8'))
    expect(body.state).toBe('idle')
    expect(body.config.size).toBe(160)
    cleanup()
  })

  it('GET /models 返回内置 + 自定义清单', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    route(`${PET_API_PREFIX}/models`)!.handler(fakeReq('GET'), res as never)
    await flush()
    const body = JSON.parse(res.state.body.toString('utf8'))
    expect(Array.isArray(body.builtin)).toBe(true)
    expect(body.builtin.length).toBeGreaterThan(0)
    expect(body.custom).toEqual([])
    cleanup()
  })

  it('错误方法返回 405', () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    route(`${PET_API_PREFIX}/state`)!.handler(fakeReq('POST'), res as never)
    expect(res.state.status).toBe(405)
    cleanup()
  })

  it('POST /set-display 越界数值在服务端被 clamp', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    await route(`${PET_API_PREFIX}/set-display`)!.handler(
      fakeReq('POST', JSON.stringify({ size: 1e9, right: -1 })), res as never,
    )
    expect(res.state.status).toBe(200)
    const body = JSON.parse(res.state.body.toString('utf8'))
    expect(body.display.size).toBe(400)
    expect(body.display.right).toBe(0)
    cleanup()
  })

  it('POST /set-display 非法 JSON 返回 400', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    await route(`${PET_API_PREFIX}/set-display`)!.handler(fakeReq('POST', '{oops'), res as never)
    expect(res.state.status).toBe(400)
    cleanup()
  })

  it('POST /settings 透传 ops 并返回视图', async () => {
    const { route, settings, cleanup } = makeRoutes()
    const res = fakeRes()
    await route(`${PET_API_PREFIX}/settings`)!.handler(
      fakeReq('POST', JSON.stringify({ ops: [{ op: 'set', path: ['size'], value: 200 }] })), res as never,
    )
    expect(settings.write).toHaveBeenCalledWith([{ op: 'set', path: ['size'], value: 200 }])
    expect(res.state.status).toBe(200)
    cleanup()
  })

  it('请求体超过 64KB 返回 400 body-too-large', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    const big = JSON.stringify({ ops: [{ op: 'set', path: ['x'], value: 'a'.repeat(70 * 1024) }] })
    await route(`${PET_API_PREFIX}/settings`)!.handler(fakeReq('POST', big), res as never)
    expect(res.state.status).toBe(400)
    const body = JSON.parse(res.state.body.toString('utf8'))
    expect(body.error).toBe('body-too-large')
    cleanup()
  })
})

describe('makePetRoutes 素材路由', () => {
  it('命中返回 200 + mime + 内容，HEAD 无 body', async () => {
    const { route, cleanup } = makeRoutes()
    const get = fakeRes()
    await route(`${PET_ASSET_PREFIX}/vendor/pixi.min.js`)!.handler(fakeReq('GET'), get as never)
    expect(get.state.status).toBe(200)
    expect(get.state.headers['content-type']).toBe('text/javascript')
    expect(get.state.body.toString('utf8')).toBe('fake-pixi-js')

    const head = fakeRes()
    await route(`${PET_ASSET_PREFIX}/vendor/pixi.min.js`)!.handler(fakeReq('HEAD'), head as never)
    expect(head.state.status).toBe(200)
    expect(head.state.body.byteLength).toBe(0)
    cleanup()
  })

  it('文件缺失返回 404', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    // 临时目录里只放了 pixi.min.js，其余 vendor 文件缺失
    await route(`${PET_ASSET_PREFIX}/vendor/live2dcubismcore.min.js`)!.handler(fakeReq('GET'), res as never)
    expect(res.state.status).toBe(404)
    cleanup()
  })

  it('非 GET/HEAD 返回 405', () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    route(`${PET_ASSET_PREFIX}/vendor/pixi.min.js`)!.handler(fakeReq('POST'), res as never)
    expect(res.state.status).toBe(405)
    cleanup()
  })
})
