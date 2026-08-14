/**
 * dsh-live2d-pets host 半区：注册宠物服务与同源 HTTP 路由。
 * 官方插件形态（docs/user/develop/basic/publish.md）：组合包 bundle，
 * 配置经 Schemastery Config schema（cordis.yml 插件行 config 传入，HMR 热替换）。
 * @module dsh-live2d-pets
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { PetService } from './service.ts'
import { makePetRoutes, petPackageRoot } from './routes.ts'

export { PetService } from './service.ts'
export type { PetState, PetStateView } from './service.ts'
export { makePetRoutes, petPackageRoot, PET_API_PREFIX, PET_ASSET_PREFIX } from './routes.ts'

/** 稳定 cordis 插件名（对应 cordis.patch.yml insert id）。 */
export const name = 'live2d-pet'

export interface Config {
  /** 插件总开关。 */
  enabled: boolean
  /** 宠物尺寸（px）。 */
  size: number
  /** 默认停靠角：首次显示位置与「重置位置」目标（拖动后为自由位置）。 */
  corner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  /** 模型：预设 id 或 .model3.json URL。 */
  model: string
  /** 调试模式：显示调试面板（开发用）。 */
  debug: boolean
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  size: Schema.number().min(40).max(400).default(160),
  corner: Schema.union(['bottom-right', 'bottom-left', 'top-right', 'top-left']).default('bottom-right'),
  model: Schema.string().default('preset-1'),
  debug: Schema.boolean().default(false),
})

/** 依赖服务：webServer（路由）+ timer（完成状态保持计时）。 */
export const inject = ['webServer', 'timer']

/** 注册宠物服务及其 API + 素材路由。 */
export function apply(ctx: Context, config: Config): void {
  const service = new PetService(ctx, config)

  // 路由随插件生命周期注册/清理；配置变更（HMR）会整体重载本 apply。
  ctx.effect(() => {
    const routes = makePetRoutes({ service, packageRoot: petPackageRoot(import.meta.url) })
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'live2d-pet: routes')
}
