/**
 * dsh-aliyun — credential/config store.
 *
 * Persists the Alibaba Cloud AccessKey and proxy options to
 * ~/.dsh/dsh-aliyun.json (mode 0600). Secrets never leave this module;
 * the public view() masks everything. The config path can be overridden
 * with DSH_ALIYUN_CONFIG (used by tests).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Default machine-wide config location (mode 0600). */
export const DEFAULT_CONFIG_FILE = path.join(homedir(), '.dsh', 'dsh-aliyun.json')

/** Test override for the config location. */
export function configPath(): string {
  const override = process.env.DSH_ALIYUN_CONFIG
  return override !== undefined && override !== '' ? override : DEFAULT_CONFIG_FILE
}

/** Default local proxy command (uvx, installed via `brew install uv`). */
export const DEFAULT_PROXY_COMMAND = 'uvx'

/** Default proxy arguments (the official Alibaba Cloud MCP Proxy). */
export const DEFAULT_PROXY_ARGS = ['alibabacloud.mcp-proxy@latest']

/** Persisted shape. Secrets never leave this module. */
export interface AliyunCredentials {
  /** Alibaba Cloud AccessKey ID. */
  accessKeyId: string
  /** Alibaba Cloud AccessKey Secret. */
  accessKeySecret: string
  /** ISO timestamp of the last credential update. */
  keyUpdatedAt: string
  /** Optional explicit upstream MCP endpoint ('' = proxy auto-discovers). */
  serverUrl: string
  /** Local proxy command (default uvx). */
  proxyCommand: string
  /** Local proxy argument list (default alibabacloud.mcp-proxy@latest). */
  proxyArgs: string[]
}

/** Public, secret-free status view. */
export interface AliyunConfigView {
  configured: boolean
  keyUpdatedAt: string
  accessKeyIdMasked: string
  serverUrl: string
  proxyCommand: string
  proxyArgs: string[]
  configPath: string
}

/** Mask a credential for display, keeping only the head and tail. */
export function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return value.slice(0, 2) + '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

/** Empty credentials record. */
function empty(): AliyunCredentials {
  return {
    accessKeyId: '',
    accessKeySecret: '',
    keyUpdatedAt: '',
    serverUrl: '',
    proxyCommand: DEFAULT_PROXY_COMMAND,
    proxyArgs: [...DEFAULT_PROXY_ARGS],
  }
}

/** Parse an unknown JSON record into credentials (tolerates missing keys). */
function parse(raw: unknown): AliyunCredentials {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  const d = empty()
  return {
    accessKeyId: str(record.accessKeyId),
    accessKeySecret: str(record.accessKeySecret),
    keyUpdatedAt: str(record.keyUpdatedAt),
    serverUrl: str(record.serverUrl),
    proxyCommand: str(record.proxyCommand) || d.proxyCommand,
    proxyArgs: Array.isArray(record.proxyArgs)
      ? record.proxyArgs.filter((a): a is string => typeof a === 'string' && a !== '')
      : [...DEFAULT_PROXY_ARGS],
  }
}

/**
 * Small credential store backed by ~/.dsh/dsh-aliyun.json.
 * Reads are lazy and cached; writes use mode 0600 so the AccessKey never
 * leaks to other local users.
 */
export class AliyunStore {
  config: AliyunCredentials | null = null

  async load(): Promise<AliyunCredentials> {
    if (this.config !== null) return this.config
    try {
      const raw = await readFile(configPath(), 'utf8')
      this.config = parse(JSON.parse(raw))
    } catch {
      // Missing or unreadable config file: treat as unconfigured.
      this.config = empty()
    }
    return this.config
  }

  async save(next: AliyunCredentials): Promise<void> {
    this.config = next
    await mkdir(path.dirname(configPath()), { recursive: true })
    await writeFile(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 })
  }

  /** Public, secret-free view. */
  async view(): Promise<AliyunConfigView> {
    const cfg = await this.load()
    return {
      configured: cfg.accessKeyId.trim() !== '' && cfg.accessKeySecret.trim() !== '',
      keyUpdatedAt: cfg.keyUpdatedAt,
      accessKeyIdMasked: mask(cfg.accessKeyId),
      serverUrl: cfg.serverUrl,
      proxyCommand: cfg.proxyCommand,
      proxyArgs: cfg.proxyArgs,
      configPath: configPath(),
    }
  }

  /** Apply a config patch: strings replace when present, undefined keeps. */
  async patch(args: Record<string, unknown> | undefined): Promise<AliyunConfigView> {
    const cfg = await this.load()
    const next: AliyunCredentials = { ...cfg }
    let changed = false
    if (args !== undefined && typeof args.accessKeyId === 'string') {
      next.accessKeyId = args.accessKeyId.trim()
      changed = true
    }
    if (args !== undefined && typeof args.accessKeySecret === 'string') {
      next.accessKeySecret = args.accessKeySecret.trim()
      changed = true
    }
    if (args !== undefined && typeof args.serverUrl === 'string') {
      next.serverUrl = args.serverUrl.trim()
      changed = true
    }
    if (args !== undefined && typeof args.proxyCommand === 'string' && args.proxyCommand.trim() !== '') {
      next.proxyCommand = args.proxyCommand.trim()
      changed = true
    }
    if (args !== undefined && typeof args.proxyArgs === 'string') {
      const parsed = args.proxyArgs.split(/\s+/).filter((a) => a !== '')
      next.proxyArgs = parsed.length > 0 ? parsed : [...DEFAULT_PROXY_ARGS]
      changed = true
    }
    if (changed) next.keyUpdatedAt = new Date().toISOString()
    await this.save(next)
    return this.view()
  }

  /** Clear every credential and reset proxy options to defaults. */
  async clearAll(): Promise<void> {
    await this.save(empty())
  }
}
