import { describe, expect, it } from 'vitest'
import { listBuiltinPresets, resolveModelUrl } from './models.ts'

describe('resolveModelUrl', () => {
  it('http(s) URL 原样返回', () => {
    expect(resolveModelUrl('https://cdn.example.com/a.model3.json', [])).toBe('https://cdn.example.com/a.model3.json')
    expect(resolveModelUrl('http://cdn.example.com/a.model3.json', [])).toBe('http://cdn.example.com/a.model3.json')
  })

  it('preset id 命中内置清单', () => {
    const url = resolveModelUrl('hiyori', [])
    expect(url).toMatch(/^https:\/\//)
    expect(url).toContain('Hiyori')
  })

  it('自定义 id 命中用户清单', () => {
    const custom = [{ id: 'my-model', name: '我的模型', modelUrl: 'https://custom.example.com/m.model3.json' }]
    expect(resolveModelUrl('my-model', custom)).toBe('https://custom.example.com/m.model3.json')
  })

  it('未命中返回 null', () => {
    expect(resolveModelUrl('nope', [])).toBeNull()
  })
})

describe('listBuiltinPresets', () => {
  it('返回 5 条策展清单，字段齐全', () => {
    const presets = listBuiltinPresets()
    expect(presets.length).toBe(5)
    for (const p of presets) {
      expect(p.id).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.modelUrl).toMatch(/^https:\/\//)
      expect(p.license.url).toMatch(/^https:\/\//)
      expect(p.cubism).toBeGreaterThan(0)
    }
  })
})
