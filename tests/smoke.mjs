/**
 * dsh-aliyun smoke test — validates the credential store (mask/patch/
 * clearAll) and the proxy argument builder against a temp config path via
 * DSH_ALIYUN_CONFIG. No network, no real AccessKey.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(tmpdir(), 'dsh-aliyun-'))
process.env.DSH_ALIYUN_CONFIG = path.join(root, 'config.json')

const { AliyunStore, mask, DEFAULT_PROXY_COMMAND, DEFAULT_PROXY_ARGS } = await import('../lib/index.js')

let failures = 0
function check(label, cond, detail) {
  if (cond) {
    console.log('  ✔ ' + label)
  } else {
    failures++
    console.error('  ✘ ' + label + (detail !== undefined ? ' → ' + String(detail) : ''))
  }
}

console.log('store: default state')
const store = new AliyunStore()
let view = await store.view()
check('not configured by default', view.configured === false, view.configured)
check('default proxy command is uvx', view.proxyCommand === DEFAULT_PROXY_COMMAND, view.proxyCommand)
check('default proxy args', JSON.stringify(view.proxyArgs) === JSON.stringify(DEFAULT_PROXY_ARGS), view.proxyArgs)

console.log('store: patch credentials')
await store.patch({ accessKeyId: 'LTAI5tExampleKey123', accessKeySecret: 'secretValueExample' })
view = await store.view()
check('configured after patch', view.configured === true, view.configured)
check('key masked (head+tail)', view.accessKeyIdMasked === 'LTAI****y123', view.accessKeyIdMasked)
check('keyUpdatedAt set', view.keyUpdatedAt !== '', view.keyUpdatedAt)

console.log('store: patch serverUrl + proxyArgs')
await store.patch({ serverUrl: 'https://api.aliyun.com/mcp', proxyArgs: 'alibabacloud.mcp-proxy@latest --safety-policy ecs:describe-*=allow,*=deny' })
view = await store.view()
check('serverUrl saved', view.serverUrl === 'https://api.aliyun.com/mcp', view.serverUrl)
check('proxyArgs split', JSON.stringify(view.proxyArgs) === JSON.stringify(['alibabacloud.mcp-proxy@latest', '--safety-policy', 'ecs:describe-*=allow,*=deny']), view.proxyArgs)

console.log('store: clearAll')
await store.clearAll()
view = await store.view()
check('cleared', view.configured === false && view.accessKeyIdMasked === '', view)
check('proxy defaults restored', JSON.stringify(view.proxyArgs) === JSON.stringify(DEFAULT_PROXY_ARGS), view.proxyArgs)

console.log('mask helper')
check('mask empty', mask('') === '', mask(''))
check('mask short', mask('abc') === 'ab****', mask('abc'))
check('mask long', mask('LTAI5tExampleKey123') === 'LTAI****y123', mask('LTAI5tExampleKey123'))

await rm(root, { recursive: true, force: true })
if (failures > 0) {
  console.error('\n' + failures + ' check(s) failed')
  process.exit(1)
}
console.log('\nAll smoke checks passed.')
