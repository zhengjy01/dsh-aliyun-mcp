/**
 * dsh-aliyun — browser half. Registers the Alibaba Cloud MCP settings
 * panel into the web settings page (settings.section entry). The panel
 * collects the AccessKey (静态凭证方案 B), shows connection state, and
 * offers one-click test / clear. Failure policy: registration problems are
 * logged, never thrown — the web shell fails the whole boot when a plugin
 * apply throws, and an external plugin must not take the GUI down.
 */
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section'
// entry) and the client runtime Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { AliyunMcpSettingsPanel } from './AliyunPanel.tsx'

/** Required services. */
export const inject = ['slots']

/**
 * Register the Aliyun MCP settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'aliyun-mcp',
      order: 321,
      label: () => '阿里云 MCP',
    }, AliyunMcpSettingsPanel))
  } catch (error) {
    console.warn('[dsh-aliyun] settings panel registration failed:', error)
  }
}
