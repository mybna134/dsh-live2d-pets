/**
 * dsh-live2d-pets 浏览器半区：挂载 Live2D 桌宠 + 「桌宠配置」设置页。
 *
 * 架构（ADR-005 / 004，spike pkg-9 实证）：
 * - `shell.overlay` 注册零尺寸锚点（生命周期/设置锚点）
 * - 视觉层用 Popover API（top layer，零 z-index）渲染，旧浏览器回退 body + 最大 z-index
 * - 运行时脚本与预设模型走 Host 同源路由（/pet-assets/*），无 CDN 依赖
 * - agent 状态经 /api/live2d-pet/state 轮询（800ms，标签页隐藏暂停）
 * - 点击/拖动按 6px 阈值判定；自由位置拖动，松手持久化（spec §4）
 * - 配置（enabled/size/debug/model）经轮询运行时应用：开关→显隐+停启渲染、
 *   尺寸→重设画布与模型适配、调试→动态面板、模型→按 modelUrl 重载（spec §2/§6/§7）
 * @module dsh-live2d-pets/client
 */

import { createElement, useEffect, useRef } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PetState, PetStateView } from '../service.ts'
import { PetSettingsSection } from './settings.ts'

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
    ticker: {
      addOnce(fn: () => void): unknown
      start(): unknown
      stop(): unknown
    }
    renderer: { resize(width: number, height: number): unknown }
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
  register(
    options: {
      name: string
      id: string
      order?: number
      label?: string | (() => string)
      inject?: () => Record<string, unknown>
    },
    component: (props: unknown) => unknown,
  ): () => void
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

/** JSON 响应读取:非 2xx 抛错——错误响应不得当作合法视图/结果解析。 */
async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`http ${res.status}`)
  return await res.json() as T
}

const api = {
  state: (): Promise<PetStateView> => fetch(`${PET_API}/state`).then((res) => readJson<PetStateView>(res)),
  setDisplay: (patch: { right?: number; bottom?: number }): Promise<{ ok: boolean }> =>
    fetch(`${PET_API}/set-display`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((res) => readJson<{ ok: boolean }>(res)),
}

/** vendor 脚本加载去重：同一 src 只注入一次、只等待同一份结果
 * （boot 在 StrictMode/HMR 下会重复执行，避免二次注入与重复初始化）。 */
const scriptPromises = new Map<string, Promise<void>>()

function loadScript(src: string): Promise<void> {
  let pending = scriptPromises.get(src)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = () => resolve()
      s.onerror = () => reject(new Error(`script load failed: ${src}`))
      document.head.appendChild(s)
    })
    scriptPromises.set(src, pending)
  }
  return pending
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

  // 卸载守卫：置位后 boot 的异步流程在每个 await 点提前退出，
  // 避免 StrictMode 双挂载 / HMR 重挂载时残留第二份 PIXI app、轮询与脚本注入。
  let disposed = false
  pushCleanup(() => { disposed = true })

  let box: HTMLDivElement | null = null
  let bubble: HTMLDivElement | null = null
  let debugEl: HTMLDivElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let app: {
    destroy(remove?: boolean): void
    stage: { addChild(child: unknown): unknown }
    ticker: {
      addOnce(fn: () => void): unknown
      start(): unknown
      stop(): unknown
    }
    renderer: { resize(width: number, height: number): unknown }
  } | null = null
  let model: ModelLike | null = null
  let hitAreas: string[] = []
  let currentModelUrl: string | null = null
  let fallbackShown = false
  let fallbackEl: HTMLDivElement | null = null
  // 模型基础尺寸（scale=1 时捕获一次；Pixi Container.width 含当前 scale，
  // 若每次 fit 都现读会按 1/s0 累积误差导致越放越大被画布裁剪）
  let baseModelW = 0
  let baseModelH = 0
  let lastBubbleAt = 0
  let lastState: PetState | null = null
  let demoState: PetState | null = null
  let view: PetStateView | null = null
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

  function applyState(next: PetStateView | null): void {
    const state = demoState ?? next?.state ?? 'idle'
    // 状态变化时播状态气泡与状态动作（spec §3，气泡走冷却防刷屏）。
    // 动作只在状态变化时触发一次——pixi-live2d-display 的 motion() 每次
    // 调用都会 stopAllMotions 从头播放,若随 800ms 轮询无条件重放,
    // 待机动画永远播不满一个循环、互动动作也会在下一轮询被掐断。
    if (state !== lastState) {
      lastState = state
      const lines = STATE_BUBBLES[state]
      if (lines && lines.length > 0) showBubble(lines[Math.floor(Math.random() * lines.length)])
      playState(state)
    }
    if (debugEl) {
      debugEl.textContent =
        `agent: ${next?.agent ?? '-'}  pet: ${state}  v${next?.version ?? '-'}\n` +
        `hitAreas: ${hitAreas.join(',') || '-'}\n` +
        `pos: ${Math.round(pos.right)},${Math.round(pos.bottom)}  size: ${pos.size}`
    }
  }

  /** 静态头像降级（WebGL 不可用 / 模型加载失败，spec §7）。 */
  function showFallback(): void {
    if (!box || fallbackShown) return
    fallbackShown = true
    fallbackEl = document.createElement('div')
    fallbackEl.style.cssText = 'pointer-events:auto;width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:36px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:16px;color:#fff'
    fallbackEl.textContent = '🐾'
    box.appendChild(fallbackEl)
  }

  /** 移除静态头像占位（模型（重新）加载前调用，避免降级与画布叠加）。 */
  function removeFallback(): void {
    if (fallbackEl && fallbackEl.parentNode) fallbackEl.parentNode.removeChild(fallbackEl)
    fallbackEl = null
    fallbackShown = false
  }

  /** 按当前尺寸重新适配模型（画布已就绪时调用；基准尺寸为 scale=1 时捕获值）。 */
  function fitModel(size: number): void {
    if (!model || !canvas) return
    const w = baseModelW
    const h = baseModelH
    if (w > 0 && h > 0) {
      const s = Math.min((size - 8) / w, (Math.round(size * 1.2) - 8) / h)
      model.scale.set(s)
      model.anchor.set(0.5, 0.5)
      model.position.set(canvas.width / 2, canvas.height / 2)
    }
  }

  /** 销毁当前渲染层（app/canvas/模型引用/静态头像占位）。 */
  function teardownLayer(): void {
    if (app) { try { app.destroy(true) } catch { /* 已销毁 */ } }
    app = null
    model = null
    hitAreas = []
    baseModelW = 0
    baseModelH = 0
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    canvas = null
    removeFallback()
  }

  /** 加载/重载模型层：销毁旧层 → 新建画布与 PIXI app → 绑定指针事件。 */
  async function loadModelLayer(url: string | null): Promise<void> {
    teardownLayer()
    if (disposed) return
    if (!url || !box) {
      showFallback()
      return
    }
    try {
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

      const loaded = await M.from(url, { autoInteract: false }) as ModelLike
      if (disposed) {
        // 挂载已拆除（StrictMode/HMR）：弃用本层，不绑定事件
        teardownLayer()
        return
      }
      model = loaded
      // 基础尺寸：scale=1 时捕获（Pixi Container.width 含当前 scale，必须固定基准）
      baseModelW = Number(loaded.width) || 0
      baseModelH = Number(loaded.height) || 0
      app.stage.addChild(loaded)
      hitAreas = Object.keys(loaded.internalModel?.hitAreas ?? {})
      fitModel(pos.size)
      // 首帧尺寸未知时延迟适配
      if (!(baseModelW > 0 && baseModelH > 0)) {
        try { app.ticker.addOnce(() => fitModel(pos.size)) } catch { /* 首帧适配 */ }
      }
      if (lastState) playState(lastState)

      // 指针事件（新 canvas；点击/拖动 6px 阈值）
      canvas.addEventListener('pointerdown', handlePointerDown)
      canvas.addEventListener('pointermove', handlePointerMove)
      canvas.addEventListener('pointerup', handlePointerUp)
      canvas.addEventListener('pointercancel', () => { down = null; dragging = false })
    } catch {
      // 加载失败 → 静态头像（spec §7）；已卸载则不再展示
      teardownLayer()
      if (!disposed) showFallback()
    }
  }

  /** 模型重载队列：串行执行，避免快速切换时并发加载。 */
  let modelLoadQueue: Promise<void> = Promise.resolve()
  function queueModelLoad(url: string | null): void {
    modelLoadQueue = modelLoadQueue.then(() => loadModelLayer(url)).catch(() => {})
  }

  /** 调试面板动态开关（spec §2）。 */
  function ensureDebugPanel(show: boolean): void {
    if (show && !debugEl && box) {
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
      applyState(view)
    } else if (!show && debugEl) {
      debugEl.parentNode?.removeChild(debugEl)
      debugEl = null
    }
  }

  /** 运行时应用配置变化（spec §2/§6/§7）：开关 / 尺寸 / 调试 / 模型。 */
  function applyConfig(next: PetStateView): void {
    const cfg = next.config
    // 开关：显示/隐藏 + 暂停/恢复渲染循环（隐藏近似零开销）
    if (box) box.style.display = cfg.enabled ? '' : 'none'
    if (app) {
      if (cfg.enabled) { try { app.ticker.start() } catch { /* 已启动 */ } }
      else { try { app.ticker.stop() } catch { /* 已停止 */ } }
    }
    // 调试面板
    ensureDebugPanel(cfg.debug)
    // 尺寸：重设画布 + 模型适配
    const nextSize = cfg.size
    if (nextSize !== pos.size) {
      pos.size = nextSize
      if (canvas && app && model) {
        canvas.width = nextSize
        canvas.height = Math.round(nextSize * 1.2)
        try { app.renderer.resize(canvas.width, canvas.height) } catch { /* 旧渲染器 */ }
        fitModel(nextSize)
      }
    }    // 模型：modelUrl 变化 → 重载
    const nextUrl = cfg.modelUrl || null
    if (nextUrl !== currentModelUrl) {
      currentModelUrl = nextUrl
      queueModelLoad(nextUrl)
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
        void playInteractionMotion('TapHead', 'TapBody')
        showBubble('摸头舒服~')
      } else if (body) {
        void playInteractionMotion('TapBody')
        showBubble(Math.random() < 0.5 ? '嘿嘿~' : '再点我就要生气了哦')
      }
    } catch {
      // 坐标转换失败：忽略本次点击
    }
  }

  /**
   * 播放互动动作（摸头/点身体）；动作播完后恢复当前状态动画（spec §4：
   * 互动动画可打断状态动画，结束后回到状态对应动画）。个别模型动作
   * 不完结（如循环播放）或加载失败时，由 3s 兜底定时器恢复。
   */
  async function playInteractionMotion(name: string, fallback?: string): Promise<void> {
    if (!model) return
    let finished: unknown
    try {
      finished = model.motion(name)
    } catch {
      if (fallback !== undefined) return playInteractionMotion(fallback)
      return
    }
    const restore = () => { if (lastState) playState(lastState) }
    const failSafe = window.setTimeout(restore, 3000)
    try { await finished as Promise<unknown> } catch { /* 动作异常，直接恢复 */ }
    window.clearTimeout(failSafe)
    restore()
  }

  // ---- 主流程 ----
  void (async () => {
    try {
      // 1. 初始状态（配置 + 显示位置）
      try { view = await api.state() } catch { /* 首帧前 API 不可用则用默认 */ }
      if (disposed) return
      if (view) pos = { ...view.display, size: view.config.size }

      // 2. 顶层容器（Popover API，回退 body + max z）
      box = document.createElement('div')
      const popoverSupported = typeof box.showPopover === 'function'
      // UA 对 [popover] 默认 inset:0 + margin:auto（居中）、border:solid + Canvas 背景，
      // 必须显式重置（ADR-005 实证：居中 + 边框/背景两处坑）
      box.style.cssText = `position:fixed;inset:auto;top:auto;left:auto;right:${pos.right}px;bottom:${pos.bottom}px;margin:0;padding:0;border:none;background:transparent;width:auto;height:auto;overflow:visible;pointer-events:none${popoverSupported ? '' : ';z-index:2147483647'}`
      if (popoverSupported) box.setAttribute('popover', 'manual')
      document.body.appendChild(box)
      if (popoverSupported) { try { box.showPopover() } catch { /* 已显示 */ } }
      pushCleanup(() => { box?.parentNode?.removeChild(box) })

      // 气泡层
      bubble = document.createElement('div')
      bubble.style.cssText = 'position:absolute;left:50%;bottom:100%;transform:translateX(-50%);margin-bottom:8px;padding:4px 10px;background:rgba(255,255,255,.95);color:#222;border-radius:999px;font:12px/1.5 sans-serif;white-space:nowrap;opacity:0;transition:opacity .2s;pointer-events:none'
      box.appendChild(bubble)

      // 3. vendor 脚本（Host 同源）
      for (const src of VENDOR_SCRIPTS) {
        await loadScript(src)
        if (disposed) return
      }

      // 4. 初始模型（config.modelUrl：Host 解析后的 .model3.json URL，spec §6）
      const initialUrl = view?.config.modelUrl || null
      currentModelUrl = initialUrl
      await loadModelLayer(initialUrl)
      if (disposed) return

      // 5. 状态轮询（visibility-aware；同时把配置变化运行时应用到宠物）
      let interval: number | undefined
      const stopPoll = () => { if (interval !== undefined) { window.clearInterval(interval); interval = undefined } }
      const startPoll = () => {
        if (interval !== undefined) return
        interval = window.setInterval(async () => {
          if (disposed) return
          try {
            const next = await api.state()
            view = next
            // 位置取持久化值；渲染尺寸保持现状，由 applyConfig 负责 diff 与更新
            pos = { right: next.display.right, bottom: next.display.bottom, size: pos.size }
            applyConfig(next)
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

      // 6. 初始应用（含开关/尺寸/调试/模型）
      if (view) {
        applyConfig(view)
        applyState(view)
      }
    } catch (error) {
      // 静态头像降级（WebGL 不可用 / 模型加载失败，spec §7）
      showFallback()
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

  // 桌宠配置设置页（settings.section，spec §2）：四项设置，读写经插件自身 API
  // （/api/live2d-pet/settings，Host 直连 ctx.settings；不走 settingsScope wire，
  // 见 docs/research/settings-tab.md「设置服务不可用」根因）。
  slots.inject('settings.section', () => slots.register(
    {
      name: 'settings.section',
      id: 'live2d-pet',
      order: 200,
      label: () => '桌宠配置',
    },
    (props: unknown) => createElement(PetSettingsSection, props as { close: () => void }),
  ))
}
