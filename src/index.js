import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  TOOLS,
  assertToolArgs,
  toMcpTextResult,
} from "./tools.js";
import { createZenTaoClient } from "./zentao.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const KNOWN_TOOL_NAMES = new Set([
  "get_token",
  "call",
  "list_my_projects",
  "get_my_bugs",
  "get_bug_detail",
  "resolve_bug",
  "batch_resolve_my_bugs",
  "close_bug",
  "verify_bug",
]);

function normalizeToolName(rawName) {
  if (!rawName || typeof rawName !== "string") return rawName;
  if (KNOWN_TOOL_NAMES.has(rawName)) return rawName;

  if (rawName.includes("_")) {
    const withoutPrefix = rawName.replace(/^[^_]+_/, "");
    if (KNOWN_TOOL_NAMES.has(withoutPrefix)) return withoutPrefix;
  }

  for (const name of KNOWN_TOOL_NAMES) {
    if (rawName.endsWith(name)) return name;
  }
  return rawName;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function getConfigFromEnv() {
  const baseUrl = requireEnv("ZENTAO_BASE_URL").replace(/\/+$/, "");
  const apiPrefix = (process.env.ZENTAO_API_PREFIX || "/api.php/v1").replace(/\/+$/, "");
  const tokenPath = process.env.ZENTAO_TOKEN_PATH || `${apiPrefix}/tokens`;
  const tokenTtlMs = Number(process.env.ZENTAO_TOKEN_TTL_MS || "3000000");
  const timeoutMs = Number(process.env.ZENTAO_HTTP_TIMEOUT_MS || "30000");
  const exposeToken = String(process.env.ZENTAO_EXPOSE_TOKEN || "false").toLowerCase() === "true";

  const account = requireEnv("ZENTAO_ACCOUNT");
  const password = requireEnv("ZENTAO_PASSWORD");

  return {
    baseUrl,
    apiPrefix,
    tokenPath,
    tokenTtlMs,
    timeoutMs,
    exposeToken,
    auth: { account, password },
  };
}

async function main() {
  const config = getConfigFromEnv();
  const zentao = createZenTaoClient(config);

  const server = new Server(
    { name: "zentao-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const rawToolName = req.params?.name;
    const toolName = normalizeToolName(rawToolName);
    const args = req.params?.arguments || {};
    assertToolArgs(toolName, args);

    if (toolName === "get_token") {
      const force = Boolean(args.force);
      const result = await zentao.getToken({ force });
      const output = config.exposeToken
        ? result
        : {
            ...result,
            token: result.token ? `${result.token.slice(0, 6)}…${result.token.slice(-4)}` : "",
          };
      return toMcpTextResult(JSON.stringify(output, null, 2));
    }

    if (toolName === "call") {
      const { path, method, query, body } = args;
      const resp = await zentao.call({ path, method, query, body });
      return toMcpTextResult(JSON.stringify(resp, null, 2));
    }

    if (toolName === "list_my_projects") {
      const resp = await zentao.listMyProjects({ keyword: args.keyword || "" });
      return toMcpTextResult(JSON.stringify(resp, null, 2));
    }

    if (toolName === "get_my_bugs") {
      const resp = await zentao.getMyBugs({
        status: args.status || "",
        keyword: args.keyword || "",
        limit: args.limit,
        page: args.page,
        path: args.path || "/bugs",
        assignedTo: args.assignedTo || "",
      });
      return toMcpTextResult(JSON.stringify(resp, null, 2));
    }

    if (toolName === "get_bug_detail") {
      const resp = await zentao.getBugDetail({
        id: args.id,
        path: args.path || "/bugs/{id}",
      });
      return toMcpTextResult(JSON.stringify(resp, null, 2));
    }

    if (toolName === "resolve_bug") {
      const resp = await zentao.resolveBug({
        id: args.id,
        resolution: args.resolution || "fixed",
        comment: args.comment || "",
        path: args.path || "/bugs/{id}/resolve",
      });
      return toMcpTextResult(JSON.stringify(resp, null, 2));
    }

    if (toolName === "batch_resolve_my_bugs") {
      const resp = await zentao.batchResolveMyBugs({
        status: args.status || "active",
        keyword: args.keyword || "",
        limit: args.limit,
        page: args.page,
        maxItems: args.maxItems,
        assignedTo: args.assignedTo || "",
        resolution: args.resolution || "fixed",
        comment: args.comment || "",
        listPath: args.listPath || "/bugs",
        resolvePath: args.resolvePath || "/bugs/{id}/resolve",
        stopOnError: Boolean(args.stopOnError),
      });
      return toMcpTextResult(JSON.stringify(resp, null, 2));
    }

    if (toolName === "close_bug") {
      const resp = await zentao.closeBug({
        id: args.id,
        comment: args.comment || "",
        path: args.path || "/bugs/{id}/close",
      });
      return toMcpTextResult(JSON.stringify(resp, null, 2));
    }

    if (toolName === "verify_bug") {
      const resp = await zentao.verifyBug({
        id: args.id,
        result: args.result || "pass",
        comment: args.comment || "",
        closePath: args.closePath || "/bugs/{id}/close",
        activatePath: args.activatePath || "/bugs/{id}/activate",
      });
      return toMcpTextResult(JSON.stringify(resp, null, 2));
    }

    throw new Error(`Unknown tool: ${rawToolName}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // stderr 方便客户端看到启动失败原因
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});
