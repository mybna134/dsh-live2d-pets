/**
 * 宠物 HTTP 路由：浏览器半区通过同源 JSON 端点（/api/live2d-pet/*）与
 * 素材静态路由（/pet-assets/*）通信——官方模式（dsh-pet routes.ts 同款，
 * 见 docs/adr/004）。
 * @module dsh-live2d-pets/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PetService } from './service.ts'

/** 浏览器侧宠物 API 基路径。 */
export const PET_API_PREFIX = '/api/live2d-pet'

/** 浏览器侧素材静态路由基路径（vendor 运行时脚本 + 预设模型）。 */
export const PET_ASSET_PREFIX = '/pet-assets'

/** 随包暴露的素材清单（路径相对于 package 根）。 */
const ASSET_FILES = [
  { name: 'vendor/pixi.min.js', mime: 'text/javascript' },
  { name: 'vendor/live2dcubismcore.min.js', mime: 'text/javascript' },
  { name: 'vendor/live2d-display.cubism4.min.js', mime: 'text/javascript' },
] as const

/** 包根目录（从本模块自身位置解析）。 */
export function petPackageRoot(importMetaUrl: string): string {
  return fileURLToPath(new URL('../', importMetaUrl))
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        queueMicrotask(() => req.destroy())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

function getRoute(path: string, run: () => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      run().then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

function postRoute(path: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      return readJsonBody(req).then((body) => {
        const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
        return run(record).then(
          (value) => json(res, 200, value),
          (error) => json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      }, (error) => {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** 构建完整路由族（API + 素材）供 ctx.webServer.register。 */
export function makePetRoutes(deps: { service: PetService; packageRoot: string }): WebRoute[] {
  const { service, packageRoot } = deps
  const apiRoutes: WebRoute[] = [
    getRoute(`${PET_API_PREFIX}/state`, async () => service.state()),
    postRoute(`${PET_API_PREFIX}/set-display`, (body) => {
      const patch: { right?: number; bottom?: number; size?: number } = {}
      if (typeof body.right === 'number') patch.right = body.right
      if (typeof body.bottom === 'number') patch.bottom = body.bottom
      if (typeof body.size === 'number') patch.size = body.size
      return Promise.resolve({ ok: true, display: service.setDisplay(patch) })
    }),
    postRoute(`${PET_API_PREFIX}/reset-display`, () => Promise.resolve({ ok: true, display: service.resetDisplay() })),
  ]

  const assetRoutes: WebRoute[] = ASSET_FILES.map((file): WebRoute => ({
    kind: 'exact',
    path: `${PET_ASSET_PREFIX}/${file.name}`,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> | void => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      return readFile(join(packageRoot, 'assets', file.name)).then((body) => {
        res.writeHead(200, {
          'content-type': file.mime,
          'content-length': String(body.byteLength),
          'cache-control': 'no-cache',
        })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        res.end(body)
      }, () => {
        res.writeHead(404)
        res.end()
      })
    },
  }))

  return [...apiRoutes, ...assetRoutes]
}
