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
import type { CustomPersonaDef } from '../persona-shared.ts'
import { PERSONAS_TEMPLATE } from '../persona-shared.ts'
import { builtinPersonaOptions } from './personas.ts'

/** settings namespace 的解析值（与 Host Config 对齐）。 */
export interface PetSettingsValue {
  enabled: boolean
  size: number
  model: string
  debug: boolean
  customModels: CustomModelEntry[]
  persona: string
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
  persona: 'tsundere',
}

const SETTINGS_API = '/api/live2d-pet/settings'
const MODELS_API = '/api/live2d-pet/models'
const STATE_API = '/api/live2d-pet/state'
const RELOAD_PERSONAS_API = '/api/live2d-pet/reload-personas'

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

/** 下拉选项（与设置页其它控件同色板，避免原生 select 的白框/底线）。 */
interface ThemeSelectOption {
  id: string
  name: string
}

interface ThemeSelectProps {
  value: string
  options: ThemeSelectOption[]
  disabled?: boolean
  onChange: (id: string) => void
}

/**
 * 自绘下拉：原生 select 在 Windows 深色主题下会出焦点白框与 options 底部白线，
 * UA 弹出层几乎不可主题化，故用同色板菜单替代。
 */
function ThemeSelect(props: ThemeSelectProps): ReactElement {
  const { value, options, disabled, onChange } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const label = options.find((o) => o.id === value)?.name ?? value

  useEffect(() => {
    if (!open) return
    const onDoc = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return createElement('div', {
    ref: rootRef,
    style: { position: 'relative', flex: 1, minWidth: 0 },
  },
    createElement('button', {
      type: 'button',
      disabled: !!disabled,
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      onClick: () => { if (!disabled) setOpen((v) => !v) },
      style: {
        ...inputStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: 'rgba(128,128,128,.14)',
        outline: 'none',
        boxShadow: 'none',
        opacity: disabled ? 0.55 : 1,
      },
    },
      createElement('span', {
        style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      }, label),
      createElement('span', { style: { color: '#888', fontSize: 10, flexShrink: 0 } }, open ? '▴' : '▾'),
    ),
    open && createElement('div', {
      role: 'listbox',
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 'calc(100% + 4px)',
        zIndex: 20,
        margin: 0,
        padding: 4,
        borderRadius: 8,
        border: '1px solid rgba(128,128,128,.35)',
        background: '#2a2a2e',
        color: '#e8e8ec',
        boxShadow: '0 8px 24px rgba(0,0,0,.45)',
        maxHeight: 240,
        overflowY: 'auto',
      },
    },
      options.map((o) => {
        const selected = o.id === value
        return createElement('button', {
          key: o.id,
          type: 'button',
          role: 'option',
          'aria-selected': selected,
          onClick: () => { onChange(o.id); setOpen(false) },
          style: {
            display: 'block',
            width: '100%',
            margin: 0,
            padding: '6px 10px',
            border: 'none',
            borderRadius: 6,
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: 13,
            color: '#e8e8ec',
            background: selected ? 'rgba(120,170,255,.28)' : 'transparent',
            outline: 'none',
          },
          onMouseEnter: (e: MouseEvent<HTMLButtonElement>) => {
            if (!selected) e.currentTarget.style.background = 'rgba(128,128,128,.22)'
          },
          onMouseLeave: (e: MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.background = selected ? 'rgba(120,170,255,.28)' : 'transparent'
          },
        }, o.name)
      }),
    ),
  )
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

/** 「自定义人设 ↗」直达打开（由插件入口注入；返回是否成功，失败走弹层兜底）。 */
export interface PetSettingsProps {
  openPath?: (path: string) => Promise<boolean>
}

interface PersonaStateView {
  persona: string
  customPersonas: CustomPersonaDef[]
  personasError: string | null
  personasFile: string
}

/** 拉取宠物状态（人设区数据源）。 */
async function loadPersonaState(): Promise<PersonaStateView | null> {
  try {
    const response = await fetch(STATE_API)
    if (!response.ok) return null
    return await response.json() as PersonaStateView
  } catch {
    return null
  }
}

/** 写剪贴板（尽力而为）。 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function PetSettingsSection(props: PetSettingsProps): ReactNode {
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

  // ---- 人设区（spec §2/§3）：下拉选择 + 重新读取 + 自定义人设入口 ----
  const [personaState, setPersonaState] = useState<PersonaStateView | null>(null)
  const [personaNotice, setPersonaNotice] = useState<string | null>(null)
  const [showPersonaPopover, setShowPersonaPopover] = useState(false)
  const reloadPersonaState = useCallback(() => {
    loadPersonaState().then((view) => { if (view) setPersonaState(view) })
  }, [])
  useEffect(() => { reloadPersonaState() }, [reloadPersonaState])

  const builtinPersonaList = builtinPersonaOptions()
  const customPersonaList = personaState?.customPersonas ?? []
  const activePersona = personaState?.persona ?? value.persona

  const reloadPersonas = () => {
    setPersonaNotice('读取中…')
    fetch(RELOAD_PERSONAS_API, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { error?: string | null } | null) => {
        reloadPersonaState()
        setPersonaNotice(data?.error ? `已重读：${data.error}` : '已重新读取人设文件')
      })
      .catch(() => setPersonaNotice('重新读取失败（Host 不可达）'))
  }

  const openPersonasFile = () => {
    const file = personaState?.personasFile
    if (!file) return
    const opened = props.openPath?.(file) ?? Promise.resolve(false)
    opened.then((ok) => {
      if (ok) {
        setPersonaNotice('已用系统默认程序打开人设文件')
      } else {
        setShowPersonaPopover(true)
      }
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
        // 受控 checkbox 的事件期捕获：React 在 onChange 后会同步把 DOM
        // 复位回上次渲染值，若出队时才读 e.target.checked 永远读到旧值
        onChange: (e: ChangeEvent<HTMLInputElement>) => {
          const next = e.target.checked
          enqueueWrite(() => [{ op: 'set', path: ['enabled'], value: next }])
        },
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

  // 3. 人设（spec §2/§3）：下拉切换（全部台词即时换语气）+ 文件工具行
  const personaOptions = [
    ...builtinPersonaList,
    ...customPersonaList.map((p) => ({ id: p.id, name: p.name ?? p.id })),
  ]
  children.push(createElement('div', { key: 'persona', style: rowStyle },
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: personaNotice || personaState?.personasError ? 6 : 0 } },
      createElement('span', { style: { whiteSpace: 'nowrap' } }, '人设'),
      createElement(ThemeSelect, {
        value: activePersona,
        options: personaOptions,
        disabled: !writable,
        onChange: (id: string) => {
          enqueueWrite(() => [{ op: 'set', path: ['persona'], value: id }])
        },
      }),
      createElement('button', { style: buttonStyle, onClick: reloadPersonas }, '↻ 重新读取'),
      createElement('button', { style: buttonStyle, onClick: openPersonasFile }, '自定义人设 ↗'),
    ),
    (personaState?.personasError || personaNotice) && createElement('div', {
      key: 'persona-notice',
      style: { color: personaState?.personasError ? '#b45309' : '#888', fontSize: 12 },
    },
      (personaState?.personasError ? `人设文件：${personaState.personasError}` : null) ?? personaNotice,
    ),
    showPersonaPopover && createElement('div', {
      key: 'persona-popover',
      style: { marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(128,128,128,.12)', fontSize: 12, wordBreak: 'break-all' },
    },
      createElement('div', null, '无法直接打开，请手动编辑人设文件：'),
      createElement('div', { style: { margin: '4px 0', color: '#666' } }, personaState?.personasFile ?? ''),
      createElement('div', { style: { display: 'flex', gap: 6 } },
        createElement('button', {
          style: buttonStyle,
          onClick: () => { void copyText(personaState?.personasFile ?? '').then((ok) => setPersonaNotice(ok ? '已复制文件路径' : '复制失败')) },
        }, '复制路径'),
        createElement('button', {
          style: buttonStyle,
          onClick: () => { void copyText(PERSONAS_TEMPLATE).then((ok) => setPersonaNotice(ok ? '已复制人设模板（女仆示例）' : '复制失败')) },
        }, '复制模板'),
        createElement('button', { style: buttonStyle, onClick: () => setShowPersonaPopover(false) }, '收起'),
      ),
    ),
  ))

  // 4. 模型列表
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

  // 5. 调试模式（与上方模型添加区留出间距）
  children.push(createElement('div', { key: 'debug', style: { ...rowStyle, marginTop: 12 } },
    createElement('label', { style: labelStyle },
      createElement('input', {
        type: 'checkbox',
        checked: !!value.debug,
        disabled: !writable,
        // 同 enabled:事件期捕获,避免受控复位覆盖出队时的读取
        onChange: (e: ChangeEvent<HTMLInputElement>) => {
          const next = e.target.checked
          enqueueWrite(() => [{ op: 'set', path: ['debug'], value: next }])
        },
      }),
      createElement('span', null, '调试模式（显示调试面板）'),
    ),
  ))

  return createElement('div', { style: { padding: '16px 20px', maxWidth: 560 } }, children)
}
