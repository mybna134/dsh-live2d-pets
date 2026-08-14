/**
 * dsh-live2d-pets host 半区：注册宠物服务、settings namespace 与同源 HTTP 路由。
 * 官方插件形态（docs/user/develop/basic/publish.md）：组合包 bundle，
 * 配置经 Schemastery Config schema 传入，并注册为 settings namespace
 * （base = cordis.yml 插件行 config，用户层覆盖，settings.yaml 持久化）。
 * @module dsh-live2d-pets
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsPathOp } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { PetService } from './service.ts'
import { makePetRoutes, petPackageRoot, type SettingsRoutesApi } from './routes.ts'
import type { CustomModelEntry } from './models.ts'

export { PetService } from './service.ts'
export type { PetState, PetStateView } from './service.ts'
export { makePetRoutes, petPackageRoot, PET_API_PREFIX, PET_ASSET_PREFIX } from './routes.ts'
export { listBuiltinPresets, resolveModelUrl } from './models.ts'
export type { BuiltinPreset, CustomModelEntry } from './models.ts'

/** 稳定 cordis 插件名（对应 cordis.patch.yml insert id）。 */
export const name = 'live2d-pet'

/** settings namespace（settings.yaml 用户层 section 名）。 */
export const SETTINGS_NAMESPACE = 'live2d-pet'

/** 品牌化 namespace（dsh-settings 类型约束）。 */
const NS = settingsNamespace(SETTINGS_NAMESPACE)

export interface Config {
  /** 插件总开关。 */
  enabled: boolean
  /** 宠物尺寸（px，滑杆 40–400）。 */
  size: number
  /** 选中模型：内置 preset id 或自定义模型 id（也兼容直接 URL）。 */
  model: string
  /** 调试模式：显示调试面板（开发用）。 */
  debug: boolean
  /** 用户自定义模型（设置面板增删改，spec §2/§6）。 */
  customModels: CustomModelEntry[]
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  size: Schema.number().min(40).max(400).default(160),
  model: Schema.string().default('hiyori'),
  debug: Schema.boolean().default(false),
  customModels: Schema.array(
    Schema.object({
      id: Schema.string(),
      name: Schema.string(),
      modelUrl: Schema.string(),
    }),
  ).default([]),
})

/** 依赖服务：webServer（同源路由）、settings（namespace 注册与解析）。 */
export const inject = ['webServer', 'settings']

/** 注册宠物服务、settings namespace 及其 API + 素材路由。 */
export function apply(ctx: Context, config: Config): void {
  // 注册 settings namespace：base = 本条 cordis.yml 条目 config 子集，
  // 用户层（settings.yaml）覆盖其上；注册随插件 fiber 自动清理。
  ctx.settings.register(NS, Config, { base: config })

  // 解析值优先（三层：schema 默认 → base → 用户层），未注册时回落 entry config。
  const resolveConfig = (): Config => {
    const resolved = ctx.settings.get(NS) as Config | undefined
    return resolved ?? config
  }

  const service = new PetService(ctx, resolveConfig)

  // 设置读写 API：Host 直连 ctx.settings（不走 wire 白名单——dsh-host-apiproxy
  // 只暴露内置 allowlist，第三方 namespace 见 research/settings-tab.md）。
  const settingsApi: SettingsRoutesApi = {
    view: () => ({ value: resolveConfig(), writable: ctx.settings.writable }),
    write: (ops: readonly SettingsPathOp[]) => ctx.settings.mutate(NS, ops),
  }

  // 路由随插件生命周期注册/清理；配置变更（HMR / settings 热更新）经 resolveConfig 即时反映。
  ctx.effect(() => {
    const routes = makePetRoutes({ service, packageRoot: petPackageRoot(import.meta.url), settings: settingsApi })
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'live2d-pet: routes')
}
