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

## 安装与运行
```bash
npm i
cp .env.example .env
npm start
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
把启动命令指向 `node src/index.js`（或 `npm start`）。

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
        "ZENTAO_API_PREFIX": "/api.php/v1",
        "ZENTAO_ACCOUNT": "your_account",
        "ZENTAO_PASSWORD": "your_password"
      }
    }
  }
}
```

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

# 发布（会二次确认）
npm run release:npm -- --publish

# 版本对齐 + commit + tag（不发布）
npm run release:npm -- --release v0.1.0
```

注意：
- 若 `package.json` 为 `private: true`，发布前请改成 `false` 并确认包名可用。
- 可加 `--require-tag` 要求 HEAD 上有匹配版本的 tag。
