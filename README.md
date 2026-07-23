# zentao-mcp-server（自建）

## 目标
- 提供一个可运行的 MCP Server（stdio），连接你的禅道 RESTful API v1。
- 最小功能：自动获取/缓存 Token + 常用 bug 工具。

## 非目标
- 不在仓库内存任何密钥/Token。
- 不暴露无边界的通用 REST 写接口。
- 不保证覆盖你禅道的全部 API；优先支持高频 bug 流程，再按你的流程补工具。

## 依赖
- Node.js 18+（需要内置 `fetch`）

## License
MIT - 详见 [LICENSE](./LICENSE) 文件

## 配置
复制 `.env.example` 为 `.env` 并填写：
- `ZENTAO_BASE_URL`
- `ZENTAO_ACCOUNT`
- `ZENTAO_PASSWORD`
- （可选）`ZENTAO_PRODUCT_ID`：你的禅道实例若报 `Need product id` 时设置
- （可选）`ZENTAO_PROJECT_SET_ID`：你的 bug 若在项目集视角，设置项目集 ID
- （可选）`ZENTAO_MY_BUGS_PATH`：我的 bug 专用接口路径（如 `/my/bug`）
- （可选）`ZENTAO_BUGS_FALLBACK_PATHS`：bug 列表回退路径（逗号分隔）
- （可选）`ZENTAO_PROJECT_SET_BUGS_PATHS`：项目集 bug 路径模板（支持 `{projectSetId}`）

> 注意：不同禅道版本/部署方式的 token 端点与返回结构可能不同；可通过 `ZENTAO_TOKEN_PATH`/`ZENTAO_API_PREFIX` 调整。
>
> 默认情况下不需要配置 `ZENTAO_API_PREFIX`（默认值是 `/api.php/v1`）。
>
> 安全约束：`ZENTAO_API_PREFIX` / `ZENTAO_TOKEN_PATH` 只支持相对路径；默认要求 `ZENTAO_BASE_URL` 使用 HTTPS。`ZENTAO_BASE_URL` 可为根路径或子目录部署地址（如 `https://zentao.example.com/zentao`）。

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
- 默认要求 HTTPS；如果你的实例只能走 HTTP，必须显式设置 `ZENTAO_ALLOW_INSECURE_HTTP=true`，且只建议临时内网调试使用。
- 若报 `Need product id`，请设置 `ZENTAO_PRODUCT_ID`，或在 `get_my_bugs` 传 `productId`。
- 若你的 bug 在“项目集/我的视角”而非产品，建议设置 `ZENTAO_PROJECT_SET_ID`，并配置 `ZENTAO_MY_BUGS_PATH=/my/bug`。
- 项目集场景下，优先直接调用 `get_my_bugs` 并传 `projectSetId`，必要时再显式传 `path="/my/bug"`；不要先依赖 `list_my_projects` 找项目。
- 有些项目集本身没有创建实际项目，但仍然存在“我的 bug”；这类数据可能不会出现在 `list_my_projects` 结果里。
- `get_my_bugs` 会按候选路径回退（包含项目集路径）；即使首个路径返回空列表也会继续尝试，并会把多端点结果合并去重。
- `get_my_bugs.total` 表示最终“我的 bug”总数；若需排查底层一共扫描了多少条，可看 `raw.scannedTotal`。
- 排查时看工具返回里的 `raw.triedPaths` / `raw.paths`，可确认每条路径的返回码与命中数量。
- `ZENTAO_API_PREFIX`/`ZENTAO_TOKEN_PATH` 是否和你的禅道实例一致，且使用相对路径。
- MCP 客户端是否真的在执行 `npx -y @aipper/zentao-mcp-server`（而不是旧的本地命令）。
- 客户端日志中是否有启动报错（如找不到命令、401、超时）。

## 已实现工具
- `get_token`：获取/刷新 token（始终只回显脱敏后的 token 摘要）
- `list_my_projects`：示例：列出“我参与的项目”（字段匹配基于常见返回结构，可能需按你的实例微调；不适合作为项目集 bug 的唯一发现入口）
- `get_my_bugs`：获取“指派给我”的 bug（支持 `status`/`keyword`/`limit`/`page`/`productId`/`projectSetId`，默认路径 `/bugs`；`path` 仅允许 `/bugs`、`/my/bug`、`/my/bugs`）
- `get_bug_detail`：按 `id` 获取 bug 详情（固定读取 `/bugs/{id}`；返回安全裁剪后的 bug 摘要与同源图片链接，不直接透传外部图片地址或原始附件外链）
- `resolve_bug`：按 `id` 处理单个 bug 状态（默认 `resolution=fixed`；优先 `solutionModules`，兼容纯文本 `solution`）
- `batch_resolve_my_bugs`：批量处理“我的 bug”（默认筛选 `status=active`，支持 `productId`/`projectSetId`，默认遇错即停，`maxItems` 上限 100；优先共享 `solutionModules`）
- `close_bug`：按 `id` 关闭 bug
- `verify_bug`：验证结果处理（`pass`=关闭，`fail`=激活）
- `comment_bug`：按 `id` 添加备注

### 结构化解决说明 `solutionModules`（推荐）

字段：
- `rootCause`：【根因】触发条件 + 错误行为
- `fixApproach`：【修复思路】策略说明
- `logicChange`：【改动逻辑】关键分支/校验/流程变化
- `impact`：【影响范围】受影响场景 + 结果型回归点

服务端会格式化为多行文本写入禅道，例如：

```text
【根因】
...

【修复思路】
...

【改动逻辑】
...

【影响范围】
...
```

优先级：`solutionModules`（任一非空字段）> 纯文本 `solution` > `comment` 兜底。

示例参数：
- `resolve_bug`（推荐）：
```json
{
  "id": 123,
  "resolution": "fixed",
  "solutionModules": {
    "rootCause": "分页参数为空时仍进入查询构造，导致列表请求异常。",
    "fixApproach": "为空参数补默认值，并在构造前做兜底校验。",
    "logicChange": "page/size 为空时回落默认值；非法值改为明确错误提示，避免前端重复提交。",
    "impact": "列表查询与分页切换；重点回归空参进入与异常提示是否收敛。"
  }
}
```
- `resolve_bug`（兼容纯文本）：`{"id":123,"resolution":"fixed","solution":"补齐分页参数为空时的默认值分支，避免空值继续进入查询构造；同时收敛异常提示，防止前端重复触发提交"}`
- `batch_resolve_my_bugs`（推荐共享模块）：
```json
{
  "status": "active",
  "maxItems": 20,
  "solutionModules": {
    "rootCause": "状态切换时旧数据判空顺序错误，触发空指针。",
    "fixApproach": "统一状态切换的判空与分支顺序。",
    "logicChange": "保存前增加兜底校验；异常改为明确提示而非静默失败。",
    "impact": "状态流转相关保存与切换场景。"
  }
}
```
- `get_my_bugs`（项目集）：`{"status":"active","projectSetId":1001,"limit":50}`
- `get_my_bugs`（我的）：`{"status":"active","path":"/my/bug","limit":50}`
- `get_my_bugs`（项目集 + 我的）：`{"status":"active","projectSetId":1001,"path":"/my/bug","limit":50}`
- `get_my_bugs`（按产品）：`{"status":"active","productId":1,"limit":50}`
- `close_bug`：`{"id":123,"comment":"验证通过，关闭"}`
- `verify_bug`：`{"id":123,"result":"pass","comment":"验证通过"}`
- `comment_bug`：`{"id":123,"comment":"已复现，正在定位根因"}`

`solutionModules` / `solution` / `comment` 不要写 `Evidence:`、`Verify:`、文件路径、编译命令或“已修复并自测”这类无法说明改动内容的表述。

使用建议：如果用户提到“项目集”“我的 bug”“项目列表里找不到但禅道里能看到 bug”，优先走项目集视角的 `get_my_bugs`，不要先让用户证明项目已创建。

## 安全建议
- **默认要求使用 HTTPS**：HTTP 会明文传输账号密码和数据，存在安全风险；如确需兼容老旧实例，需显式设置 `ZENTAO_ALLOW_INSECURE_HTTP=true`。
- 使用最小权限账号（仅需要的项目权限），避免使用管理员账号。
- `get_token` 不再支持回显完整 token。
- 调试日志会自动脱敏 `query`、`body`、`comment`、`solution` 等敏感字段，但仍建议仅在排查问题时临时开启。

## 调试
如需查看详细日志，可设置环境变量：
```bash
ZENTAO_DEBUG=true npx -y @aipper/zentao-mcp-server
```
日志会输出到 stderr，不影响 MCP 协议通信。

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
