function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isProbablyAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function buildUrl({ baseUrl, apiPrefix, path, query }) {
  if (!path) throw new Error("path is required");
  if (isProbablyAbsoluteUrl(path)) {
    throw new Error("path must be relative (absolute URL is not allowed)");
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const prefix = apiPrefix.startsWith("/") ? apiPrefix : `/${apiPrefix}`;
  const url = new URL(`${baseUrl}${prefix}${normalizedPath}`);

  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url;
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

export function createZenTaoClient(config) {
  const { baseUrl, apiPrefix, tokenPath, tokenTtlMs, timeoutMs, auth } = config;

  let cachedToken = "";
  let cachedAt = 0;

  async function fetchJson(url, { method, headers, body }) {
    const { signal, cleanup } = createAbortSignal(timeoutMs);
    try {
      const resp = await fetch(url, { method, headers, body, signal });
      const text = await resp.text();
      const contentType = resp.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? safeJsonParse(text) : text;
      if (!resp.ok) {
        const err = new Error(`Request failed ${resp.status}: ${truncate(String(text), 2000)}`);
        err.status = resp.status;
        err.data = data;
        throw err;
      }
      return { status: resp.status, headers: Object.fromEntries(resp.headers.entries()), data };
    } finally {
      cleanup();
    }
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  function truncate(s, max) {
    if (s.length <= max) return s;
    return s.slice(0, max) + "...(truncated)";
  }

  function tokenExpired() {
    if (!cachedToken) return true;
    if (!cachedAt) return true;
    return Date.now() - cachedAt > tokenTtlMs;
  }

  async function getToken({ force } = {}) {
    if (!force && !tokenExpired()) {
      return { token: cachedToken, source: "cache" };
    }
    if (!auth.account || !auth.password) {
      throw new Error("Need ZENTAO_ACCOUNT and ZENTAO_PASSWORD");
    }

    // 兼容性：不同禅道版本 token 接口可能不同；先按常见 v1 约定尝试
    const url = new URL(tokenPath, baseUrl);
    const payload = { account: auth.account, password: auth.password };
    const resp = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const token =
      resp?.data?.token ||
      resp?.data?.data?.token ||
      resp?.data?.data?.session?.token ||
      "";

    if (!token) {
      throw new Error(
        "Token response does not contain token field; adjust parsing in src/zentao.js#getToken()"
      );
    }
    cachedToken = token;
    cachedAt = Date.now();
    return { token: cachedToken, source: "login" };
  }

  async function call({ path, method = "GET", query, body } = {}) {
    const tokenInfo = await getToken();
    const url = buildUrl({ baseUrl, apiPrefix, path, query });

    const headers = { Token: tokenInfo.token };
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    return fetchJson(url, { method: method.toUpperCase(), headers, body: payload });
  }

  function looksLikeMyProject(p, keyword) {
    if (!p || typeof p !== "object") return false;
    const k = (keyword || "").trim().toLowerCase();
    const fields = [
      p.name,
      p.code,
      p.desc,
      p.pm,
      p.po,
      p.qd,
      p.rd,
      p.status,
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());
    if (k && !fields.some((x) => x.includes(k))) return false;
    return true;
  }

  async function listMyProjects({ keyword } = {}) {
    // 这里的路径可能需要按你的禅道实例调整：如 /projects 或 /projects?limit=...
    const resp = await call({ path: "/projects", method: "GET" });
    const list = Array.isArray(resp?.data?.projects)
      ? resp.data.projects
      : Array.isArray(resp?.data?.data)
        ? resp.data.data
        : Array.isArray(resp?.data)
          ? resp.data
          : [];
    const filtered = list.filter((p) => looksLikeMyProject(p, keyword));
    return { total: list.length, matched: filtered.length, projects: filtered };
  }

  // 轻量重试：禅道偶发 502/网关问题时可用；默认不用，保留扩展点
  async function callWithRetry(args, { retries = 0, backoffMs = 200 } = {}) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        return await call(args);
      } catch (e) {
        lastErr = e;
        if (i === retries) break;
        await sleep(backoffMs * (i + 1));
      }
    }
    throw lastErr;
  }

  return { getToken, call, callWithRetry, listMyProjects };
}
