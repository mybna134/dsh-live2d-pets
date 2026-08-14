/**
 * 桌宠配置设置页（`settings.section` 注册体，spec §2）。
 * 四项设置：开关 / 尺寸滑杆 / 模型列表（内置只读 + 自定义增删改）/ 调试模式。
 * 读写经插件自己的同源 API `/api/live2d-pet/settings`（Host 直连 ctx.settings，
 * 持久化到 settings.yaml 用户层）——不走 client settingsScope wire，因为
 * dsh-host-apiproxy 只把内置 allowlist 的 namespace 暴露给浏览器
 * （见 docs/research/settings-tab.md「设置服务不可用」根因）。
 * 不引入任何非平台模块值导入。
 * @module dsh-live2d-pets/client/settings
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, MouseEvent, ReactNode, ReactElement } from 'react'
import type { CustomModelEntry } from '../index.ts'
import type { BuiltinPreset } from '../models.ts'

/** settings namespace 的解析值（与 Host Config 对齐）。 */
export interface PetSettingsValue {
  enabled: boolean
  size: number
  model: string
  debug: boolean
  customModels: CustomModelEntry[]
}

export interface PetSettingsSectionProps {
  close: () => void
}

interface SettingsView {
  value?: PetSettingsValue
  writable?: boolean
}

interface SettingsState {
  status: 'loading' | 'ready' | 'unavailable'
  value?: PetSettingsValue
  writable: boolean
}

const DEFAULT_VALUE: PetSettingsValue = {
  enabled: true,
  size: 160,
  model: 'hiyori',
  debug: false,
  customModels: [],
}

const SETTINGS_API = '/api/live2d-pet/settings'
const MODELS_API = '/api/live2d-pet/models'

const rowStyle: CSSProperties = {
  padding: '10px 12px',
  marginBottom: 8,
  borderRadius: 8,
  background: 'rgba(128,128,128,.08)',
}

const labelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  flex: 1,
  minWidth: 0,
}

const linkStyle: CSSProperties = {
  color: 'inherit',
  fontSize: 12,
  marginLeft: 8,
}

const buttonStyle: CSSProperties = {
  marginLeft: 6,
  padding: '2px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
  background: 'rgba(128,128,128,.14)',
  color: 'inherit',
  border: 'none',
}

const inputStyle: CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid rgba(128,128,128,.35)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  minWidth: 0,
  flex: 1,
}

const sectionTitleStyle: CSSProperties = {
  margin: '16px 0 8px',
  fontSize: 13,
  fontWeight: 600,
  color: '#888',
}

/** 设置路径 op（与 Host settings.mutate 对齐）。 */
type SettingsOp = { op: 'set' | 'unset'; path: string[]; value?: unknown }

/** 读取设置（GET）。 */
async function loadSettings(): Promise<SettingsView | null> {
  try {
    const response = await fetch(SETTINGS_API)
    if (!response.ok) return null
    return await response.json() as SettingsView
  } catch {
    return null
  }
}

/** 写入设置（POST 路径 op；返回写后视图）。 */
async function writeSettings(ops: SettingsOp[]): Promise<SettingsView | null> {
  try {
    const response = await fetch(SETTINGS_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops }),
    })
    if (!response.ok) return null
    return await response.json() as SettingsView
  } catch {
    return null
  }
}

/** 单个模型行（radio 选择 + 元信息 + 右侧操作）。 */
function modelRow(
  key: string,
  selected: boolean,
  onSelect: () => void,
  meta: string,
  disabled: boolean,
  actions?: ReactNode,
  licenseLink?: ReactNode,
): ReactElement {
  return createElement('div', { key, style: { ...rowStyle, display: 'flex', alignItems: 'center', gap: 8 } },
    createElement('label', { style: { ...labelStyle, margin: 0 } },
      createElement('input', {
        type: 'radio',
        name: 'pet-model',
        checked: selected,
        disabled,
        onChange: onSelect,
      }),
      createElement('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, meta),
    ),
    licenseLink,
    actions,
  )
}

export function PetSettingsSection(): ReactNode {
  const [state, setState] = useState<SettingsState>({ status: 'loading', writable: false })
  // 最新视图 ref：写入 ops 在出队时按最新状态合成，避免快速操作读到过期闭包
  const stateRef = useRef(state)
  const setSettingsState = (next: SettingsState | ((prev: SettingsState) => SettingsState)): void => {
    const resolved = typeof next === 'function' ? next(stateRef.current) : next
    stateRef.current = resolved
    setState(resolved)
  }
  const reload = useCallback(() => {
    loadSettings().then((view) => {
      if (view === null) {
        setSettingsState((prev) => prev.status === 'ready' ? prev : { status: 'unavailable', writable: false })
        return
      }
      setSettingsState({ status: 'ready', value: view.value, writable: view.writable !== false })
    })
  }, [])
  useEffect(() => { reload() }, [reload])

  const value = state.value ?? DEFAULT_VALUE
  const writable = state.writable

  // 内置清单（Host API，只读）
  const [builtin, setBuiltin] = useState<BuiltinPreset[]>([])
  useEffect(() => {
    let alive = true
    fetch(MODELS_API)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return
        if (Array.isArray(data.builtin)) setBuiltin(data.builtin)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // 尺寸滑杆：拖动中本地草稿，松手/失焦提交（避免拖动写满 settings.yaml）
  const [draftSize, setDraftSize] = useState<number | null>(null)
  useEffect(() => { setDraftSize(null) }, [value.size])
  const size = draftSize ?? value.size
  const commitSize = () => {
    if (draftSize === null) return
    const nextSize = draftSize
    enqueueWrite(() => [{ op: 'set', path: ['size'], value: nextSize }])
    setDraftSize(null)
  }

  // 自定义模型表单（添加 + 编辑）
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')

  const custom = value.customModels ?? []

  // 写入串行化：ops 在出队时基于最新视图合成。若直接用渲染闭包里的
  // custom/value 组合完整数组替换，快速连续操作（如连删两个模型）会
  // 读到过期状态，后到的写覆盖先到的，导致已删条目被"复活"。
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const enqueueWrite = (compose: (current: PetSettingsValue) => SettingsOp[]): void => {
    writeQueue.current = writeQueue.current.then(async () => {
      const current = stateRef.current.value ?? DEFAULT_VALUE
      const view = await writeSettings(compose(current))
      if (view !== null) setSettingsState({ status: 'ready', value: view.value, writable: view.writable !== false })
    })
  }

  const addModel = () => {
    const name = newName.trim()
    const url = newUrl.trim()
    if (!name || !/^https?:\/\//.test(url)) return
    const entry: CustomModelEntry = { id: `m${Date.now()}`, name, modelUrl: url }
    enqueueWrite((current) => [{ op: 'set', path: ['customModels'], value: [...current.customModels, entry] }])
    setNewName('')
    setNewUrl('')
  }

  const saveEdit = (id: string) => {
    const name = editName.trim()
    const url = editUrl.trim()
    if (!name || !/^https?:\/\//.test(url)) return
    enqueueWrite((current) => [
      { op: 'set', path: ['customModels'], value: current.customModels.map((c) => (c.id === id ? { ...c, name, modelUrl: url } : c)) },
    ])
    setEditId(null)
  }

  const removeModel = (id: string) => {
    // 删除的是当前选中模型时，回退到第一个内置模型（builtin 加载完成前用默认 id）
    const fallbackModel = builtin[0]?.id ?? 'hiyori'
    enqueueWrite((current) => {
      const ops: SettingsOp[] = [
        { op: 'set', path: ['customModels'], value: current.customModels.filter((c) => c.id !== id) },
      ]
      if (current.model === id) ops.push({ op: 'set', path: ['model'], value: fallbackModel })
      return ops
    })
  }

  // ---- 组装页面 ----
  const builtinRows = builtin.map((p) => modelRow(
    `builtin-${p.id}`,
    value.model === p.id,
    () => enqueueWrite(() => [{ op: 'set', path: ['model'], value: p.id }]),
    `${p.name}（${p.author}）`,
    !writable,
    undefined,
    createElement('a', {
      key: 'license',
      href: p.license?.url,
      target: '_blank',
      rel: 'noreferrer',
      style: linkStyle,
      onClick: (e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation(),
    }, p.license?.type ?? '许可'),
  ))

  const customRows = custom.map((c) => {
    if (editId === c.id) {
      return createElement('div', { key: c.id, style: { ...rowStyle, display: 'flex', gap: 6, alignItems: 'center' } },
        createElement('input', {
          style: inputStyle,
          value: editName,
          placeholder: '名称',
          onChange: (e: ChangeEvent<HTMLInputElement>) => setEditName(e.target.value),
        }),
        createElement('input', {
          style: inputStyle,
          value: editUrl,
          placeholder: 'https://…/model3.json',
          onChange: (e: ChangeEvent<HTMLInputElement>) => setEditUrl(e.target.value),
        }),
        createElement('button', { style: buttonStyle, onClick: () => saveEdit(c.id) }, '保存'),
        createElement('button', { style: buttonStyle, onClick: () => setEditId(null) }, '取消'),
      )
    }
    return modelRow(
      `custom-${c.id}`,
      value.model === c.id,
      () => enqueueWrite(() => [{ op: 'set', path: ['model'], value: c.id }]),
      c.name,
      !writable,
      createElement('span', { key: 'actions' },
        createElement('button', { style: buttonStyle, onClick: () => { setEditId(c.id); setEditName(c.name); setEditUrl(c.modelUrl) } }, '修改'),
        createElement('button', { style: buttonStyle, onClick: () => removeModel(c.id) }, '删除'),
      ),
      undefined,
    )
  })

  const children: ReactNode[] = [
    createElement('h3', { key: 'title', style: { margin: '0 0 4px' } }, '桌宠配置'),
    createElement('p', { key: 'sub', style: { margin: '0 0 12px', color: '#888', fontSize: 12 } },
      '设置经 $DSH_HOME/settings.yaml 持久化，立即生效。'),
  ]

  if (state.status !== 'ready') {
    children.push(createElement('div', { key: 'notice', style: { ...rowStyle, color: '#b45309' } },
      state.status === 'unavailable' ? '设置服务不可用（Host 插件未加载）。' : '设置加载中…',
    ))
  }

  // 1. 开关
  children.push(createElement('div', { key: 'enabled', style: rowStyle },
    createElement('label', { style: labelStyle },
      createElement('input', {
        type: 'checkbox',
        checked: !!value.enabled,
        disabled: !writable,
        onChange: (e: ChangeEvent<HTMLInputElement>) => enqueueWrite(() => [{ op: 'set', path: ['enabled'], value: e.target.checked }]),
      }),
      createElement('span', null, '显示宠物'),
    ),
  ))

  // 2. 尺寸滑杆
  children.push(createElement('div', { key: 'size', style: rowStyle },
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      createElement('span', { style: { whiteSpace: 'nowrap' } }, '尺寸'),
      createElement('input', {
        type: 'range',
        min: 40,
        max: 400,
        step: 1,
        value: size,
        disabled: !writable,
        style: { flex: 1 },
        onChange: (e: ChangeEvent<HTMLInputElement>) => setDraftSize(Number(e.target.value)),
        onPointerUp: commitSize,
        onKeyUp: commitSize,
        onBlur: commitSize,
      }),
      createElement('span', { style: { width: 56, textAlign: 'right', color: '#888', fontSize: 12 } }, `${size}px`),
    ),
  ))

  // 3. 模型列表
  children.push(createElement('div', { key: 'models' },
    createElement('div', { style: sectionTitleStyle }, '内置模型（只读）'),
    builtinRows.length > 0 ? builtinRows : createElement('div', { style: { color: '#888', fontSize: 12 } }, '清单加载中…'),
    createElement('div', { style: sectionTitleStyle }, '我的模型'),
    customRows.length > 0 ? customRows : createElement('div', { style: { color: '#888', fontSize: 12, marginBottom: 8 } }, '尚未添加自定义模型'),
    createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      createElement('input', {
        style: inputStyle,
        value: newName,
        placeholder: '名称',
        disabled: !writable,
        onChange: (e: ChangeEvent<HTMLInputElement>) => setNewName(e.target.value),
      }),
      createElement('input', {
        style: inputStyle,
        value: newUrl,
        placeholder: 'https://…/xxx.model3.json',
        disabled: !writable,
        onChange: (e: ChangeEvent<HTMLInputElement>) => setNewUrl(e.target.value),
      }),
      createElement('button', { style: buttonStyle, onClick: addModel, disabled: !writable }, '添加'),
    ),
  ))

  // 4. 调试模式（与上方模型添加区留出间距）
  children.push(createElement('div', { key: 'debug', style: { ...rowStyle, marginTop: 12 } },
    createElement('label', { style: labelStyle },
      createElement('input', {
        type: 'checkbox',
        checked: !!value.debug,
        disabled: !writable,
        onChange: (e: ChangeEvent<HTMLInputElement>) => enqueueWrite(() => [{ op: 'set', path: ['debug'], value: e.target.checked }]),
      }),
      createElement('span', null, '调试模式（显示调试面板）'),
    ),
  ))

  return createElement('div', { style: { padding: '16px 20px', maxWidth: 560 } }, children)
}
