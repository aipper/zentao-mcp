export function toMcpTextResult(text) {
  return { content: [{ type: "text", text }] };
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
];

export function assertToolArgs(name, args) {
  if (args == null) return;
  if (typeof args !== "object") throw new Error(`Invalid arguments for ${name}: expected object`);
  if (name === "call" && typeof args.path !== "string") {
    throw new Error("call.path must be a string");
  }
}
