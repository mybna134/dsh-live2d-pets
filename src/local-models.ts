/**
 * 本地模型文件支持：用户填写的本地绝对路径由 Host 映射为同源 HTTP 路由
 * `/pet-local-models/<customId>/<fileName>`，浏览器无需访问 file://。
 * @module dsh-live2d-pets/local-models
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isLocalModelPath } from './models.ts'

/** 展开用户填写的 `~/...` 路径为绝对路径（其余原样返回）。 */
export function expandLocalPath(value: string): string {
  const v = value.trim()
  if (v === '~') return homedir()
  if (v.startsWith('~/') || v.startsWith('~\\')) return join(homedir(), v.slice(2))
  return v
}

/** 本地路径解析结果：模型文件所在目录 + 入口 .model3.json 文件名。 */
export interface LocalModelTarget {
  root: string
  fileName: string
}

/**
 * 解析用户填写的本地模型位置：
 * - 文件路径 → 目录 + 文件名
 * - 目录路径 → 目录 + 目录内第一个 .model3.json
 */
export function localModelTarget(modelUrl: string): LocalModelTarget | null {
  if (!isLocalModelPath(modelUrl)) return null
  const p = expandLocalPath(modelUrl)
  try {
    const st = statSync(p)
    if (st.isDirectory()) {
      const files = readdirSync(p).filter((f) => f.toLowerCase().endsWith('.model3.json'))
      if (files.length === 0) return null
      return { root: p, fileName: files[0] }
    }
    if (st.isFile()) {
      return { root: dirname(p), fileName: basename(p) }
    }
  } catch {
    return null
  }
  return null
}

/** 生成浏览器可访问的本地模型入口 URL。 */
export function localModelUrlPath(customId: string, modelUrl: string): string | null {
  const target = localModelTarget(modelUrl)
  if (!target) return null
  return `/pet-local-models/${encodeURIComponent(customId)}/${target.fileName.split(/[\\/]/).map(encodeURIComponent).join('/')}`
}

/**
 * 把一个本地目录或 `.model3.json` 文件路径解析为入口文件的绝对路径（供
 * 「选择本地文件」原生目录选择器回填 URL 用）：
 * - 文件 → 原样返回该文件绝对路径
 * - 目录 → 目录内第一个 `.model3.json` 的绝对路径
 * - 无入口文件 → null
 */
export function resolveLocalEntryFile(modelUrl: string): string | null {
  if (!isLocalModelPath(modelUrl)) return null
  const p = expandLocalPath(modelUrl)
  try {
    const st = statSync(p)
    if (st.isFile()) return resolve(p)
    if (st.isDirectory()) {
      const files = readdirSync(p).filter((f) => f.toLowerCase().endsWith('.model3.json'))
      if (files.length === 0) return null
      return resolve(p, files[0])
    }
  } catch {
    return null
  }
  return null
}

/** 把本地模型路由的相对路径安全解析为真实文件路径；越界返回 null。 */
export function resolveLocalModelFile(modelUrl: string, relativePath: string): string | null {
  const target = localModelTarget(modelUrl)
  if (!target) return null
  const root = resolve(target.root)
  const file = resolve(root, relativePath)
  const rel = relative(root, file)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  if (!existsSync(file)) return null
  return file
}

/** 路径分隔符导出（路由/测试用）。 */
export const PATH_SEP = sep
