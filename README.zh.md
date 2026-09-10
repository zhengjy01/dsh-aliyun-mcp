# dsh-aliyun-mcp — 阿里云 MCP 连接（静态凭证方案）

把阿里云官方 **OpenAPI MCP Server** 接入 DeepSeek Harness：填入 AccessKey（推荐 RAM 子账号），插件通过本地 **Alibaba Cloud MCP Proxy**（`uvx alibabacloud.mcp-proxy`）自动换取令牌并连接上游，工具以 `mcp__aliyun__*` 暴露给 agent，覆盖 ECS / OSS / 域名 / DNS / 函数计算等阿里云数万个 OpenAPI。

> 方案选型：阿里云官方 MCP 有「远程 OAuth」与「本地静态凭证 + Proxy」两种接入；本插件采用后者（无 OAuth 回调，AccessKey 只存在本机 `~/.dsh/dsh-aliyun.json`，0600）。

## 前置条件

1. **本机安装 uv**（用于运行官方 MCP Proxy）：`brew install uv`
2. **AccessKey**：阿里云控制台创建 **RAM 子账号**，授权系统策略 `AliyunOpenAPIMCPServerStaticCredentialAccess`（含 `ram:GenerateAccessToken` + `openapiexplorer:*`）。不要用主账号密钥。

## 安装

```sh
dsh plugin --profile web add link:/path/to/dsh-aliyun-mcp
# 重启 dsh web 生效
```

## 配置

在 Web 设置页「阿里云 MCP」面板填入：

- **AccessKey ID / Secret**（RAM 子账号）
- **上游端点**（可选）：中国站 `https://api.aliyun.com/mcp`、国际站 `https://api.alibabacloud.com/mcp`；留空 = 代理自动发现
- **代理参数**（可选）：默认 `alibabacloud.mcp-proxy@latest`，可追加 `--safety-policy "ecs:describe-*=allow,*=deny"` 等限制

也可用 agent 工具配置：

```sh
aliyun_mcp_config    # 配置/查看（accessKeyId / accessKeySecret / serverUrl / proxyArgs）
aliyun_mcp_status    # 查看连接状态与已注册工具数
aliyun_mcp_test      # 测试连接并列出工具
aliyun_mcp_clear     # 清除凭据并断开
```

## 工具命名

上游 MCP 工具按 `mcp__aliyun__<原始工具名>` 注册（与 dsh-mcp-client 契约一致），例如 `mcp__aliyun__AlibabaCloud___CallCLI`。

## 开发

```sh
pnpm install
pnpm build && node tests/smoke.mjs
```

## License

MIT
