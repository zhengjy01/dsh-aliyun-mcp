/**
 * dsh-aliyun — Alibaba Cloud MCP connection for DeepSeek Harness.
 * Host half.
 *
 * Connects to the official Alibaba Cloud OpenAPI MCP Server (方案 B：
 * 本地静态凭证 + Alibaba Cloud MCP Proxy). The plugin stores the user's
 * AccessKey (RAM 子账号推荐), spawns the official proxy
 * (`uvx alibabacloud.mcp-proxy@latest`, a local stdio MCP server that
 * exchanges the static credentials for a Bearer Token via IMS
 * GenerateAccessToken), and registers the upstream tools under
 * `mcp__aliyun__*`. No OAuth callback needed; credentials live in
 * ~/.dsh/dsh-aliyun.json (mode 0600).
 *
 * The proxy auto-discovers the upstream endpoint (ListApiMcpServerCores)
 * unless an explicit `serverUrl` is configured. RAM prerequisite for the
 * AccessKey: policy `AliyunOpenAPIMCPServerStaticCredentialAccess`
 * (ram:GenerateAccessToken + openapiexplorer:*).
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { AliyunStore, configPath } from './store.ts'
import { createSupervisor, type McpSupervisor } from './proxy.ts'
import { makeRoutes, ALIYUN_API } from './routes.ts'

/** Stable cordis plugin name. */
export const name = 'aliyun-mcp'

/** Services required before the surfaces can mount. */
export const inject = ['tools', 'systemPrompt', 'webServer']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 162

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const ALIYUN_MCP_GUIDANCE =
  '本机已安装 dsh-aliyun 插件（阿里云 MCP 连接）：配置 AccessKey（RAM 子账号推荐，需授权策略 AliyunOpenAPIMCPServerStaticCredentialAccess）后，' +
  '阿里云官方 OpenAPI MCP 服务器（经本地 MCP Proxy 连接）的工具以 mcp__aliyun__* 形式可用，' +
  '覆盖 ECS/OSS/域名/DNS/函数计算等阿里云数万个 OpenAPI。' +
  '配置：在 Web 设置页「阿里云 MCP」面板填入 AccessKey ID/Secret（存 ~/.dsh/dsh-aliyun.json，0600）。' +
  '工具：aliyun_mcp_status（状态）、aliyun_mcp_config（配置）、aliyun_mcp_test（测试连接并列出工具）、aliyun_mcp_clear（清除凭据）。' +
  '用户提到「阿里云 / 阿里云MCP / 控制阿里云 / ECS / OSS」时即指本插件，请据此协作。'

/** Plugin config, read from the composition row. */
export interface Config {
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled?: boolean
}

/**
 * Mount the Aliyun MCP tools, helper tools, routes, and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt/webServer.
 * @param config - plugin config from the composition row.
 */
export function apply(ctx: Context, config?: Config): void {
  const announceToAgent = config?.announceToAgent !== false
  const enabled = config?.enabled !== false
  const store = new AliyunStore()
  const supervisor = createSupervisor(ctx, store)
  const context = { store, supervisor }

  let disposeTools: (() => void) | undefined
  let disposeRoutes: (() => void) | undefined
  let disposeSection: (() => void) | undefined
  let started = false

  const sync = (): void => {
    if (disposeTools !== undefined) {
      disposeTools()
      disposeTools = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (!enabled) return
    disposeTools = ctx.effect(
      () => {
        const disposers = buildTools(context).map((tool) => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-aliyun: tools',
    )
    disposeRoutes = ctx.effect(
      () => {
        const disposers = makeRoutes(context).map((route) => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-aliyun: routes',
    )
    if (announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-aliyun',
        order: SECTION_ORDER,
        text: ALIYUN_MCP_GUIDANCE,
      })
    }
  }

  sync()

  // Auto-connect when credentials already exist (e.g. after a host restart).
  void (async () => {
    if (!enabled) return
    const view = await store.view()
    if (view.configured && !started) {
      started = true
      void supervisor.start().catch(() => {})
    }
  })()

  ctx.effect(() => {
    return () => { void supervisor.dispose() }
  }, 'dsh-aliyun: connection')
}

/** Re-export for the settings panel's route table. */
export { ALIYUN_API }

/** Re-exports for host consumers and the smoke tests. */
export { AliyunStore, mask, configPath, DEFAULT_PROXY_COMMAND, DEFAULT_PROXY_ARGS, type AliyunConfigView } from './store.ts'
export { createSupervisor, type McpSupervisor } from './proxy.ts'
export { makeRoutes } from './routes.ts'
export { defineTool }

/** Shared tool dependencies. */
export interface ToolContext {
  store: AliyunStore
  supervisor: McpSupervisor
}

/** Build every agent-facing aliyun_mcp_* tool. */
function buildTools(ctx: ToolContext): ReturnType<typeof defineTool>[] {
  return [
    aliyunMcpStatusTool(ctx),
    aliyunMcpConfigTool(ctx),
    aliyunMcpTestTool(ctx),
    aliyunMcpClearTool(ctx),
  ]
}

/** One text content block. */
function text(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

/** Status tool: connection state, credential age, tool count. */
function aliyunMcpStatusTool(ctx: ToolContext) {
  return defineTool({
    name: 'aliyun_mcp_status',
    description:
      '查看 dsh-aliyun 插件状态：是否已配置 AccessKey、密钥最近更新时间、MCP 是否已连接、已注册的阿里云工具数量。不会泄露任何密钥。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          configured: { type: 'boolean' },
          connected: { type: 'boolean' },
          toolCount: { type: 'number' },
          keyUpdatedAt: { type: 'string' },
          serverUrl: { type: 'string' },
          proxyCommand: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      const view = await ctx.store.view()
      const lines = [
        view.configured ? '已配置 AccessKey（更新于 ' + view.keyUpdatedAt + '）' : '未配置 AccessKey',
        'MCP ' + (ctx.supervisor.isConnected() ? '已连接' : '未连接'),
        '已注册工具 ' + ctx.supervisor.toolCount() + ' 个',
        view.serverUrl !== '' ? ('上游端点 ' + view.serverUrl) : '上游端点（代理自动发现）',
        '代理命令 ' + view.proxyCommand,
        '配置路径 ' + view.configPath,
      ]
      return {
        ok: true,
        message: 'dsh-aliyun：' + lines.join('；') + '。' + (view.configured
          ? '可直接使用 mcp__aliyun__* 工具。'
          : '请在 Web 设置页「阿里云 MCP」填入 AccessKey，或用 aliyun_mcp_config 配置。'),
        configured: view.configured,
        connected: ctx.supervisor.isConnected(),
        toolCount: ctx.supervisor.toolCount(),
        keyUpdatedAt: view.keyUpdatedAt,
        serverUrl: view.serverUrl,
        proxyCommand: view.proxyCommand,
        configPath: view.configPath,
      }
    },
  })
}

/** Config tool: set/update credentials and proxy options. */
function aliyunMcpConfigTool(ctx: ToolContext) {
  return defineTool({
    name: 'aliyun_mcp_config',
    description:
      '配置 dsh-aliyun 的阿里云连接：accessKeyId/accessKeySecret（RAM 子账号推荐，需 AliyunOpenAPIMCPServerStaticCredentialAccess 策略）、serverUrl（可选，上游 OpenAPI MCP 端点，中国站 https://api.aliyun.com/mcp、国际站 https://api.alibabacloud.com/mcp，留空=代理自动发现）、proxyCommand/proxyArgs（可选，本地代理命令，默认 uvx alibabacloud.mcp-proxy@latest）。配置持久化到 ~/.dsh/dsh-aliyun.json（0600）。传 reset: true 清除。',
    parameters: {
      accessKeyId: { type: 'string', description: '阿里云 AccessKey ID' },
      accessKeySecret: { type: 'string', description: '阿里云 AccessKey Secret' },
      serverUrl: { type: 'string', description: '可选：上游 MCP 端点（留空=代理自动发现）' },
      proxyCommand: { type: 'string', description: '可选：本地代理命令（默认 uvx）' },
      proxyArgs: { type: 'string', description: '可选：代理参数，空格分隔（默认 alibabacloud.mcp-proxy@latest）' },
      reset: { type: 'boolean', description: '清除全部凭据与配置' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          configured: { type: 'boolean' },
          connected: { type: 'boolean' },
          toolCount: { type: 'number' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: Record<string, unknown>) {
      try {
        if (args !== undefined && args.reset === true) {
          await ctx.store.clearAll()
          await ctx.supervisor.dispose()
          return { ok: true, message: '已清除阿里云凭据与配置，MCP 工具已注销。', configured: false, connected: false, toolCount: 0, configPath: configPath() }
        }
        await ctx.store.patch(args)
        const view = await ctx.store.view()
        if (view.configured && !ctx.supervisor.isConnected()) {
          await ctx.supervisor.start()
        }
        return {
          ok: true,
          message: '配置已保存' + (view.configured ? '，MCP ' + (ctx.supervisor.isConnected() ? '已连接，工具 ' + ctx.supervisor.toolCount() + ' 个。' : '连接中（可用 aliyun_mcp_test 验证）。') : '。'),
          configured: view.configured,
          connected: ctx.supervisor.isConnected(),
          toolCount: ctx.supervisor.toolCount(),
          configPath: view.configPath,
        }
      } catch (error) {
        return { ok: false, message: '配置失败：' + String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

/** Test tool: connect and list the Aliyun MCP tools. */
function aliyunMcpTestTool(ctx: ToolContext) {
  return defineTool({
    name: 'aliyun_mcp_test',
    description:
      '测试 dsh-aliyun 连接：确认 AccessKey 有效并列出服务器当前提供的全部工具名（如 mcp__aliyun__* 的前身工具名）。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          tools: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      const view = await ctx.store.view()
      if (!view.configured) {
        return { ok: false, message: '尚未配置 AccessKey：请用 aliyun_mcp_config 或 Web 设置页配置。' }
      }
      try {
        if (!ctx.supervisor.isConnected()) {
          await ctx.supervisor.start()
        }
        const tools = await ctx.supervisor.listTools()
        return {
          ok: true,
          message: '连接成功：阿里云 MCP 提供 ' + tools.length + ' 个工具。' +
            (tools.length > 0 ? ' 示例：' + tools.slice(0, 8).join('、') : ''),
          tools,
        }
      } catch (error) {
        return { ok: false, message: '测试失败：' + String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

/** Clear tool: wipe credentials and disconnect. */
function aliyunMcpClearTool(ctx: ToolContext) {
  return defineTool({
    name: 'aliyun_mcp_clear',
    description:
      '清除 dsh-aliyun 的全部凭据（AccessKey）并断开连接，MCP 工具随之注销。需要用户确认后执行。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      await ctx.supervisor.dispose()
      await ctx.store.clearAll()
      return { ok: true, message: '已清除阿里云 MCP 的全部凭据，MCP 工具已注销。' }
    },
  })
}
