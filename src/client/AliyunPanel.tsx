/**
 * Aliyun MCP settings panel — rendered inside the web settings page
 * (settings.section entry). 方案 B：静态 AccessKey + 本地 MCP Proxy。
 * The panel collects AccessKey ID/Secret (stored locally, mode 0600),
 * optional upstream endpoint override, and offers test / clear. Plain
 * React, no emoji, no external UI package — inline styles only.
 */
import { useCallback, useEffect, useState } from 'react'
import { AliyunMcpApi, type AliyunMcpStatusView } from './api.ts'

/** Module-level API client (stateless; the component closes over it). */
const api = new AliyunMcpApi()

/** One shared style sheet (kept tiny and theme-agnostic). */
const s = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '620px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(128,128,128,0.3)',
    fontSize: '13px',
    color: 'inherit',
  } as const,
  title: { fontWeight: 600, fontSize: '13px', margin: 0 } as const,
  status: { fontSize: '12px', opacity: 0.85 } as const,
  statusWarn: { fontSize: '12px', opacity: 0.9, color: '#c9763a' } as const,
  hint: { fontSize: '12px', opacity: 0.85, lineHeight: '1.5', margin: 0 } as const,
  row: { display: 'flex', gap: '6px', alignItems: 'center' } as const,
  label: { fontSize: '12px', opacity: 0.85, whiteSpace: 'nowrap' } as const,
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'rgba(128,128,128,0.08)',
    color: 'inherit',
    fontSize: '12px',
  } as const,
  flex: { flex: 1 } as const,
  button: {
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid rgba(128,128,128,0.4)',
    background: 'rgba(128,128,128,0.14)',
    color: 'inherit',
    fontSize: '12px',
  } as const,
  buttonDanger: {
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid rgba(200,90,80,0.5)',
    background: 'rgba(200,90,80,0.12)',
    color: 'inherit',
    fontSize: '12px',
  } as const,
  msg: { fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: 0.9 } as const,
}

/** Status line for the current status view. */
function statusText(view: AliyunMcpStatusView | null): string {
  if (view === null) return '加载中…'
  const base = view.configured
    ? '已配置 AccessKey' + (view.accessKeyIdMasked !== '' ? '（' + view.accessKeyIdMasked + '）' : '')
    : '未配置 AccessKey'
  const conn = view.connected ? '已连接 · ' + view.toolCount + ' 个工具' : '未连接'
  return base + ' · ' + conn
}

/** The Aliyun MCP settings panel component. */
export function AliyunMcpSettingsPanel(): JSX.Element {
  const [view, setView] = useState<AliyunMcpStatusView | null>(null)
  const [accessKeyId, setAccessKeyId] = useState('')
  const [accessKeySecret, setAccessKeySecret] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [proxyArgs, setProxyArgs] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    try {
      const v = await api.status()
      setView(v)
      setServerUrl(v.serverUrl)
      setProxyArgs(v.proxyArgs.join(' '))
    } catch (error) {
      setMsg('读取状态失败: ' + String(error instanceof Error ? error.message : error))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  /** Run one async panel action with busy/message bookkeeping. */
  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      setMsg(await action())
    } catch (error) {
      setMsg('操作失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const save = (): void => {
    void run(async () => {
      const patch: Record<string, unknown> = {}
      if (accessKeyId.trim() !== '') patch.accessKeyId = accessKeyId
      if (accessKeySecret.trim() !== '') patch.accessKeySecret = accessKeySecret
      if (serverUrl !== view?.serverUrl) patch.serverUrl = serverUrl
      if (proxyArgs !== view?.proxyArgs.join(' ')) patch.proxyArgs = proxyArgs
      const result = await api.save(patch)
      setView(result.view)
      setAccessKeyId('')
      setAccessKeySecret('')
      setServerUrl(result.view.serverUrl)
      setProxyArgs(result.view.proxyArgs.join(' '))
      return result.ok ? result.message : ('保存失败: ' + (result.error ?? result.message))
    })
  }

  const test = (): void => {
    void run(async () => {
      const result = await api.test()
      setView(result.view)
      if (!result.ok) return '连接失败: ' + (result.error ?? '未知错误')
      return result.message ?? '连接成功。'
    })
  }

  const clear = (): void => {
    void run(async () => {
      const result = await api.clear()
      setView(result.view)
      return result.message
    })
  }

  return (
    <div style={s.card}>
      <p style={s.title}>阿里云 MCP（AccessKey + 本地代理）</p>

      <p style={s.hint}>
        填入阿里云 <b>AccessKey</b>（推荐用 <b>RAM 子账号</b>，并授权策略
        <code> AliyunOpenAPIMCPServerStaticCredentialAccess </code>
        ——即 <code>ram:GenerateAccessToken</code> + <code>openapiexplorer:*</code>）。保存后插件会用本地
        MCP 代理（<code>uvx alibabacloud.mcp-proxy</code>，需本机已装 uv）换取令牌，连接阿里云官方
        OpenAPI MCP 服务器（中国站 <code>api.aliyun.com/mcp</code> / 国际站
        <code> api.alibabacloud.com/mcp</code>），工具以 <code>mcp__aliyun__*</code> 暴露给 agent。
        凭据只存在本机 <code>~/.dsh/dsh-aliyun.json</code>（0600）。
      </p>

      <div style={view !== null && view.configured ? s.status : s.statusWarn}>{statusText(view)}</div>

      <div style={s.row}>
        <span style={s.label}>AccessKey ID</span>
        <input style={{ ...s.input, ...s.flex }} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)}
          placeholder={view?.configured ? '已配置（' + view.accessKeyIdMasked + '），留空不改' : 'LTAI…'} />
      </div>
      <div style={s.row}>
        <span style={s.label}>AccessKey Secret</span>
        <input style={{ ...s.input, ...s.flex }} type="password" value={accessKeySecret} onChange={(e) => setAccessKeySecret(e.target.value)}
          placeholder={view?.configured ? '已配置，留空不改' : '••••••••'} />
      </div>

      <div style={s.row}>
        <span style={s.label}>上游端点</span>
        <input style={{ ...s.input, ...s.flex }} value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
          placeholder="留空 = 代理自动发现（中国站 api.aliyun.com/mcp）" />
      </div>

      <div style={s.row}>
        <span style={s.label}>代理参数</span>
        <input style={{ ...s.input, ...s.flex }} value={proxyArgs} onChange={(e) => setProxyArgs(e.target.value)}
          placeholder="默认 alibabacloud.mcp-proxy@latest" />
      </div>

      <div style={s.row}>
        <button style={s.button} onClick={save} disabled={busy}>保存配置</button>
        <button style={s.button} onClick={test} disabled={busy}>测试连接</button>
        <button style={s.button} onClick={() => void refresh()} disabled={busy}>刷新</button>
        <button style={s.buttonDanger} onClick={clear} disabled={busy}>清除凭据</button>
      </div>

      {msg !== '' && <div style={s.msg}>{msg}</div>}
    </div>
  )
}
