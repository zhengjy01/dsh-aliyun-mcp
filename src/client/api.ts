/**
 * Browser-side API client for the /api/dsh-aliyun route family. The
 * only data access path the settings panel uses — plain fetch, same origin.
 */

/** Public status view (mirrors the host contract). */
export interface AliyunMcpStatusView {
  configured: boolean
  keyUpdatedAt: string
  accessKeyIdMasked: string
  serverUrl: string
  proxyCommand: string
  proxyArgs: string[]
  configPath: string
  connected: boolean
  toolCount: number
}

/** Error carrying the route's JSON error message. */
export class AliyunMcpApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AliyunMcpApiError'
  }
}

/** Parse a JSON response or throw an AliyunMcpApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new AliyunMcpApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new AliyunMcpApiError(message)
  }
  return body as T
}

/** Plain fetch helper with an error wrapper. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    throw new AliyunMcpApiError('网络请求失败: ' + String(error instanceof Error ? error.message : error))
  }
  return readJson<T>(response)
}

/** The Aliyun MCP panel API. */
export class AliyunMcpApi {
  async status(): Promise<AliyunMcpStatusView> {
    return request<AliyunMcpStatusView>('/api/dsh-aliyun/status')
  }

  async save(patch: Record<string, unknown>): Promise<{ ok: boolean; message: string; error?: string; view: AliyunMcpStatusView }> {
    return request('/api/dsh-aliyun/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  async test(): Promise<{ ok: boolean; message?: string; error?: string; tools?: string[]; view: AliyunMcpStatusView }> {
    return request('/api/dsh-aliyun/test', { method: 'POST' })
  }

  async clear(): Promise<{ ok: boolean; message: string; view: AliyunMcpStatusView }> {
    return request('/api/dsh-aliyun/clear', { method: 'POST' })
  }
}
