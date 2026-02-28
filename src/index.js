import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  TOOLS,
  assertToolArgs,
  toMcpTextResult,
} from "./tools.js";
import { createZenTaoClient } from "./zentao.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

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
    const toolName = req.params?.name;
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

    throw new Error(`Unknown tool: ${toolName}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // stderr 方便客户端看到启动失败原因
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});
