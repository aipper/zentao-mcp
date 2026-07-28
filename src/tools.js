import { assertSolutionArgs } from "./solution.js";

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

/** Shared MCP schema for structured bug solutions. */
const SOLUTION_MODULES_SCHEMA = {
  type: "object",
  description:
    "Preferred structured solution. Server formats into multi-line text with 【根因】【修复思路】【改动逻辑】【影响范围】. Prefer this over plain solution. Avoid Evidence/Verify labels, file paths, and compile/test commands.",
  properties: {
    rootCause: {
      type: "string",
      description: "【根因】Why it broke: trigger condition + wrong behavior.",
    },
    fixApproach: {
      type: "string",
      description: "【修复思路】How to fix: strategy without low-level proof noise.",
    },
    logicChange: {
      type: "string",
      description: "【改动逻辑】Key branch/validation/flow changes (before → after or bullet points).",
    },
    impact: {
      type: "string",
      description: "【影响范围】Affected pages/APIs/scenarios and result-oriented regression notes.",
    },
  },
  additionalProperties: false,
};

const PLAIN_SOLUTION_SCHEMA = {
  type: "string",
  description:
    "DEPRECATED free-text solution. Always prefer solutionModules instead — this legacy field does NOT produce template formatting (【根因】【修复思路】【改动逻辑】【影响范围】). If both are set, non-empty solutionModules wins.",
};

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
        projectId: {
          type: "number",
          minimum: 1,
          description: "Optional project id. Directly query /projects/{id}/bugs, no cross-project merge.",
        },
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
    description:
      "Resolve one bug by ID via POST /bugs/{id}/resolve. REQUIREs non-empty solutionModules {rootCause, fixApproach, logicChange, impact} — without it the resolve call will REJECT with an error. Plain comment/solution is no longer accepted. Many instances require resolvedBuild (解决版本); pass it or set ZENTAO_DEFAULT_RESOLVED_BUILD (e.g. trunk). Do NOT use raw HTTP PUT/edit as a resolve substitute — it only flips status without writing solution text.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", minimum: 1, description: "Bug ID" },
        resolution: { type: "string", description: "Default fixed" },
        resolvedBuild: {
          type: "string",
          description:
            "解决版本 (required by many instances). Falls back to ZENTAO_DEFAULT_RESOLVED_BUILD. Common value: trunk",
        },
        solutionModules: {
          ...SOLUTION_MODULES_SCHEMA,
          description:
            "REQUIRED — resolve WILL REJECT without it. Structured solution object. Server formats into multi-line text with 【根因】【修复思路】【改动逻辑】【影响范围】. At least one field must be non-empty.",
        },
        solution: {
          type: "string",
          description: "IGNORED for resolve — only solutionModules is accepted. This field is kept for backward compatibility only.",
        },
        comment: {
          type: "string",
          description: "IGNORED for resolve — only solutionModules is accepted. This field only appends plain text to the action record if solutionModules is also present.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "batch_resolve_my_bugs",
    description:
      "Batch resolve my bugs via the real resolve API (default status=active, resolution=fixed). REQUIRES shared non-empty solutionModules {rootCause, fixApproach, logicChange, impact} — without it the batch will REJECT with an error. Plain comment/solution is no longer accepted. Requires resolvedBuild or ZENTAO_DEFAULT_RESOLVED_BUILD on instances that validate 解决版本. Prefer projectSetId or /my/bug for project-set scope.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Default active" },
        keyword: { type: "string", description: "Optional keyword filter before resolve" },
        limit: { type: "number", minimum: 1, maximum: 200, description: "List page size, default 50" },
        page: { type: "number", minimum: 1, description: "Default 1" },
        productId: { type: "number", minimum: 1, description: "Optional product id (for instances requiring product scope)" },
        projectId: {
          type: "number",
          minimum: 1,
          description: "Optional project id. Directly query /projects/{id}/bugs, no cross-project merge.",
        },
        projectSetId: {
          type: "number",
          minimum: 1,
          description: "Optional project-set id. Prefer this for project-set bugs, especially when the project set has no concrete project entries.",
        },
        maxItems: { type: "number", minimum: 1, maximum: 100, description: "Max resolve count, default 20" },
        resolution: { type: "string", description: "Default fixed" },
        resolvedBuild: {
          type: "string",
          description:
            "Shared 解决版本 for the batch. Falls back to ZENTAO_DEFAULT_RESOLVED_BUILD. Common value: trunk",
        },
        solutionModules: {
          ...SOLUTION_MODULES_SCHEMA,
          description:
            "REQUIRED — resolve WILL REJECT without it. Shared structured solution for the batch. Server formats into multi-line text with 【根因】【修复思路】【改动逻辑】【影响范围】. Write common root cause and shared logic changes.",
        },
        solution: {
          type: "string",
          description: "IGNORED for resolve — only solutionModules is accepted. This field is kept for backward compatibility only.",
        },
        comment: {
          type: "string",
          description: "IGNORED for resolve — only solutionModules is accepted. This field only appends plain text to the action record if solutionModules is also present.",
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
    description: "Add comment to one bug by ID. REQUIRES solutionModules {rootCause, fixApproach, logicChange, impact} — server auto-formats into 【根因】【修复思路】【改动逻辑】【影响范围】 multi-line template text. Plain comment without solutionModules is no longer accepted.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", minimum: 1, description: "Bug ID" },
        comment: {
          type: "string",
          description:
            "IGNORED for writing — only solutionModules is accepted. Kept for backward compatibility only.",
        },
        solutionModules: {
          ...SOLUTION_MODULES_SCHEMA,
          description:
            "REQUIRED — comment will REJECT without it. Structured solution. Server auto-formats into multi-line 【根因】【修复思路】【改动逻辑】【影响范围】 template text. At least one field must be non-empty.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "upload_attachment",
    description: "Upload a file (screenshot, log) and attach to a bug as visual evidence. Use after bug fix to provide screenshot proof.",
    inputSchema: {
      type: "object",
      properties: {
        bugId: { type: "number", minimum: 1, description: "Bug ID to attach to" },
        filePath: { type: "string", description: "Absolute path to file on disk" },
        fileName: { type: "string", description: "Optional display name (defaults to file basename)" },
      },
      required: ["bugId", "filePath"],
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
    if (args.projectId !== undefined && (!Number.isFinite(args.projectId) || args.projectId < 1)) {
      throw new Error("get_my_bugs.projectId must be a number >= 1");
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
    if (args.resolvedBuild !== undefined && typeof args.resolvedBuild !== "string") {
      throw new Error("resolve_bug.resolvedBuild must be a string");
    }
    if (typeof args.resolvedBuild === "string" && !args.resolvedBuild.trim()) {
      throw new Error("resolve_bug.resolvedBuild must be a non-empty string when provided");
    }
    assertSolutionArgs("resolve_bug", args);
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
    if (args.projectId !== undefined && (!Number.isFinite(args.projectId) || args.projectId < 1)) {
      throw new Error("batch_resolve_my_bugs.projectId must be a number >= 1");
    }
    if (args.resolvedBuild !== undefined && typeof args.resolvedBuild !== "string") {
      throw new Error("batch_resolve_my_bugs.resolvedBuild must be a string");
    }
    if (typeof args.resolvedBuild === "string" && !args.resolvedBuild.trim()) {
      throw new Error("batch_resolve_my_bugs.resolvedBuild must be a non-empty string when provided");
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
    assertSolutionArgs("batch_resolve_my_bugs", args);
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
    if (!args.solutionModules || typeof args.solutionModules !== "object") {
      throw new Error("comment_bug REQUIRES solutionModules {rootCause, fixApproach, logicChange, impact}; plain comment is no longer accepted");
    }
    if (args.path !== undefined) {
      throw new Error("comment_bug.path is no longer supported");
    }
  }
}
