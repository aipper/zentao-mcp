export function toMcpTextResult(text, options = {}) {
  const { isError = false } = options;
  return {
    content: [{ type: "text", text }],
    structuredContent: { output: text },
    output: text,
    ...(isError ? { isError: true } : {}),
  };
}

const SAFE_BUG_LIST_PATHS = new Set(["/bugs", "/my/bug", "/my/bugs"]);

export const TOOLS = [
  {
    name: "get_token",
    description: "Get or refresh ZenTao API token (cached).",
    inputSchema: {
      type: "object",
      properties: { force: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "list_my_projects",
    description: "List projects I participate in (heuristic filtering). Not reliable for project-set-only bugs when the project set has no concrete projects.",
    inputSchema: {
      type: "object",
      properties: { keyword: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_my_bugs",
    description:
      "List bugs assigned to me (supports status/keyword/limit/page filter). For project-set scope, prefer projectSetId or /my/bug instead of relying on list_my_projects.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional status filter, e.g. active/resolved/closed" },
        keyword: { type: "string", description: "Optional keyword in title/steps/severity/pri" },
        limit: { type: "number", minimum: 1, maximum: 200, description: "Default 20, max 200" },
        page: { type: "number", minimum: 1, description: "Default 1" },
        productId: { type: "number", minimum: 1, description: "Optional product id (for instances requiring product scope)" },
        projectSetId: {
          type: "number",
          minimum: 1,
          description: "Optional project-set id. Prefer this when bugs are under project-set scope, especially if no concrete project exists.",
        },
        path: {
          type: "string",
          description: "Optional safe list path override. Allowed values: /bugs, /my/bug, /my/bugs.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_bug_detail",
    description: "Get bug detail by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", minimum: 1, description: "Bug ID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "resolve_bug",
    description: "Resolve one bug by ID (default resolution=fixed). Prefer a solution that explains root cause, fix approach, and logic changes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", minimum: 1, description: "Bug ID" },
        resolution: { type: "string", description: "Default fixed" },
        solution: {
          type: "string",
          description:
            "Preferred. Describe the fix idea, changed logic, and affected behavior. Avoid Evidence/Verify labels, file paths, and compile/test commands.",
        },
        comment: {
          type: "string",
          description: "Optional resolve comment. If used for bug updates, prefer change summary over build/test proof.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "batch_resolve_my_bugs",
    description:
      "Batch resolve my bugs (default status=active, resolution=fixed). Prefer projectSetId or /my/bug for project-set scope, and use a shared solution that explains the common root cause and logic changes.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Default active" },
        keyword: { type: "string", description: "Optional keyword filter before resolve" },
        limit: { type: "number", minimum: 1, maximum: 200, description: "List page size, default 50" },
        page: { type: "number", minimum: 1, description: "Default 1" },
        productId: { type: "number", minimum: 1, description: "Optional product id (for instances requiring product scope)" },
        projectSetId: {
          type: "number",
          minimum: 1,
          description: "Optional project-set id. Prefer this for project-set bugs, especially when the project set has no concrete project entries.",
        },
        maxItems: { type: "number", minimum: 1, maximum: 100, description: "Max resolve count, default 20" },
        resolution: { type: "string", description: "Default fixed" },
        solution: {
          type: "string",
          description:
            "Preferred. Summarize the shared fix approach and changed logic. Avoid Evidence/Verify labels, file paths, and compile/test commands.",
        },
        comment: {
          type: "string",
          description: "Optional resolve comment. Prefer business-facing change summary over proof-style output.",
        },
        path: {
          type: "string",
          description: "Optional safe list path override. Allowed values: /bugs, /my/bug, /my/bugs.",
        },
        stopOnError: { type: "boolean", description: "Default true; stop on first resolve failure" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "close_bug",
    description: "Close one bug by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", minimum: 1, description: "Bug ID" },
        comment: { type: "string", description: "Optional close comment" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_bug",
    description: "Verify bug result: pass -> close, fail -> activate.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", minimum: 1, description: "Bug ID" },
        result: { type: "string", description: "pass or fail, default pass" },
        comment: { type: "string", description: "Optional verification comment" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "comment_bug",
    description: "Add comment to one bug by ID. For solution updates, explain analysis and logic changes rather than build/test evidence.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", minimum: 1, description: "Bug ID" },
        comment: {
          type: "string",
          description:
            "Comment content. For bug handling, prefer root cause, fix idea, and changed logic; avoid Evidence/Verify labels, file paths, and compile/test commands.",
        },
      },
      required: ["id", "comment"],
      additionalProperties: false,
    },
  },
];

export function assertToolArgs(name, args) {
  if (args == null) return;
  if (typeof args !== "object") throw new Error(`Invalid arguments for ${name}: expected object`);
  if (name === "get_my_bugs") {
    if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit < 1 || args.limit > 200)) {
      throw new Error("get_my_bugs.limit must be a number between 1 and 200");
    }
    if (args.page !== undefined && (!Number.isFinite(args.page) || args.page < 1)) {
      throw new Error("get_my_bugs.page must be a number >= 1");
    }
    if (args.path !== undefined) {
      if (typeof args.path !== "string") throw new Error("get_my_bugs.path must be a string");
      if (!SAFE_BUG_LIST_PATHS.has(args.path)) {
        throw new Error("get_my_bugs.path must be one of /bugs, /my/bug, /my/bugs");
      }
    }
    if (args.assignedTo !== undefined) {
      throw new Error("get_my_bugs.assignedTo is no longer supported");
    }
    if (args.productId !== undefined && (!Number.isFinite(args.productId) || args.productId < 1)) {
      throw new Error("get_my_bugs.productId must be a number >= 1");
    }
    if (args.projectSetId !== undefined && (!Number.isFinite(args.projectSetId) || args.projectSetId < 1)) {
      throw new Error("get_my_bugs.projectSetId must be a number >= 1");
    }
  }
  if (name === "get_bug_detail") {
    if (!Number.isFinite(args.id) || Number(args.id) < 1) {
      throw new Error("get_bug_detail.id must be a number >= 1");
    }
    if (args.path !== undefined) {
      throw new Error("get_bug_detail.path is no longer supported");
    }
  }
  if (name === "resolve_bug") {
    if (!Number.isFinite(args.id) || Number(args.id) < 1) {
      throw new Error("resolve_bug.id must be a number >= 1");
    }
    if (args.path !== undefined) {
      throw new Error("resolve_bug.path is no longer supported");
    }
    if (args.solution !== undefined && typeof args.solution !== "string") {
      throw new Error("resolve_bug.solution must be a string");
    }
  }
  if (name === "batch_resolve_my_bugs") {
    if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit < 1 || args.limit > 200)) {
      throw new Error("batch_resolve_my_bugs.limit must be a number between 1 and 200");
    }
    if (args.page !== undefined && (!Number.isFinite(args.page) || args.page < 1)) {
      throw new Error("batch_resolve_my_bugs.page must be a number >= 1");
    }
    if (args.maxItems !== undefined && (!Number.isFinite(args.maxItems) || args.maxItems < 1 || args.maxItems > 100)) {
      throw new Error("batch_resolve_my_bugs.maxItems must be a number between 1 and 100");
    }
    if (args.productId !== undefined && (!Number.isFinite(args.productId) || args.productId < 1)) {
      throw new Error("batch_resolve_my_bugs.productId must be a number >= 1");
    }
    if (args.projectSetId !== undefined && (!Number.isFinite(args.projectSetId) || args.projectSetId < 1)) {
      throw new Error("batch_resolve_my_bugs.projectSetId must be a number >= 1");
    }
    if (args.path !== undefined) {
      if (typeof args.path !== "string") throw new Error("batch_resolve_my_bugs.path must be a string");
      if (!SAFE_BUG_LIST_PATHS.has(args.path)) {
        throw new Error("batch_resolve_my_bugs.path must be one of /bugs, /my/bug, /my/bugs");
      }
    }
    if (args.assignedTo !== undefined) {
      throw new Error("batch_resolve_my_bugs.assignedTo is no longer supported");
    }
    if (args.listPath !== undefined || args.resolvePath !== undefined) {
      throw new Error("batch_resolve_my_bugs endpoint overrides are no longer supported");
    }
    if (args.solution !== undefined && typeof args.solution !== "string") {
      throw new Error("batch_resolve_my_bugs.solution must be a string");
    }
  }
  if (name === "close_bug") {
    if (!Number.isFinite(args.id) || Number(args.id) < 1) {
      throw new Error("close_bug.id must be a number >= 1");
    }
    if (args.path !== undefined) {
      throw new Error("close_bug.path is no longer supported");
    }
  }
  if (name === "verify_bug") {
    if (!Number.isFinite(args.id) || Number(args.id) < 1) {
      throw new Error("verify_bug.id must be a number >= 1");
    }
    if (args.result !== undefined) {
      const result = String(args.result).toLowerCase();
      if (result !== "pass" && result !== "fail") {
        throw new Error("verify_bug.result must be pass or fail");
      }
    }
    if (args.closePath !== undefined || args.activatePath !== undefined) {
      throw new Error("verify_bug endpoint overrides are no longer supported");
    }
  }
  if (name === "comment_bug") {
    if (!Number.isFinite(args.id) || Number(args.id) < 1) {
      throw new Error("comment_bug.id must be a number >= 1");
    }
    if (typeof args.comment !== "string" || !args.comment.trim()) {
      throw new Error("comment_bug.comment must be a non-empty string");
    }
    if (args.path !== undefined) {
      throw new Error("comment_bug.path is no longer supported");
    }
  }
}
