/**
 * dsh-live2d-pets 浏览器半区：挂载 Live2D 桌宠 + 「桌宠配置」设置页。
 *
 * 架构（ADR-005 / 004，spike pkg-9 实证）：
 * - `shell.overlay` 注册零尺寸锚点（生命周期/设置锚点）
 * - 视觉层用 Popover API（top layer，零 z-index）渲染，旧浏览器回退 body + 最大 z-index
 * - 运行时脚本与预设模型走 Host 同源路由（/pet-assets/*），无 CDN 依赖
 * - agent 状态经 /api/live2d-pet/events SSE 推送（首帧快照 + 变更推送，ADR-006）；
 *   标签页隐藏/窗口失焦暂停渲染循环，恢复时继续（spec §7）
 * - 点击/拖动按 6px 阈值判定；自由位置拖动，松手持久化（spec §4）
 * - 配置（enabled/size/debug/model）经状态推送运行时应用：开关→显隐+停启渲染、
 *   尺寸→重设画布与模型适配、调试→动态面板、模型→按 modelUrl 重载（spec §2/§6/§7）
 * @module dsh-live2d-pets/client
 */

import { createElement, useEffect, useRef } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactNode } from 'react'
import type { PetState, PetStateView } from '../service.ts'
import { PetSettingsSection } from './settings.ts'
import { installPetSettingsNavIcon, pawNavIcon } from './paw-icon.ts'
import { resolvePersonaCopy, BUILTIN_PERSONAS } from './personas.ts'
import type { CopyTable } from '../persona-shared.ts'
import { DEFAULT_PERSONA_ID } from '../persona-shared.ts'

/** 注入所需服务。 */
export const inject = ['slots']

/** 点击/拖动判定阈值（px）。 */
const DRAG_THRESHOLD = 6
/** 交互/瞬态状态气泡冷却（ms）。 */
const BUBBLE_COOLDOWN_MS = 2000
/** 瞬态气泡显示时长（ms）：到时自动隐藏。 */
const BUBBLE_DISPLAY_MS = 2500
/**
 * 渲染帧率上限（spec §7）：未封顶时 PIXI ticker 可达 120–140fps，
 * 长时间挂页会持续占满 GPU/主线程；桌宠动画 30fps 足够。
 */
const PET_MAX_FPS = 30
/**
 * 阶段演进气泡（spec §3）：思考/等审批为长状态（可达数十秒以上），气泡与
 * 状态同生命周期**常驻**，文案按入态后耗时推进（afterMs 为距入态偏移），
 * 阶段切换时重播一次状态动作；状态一变即被新状态表现取代。
 * 文案取自当前人设台词表（thinking1..3 / waiting1..3，spec §3 人设化台词）。
 */
const STAGED_DELAYS: Partial<Record<PetState, number[]>> = {
  thinking: [0, 15_000, 40_000],
  waiting: [0, 30_000, 90_000],
}
/** 长状态阶段文案池键。 */
type StageCopyKey = 'thinking1' | 'thinking2' | 'thinking3' | 'waiting1' | 'waiting2' | 'waiting3'
/** 长状态 → 台词池键（与 STAGED_DELAYS 下标对应）。 */
const STAGED_COPY_KEYS: Partial<Record<PetState, StageCopyKey[]>> = {
  thinking: ['thinking1', 'thinking2', 'thinking3'],
  waiting: ['waiting1', 'waiting2', 'waiting3'],
}
/** 短状态（瞬态气泡）→ 台词池键；无键的状态不冒泡。 */
const TRANSIENT_COPY_KEYS: Partial<Record<PetState, 'idle' | 'error' | 'done'>> = {
  idle: 'idle',
  error: 'error',
  done: 'done',
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
      maxFPS?: number
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
      /** 设置导航图标：ReactNode 或按尺寸渲染（与 better-sidebar 等同款约定）。 */
      icon?: ReactNode | ((size: number) => ReactNode)
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
  /** pixi-live2d-display 真实签名：hitTest(x, y) 返回**命中的区域名数组**（spec §4）。 */
  hitTest(x: number, y: number): string[]
  internalModel?: { hitAreas?: Record<string, unknown> }
}

/** 互动部位（spec §4 四档分部位）。 */
type TapPart = 'head' | 'leg' | 'arm' | 'body'

/** 命中区域名 → 部位分桶（正则容错：不同模型命名不一）；未匹配的命中区域归身体。 */
const TAP_PART_MATCHERS: Array<{ part: TapPart; re: RegExp }> = [
  { part: 'head', re: /head|hair|face|头/i },
  { part: 'leg', re: /leg|foot|feet|shoe|腿|脚/i },
  { part: 'arm', re: /arm|hand|手/i },
]

/** 部位 → 候选动作链（逐个按模型可用性尝试，最终回退 TapBody，spec §4）。 */
const TAP_PART_MOTIONS: Record<TapPart, string[]> = {
  head: ['TapHead', 'TapBody'],
  leg: ['TapLeg', 'TapBody'],
  arm: ['TapArm', 'TapBody'],
  body: ['TapBody'],
}

/**
 * 按优先级（头 > 腿 > 手 > 身体）把命中区域名列表归类到一个部位；
 * 空列表（点击落在所有命中区域之外）返回 null 不响应。
 */
function classifyTap(hits: readonly string[]): TapPart | null {
  if (hits.length === 0) return null
  for (const { part, re } of TAP_PART_MATCHERS) {
    if (hits.some((name) => re.test(name))) return part
  }
  return 'body'
}

/** 从台词池随机取一句。 */
function pickLine(pool: readonly string[]): string | undefined {
  if (pool.length === 0) return undefined
  return pool[Math.floor(Math.random() * pool.length)]
}

/** JSON 响应读取:非 2xx 抛错——错误响应不得当作合法视图/结果解析。 */
async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`http ${res.status}`)
  return await res.json() as T
}

const api = {
  state: (): Promise<PetStateView> => fetch(`${PET_API}/state`).then((res) => readJson<PetStateView>(res)),
  /** SSE 状态订阅（ADR-006）：每次推送回调最新快照；断线由 EventSource
   *  自动重连（服务端 retry 3s），重连后首帧即全量快照。返回退订函数。 */
  events: (onState: (view: PetStateView) => void, onError: () => void): (() => void) => {
    const es = new EventSource(`${PET_API}/events`)
    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        onState(JSON.parse(ev.data) as PetStateView)
      } catch {
        // 忽略坏帧，等待下一条
      }
    }
    es.onerror = onError
    return () => es.close()
  },
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
  // 避免 StrictMode 双挂载 / HMR 重挂载时残留第二份 PIXI app、SSE 订阅与脚本注入。
  let disposed = false
  pushCleanup(() => { disposed = true })
  // 阶段推进/瞬态气泡计时随卸载清理（HMR/StrictMode 重挂载不残留）
  pushCleanup(() => { clearStages(); clearBubbleHideTimer() })
  pushCleanup(() => {
    if (sizeRaf) { window.cancelAnimationFrame(sizeRaf); sizeRaf = 0 }
    pendingSize = null
  })

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
      maxFPS?: number
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
  // 尺寸变更合并：SSE 连发时只落地最后一档，避免主线程串行多次 WebGL resize（实测单次可达数秒）
  let pendingSize: number | null = null
  let sizeRaf = 0
  let lastBubbleAt = 0
  let bubbleHideTimer: number | undefined
  let stageTimers: number[] = []
  let stagedState: PetState | null = null
  let stageIndex = 0
  let lastState: PetState | null = null
  let demoState: PetState | null = null
  let view: PetStateView | null = null
  let pos: DisplayLike = { right: 24, bottom: 20, size: 160 }
  // 渲染开关：插件 enabled（配置）与页面可见性（spec §7）共同决定 ticker 是否运行
  let enabled = true
  let hidden = document.visibilityState !== 'visible'
  // 当前人设台词表（spec §3：内置常量 or 自定义 base 链合并；人设切换时热更新）
  let activePersonaId: string = DEFAULT_PERSONA_ID
  let activeCopy: CopyTable = resolvePersonaCopy(DEFAULT_PERSONA_ID, [])
  let lastCustomPersonas: PetStateView['customPersonas'] = []
  let personaDefsVersion = -1

  /** 合并 enabled/隐藏/失焦状态，启停渲染循环（spec §7：暂停渲染保留最后画面）。 */
  function syncTicker(): void {
    if (!app) return
    const shouldRun = enabled && !hidden
    if (shouldRun) { try { app.ticker.start() } catch { /* 已启动 */ } }
    else { try { app.ticker.stop() } catch { /* 已停止 */ } }
  }

  function clearBubbleHideTimer(): void {
    if (bubbleHideTimer !== undefined) {
      window.clearTimeout(bubbleHideTimer)
      bubbleHideTimer = undefined
    }
  }

  /** 显示常驻气泡文案：取消瞬态隐藏计时，气泡保持可见直到被取代。 */
  function setBubbleText(text: string): void {
    if (!bubble) return
    clearBubbleHideTimer()
    bubble.textContent = text
    bubble.style.opacity = '1'
  }

  /** 重绘当前阶段文案（阶段推进/瞬态气泡到时回落/拖拽结束后恢复）。 */
  function showStageText(): void {
    if (!stagedState) return
    const key = STAGED_COPY_KEYS[stagedState]?.[stageIndex]
    if (!key) return
    const line = pickLine(activeCopy[key])
    if (line !== undefined) setBubbleText(line)
  }

  /**
   * 瞬态气泡（交互/短状态，spec §3/§4）：冷却防刷屏；到时隐藏——若正处于
   * 阶段演进状态则回落到当前阶段文案（交互短暂抢占常驻气泡，过后归还）。
   */
  function showBubble(text: string): void {
    if (!bubble) return
    const now = Date.now()
    if (now - lastBubbleAt < BUBBLE_COOLDOWN_MS) return
    lastBubbleAt = now
    setBubbleText(text)
    bubbleHideTimer = window.setTimeout(() => {
      bubbleHideTimer = undefined
      if (stagedState) showStageText()
      else if (bubble) bubble.style.opacity = '0'
    }, BUBBLE_DISPLAY_MS)
  }

  /** 退出阶段演进状态：取消全部阶段计时并复位标记。 */
  function clearStages(): void {
    for (const t of stageTimers) window.clearTimeout(t)
    stageTimers = []
    stagedState = null
    stageIndex = 0
  }

  /** 进入阶段演进状态：立即显示阶段 0 并按偏移调度后续阶段（spec §3）。 */
  function enterStaged(state: PetState): void {
    clearStages()
    const delays = STAGED_DELAYS[state]
    const keys = STAGED_COPY_KEYS[state]
    if (!delays || !keys || delays.length === 0) return
    stagedState = state
    stageIndex = 0
    showStageText()
    for (let i = 1; i < delays.length; i++) {
      stageTimers.push(window.setTimeout(() => {
        stageIndex = i
        // 拖拽中暂停气泡与动作（spec §4），阶段静默推进、松手后恢复新阶段
        if (!dragging) {
          showStageText()
          playState(state)
        }
      }, delays[i]))
    }
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
    // 人设热更新（spec §3）：persona 或自定义清单变化时重算台词表；
    // 若正处于长状态，当前阶段气泡立即换新语气重绘（不打断计时节奏）
    const personaId = next?.config.persona || DEFAULT_PERSONA_ID
    if (personaId !== activePersonaId || personaDefsVersion !== next?.version) {
      const customs = next?.customPersonas ?? []
      const changed = personaId !== activePersonaId
        || customs.length !== lastCustomPersonas.length
        || customs.some((p, i) => p !== lastCustomPersonas[i])
      if (changed) {
        lastCustomPersonas = customs
        activePersonaId = personaId
        activeCopy = resolvePersonaCopy(personaId, customs)
        if (stagedState && !dragging) showStageText()
      }
      personaDefsVersion = next?.version ?? -1
    }
    // 状态变化时播状态气泡与状态动作（spec §3）：长状态（思考/等审批）走
    // 阶段演进常驻气泡，短状态气泡瞬态显示；交互气泡走冷却防刷屏。
    // 动作只在状态变化（及长状态阶段推进）时触发——pixi-live2d-display 的
    // motion() 每次调用都会 stopAllMotions 从头播放,若随状态推送无条件重放,
    // 待机动画永远播不满一个循环、互动动作也会在下次推送被掐断。
    if (state !== lastState) {
      lastState = state
      if (STAGED_DELAYS[state]) {
        enterStaged(state)
      } else {
        clearStages()
        const key = TRANSIENT_COPY_KEYS[state]
        const line = key ? pickLine(activeCopy[key]) : undefined
        if (line !== undefined) showBubble(line)
      }
      playState(state)
    }
    if (debugEl) {
      debugEl.textContent =
        `agent: ${next?.agent ?? '-'}  pet: ${state}  v${next?.version ?? '-'}\n` +
        `persona: ${activePersonaId}  hitAreas: ${hitAreas.join(',') || '-'}\n` +
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

  /** 立即应用画布尺寸（仅 renderer.resize，避免先写 canvas.width 清空缓冲造成闪屏）。 */
  function applySizeNow(nextSize: number): void {
    if (canvas && app) {
      const w = nextSize
      const h = Math.round(nextSize * 1.2)
      try { app.renderer.resize(w, h) } catch { /* 旧渲染器 */ }
      pos.size = nextSize
      if (model) fitModel(nextSize)
    } else {
      pos.size = nextSize
    }
  }

  /** 合并同帧/连发的尺寸变更：只落地最后一档（防 SSE 风暴卡死主线程）。 */
  function scheduleSize(nextSize: number): void {
    if (nextSize === pos.size && pendingSize === null) return
    pendingSize = nextSize
    if (sizeRaf) return
    sizeRaf = window.requestAnimationFrame(() => {
      sizeRaf = 0
      const size = pendingSize
      pendingSize = null
      if (size !== null && size !== pos.size) applySizeNow(size)
    })
  }

  /** 销毁当前渲染层（app/canvas/模型引用/静态头像占位）。 */
  function teardownLayer(): void {
    if (sizeRaf) { window.cancelAnimationFrame(sizeRaf); sizeRaf = 0 }
    pendingSize = null
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

      app = new PIXI.Application({
        view: canvas,
        width: canvas.width,
        height: canvas.height,
        backgroundAlpha: 0,
        antialias: false,
        powerPreference: 'low-power',
      })
      try { app.ticker.maxFPS = PET_MAX_FPS } catch { /* 旧 ticker */ }
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
      for (const st of ['idle', 'thinking', 'waiting', 'done', 'error'] as const) {
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
    // 开关：显示/隐藏 + 暂停/恢复渲染循环（syncTicker 合并隐藏/失焦状态，spec §7）
    if (box) box.style.display = cfg.enabled ? '' : 'none'
    enabled = cfg.enabled
    syncTicker()
    // 调试面板
    ensureDebugPanel(cfg.debug)
    // 尺寸：合并后重设画布 + 模型适配（避免连发 SSE 同步卡死主线程）
    const nextSize = cfg.size
    if (nextSize !== pos.size) scheduleSize(nextSize)
    // 模型：modelUrl 变化 → 重载
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
      // 拖拽中隐藏的常驻气泡恢复当前阶段文案（spec §4：拖拽中暂停、结束恢复）
      showStageText()
    } else {
      handleTap(e)
    }
    down = null
    dragging = false
  }
  function handleTap(e: PointerEvent): void {
    if (!canvas || !model) return
    try {
      const rect = canvas.getBoundingClientRect()
      // hitTest(x, y) 吃画布世界坐标（库内部做模型空间转换），返回命中的区域名数组
      const hits = model.hitTest(e.clientX - rect.left, e.clientY - rect.top)
      const part = classifyTap(hits)
      if (part === null) return
      const line = pickLine(activeCopy[`tap${part[0].toUpperCase()}${part.slice(1)}` as 'tapHead' | 'tapLeg' | 'tapArm' | 'tapBody'])
      if (line !== undefined) showBubble(line)
      const [first, ...fallbacks] = TAP_PART_MOTIONS[part]
      void playInteractionMotion(first, ...fallbacks)
    } catch {
      // 命中检测异常：忽略本次点击
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

      // 5. 状态订阅（SSE 推送，ADR-006）：替代 v0.1 的 800ms 轮询。
      //    断线由 EventSource 自动重连，重连后首帧即全量快照，无需补偿拉取。
      const handleState = (next: PetStateView): void => {
        if (disposed) return
        view = next
        // 位置取持久化值；渲染尺寸保持现状，由 applyConfig 负责 diff 与更新
        pos = { right: next.display.right, bottom: next.display.bottom, size: pos.size }
        applyConfig(next)
        applyState(next)
      }
      let closeEvents: (() => void) | undefined
      try {
        closeEvents = api.events(handleState, () => { /* 断线重连中，EventSource 自动重试 */ })
      } catch {
        // EventSource 不可用：保留首帧快照（静态宠物），不再更新
      }
      // 标签页隐藏/窗口失焦 → 暂停渲染循环；恢复时继续（spec §7）
      const onVisibility = () => { hidden = document.visibilityState !== 'visible'; syncTicker() }
      const onBlur = () => { hidden = true; syncTicker() }
      const onFocus = () => { hidden = false; syncTicker() }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('blur', onBlur)
      window.addEventListener('focus', onFocus)
      pushCleanup(() => {
        closeEvents?.()
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('focus', onFocus)
      })

      // 6. 初始应用（含开关/尺寸/调试/模型；SSE 首帧到达前先用已拉到的快照）
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

  // 「自定义人设 ↗」直达打开（spec §2）：优先经 DSH workspaces.openPath 用系统
  // 默认程序打开人设文件；服务不存在/无权限/打开失败由设置页弹层兜底。
  const openPath = async (path: string): Promise<boolean> => {
    try {
      const workspaces = ctx.get('workspaces') as { openPath?: (p: string) => Promise<void> } | undefined
      if (!workspaces?.openPath) return false
      await workspaces.openPath(path)
      return true
    } catch {
      return false
    }
  }

  // 桌宠配置设置页（settings.section，spec §2）：开关/尺寸/人设/模型列表/调试，
  // 读写经插件自身 API（/api/live2d-pet/settings，Host 直连 ctx.settings；
  // 不走 settingsScope wire，见 docs/research/settings-tab.md「设置服务不可用」根因）。
  // 桌宠配置设置页（settings.section，spec §2）：开关/尺寸/人设/模型列表/调试，
  // 读写经插件自身 API（/api/live2d-pet/settings，Host 直连 ctx.settings；
  // 不走 settingsScope wire，见 docs/research/settings-tab.md「设置服务不可用」根因）。
  // 导航爪印：平台 settings-general 按 id 硬编码图标（未知 id→齿轮），故 register.icon
  // 暂不生效；installPetSettingsNavIcon 在 DOM 层替换，卸载时一并清理。
  slots.inject('settings.section', () => {
    const stopNavIcon = installPetSettingsNavIcon()
    const disposeSection = slots.register(
      {
        name: 'settings.section',
        id: 'live2d-pet',
        order: 200,
        label: () => '桌宠配置',
        icon: pawNavIcon,
      },
      () => createElement(PetSettingsSection, { openPath }),
    )
    return () => {
      stopNavIcon()
      disposeSection()
    }
  })
}
