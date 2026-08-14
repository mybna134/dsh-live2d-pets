/**
 * PetService：宠物状态机 + 显示配置 + 持久化。
 * 状态源为 DSH 真实事件（Event.listEvents 实测）：
 *   agent/status（idle⇄running）、agent/error、agent/turn-stopping、approval/request。
 * 配置经 getConfig() 读取 settings 解析值（schema 默认 → base → 用户层）。
 * @module dsh-live2d-pets/service
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { Config } from './index.ts'
import type { CustomModelEntry } from './models.ts'
import { resolveModelUrl } from './models.ts'
import {
  loadPetPersist,
  savePetPersist,
  normalizeDisplay,
  DEFAULT_DISPLAY,
  type PetDisplay,
} from './persist.ts'

export type PetState = 'idle' | 'thinking' | 'error' | 'done' | 'waiting'

export interface PetStateView {
  state: PetState
  agent: string
  config: {
    enabled: boolean
    size: number
    model: string
    /** 解析后的 .model3.json URL（模型 id → URL，spec §6）。 */
    modelUrl: string | null
    debug: boolean
  }
  display: PetDisplay
  version: number
}

/** "完成"庆祝状态在回到空闲前的保持时长（ms）。 */
const DONE_HOLD_MS = 3500

export class PetService {
  private state: PetState = 'idle'
  private agent = 'idle'
  private version = 0
  private display: PetDisplay
  private doneTimerId: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly getConfig: () => Config,
  ) {
    this.display = loadPetPersist()
    // 卸载时清理"完成"保持计时器
    ctx.effect(() => () => {
      if (this.doneTimerId) clearTimeout(this.doneTimerId)
    })

    ctx.on('agent/status', (payload) => {
      const status = payload?.status
      if (!status) return
      this.agent = String(status)
      if (status === 'running') {
        this.set('thinking')
      } else if (status === 'idle' && this.state !== 'done') {
        // done 保持期内到达的 idle 不打断庆祝（由 setDone 的计时器负责回收）
        this.set('idle')
      }
    })
    ctx.on('agent/error', () => this.set('error'))
    ctx.on('agent/turn-stopping', () => this.setDone())
    // approval/request 是 waterfall 事件：必须调用 next() 放行审批链
    ctx.on('approval/request', (_req, next) => {
      this.set('waiting')
      return next()
    })
  }

  /** 立即切换状态；取消未完成的"完成"保持计时。 */
  private set(next: PetState): void {
    if (this.doneTimerId) {
      clearTimeout(this.doneTimerId)
      this.doneTimerId = undefined
    }
    if (this.state === next) return
    this.state = next
    this.version += 1
  }

  /** 进入"完成"并保持 DONE_HOLD_MS 后回空闲（客户端据此播庆祝动画）。 */
  private setDone(): void {
    this.set('done')
    this.doneTimerId = setTimeout(() => {
      this.doneTimerId = undefined
      this.set('idle')
    }, DONE_HOLD_MS)
  }

  /** 浏览器轮询用的状态快照（配置实时读取 settings 解析值）。 */
  snapshot(): PetStateView {
    const config = this.getConfig()
    return {
      state: this.state,
      agent: this.agent,
      config: {
        enabled: config.enabled,
        size: config.size,
        model: config.model,
        modelUrl: resolveModelUrl(config.model, config.customModels),
        debug: config.debug,
      },
      display: { ...this.display },
      version: this.version,
    }
  }

  /** 用户自定义模型列表（设置面板模型列表的 custom 部分，Host 权威视图）。 */
  listCustomModels(): CustomModelEntry[] {
    return this.getConfig().customModels
  }

  /** 更新显示配置（拖动/尺寸）并持久化；数值在服务端按权威边界 clamp。 */
  setDisplay(patch: Partial<PetDisplay>): PetDisplay {
    this.display = normalizeDisplay({
      right: patch.right ?? this.display.right,
      bottom: patch.bottom ?? this.display.bottom,
      size: patch.size ?? this.display.size,
    })
    savePetPersist(this.display)
    this.version += 1
    return { ...this.display }
  }

  /** 重置为默认显示配置（调试用）。 */
  resetDisplay(): PetDisplay {
    this.display = { ...DEFAULT_DISPLAY }
    savePetPersist(this.display)
    this.version += 1
    return { ...this.display }
  }
}
