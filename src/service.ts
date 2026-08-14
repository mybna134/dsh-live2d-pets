/**
 * PetService：宠物状态机 + 显示配置 + 持久化。
 * 状态源为 DSH 真实事件（Event.listEvents 实测）：
 *   agent/status（idle⇄running）、agent/error、agent/turn-stopping、approval/request。
 * @module dsh-live2d-pets/service
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './index.ts'
import {
  loadPetPersist,
  savePetPersist,
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
    corner: string
    model: string
    debug: boolean
  }
  display: PetDisplay
  version: number
}

/** "完成"庆祝状态在回到空闲前的保持时长。 */
const DONE_HOLD_MS = 3500

export class PetService {
  private state: PetState = 'idle'
  private agent = 'idle'
  private version = 0
  private display: PetDisplay
  private doneTimer: (() => void) | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {
    this.display = loadPetPersist()
    ctx.on('agent/status', (payload) => {
      const status = payload?.status
      if (!status) return
      this.agent = String(status)
      if (status === 'running') this.set('thinking')
      else if (status === 'idle') this.set('idle')
    })
    ctx.on('agent/error', () => this.set('error'))
    ctx.on('agent/turn-stopping', () => this.setDone())
    ctx.on('approval/request', () => this.set('waiting'))
  }

  /** 立即切换状态；取消未完成的"完成"保持计时。 */
  private set(next: PetState): void {
    if (this.doneTimer) {
      this.doneTimer()
      this.doneTimer = undefined
    }
    if (this.state === next) return
    this.state = next
    this.version += 1
  }

  /** 进入"完成"并保持 DONE_HOLD_MS 后回空闲（客户端据此播庆祝动画）。 */
  private setDone(): void {
    this.set('done')
    this.doneTimer = this.ctx.timeout(() => {
      this.doneTimer = undefined
      this.set('idle')
    }, DONE_HOLD_MS)
  }

  /** 浏览器轮询用的状态快照。 */
  state(): PetStateView {
    return {
      state: this.state,
      agent: this.agent,
      config: {
        enabled: this.config.enabled,
        size: this.config.size,
        corner: this.config.corner,
        model: this.config.model,
        debug: this.config.debug,
      },
      display: { ...this.display },
      version: this.version,
    }
  }

  /** 更新显示配置（拖动/尺寸）并持久化。 */
  setDisplay(patch: Partial<PetDisplay>): PetDisplay {
    this.display = {
      right: patch.right ?? this.display.right,
      bottom: patch.bottom ?? this.display.bottom,
      size: patch.size ?? this.display.size,
    }
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
