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
  guideToggle: {
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px dashed rgba(128,128,128,0.45)',
    background: 'rgba(128,128,128,0.06)',
    color: 'inherit',
    fontSize: '12px',
    textAlign: 'left' as const,
  } as const,
  guide: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(128,128,128,0.25)',
    background: 'rgba(128,128,128,0.05)',
    fontSize: '12px',
    lineHeight: '1.6',
  } as const,
  guideStep: { margin: 0, opacity: 0.92 } as const,
  guideNote: { margin: 0, opacity: 0.85, fontSize: '12px', lineHeight: '1.6' } as const,
  link: { color: '#3E5C9A', textDecoration: 'underline', cursor: 'pointer' } as const,
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
  /** AccessKey onboarding guide visibility (collapsible). */
  const [showGuide, setShowGuide] = useState(true)

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

      <button style={s.guideToggle} onClick={() => setShowGuide((v) => !v)} aria-expanded={showGuide}>
        {showGuide ? '▾ 收起获取 AccessKey 引导' : '▸ 展开获取 AccessKey 引导'}
      </button>
      {showGuide && (
        <div style={s.guide}>
          <p style={s.guideStep}>
            <b>1. 打开 RAM 控制台并登录</b>：访问
            <a style={s.link} href="https://ram.console.aliyun.com/users" target="_blank" rel="noreferrer">
              https://ram.console.aliyun.com/users
            </a>
            （阿里云 RAM 访问控制 → 用户）。
          </p>
          <p style={s.guideStep}>
            <b>2. 创建 RAM 子账号（强烈建议，不要用主账号密钥）</b>：点「创建用户」，访问方式勾选
            <b>「OpenAPI 调用访问」</b>（会生成 AccessKey），按需填写备注后完成创建。
          </p>
          <p style={s.guideStep}>
            <b>3. 立即保存 AccessKey Secret</b>：创建成功后页面只显示一次 Secret，请当场复制保存
            （AccessKey ID 形如 <code>LTAI…</code>，随时可查）。
          </p>
          <p style={s.guideStep}>
            <b>4. 授权 MCP 访问策略</b>：在用户详情 → 权限管理 → 添加权限，选择系统策略
            <code> AliyunOpenAPIMCPServerStaticCredentialAccess </code>
            （等价于 <code>ram:GenerateAccessToken</code> + <code>openapiexplorer:*</code>，即代理换取令牌与调用 OpenAPI 所需的最小权限）。
          </p>
          <p style={s.guideStep}>
            <b>5. 回到本页填写</b>：把 AccessKey ID / Secret 粘贴到上方输入框 → 点「保存配置」→ 点「测试连接」，
            成功后会列出 <code>mcp__aliyun__*</code> 工具，agent 即可操作 ECS / OSS / 域名等。
          </p>
          <p style={s.guideNote}>
            提示：密钥只保存在本机 <code>~/.dsh/dsh-aliyun.json</code>（权限 0600），显示时脱敏；如需更严的权限控制，
            可在「代理参数」里追加
            <code> --safety-policy "ecs:describe-*=allow,*=deny" </code> 之类的限制。
          </p>
        </div>
      )}

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
