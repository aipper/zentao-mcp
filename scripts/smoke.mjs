import { createZenTaoClient } from "../src/zentao.js";

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

  const account = requireEnv("ZENTAO_ACCOUNT");
  const password = requireEnv("ZENTAO_PASSWORD");

  return { baseUrl, apiPrefix, tokenPath, tokenTtlMs, timeoutMs, auth: { account, password } };
}

async function main() {
  const zentao = createZenTaoClient(getConfigFromEnv());

  const token = await zentao.getToken({ force: false });
  console.log("token:", token.token ? `${token.token.slice(0, 6)}…${token.token.slice(-4)}` : "", "source:", token.source);

  // 尝试拉一个最常用的列表接口，验证 apiPrefix/path 是否正确
  const projects = await zentao.call({ path: "/projects", method: "GET" });
  console.log("GET /projects status:", projects.status);
  console.log("projects keys:", projects.data && typeof projects.data === "object" ? Object.keys(projects.data) : typeof projects.data);
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});
