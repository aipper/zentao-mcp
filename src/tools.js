export function toMcpTextResult(text, options = {}) {
  const { isError = false } = options;
  return {
    content: [{ type: "text", text }],
    structuredContent: { output: text },
    output: text,
    ...(isError ? { isError: true } : {}),
  };
}

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
    name: "call",
    description: "Call ZenTao REST API v1 path with Token header.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, description: "API path, e.g. /projects or bugs/123" },
        method: { type: "string", description: "GET/POST/PUT/DELETE..." },
        query: { type: "object", additionalProperties: true },
        body: {},
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_my_projects",
    description: "List projects I participate in (heuristic filtering).",
    inputSchema: {
      type: "object",
      properties: { keyword: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_my_bugs",
    description: "List bugs assigned to me (supports status/keyword/limit/page filter).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional status filter, e.g. active/resolved/closed" },
        keyword: { type: "string", description: "Optional keyword in title/steps/severity/pri" },
        limit: { type: "number", minimum: 1, maximum: 200, description: "Default 20, max 200" },
        page: { type: "number", minimum: 1, description: "Default 1" },
        productId: { type: "number", minimum: 1, description: "Optional product id (for instances requiring product scope)" },
        path: { type: "string", description: "Optional bugs endpoint override, default /bugs" },
        assignedTo: { type: "string", description: "Optional assignee override, default current account" },
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
        path: { type: "string", description: "Optional detail endpoint template, default /bugs/{id}" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "resolve_bug",
    description: "Resolve one bug by ID (default resolution=fixed).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", minimum: 1, description: "Bug ID" },
        resolution: { type: "string", description: "Default fixed" },
        solution: { type: "string", description: "Resolution description (preferred)" },
        comment: { type: "string", description: "Optional resolve comment" },
        path: { type: "string", description: "Optional resolve endpoint template, default /bugs/{id}/resolve" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "batch_resolve_my_bugs",
    description: "Batch resolve my bugs (default status=active, resolution=fixed).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Default active" },
        keyword: { type: "string", description: "Optional keyword filter before resolve" },
        limit: { type: "number", minimum: 1, maximum: 200, description: "List page size, default 50" },
        page: { type: "number", minimum: 1, description: "Default 1" },
        productId: { type: "number", minimum: 1, description: "Optional product id (for instances requiring product scope)" },
        maxItems: { type: "number", minimum: 1, maximum: 500, description: "Max resolve count, default 50" },
        assignedTo: { type: "string", description: "Optional assignee override" },
        resolution: { type: "string", description: "Default fixed" },
        solution: { type: "string", description: "Resolution description (preferred)" },
        comment: { type: "string", description: "Optional resolve comment" },
        listPath: { type: "string", description: "Optional list endpoint, default /bugs" },
        resolvePath: { type: "string", description: "Optional resolve path template, default /bugs/{id}/resolve" },
        stopOnError: { type: "boolean", description: "Default false; stop on first resolve failure" },
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
        path: { type: "string", description: "Optional close endpoint template, default /bugs/{id}/close" },
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
        closePath: { type: "string", description: "Optional close endpoint template, default /bugs/{id}/close" },
        activatePath: { type: "string", description: "Optional activate endpoint template, default /bugs/{id}/activate" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "comment_bug",
    description: "Add comment to one bug by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", minimum: 1, description: "Bug ID" },
        comment: { type: "string", description: "Comment content" },
        path: { type: "string", description: "Optional comment endpoint template, default /bugs/{id}/comment" },
      },
      required: ["id", "comment"],
      additionalProperties: false,
    },
  },
];

export function assertToolArgs(name, args) {
  if (args == null) return;
  if (typeof args !== "object") throw new Error(`Invalid arguments for ${name}: expected object`);
  if (name === "call" && typeof args.path !== "string") {
    throw new Error("call.path must be a string");
  }
  if (name === "get_my_bugs") {
    if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit < 1 || args.limit > 200)) {
      throw new Error("get_my_bugs.limit must be a number between 1 and 200");
    }
    if (args.page !== undefined && (!Number.isFinite(args.page) || args.page < 1)) {
      throw new Error("get_my_bugs.page must be a number >= 1");
    }
    if (args.path !== undefined && typeof args.path !== "string") {
      throw new Error("get_my_bugs.path must be a string");
    }
    if (args.productId !== undefined && (!Number.isFinite(args.productId) || args.productId < 1)) {
      throw new Error("get_my_bugs.productId must be a number >= 1");
    }
  }
  if (name === "get_bug_detail") {
    if (!Number.isFinite(args.id) || Number(args.id) < 1) {
      throw new Error("get_bug_detail.id must be a number >= 1");
    }
    if (args.path !== undefined && typeof args.path !== "string") {
      throw new Error("get_bug_detail.path must be a string");
    }
  }
  if (name === "resolve_bug") {
    if (!Number.isFinite(args.id) || Number(args.id) < 1) {
      throw new Error("resolve_bug.id must be a number >= 1");
    }
    if (args.path !== undefined && typeof args.path !== "string") {
      throw new Error("resolve_bug.path must be a string");
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
    if (args.maxItems !== undefined && (!Number.isFinite(args.maxItems) || args.maxItems < 1 || args.maxItems > 500)) {
      throw new Error("batch_resolve_my_bugs.maxItems must be a number between 1 and 500");
    }
    if (args.productId !== undefined && (!Number.isFinite(args.productId) || args.productId < 1)) {
      throw new Error("batch_resolve_my_bugs.productId must be a number >= 1");
    }
    if (args.listPath !== undefined && typeof args.listPath !== "string") {
      throw new Error("batch_resolve_my_bugs.listPath must be a string");
    }
    if (args.resolvePath !== undefined && typeof args.resolvePath !== "string") {
      throw new Error("batch_resolve_my_bugs.resolvePath must be a string");
    }
    if (args.solution !== undefined && typeof args.solution !== "string") {
      throw new Error("batch_resolve_my_bugs.solution must be a string");
    }
  }
  if (name === "close_bug") {
    if (!Number.isFinite(args.id) || Number(args.id) < 1) {
      throw new Error("close_bug.id must be a number >= 1");
    }
    if (args.path !== undefined && typeof args.path !== "string") {
      throw new Error("close_bug.path must be a string");
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
    if (args.closePath !== undefined && typeof args.closePath !== "string") {
      throw new Error("verify_bug.closePath must be a string");
    }
    if (args.activatePath !== undefined && typeof args.activatePath !== "string") {
      throw new Error("verify_bug.activatePath must be a string");
    }
  }
  if (name === "comment_bug") {
    if (!Number.isFinite(args.id) || Number(args.id) < 1) {
      throw new Error("comment_bug.id must be a number >= 1");
    }
    if (typeof args.comment !== "string" || !args.comment.trim()) {
      throw new Error("comment_bug.comment must be a non-empty string");
    }
    if (args.path !== undefined && typeof args.path !== "string") {
      throw new Error("comment_bug.path must be a string");
    }
  }
}
