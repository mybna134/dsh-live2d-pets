import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonasStore, stripJsonComments, normalizeCustomPersona } from './personas.ts'
import { PERSONAS_TEMPLATE } from './persona-shared.ts'

let home = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-live2d-pet-personas-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

describe('stripJsonComments', () => {
  it('去掉行注释与块注释，保留字符串内的注释符', () => {
    const src = `{
      // 行注释
      "a": "http://x//y", /* 块注释 */
      "b": "含/*块*/字面量",
      "c": "转义\\"引号//仍字符串"
    }`
    const out = JSON.parse(stripJsonComments(src)) as Record<string, string>
    expect(out.a).toBe('http://x//y')
    expect(out.b).toBe('含/*块*/字面量')
    expect(out.c).toBe('转义"引号//仍字符串')
  })
})

describe('normalizeCustomPersona', () => {
  it('接受合法条目并只保留白名单台词池', () => {
    const def = normalizeCustomPersona({
      id: 'my-persona_1',
      name: ' 我的人设 ',
      base: 'genki',
      copy: { tapHead: ['好哦'], unknownKey: ['x'], tapLeg: [], tapArm: '不是数组' },
    })
    expect(def).toEqual({ id: 'my-persona_1', name: '我的人设', base: 'genki', copy: { tapHead: ['好哦'] } })
  })

  it('拒绝空 id / 非法 id / 内置 id 冲突 / 非对象', () => {
    expect(normalizeCustomPersona({ id: '' })).toBeNull()
    expect(normalizeCustomPersona({ id: '1abc' })).toBeNull()
    expect(normalizeCustomPersona({ id: 'has space' })).toBeNull()
    expect(normalizeCustomPersona({ id: 'tsundere' })).toBeNull()
    expect(normalizeCustomPersona('x')).toBeNull()
    expect(normalizeCustomPersona(null)).toBeNull()
  })
})

describe('PersonasStore', () => {
  it('首次构造落地模板（含女仆彩蛋注释），二次构造不覆盖用户文件', () => {
    const file = join(home, 'live2d-pet-personas.json')
    const store = new PersonasStore()
    expect(existsSync(file)).toBe(true)
    const text1 = readFileSync(file, 'utf8')
    expect(text1).toBe(PERSONAS_TEMPLATE)
    expect(text1).toContain('maid')
    // 用户改写文件后：新 store（模拟重启）不得覆盖
    writeFileSync(file, '{"personas":[{"id":"mine","name":"我"}]}', 'utf8')
    new PersonasStore()
    expect(readFileSync(file, 'utf8')).toBe('{"personas":[{"id":"mine","name":"我"}]}')
    expect(store.path).toBe(file)
  })

  it('读取合法自定义人设；无 personas 键视为空清单', () => {
    writeFileSync(join(home, 'live2d-pet-personas.json'), JSON.stringify({
      personas: [
        { id: 'mine', name: '我', base: 'kuudere', copy: { tapBody: ['嗯'] } },
        { id: 'dupe', name: 'A' },
        { id: 'dupe', name: 'B' },
      ],
    }), 'utf8')
    const view = new PersonasStore().load()
    expect(view.error).toBeNull()
    expect(view.personas).toHaveLength(2)
    expect(view.personas[0]).toEqual({ id: 'mine', name: '我', base: 'kuudere', copy: { tapBody: ['嗯'] } })
    expect(view.personas[1]?.name).toBe('A') // 后到的重复 id 被忽略
  })

  it('解析失败保留上一份好结果并给出错误', () => {
    const file = join(home, 'live2d-pet-personas.json')
    writeFileSync(file, '{"personas":[{"id":"good"}]}', 'utf8')
    const store = new PersonasStore()
    expect(store.load().personas).toHaveLength(1)
    writeFileSync(file, '{ 坏掉的 json', 'utf8')
    const view = store.load()
    expect(view.error).toContain('解析失败')
    expect(view.personas).toHaveLength(1) // 上一份好结果
  })

  it('personas 非数组 → 文件级错误；坏条目跳过并计数', () => {
    writeFileSync(join(home, 'live2d-pet-personas.json'), '{"personas": 42}', 'utf8')
    expect(new PersonasStore().load().error).toContain('必须是数组')

    writeFileSync(join(home, 'live2d-pet-personas.json'), '{"personas":[{"id":"ok"},{"id":"tsundere"},{"bad":1}]}', 'utf8')
    const view = new PersonasStore().load()
    expect(view.personas.map((p) => p.id)).toEqual(['ok'])
    expect(view.error).toContain('2 个非法条目')
  })

  it('模板文件解析：注释版女仆不生效（personas 为空），注释剥离本身不出错', () => {
    const store = new PersonasStore() // 落地模板
    const view = store.load()
    expect(view.error).toBeNull()
    expect(view.personas).toEqual([])
  })
})
