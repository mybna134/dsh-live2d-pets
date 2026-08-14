import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_DISPLAY, loadPetPersist, normalizeDisplay, savePetPersist } from './persist.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-live2d-pet-'))
  process.env.DSH_HOME = dir
})

afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(dir, { recursive: true, force: true })
})

describe('loadPetPersist', () => {
  it('文件不存在时回退默认值', () => {
    expect(loadPetPersist()).toEqual(DEFAULT_DISPLAY)
  })

  it('读取合法值', () => {
    writeFileSync(join(dir, 'live2d-pet.json'), JSON.stringify({ right: 100, bottom: 50, size: 220 }))
    expect(loadPetPersist()).toEqual({ right: 100, bottom: 50, size: 220 })
  })

  it('越界值 clamp 到合法边界', () => {
    writeFileSync(join(dir, 'live2d-pet.json'), JSON.stringify({ right: -10, bottom: 99999, size: 1e9 }))
    expect(loadPetPersist()).toEqual({ right: 0, bottom: 4000, size: 400 })
  })

  it('损坏 JSON 回退默认值', () => {
    writeFileSync(join(dir, 'live2d-pet.json'), '{oops')
    expect(loadPetPersist()).toEqual(DEFAULT_DISPLAY)
  })
})

describe('savePetPersist', () => {
  it('写入后原样读回', () => {
    savePetPersist({ right: 30, bottom: 40, size: 180 })
    expect(loadPetPersist()).toEqual({ right: 30, bottom: 40, size: 180 })
    expect(JSON.parse(readFileSync(join(dir, 'live2d-pet.json'), 'utf8'))).toEqual({ right: 30, bottom: 40, size: 180 })
  })
})

describe('normalizeDisplay', () => {
  it('非有限值回落到最小边界', () => {
    expect(normalizeDisplay({ right: Number.NaN, bottom: Number.POSITIVE_INFINITY, size: Number.NEGATIVE_INFINITY }))
      .toEqual({ right: 0, bottom: 0, size: 40 })
  })
})
