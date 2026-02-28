# zentao-mcp-server（自建）

## 目标
- 提供一个可运行的 MCP Server（stdio），连接你的禅道 RESTful API v1。
- 最小功能：自动获取/缓存 Token + 通用 `call` 工具 + 少量便捷工具示例。

## 非目标
- 不在仓库内存任何密钥/Token。
- 不保证覆盖你禅道的全部 API；优先把“通用 call”跑通，再按你的流程补工具。

## 依赖
- Node.js 18+（需要内置 `fetch`）

## 配置
复制 `.env.example` 为 `.env` 并填写：
- `ZENTAO_BASE_URL`
- `ZENTAO_ACCOUNT`
- `ZENTAO_PASSWORD`

> 注意：不同禅道版本/部署方式的 token 端点与返回结构可能不同；可通过 `ZENTAO_TOKEN_PATH`/`ZENTAO_API_PREFIX` 调整。
>
> 默认情况下不需要配置 `ZENTAO_API_PREFIX`（默认值是 `/api.php/v1`）。

## 安装与运行
```bash
npm i
cp .env.example .env
npm start
```

## npm 安装后的运行
发布到 npm 后，推荐用 `npx` 启动（适合 MCP 客户端配置）：
```bash
npx -y @aipper/zentao-mcp-server
```

## 验证（不依赖 MCP 客户端）
```bash
npm i
cp .env.example .env
set -a; source .env; set +a
npm run smoke
```
期望结果：
- 输出一行 `token: xxxx…yyyy source: ...`
- 输出 `GET /projects status: 200`（或你的禅道实际返回码）

## Claude Desktop / Cursor 示例（stdio）
优先使用 `npx`（npm 发布版）：
```json
{
  "mcpServers": {
    "zentao": {
      "command": "npx",
      "args": ["-y", "@aipper/zentao-mcp-server"],
      "env": {
        "ZENTAO_BASE_URL": "https://zentao.example.com",
        "ZENTAO_ACCOUNT": "your_account",
        "ZENTAO_PASSWORD": "your_password"
      }
    }
  }
}
```

本地源码调试可继续用 `node src/index.js`：

示例（Claude Desktop 的 `mcpServers` 风格，按你的客户端实际字段为准）：
```json
{
  "mcpServers": {
    "zentao": {
      "command": "node",
      "args": ["src/index.js"],
      "cwd": "/ABS/PATH/TO/zentao",
      "env": {
        "ZENTAO_BASE_URL": "https://zentao.example.com",
        "ZENTAO_ACCOUNT": "your_account",
        "ZENTAO_PASSWORD": "your_password"
      }
    }
  }
}
```

## 常见错误（`-32000`）
`-32000` 通常是客户端侧“通用 MCP 调用失败”映射码，优先检查：
- `env` 是否完整传入（尤其是 `ZENTAO_BASE_URL`/`ZENTAO_ACCOUNT`/`ZENTAO_PASSWORD`）。
- `ZENTAO_API_PREFIX`/`ZENTAO_TOKEN_PATH` 是否和你的禅道实例一致。
- MCP 客户端是否真的在执行 `npx -y @aipper/zentao-mcp-server`（而不是旧的本地命令）。
- 客户端日志中是否有启动报错（如找不到命令、401、超时）。

## 已实现工具
- `get_token`：获取/刷新 token（默认不回显完整 token）
- `call`：调用任意相对 API 路径（自动带 Token 头）
- `list_my_projects`：示例：列出“我参与的项目”（字段匹配基于常见返回结构，可能需按你的实例微调）

## 安全建议
- 使用最小权限账号（仅需要的项目权限），避免使用管理员账号。
- 默认 `get_token` 不回显完整 token；如确需调试，可设 `ZENTAO_EXPOSE_TOKEN=true`。

## 发布到 npm
脚本：`scripts/release-npm.sh`（参考 `aiws` 的发布流程，默认 dry-run）。

常用命令：
```bash
# dry-run：只检查 + npm pack --dry-run，不会发布
npm run release:npm

# 自动递增版本（patch/minor/major）+ commit + tag（不发布）
npm run release:npm -- --bump patch

# 发布（会二次确认；默认自动 patch 递增）
npm run release:npm -- --publish

# 版本对齐 + commit + tag（不发布）
npm run release:npm -- --release v0.1.0
```

注意：
- 若 `package.json` 为 `private: true`，发布前请改成 `false` 并确认包名可用。
- 可加 `--require-tag` 要求 HEAD 上有匹配版本的 tag。
- 若发布时报 `403`，通常是包名归属问题；建议改为 scoped 包名（如 `@yourname/zentao-mcp-server`）。
