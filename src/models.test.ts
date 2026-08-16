import { describe, expect, it } from 'vitest'
import {
  listBuiltinPresets,
  resolveModelUrl,
  resolveSpatialTap,
  resolveMotionMap,
} from './models-host.ts'
import {
  mergeSpatialTap,
  DEFAULT_SPATIAL_TAP,
  DEFAULT_MOTION_MAP,
} from './models.ts'

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

describe('resolveMotionMap', () => {
  it('无配置时返回默认映射', () => {
    expect(resolveMotionMap('mao', [])).toEqual(DEFAULT_MOTION_MAP)
    expect(resolveMotionMap('custom-missing', [])).toEqual(DEFAULT_MOTION_MAP)
  })

  it('自定义模型动画映射覆盖对应槽位，其余沿用默认', () => {
    const custom = [{
      id: 'my-mao',
      name: '猫',
      modelUrl: 'https://example.com/m.model3.json',
      animationMap: {
        thinking: ['Idle', 'TapBody'],
        head: ['TapHead'],
      },
    }]
    const map = resolveMotionMap('my-mao', custom)
    expect(map.thinking).toEqual(['Idle', 'TapBody'])
    expect(map.head).toEqual(['TapHead'])
    expect(map.idle).toEqual(DEFAULT_MOTION_MAP.idle)
    expect(map.done).toEqual(DEFAULT_MOTION_MAP.done)
  })

  it('内置 preset animationMap 生效，自定义优先于内置', () => {
    // 当前内置 Mao 未配置 animationMap → 默认
    expect(resolveMotionMap('mao', [])).toEqual(DEFAULT_MOTION_MAP)
  })
})

describe('mergeSpatialTap / resolveSpatialTap', () => {
  it('无覆盖时等于默认', () => {
    expect(mergeSpatialTap()).toEqual(DEFAULT_SPATIAL_TAP)
    expect(mergeSpatialTap(null)).toEqual(DEFAULT_SPATIAL_TAP)
  })

  it('只覆盖写出的字段，其余沿用默认', () => {
    expect(mergeSpatialTap({ headMaxNy: 0.4 })).toEqual({
      ...DEFAULT_SPATIAL_TAP,
      headMaxNy: 0.4,
    })
  })

  it('越界夹到 0–1；旧键 armLeftMaxNx 映射 bodyMinNx', () => {
    expect(mergeSpatialTap({ headMaxNy: 2, legMinNy: -1 }).headMaxNy).toBe(1)
    expect(mergeSpatialTap({ headMaxNy: 2, legMinNy: -1 }).legMinNy).toBe(0)
    expect(mergeSpatialTap({ armLeftMaxNx: 0.4, armRightMinNx: 0.7 }).bodyMinNx).toBe(0.4)
    expect(mergeSpatialTap({ armLeftMaxNx: 0.4, armRightMinNx: 0.7 }).bodyMaxNx).toBe(0.7)
  })

  it('自定义覆盖优先于内置；Hiyori 使用预设居中五矩形', () => {
    const custom = [{
      id: 'my-mao',
      name: '猫',
      modelUrl: 'https://example.com/m.model3.json',
      spatialTap: { headMaxNy: 0.4, legMinNy: 0.62 },
    }]
    expect(resolveSpatialTap('my-mao', custom).headMaxNy).toBe(0.4)
    expect(resolveSpatialTap('my-mao', custom).bodyMinNx).toBe(DEFAULT_SPATIAL_TAP.bodyMinNx)

    const hiyori = resolveSpatialTap('hiyori', [])
    expect(hiyori.headMinNx).toBeGreaterThan(0)
    expect(hiyori.headMaxNx).toBeLessThan(1)
    expect(hiyori.bodyMinNx).toBeGreaterThan(hiyori.armLeftMinNx)
    expect(hiyori.bodyMaxNx).toBeLessThan(hiyori.armRightMaxNx)
    expect(hiyori.headMaxNy).toBe(0.30)

    // 无预设覆盖的内置 → 默认
    expect(resolveSpatialTap('mao', [])).toEqual(DEFAULT_SPATIAL_TAP)
  })
})
