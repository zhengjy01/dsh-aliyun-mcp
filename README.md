# dsh-aliyun-mcp — Alibaba Cloud MCP connection (static-credential mode)

Connects the official Alibaba Cloud **OpenAPI MCP Server** to DeepSeek Harness: enter an AccessKey (RAM sub-account recommended), the plugin runs the official **Alibaba Cloud MCP Proxy** (`uvx alibabacloud.mcp-proxy`) locally to exchange the static credentials for a bearer token, and registers the upstream tools under `mcp__aliyun__*` — covering ECS / OSS / domains / DNS / Function Compute and tens of thousands of Alibaba Cloud OpenAPIs.

## Prerequisites

1. Install `uv` locally: `brew install uv`
2. Create a RAM sub-account AccessKey and attach the managed policy `AliyunOpenAPIMCPServerStaticCredentialAccess` (`ram:GenerateAccessToken` + `openapiexplorer:*`). Do not use the root account key.

## Install

```sh
dsh plugin --profile web add link:/path/to/dsh-aliyun-mcp
# restart dsh web to apply
```

## Configure

Fill in the Web settings panel「阿里云 MCP」: AccessKey ID / Secret, optional upstream endpoint (`https://api.aliyun.com/mcp` for CN, `https://api.alibabacloud.com/mcp` for INTL; leave empty for auto-discovery), optional proxy args.

Or via agent tools: `aliyun_mcp_config` / `aliyun_mcp_status` / `aliyun_mcp_test` / `aliyun_mcp_clear`.

## License

MIT
