/**
 * dsh-live2d-pets 浏览器半区：挂载 Live2D 桌宠。
 *
 * 架构（ADR-005 / 004，spike pkg-9 实证）：
 * - `shell.overlay` 注册零尺寸锚点（生命周期/设置锚点）
 * - 视觉层用 Popover API（top layer，零 z-index）渲染，旧浏览器回退 body + 最大 z-index
 * - 运行时脚本与预设模型走 Host 同源路由（/pet-assets/*），无 CDN 依赖
 * - agent 状态经 /api/live2d-pet/state 轮询（800ms，标签页隐藏暂停）
 * - 点击/拖动按 6px 阈值判定；自由位置拖动，松手持久化（spec §4）
 * @module dsh-live2d-pets/client
 */

import { createElement, useEffect, useRef } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PetState, PetStateView } from '../service.ts'

/** 注入所需服务。 */
export const inject = ['slots']

/** 状态轮询间隔（ms）。 */
const POLL_MS = 800
/** 点击/拖动判定阈值（px）。 */
const DRAG_THRESHOLD = 6
/** 交互气泡冷却（ms）。 */
const BUBBLE_COOLDOWN_MS = 2000
/** 状态气泡文案池（中文活泼卖萌，v0.1 常量内置）。 */
const STATE_BUBBLES: Record<PetState, string[]> = {
  idle: ['在呢~', '摸鱼中…'],
  thinking: ['思考中…', '让我想想'],
  error: ['出错了，要我帮你看看吗？'],
  done: ['搞定！'],
  waiting: ['等你拍板~'],
}
/** 状态 → 候选动作组（按模型实际可用性逐个尝试）。 */
const STATE_MOTIONS: Record<PetState, string[]> = {
  idle: ['Idle'],
  thinking: ['Thinking', 'Working', 'Idle'],
  error: ['Failed', 'Sad', 'Idle'],
  done: ['Jumping', 'Done', 'Idle'],
  waiting: ['Waiting', 'Idle'],
}
/** vendor 运行时脚本（Host 同源路由，ADR-003）。 */
const VENDOR_SCRIPTS = [
  '/pet-assets/vendor/pixi.min.js',
  '/pet-assets/vendor/live2dcubismcore.min.js',
  '/pet-assets/vendor/live2d-display.cubism4.min.js',
]

const PET_API = '/api/live2d-pet'

/** PIXI 全局（script 注入，非模块导入）。 */
declare const PIXI: {
  Application: new (options: Record<string, unknown>) => {
    stage: { addChild(child: unknown): unknown }
    ticker: { addOnce(fn: () => void): unknown }
    destroy(remove: boolean): void
  }
  Point: new (x: number, y: number) => unknown
  live2d?: {
    Live2DModel?: {
      from(url: string, options?: Record<string, unknown>): Promise<unknown>
    }
  }
}

/** 最小 slots 服务结构类型（运行时由 DSH 提供）。 */
interface SlotsLike {
  inject(key: string, callback: () => () => void): () => void
  register(options: { name: string; id: string }, component: () => unknown): () => void
}

interface DisplayLike { right: number; bottom: number; size: number }

interface ModelLike {
  width: number
  height: number
  anchor: { set(x: number, y: number): void }
  scale: { set(s: number): void }
  position: { set(x: number, y: number): void }
  motion(name: string): unknown
  hitTest(name: string, x: number, y: number): boolean
  toLocal(point: unknown): { x: number; y: number }
  internalModel?: { hitAreas?: Record<string, unknown> }
}

const api = {
  state: (): Promise<PetStateView> => fetch(`${PET_API}/state`).then((r) => r.json()),
  setDisplay: (patch: { right?: number; bottom?: number }): Promise<{ ok: boolean }> =>
    fetch(`${PET_API}/set-display`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => r.json()),
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`script load failed: ${src}`))
    document.head.appendChild(s)
  })
}

/** 零尺寸锚点组件：占位 shell.overlay 席位，实际渲染在 popover 顶层容器。 */
function PetAnchor(): ReturnType<typeof createElement> {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => boot(ref.current), [])
  return createElement('div', { ref, style: { width: 0, height: 0 } })
}

function boot(anchor: HTMLDivElement | null): (() => void) | undefined {
  if (!anchor) return undefined
  const cleanup: Array<() => void> = []
  const pushCleanup = (fn: () => void) => { cleanup.push(fn) }

  let box: HTMLDivElement | null = null
  let bubble: HTMLDivElement | null = null
  let debugEl: HTMLDivElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let app: {
    destroy(remove?: boolean): void
    stage: { addChild(child: unknown): unknown }
    ticker: { addOnce(fn: () => void): unknown }
  } | null = null
  let model: ModelLike | null = null
  let hitAreas: string[] = []
  let lastBubbleAt = 0
  let lastState: PetState | null = null
  let demoState: PetState | null = null
  let pos: DisplayLike = { right: 24, bottom: 20, size: 160 }

  function showBubble(text: string, force = false): void {
    if (!bubble) return
    const now = Date.now()
    if (!force && now - lastBubbleAt < BUBBLE_COOLDOWN_MS) return
    lastBubbleAt = now
    bubble.textContent = text
    bubble.style.opacity = '1'
    window.setTimeout(() => { if (bubble) bubble.style.opacity = '0' }, 2500)
  }

  function playState(state: PetState): void {
    if (!model) return
    for (const name of STATE_MOTIONS[state] ?? []) {
      try {
        model.motion(name)
        return
      } catch {
        // 尝试下一个候选动作
      }
    }
  }

  function applyState(view: PetStateView | null): void {
    const state = demoState ?? view?.state ?? 'idle'
    // 状态变化时播状态气泡（spec §3，走气泡冷却防刷屏）
    if (state !== lastState) {
      lastState = state
      const lines = STATE_BUBBLES[state]
      if (lines && lines.length > 0) showBubble(lines[Math.floor(Math.random() * lines.length)])
    }
    playState(state)
    if (debugEl) {
      debugEl.textContent =
        `agent: ${view?.agent ?? '-'}  pet: ${state}  v${view?.version ?? '-'}\n` +
        `hitAreas: ${hitAreas.join(',') || '-'}\n` +
        `pos: ${Math.round(pos.right)},${Math.round(pos.bottom)}  size: ${pos.size}`
    }
  }

  // ---- 指针：点击/拖动判定（6px 阈值，spec §4） ----
  let down: { x: number; y: number; startRight: number; startBottom: number } | null = null
  let dragging = false

  function handlePointerDown(e: PointerEvent): void {
    down = { x: e.clientX, y: e.clientY, startRight: pos.right, startBottom: pos.bottom }
    dragging = false
    canvas?.setPointerCapture(e.pointerId)
  }
  function handlePointerMove(e: PointerEvent): void {
    if (!down) return
    const dx = e.clientX - down.x
    const dy = e.clientY - down.y
    if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragging = true
      if (bubble) bubble.style.opacity = '0'
    }
    if (dragging && box) {
      pos.right = Math.max(0, down.startRight - dx)
      pos.bottom = Math.max(0, down.startBottom - dy)
      box.style.right = `${Math.round(pos.right)}px`
      box.style.bottom = `${Math.round(pos.bottom)}px`
    }
  }
  function handlePointerUp(e: PointerEvent): void {
    if (!down) return
    if (dragging) {
      api.setDisplay({ right: Math.round(pos.right), bottom: Math.round(pos.bottom) }).catch(() => {})
    } else {
      handleTap(e)
    }
    down = null
    dragging = false
  }
  function handleTap(e: PointerEvent): void {
    if (!canvas || !model) return
    const m = model
    try {
      const rect = canvas.getBoundingClientRect()
      const local = m.toLocal(new PIXI.Point(e.clientX - rect.left, e.clientY - rect.top))
      const head = hitAreas.filter((n) => /head/i.test(n)).find((n) => { try { return m.hitTest(n, local.x, local.y) } catch { return false } })
      const body = hitAreas.filter((n) => !/head/i.test(n)).find((n) => { try { return m.hitTest(n, local.x, local.y) } catch { return false } })
      if (head) {
        try { m.motion('TapHead') } catch { try { m.motion('TapBody') } catch { /* 无触摸动作 */ } }
        showBubble('摸头舒服~')
      } else if (body) {
        try { m.motion('TapBody') } catch { /* 无触摸动作 */ }
        showBubble(Math.random() < 0.5 ? '嘿嘿~' : '再点我就要生气了哦')
      }
    } catch {
      // 坐标转换失败：忽略本次点击
    }
  }

  // ---- 主流程 ----
  void (async () => {
    try {
      // 1. 初始状态（配置 + 显示位置）
      let view: PetStateView | null = null
      try { view = await api.state() } catch { /* 首帧前 API 不可用则用默认 */ }
      if (view) pos = { ...view.display, size: view.config.size }

      // 2. 顶层容器（Popover API，回退 body + max z）
      box = document.createElement('div')
      const popoverSupported = typeof box.showPopover === 'function'
      // UA 对 [popover] 默认 inset:0 + margin:auto（居中），必须显式重置（ADR-005 实证）
      box.style.cssText = `position:fixed;inset:auto;top:auto;left:auto;right:${pos.right}px;bottom:${pos.bottom}px;margin:0;pointer-events:none${popoverSupported ? '' : ';z-index:2147483647'}`
      if (popoverSupported) box.setAttribute('popover', 'manual')
      document.body.appendChild(box)
      if (popoverSupported) { try { box.showPopover() } catch { /* 已显示 */ } }
      pushCleanup(() => { box?.parentNode?.removeChild(box) })

      // 气泡层
      bubble = document.createElement('div')
      bubble.style.cssText = 'position:absolute;left:50%;bottom:100%;transform:translateX(-50%);margin-bottom:8px;padding:4px 10px;background:rgba(255,255,255,.95);color:#222;border-radius:999px;font:12px/1.5 sans-serif;white-space:nowrap;opacity:0;transition:opacity .2s;pointer-events:none'
      box.appendChild(bubble)

      // 3. vendor 脚本（Host 同源）
      for (const src of VENDOR_SCRIPTS) await loadScript(src)

      // 4. 模型（config.model：URL 直载；预设 id 待预设定稿后支持）
      const modelUrl = view?.config.model && /^https?:\/\//.test(view.config.model) ? view.config.model : null
      if (!modelUrl) throw new Error('未配置模型 URL（预设待定稿，可在 config 中填 model URL）')
      canvas = document.createElement('canvas')
      const size = pos.size
      canvas.width = size
      canvas.height = Math.round(size * 1.2)
      canvas.style.cssText = 'pointer-events:auto;display:block'
      box.appendChild(canvas)

      const M = PIXI.live2d?.Live2DModel
      if (!M) throw new Error('Live2DModel 不可用')

      app = new PIXI.Application({ view: canvas, width: canvas.width, height: canvas.height, backgroundAlpha: 0 })
      pushCleanup(() => { try { app?.destroy(true) } catch { /* 已销毁 */ } })

      const loaded = await M.from(modelUrl, { autoInteract: false }) as ModelLike
      model = loaded
      app.stage.addChild(loaded)
      hitAreas = Object.keys(loaded.internalModel?.hitAreas ?? {})
      const fit = () => {
        const w = Number(loaded.width) || 0
        const h = Number(loaded.height) || 0
        if (w > 0 && h > 0) {
          const s = Math.min((size - 8) / w, (Math.round(size * 1.2) - 8) / h)
          loaded.scale.set(s)
          loaded.anchor.set(0.5, 0.5)
          loaded.position.set(canvas!.width / 2, canvas!.height / 2)
          return true
        }
        return false
      }
      if (!fit()) { try { app.ticker.addOnce(() => fit()) } catch { /* 首帧适配 */ } }
      playState('idle')

      // 5. 指针事件（点击/拖动）
      canvas.addEventListener('pointerdown', handlePointerDown)
      canvas.addEventListener('pointermove', handlePointerMove)
      canvas.addEventListener('pointerup', handlePointerUp)
      canvas.addEventListener('pointercancel', () => { down = null; dragging = false })
      pushCleanup(() => {
        canvas?.removeEventListener('pointerdown', handlePointerDown)
        canvas?.removeEventListener('pointermove', handlePointerMove)
        canvas?.removeEventListener('pointerup', handlePointerUp)
      })

      // 6. 调试面板（config.debug，spec §2）
      if (view?.config.debug) {
        debugEl = document.createElement('div')
        debugEl.style.cssText = 'pointer-events:auto;margin-top:6px;padding:6px 8px;background:rgba(20,20,32,.9);color:#e8e8f0;border-radius:8px;font:11px/1.5 ui-monospace,monospace;white-space:pre-wrap;width:220px'
        const demoRow = document.createElement('div')
        demoRow.style.cssText = 'margin-top:4px;display:flex;gap:4px'
        for (const st of ['idle', 'thinking', 'done', 'error'] as const) {
          const btn = document.createElement('button')
          btn.textContent = st
          btn.onclick = () => { demoState = demoState === st ? null : st; applyState(view) }
          demoRow.appendChild(btn)
        }
        debugEl.appendChild(demoRow)
        box.appendChild(debugEl)
      }

      // 7. 状态轮询（visibility-aware）
      let interval: number | undefined
      const stopPoll = () => { if (interval !== undefined) { window.clearInterval(interval); interval = undefined } }
      const startPoll = () => {
        if (interval !== undefined) return
        interval = window.setInterval(async () => {
          try {
            const next = await api.state()
            view = next
            pos = { ...next.display, size: next.config.size }
            applyState(next)
          } catch { /* 下次轮询重试 */ }
        }, POLL_MS)
      }
      const onVisibility = () => {
        if (document.visibilityState === 'visible') startPoll()
        else stopPoll()
      }
      startPoll()
      document.addEventListener('visibilitychange', onVisibility)
      pushCleanup(() => {
        stopPoll()
        document.removeEventListener('visibilitychange', onVisibility)
      })
      applyState(view)
    } catch (error) {
      // 静态头像降级（WebGL 不可用 / 模型加载失败，spec §7）
      if (box) {
        const fallback = document.createElement('div')
        fallback.style.cssText = 'pointer-events:auto;width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:36px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:16px;color:#fff'
        fallback.textContent = '🐾'
        box.appendChild(fallback)
      }
    }
  })()

  return () => { for (const fn of cleanup) { try { fn() } catch { /* 忽略清理错误 */ } } }
}

/** 插件入口。 */
export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots') as SlotsLike | undefined
  if (slots === undefined) return
  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'live2d-pet' },
    () => createElement(PetAnchor),
  ))
}
