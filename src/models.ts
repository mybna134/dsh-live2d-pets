/**
 * 模型清单：内置 presets.json（只读策展）+ 用户自定义模型（settings 用户层）。
 * 模型一律 URL 直载（spec §6）；`config.model` 存选中 id 或 URL，此处解析为
 * `.model3.json` URL。
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
}

/** 用户自定义模型（名称 + URL，spec §2/§6）。 */
export interface CustomModelEntry {
  id: string
  name: string
  modelUrl: string
}

/** 内置策展清单（只读）。 */
export function listBuiltinPresets(): BuiltinPreset[] {
  return presetsData.presets
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
