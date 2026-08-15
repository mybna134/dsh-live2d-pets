/**
 * 模型清单：内置 presets.json（只读策展）+ 用户自定义模型（settings 用户层）。
 * 模型一律 URL 直载（spec §6）；`config.model` 存选中 id 或 URL，此处解析为
 * `.model3.json` URL。内置/自定义均可可选覆盖空间回退分区阈值（spec §4/§6）。
 * @module dsh-live2d-pets/models
 */

import presetsData from './presets/presets.json'

/** 内置策展条目（presets.json 结构，spec §6：许可可标注）。 */
export interface BuiltinPreset {
  id: string
  name: string
  author: string
  modelUrl: string
  license: { type: string; url: string }
  cubism: number
  status: string
  /** 可选：该内置模型的空间回退覆盖。 */
  spatialTap?: SpatialTapOverride
}

/**
 * 空间回退完整阈值（相对模型包围盒，spec §4）。
 * 五个矩形：头（居中列上段）、身（居中列中段）、腿（居中列下段）、左/右臂（侧列中段）。
 * 与 client 分档 / showTapZones 色块共用。
 */
export interface SpatialTapConfig {
  /** 头带下沿：ny < headMaxNy 且在头横向列 → head */
  headMaxNy: number
  /** 腿带上沿：ny > legMinNy 且在身横向列 → leg */
  legMinNy: number
  /** 手臂高度带上沿（通常 ≈ headMaxNy） */
  armMinNy: number
  /** 头矩形左缘 */
  headMinNx: number
  /** 头矩形右缘 */
  headMaxNx: number
  /** 身/腿居中列左缘（亦为左臂右缘） */
  bodyMinNx: number
  /** 身/腿居中列右缘（亦为右臂左缘） */
  bodyMaxNx: number
  /** 左臂左缘 */
  armLeftMinNx: number
  /** 右臂右缘 */
  armRightMaxNx: number
}

/** 可选覆盖：缺省字段沿用 {@link DEFAULT_SPATIAL_TAP}。兼容旧键 armLeftMaxNx/armRightMinNx → body 列。 */
export type SpatialTapOverride = Partial<SpatialTapConfig> & {
  /** @deprecated 用 bodyMinNx */
  armLeftMaxNx?: number
  /** @deprecated 用 bodyMaxNx */
  armRightMinNx?: number
}

/**
 * 全局默认：头/腿仍整宽（兼容旧行为），身在中列、臂在两侧。
 * 内置 Hiyori 等可在 presets.json 收紧为居中五矩形。
 */
export const DEFAULT_SPATIAL_TAP: SpatialTapConfig = {
  headMaxNy: 0.32,
  legMinNy: 0.58,
  armMinNy: 0.28,
  headMinNx: 0,
  headMaxNx: 1,
  bodyMinNx: 0.38,
  bodyMaxNx: 0.62,
  armLeftMinNx: 0,
  armRightMaxNx: 1,
}

/** 用户自定义模型（名称 + URL + 可选空间分区覆盖，spec §2/§6）。 */
export interface CustomModelEntry {
  id: string
  name: string
  modelUrl: string
  /** 可选：仅该模型覆盖空间回退阈值；未写字段用默认。 */
  spatialTap?: SpatialTapOverride
}

/** 内置策展清单（只读）。 */
export function listBuiltinPresets(): BuiltinPreset[] {
  return presetsData.presets as BuiltinPreset[]
}

/** 把数值夹到 [0, 1]；非有限数回落 fallback。 */
function clamp01(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

/**
 * 将可选覆盖与默认合并为完整阈值（非法/越界值夹到 0–1）。
 * 旧字段 `armLeftMaxNx` / `armRightMinNx` 映射为 `bodyMinNx` / `bodyMaxNx`。
 */
export function mergeSpatialTap(override?: SpatialTapOverride | null): SpatialTapConfig {
  const o = override ?? {}
  const bodyMinNx = clamp01(
    o.bodyMinNx ?? o.armLeftMaxNx,
    DEFAULT_SPATIAL_TAP.bodyMinNx,
  )
  const bodyMaxNx = clamp01(
    o.bodyMaxNx ?? o.armRightMinNx,
    DEFAULT_SPATIAL_TAP.bodyMaxNx,
  )
  return {
    headMaxNy: clamp01(o.headMaxNy, DEFAULT_SPATIAL_TAP.headMaxNy),
    legMinNy: clamp01(o.legMinNy, DEFAULT_SPATIAL_TAP.legMinNy),
    armMinNy: clamp01(o.armMinNy, DEFAULT_SPATIAL_TAP.armMinNy),
    headMinNx: clamp01(o.headMinNx, DEFAULT_SPATIAL_TAP.headMinNx),
    headMaxNx: clamp01(o.headMaxNx, DEFAULT_SPATIAL_TAP.headMaxNx),
    bodyMinNx,
    bodyMaxNx,
    armLeftMinNx: clamp01(o.armLeftMinNx, DEFAULT_SPATIAL_TAP.armLeftMinNx),
    armRightMaxNx: clamp01(o.armRightMaxNx, DEFAULT_SPATIAL_TAP.armRightMaxNx),
  }
}

/**
 * 按当前选中模型解析生效空间阈值：
 * 自定义条目覆盖优先；否则内置 preset 的 `spatialTap`；再否则全局默认。
 */
export function resolveSpatialTap(model: string, customModels: CustomModelEntry[]): SpatialTapConfig {
  const custom = customModels.find((c) => c.id === model)
  if (custom?.spatialTap) return mergeSpatialTap(custom.spatialTap)
  const preset = (presetsData.presets as BuiltinPreset[]).find((p) => p.id === model)
  return mergeSpatialTap(preset?.spatialTap)
}

/**
 * 把 `config.model` 解析为可加载的 `.model3.json` URL：
 * - 已是 http(s) URL → 原样返回
 * - preset id → presets.json 匹配
 * - 自定义模型 id → settings 用户层 customModels 匹配
 * 未命中返回 null（客户端降级静态头像）。
 */
export function resolveModelUrl(model: string, customModels: CustomModelEntry[]): string | null {
  if (/^https?:\/\//.test(model)) return model
  const preset = presetsData.presets.find((p) => p.id === model)
  if (preset) return preset.modelUrl
  const custom = customModels.find((c) => c.id === model)
  if (custom) return custom.modelUrl
  return null
}
