/**
 * dsh-aliyun — loopback HTTP routes for the web settings panel.
 *
 * Route family: /api/dsh-aliyun/*. All routes are loopback-only
 * (127.0.0.1/localhost, same-origin) — the settings panel is the only
 * consumer.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AliyunStore } from './store.ts'
import type { McpSupervisor } from './proxy.ts'

/** Route paths. */
export const ALIYUN_API = {
  status: '/api/dsh-aliyun/status',
  config: '/api/dsh-aliyun/config',
  test: '/api/dsh-aliyun/test',
  clear: '/api/dsh-aliyun/clear',
} as const

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** Strict loopback fence for all routes. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Route handler context. */
export interface RouteContext {
  store: AliyunStore
  supervisor: McpSupervisor
}

/** Build every /api/dsh-aliyun route (exact paths). */
export function makeRoutes(deps: RouteContext) {
  const { store, supervisor } = deps

  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  const statusView = async (): Promise<Record<string, unknown>> => {
    const view = await store.view()
    return {
      ...view,
      connected: supervisor.isConnected(),
      toolCount: supervisor.toolCount(),
    }
  }

  return [
    {
      kind: 'exact' as const,
      path: ALIYUN_API.status,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, await statusView())
      },
    },
    {
      kind: 'exact' as const,
      path: ALIYUN_API.config,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const method = req.method ?? 'GET'
        if (method === 'GET') {
          if (!guard(req, res, 'GET')) return
          writeJson(res, 200, await statusView())
          return
        }
        if (method === 'POST') {
          if (!guard(req, res, 'POST')) return
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          if (body.clear === true) {
            await supervisor.dispose()
            await store.clearAll()
            writeJson(res, 200, { ok: true, message: '已清除阿里云凭据与配置。', view: await statusView() })
            return
          }
          await store.patch(body)
          const view = await store.view()
          if (view.configured && !supervisor.isConnected()) {
            try {
              await supervisor.start()
            } catch (error) {
              writeJson(res, 200, {
                ok: false,
                message: '配置已保存，但连接失败：' + String(error instanceof Error ? error.message : error),
                view: await statusView(),
              })
              return
            }
          }
          writeJson(res, 200, { ok: true, message: '配置已保存。', view: await statusView() })
          return
        }
        writeJson(res, 405, { error: `method not allowed: ${method}` })
      },
    },
    {
      kind: 'exact' as const,
      path: ALIYUN_API.test,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        const view = await store.view()
        if (!view.configured) {
          writeJson(res, 200, { ok: false, error: '尚未配置 AccessKey：请先填写并保存。', view: await statusView() })
          return
        }
        try {
          if (!supervisor.isConnected()) {
            await supervisor.start()
          }
          const tools = await supervisor.listTools()
          writeJson(res, 200, { ok: true, message: `连接成功，发现 ${tools.length} 个阿里云 MCP 工具。`, tools, view: await statusView() })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: String(error instanceof Error ? error.message : error), view: await statusView() })
        }
      },
    },
    {
      kind: 'exact' as const,
      path: ALIYUN_API.clear,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        await supervisor.dispose()
        await store.clearAll()
        writeJson(res, 200, { ok: true, message: '已清除阿里云 MCP 的凭据与配置。', view: await statusView() })
      },
    },
  ]
}
