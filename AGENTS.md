# zentao 协作规则

适用范围：仓库根目录及所有子目录。

## 目标
- 处理 ZenTao bug 时，优先使用结构化解决说明：`resolve_bug.solutionModules` / `batch_resolve_my_bugs.solutionModules`。
- 模块固定为：`rootCause`（根因）、`fixApproach`（修复思路）、`logicChange`（改动逻辑）、`impact`（影响范围）。
- 服务端会把模块格式化为多行文本写入禅道；阅读者应能直接理解“为什么改、改了什么、影响什么”。

## bug 回复写法
- 调用 MCP 解决 bug 时，优先传 `solutionModules`，至少填 `rootCause` + `logicChange`，完整时四块都写。
- 每块 1 到 3 句，优先业务/产品能理解的改动结果，不堆砌编译、提交、路径等证明信息。
- 如果需要提验证，只写结果型描述，例如“已覆盖空值与重复提交场景”，不要贴命令。
- 不要只写“已修复并自测”这类没有信息量的句子。
- 兼容：仍可传纯文本 `solution`；若同时传了且 `solutionModules` 有任一非空字段，以 `solutionModules` 为准。

## 明确禁止
- 不要把 `Evidence:`、`Verify:` 这样的模板标签写进 bug 解决说明。
- 不要在 bug 回复里附编译命令、测试命令、文件路径、提交 hash、截图路径。
- 不要把聊天里的通用收尾模板直接复制到 ZenTao 的 `solution` / `solutionModules` 或 `comment` 字段。

## 工具约定
- 获取 bug 时，优先使用 `get_my_bugs`。若已知是在项目视角，传 `projectId`（比 `projectSetId` 更精确，不会跨项目合并）；若已知是产品视角传 `productId`；若已知是项目集视角传 `projectSetId`，必要时配合 `path="/my/bug"` 或环境变量 `ZENTAO_MY_BUGS_PATH=/my/bug`。
- `get_my_bugs` 传了 `projectId` 后会直接查 `/projects/{id}/bugs`，不再扫描其它项目/产品/项目集路径，实现硬隔离。
- 不要默认先依赖 `list_my_projects` 找项目再查 bug；有些项目集没有实际创建项目，也仍然会有“我的 bug”，这类场景可能无法通过项目列表发现。
- 处理 bug 优先填 `solutionModules`（或兼容字段 `solution`），只有没有合适解决说明时才退回 `comment`。
- `comment_bug.comment` 用于补充进展、风险、待验证项，不替代完整的解决说明。
- 批量处理时，`solutionModules` 要写共性根因和共性逻辑调整，不要写单次操作证明。
