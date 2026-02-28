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
  const { baseUrl, apiPrefix, tokenPath, tokenTtlMs, timeoutMs, defaultProductId, auth } = config;

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

  function parseBugsFromResponse(data) {
    if (Array.isArray(data?.bugs)) return data.bugs;
    if (Array.isArray(data?.data?.bugs)) return data.data.bugs;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  }

  function parseBugDetailFromResponse(data) {
    if (data?.bug && typeof data.bug === "object") return data.bug;
    if (data?.data?.bug && typeof data.data.bug === "object") return data.data.bug;
    if (data?.data && typeof data.data === "object" && !Array.isArray(data.data)) return data.data;
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
    return null;
  }

  function normalizeString(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizePositiveInt(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  function buildProductScopedBugsPath({ productId, path }) {
    const pid = normalizePositiveInt(productId);
    if (!pid) return path || "/bugs";

    const basePath = path || "/bugs";
    if (basePath.includes("{productId}")) {
      return basePath.replaceAll("{productId}", String(pid));
    }
    if (basePath === "/bugs") {
      return `/products/${pid}/bugs`;
    }
    return basePath;
  }

  function isNeedProductIdError(err) {
    const merged = `${String(err?.message || "")} ${JSON.stringify(err?.data || "")}`.toLowerCase();
    return merged.includes("need product id");
  }

  function buildResolutionComment({ solution, comment, resolution }) {
    const normalizedSolution = String(solution || "").trim();
    if (normalizedSolution) return `解决说明：${normalizedSolution}`;
    const normalizedComment = String(comment || "").trim();
    if (normalizedComment) return normalizedComment;
    return `已处理，resolution=${String(resolution || "fixed")}`;
  }

  function getBugAssignee(bug) {
    return (
      bug?.assignedTo ||
      bug?.assignedto ||
      bug?.assigned_to ||
      bug?.assignedUser ||
      bug?.owner ||
      ""
    );
  }

  function matchesBugFilters(bug, { status, keyword, assignee }) {
    const normalizedStatus = normalizeString(status);
    const normalizedKeyword = normalizeString(keyword);
    const normalizedAssignee = normalizeString(assignee);

    if (normalizedStatus) {
      const bugStatus = normalizeString(bug?.status);
      if (bugStatus !== normalizedStatus) return false;
    }

    if (normalizedAssignee) {
      const bugAssignee = normalizeString(getBugAssignee(bug));
      if (bugAssignee !== normalizedAssignee) return false;
    }

    if (normalizedKeyword) {
      const searchableText = [
        bug?.title,
        bug?.severity,
        bug?.pri,
        bug?.steps,
        bug?.status,
        getBugAssignee(bug),
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .join(" ");
      if (!searchableText.includes(normalizedKeyword)) return false;
    }

    return true;
  }

  function buildBugDetailPath({ id, path }) {
    const normalizedId = Number(id);
    const basePath = path || "/bugs/{id}";
    if (basePath.includes("{id}")) {
      return basePath.replaceAll("{id}", String(normalizedId));
    }
    const trimmed = basePath.replace(/\/+$/, "");
    return `${trimmed}/${normalizedId}`;
  }

  function buildBugResolvePath({ id, path }) {
    return buildBugTransitionPath({ id, path, action: "resolve" });
  }

  function buildBugCommentPath({ id, path }) {
    const normalizedId = Number(id);
    const basePath = path || "/bugs/{id}/comment";
    if (basePath.includes("{id}")) {
      return basePath.replaceAll("{id}", String(normalizedId));
    }
    const trimmed = basePath.replace(/\/+$/, "");
    return `${trimmed}/${normalizedId}/comment`;
  }

  function buildBugTransitionPath({ id, path, action }) {
    const normalizedId = Number(id);
    const safeAction = String(action || "").trim();
    if (!safeAction) throw new Error("buildBugTransitionPath requires action");
    const basePath = path || `/bugs/{id}/${safeAction}`;
    if (basePath.includes("{id}")) {
      return basePath.replaceAll("{id}", String(normalizedId));
    }
    const trimmed = basePath.replace(/\/+$/, "");
    return `${trimmed}/${normalizedId}/${safeAction}`;
  }

  function getBugId(bug) {
    const id = Number(
      bug?.id ??
      bug?.bugId ??
      bug?.bugID ??
      bug?.bug_id ??
      bug?.bug?.id
    );
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  function extractImageUrlsFromBug(bug) {
    const images = new Set();
    const addMatches = (value) => {
      if (!value) return;
      const text = String(value);
      const srcRegex = /<img[^>]+src=["']([^"']+)["']/gi;
      for (const match of text.matchAll(srcRegex)) {
        if (match[1]) images.add(match[1]);
      }
      const urlRegex = /https?:\/\/[^\s"'<>]+\.(png|jpe?g|gif|webp|bmp|svg)/gi;
      for (const match of text.matchAll(urlRegex)) {
        if (match[0]) images.add(match[0]);
      }
    };
    addMatches(bug?.steps);
    addMatches(bug?.stepsHtml);
    addMatches(bug?.openedBuild);
    return Array.from(images);
  }

  async function getMyBugs({
    status,
    keyword,
    limit = 20,
    page = 1,
    productId,
    path = "/bugs",
    assignedTo,
  } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    const safePage = Math.max(1, Number(page) || 1);
    const assignee = normalizeString(assignedTo) || normalizeString(auth.account);
    const effectiveProductId = normalizePositiveInt(productId) || normalizePositiveInt(defaultProductId);
    const primaryPath = buildProductScopedBugsPath({ productId: effectiveProductId, path });

    const query = {
      limit: safeLimit,
      page: safePage,
      assignedTo: assignee || undefined,
      status: status || undefined,
      product: effectiveProductId || undefined,
    };
    let resp;
    try {
      resp = await call({ path: primaryPath, method: "GET", query });
    } catch (err) {
      const fallbackPath = effectiveProductId ? `/products/${effectiveProductId}/bugs` : null;
      if (
        fallbackPath &&
        primaryPath !== fallbackPath &&
        isNeedProductIdError(err)
      ) {
        resp = await call({ path: fallbackPath, method: "GET", query: { limit: safeLimit, page: safePage } });
      } else {
        throw err;
      }
    }

    const bugs = parseBugsFromResponse(resp?.data);
    const filtered = bugs.filter((bug) => matchesBugFilters(bug, { status, keyword, assignee }));

    return {
      total: bugs.length,
      matched: filtered.length,
      page: safePage,
      limit: safeLimit,
      productId: effectiveProductId,
      assignedTo: assignee,
      bugs: filtered,
      raw: { status: resp?.status, path: primaryPath },
    };
  }

  async function getBugDetail({ id, path = "/bugs/{id}" } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("getBugDetail requires a valid bug id");
    }

    const detailPath = buildBugDetailPath({ id: bugId, path });
    const resp = await call({ path: detailPath, method: "GET" });
    const bug = parseBugDetailFromResponse(resp.data);
    if (!bug) {
      return {
        id: bugId,
        found: false,
        images: [],
        raw: { status: resp.status, data: resp.data },
      };
    }

    return {
      id: bugId,
      found: true,
      bug,
      images: extractImageUrlsFromBug(bug),
      raw: { status: resp.status },
    };
  }

  async function resolveBug({
    id,
    resolution = "fixed",
    solution = "",
    comment = "",
    path = "/bugs/{id}/resolve",
  } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("resolveBug requires a valid bug id");
    }

    const resolvePath = buildBugResolvePath({ id: bugId, path });
    const resolvedValue = String(resolution || "fixed");
    const resolvedComment = buildResolutionComment({ solution, comment, resolution: resolvedValue });
    const body = {
      resolution: resolvedValue,
      comment: resolvedComment,
    };

    const resp = await call({ path: resolvePath, method: "POST", body });
    return {
      id: bugId,
      resolved: true,
      resolution: resolvedValue,
      solution: String(solution || "").trim(),
      comment: resolvedComment,
      raw: { status: resp.status, data: resp.data },
    };
  }

  async function closeBug({ id, comment = "", path = "/bugs/{id}/close" } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("closeBug requires a valid bug id");
    }

    const closePath = buildBugTransitionPath({ id: bugId, path, action: "close" });
    const body = {};
    if (comment) body.comment = String(comment);

    const resp = await call({ path: closePath, method: "POST", body });
    return {
      id: bugId,
      closed: true,
      raw: { status: resp.status, data: resp.data },
    };
  }

  async function activateBug({ id, comment = "", path = "/bugs/{id}/activate" } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("activateBug requires a valid bug id");
    }

    const activatePath = buildBugTransitionPath({ id: bugId, path, action: "activate" });
    const body = {};
    if (comment) body.comment = String(comment);

    const resp = await call({ path: activatePath, method: "POST", body });
    return {
      id: bugId,
      activated: true,
      raw: { status: resp.status, data: resp.data },
    };
  }

  async function verifyBug({
    id,
    result = "pass",
    comment = "",
    closePath = "/bugs/{id}/close",
    activatePath = "/bugs/{id}/activate",
  } = {}) {
    const normalizedResult = normalizeString(result || "pass");
    if (normalizedResult !== "pass" && normalizedResult !== "fail") {
      throw new Error("verifyBug.result must be pass or fail");
    }

    if (normalizedResult === "pass") {
      const closeResult = await closeBug({ id, comment, path: closePath });
      return {
        id: Number(id),
        verified: true,
        result: "pass",
        action: "close",
        raw: closeResult.raw,
      };
    }

    const activateResult = await activateBug({ id, comment, path: activatePath });
    return {
      id: Number(id),
      verified: true,
      result: "fail",
      action: "activate",
      raw: activateResult.raw,
    };
  }

  async function commentBug({ id, comment, path = "/bugs/{id}/comment" } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("commentBug requires a valid bug id");
    }
    const text = String(comment || "").trim();
    if (!text) {
      throw new Error("commentBug requires non-empty comment");
    }

    const primaryPath = buildBugCommentPath({ id: bugId, path });
    const body = { comment: text };
    try {
      const resp = await call({ path: primaryPath, method: "POST", body });
      return {
        id: bugId,
        commented: true,
        comment: text,
        raw: { status: resp.status, path: primaryPath, data: resp.data },
      };
    } catch (err) {
      const fallbackPath = primaryPath.replace(/\/comment$/, "/comments");
      if (fallbackPath !== primaryPath && Number(err?.status) === 404) {
        const resp = await call({ path: fallbackPath, method: "POST", body });
        return {
          id: bugId,
          commented: true,
          comment: text,
          raw: { status: resp.status, path: fallbackPath, data: resp.data },
        };
      }
      throw err;
    }
  }

  async function batchResolveMyBugs({
    status = "active",
    keyword = "",
    limit = 50,
    page = 1,
    productId,
    maxItems = 50,
    assignedTo = "",
    resolution = "fixed",
    solution = "",
    comment = "",
    listPath = "/bugs",
    resolvePath = "/bugs/{id}/resolve",
    stopOnError = false,
  } = {}) {
    const safeMaxItems = Math.max(1, Math.min(Number(maxItems) || 50, 500));
    const listResult = await getMyBugs({
      status,
      keyword,
      limit,
      page,
      productId,
      path: listPath,
      assignedTo,
    });

    const candidates = (listResult.bugs || []).slice(0, safeMaxItems);
    const success = [];
    const failed = [];

    for (const bug of candidates) {
      const bugId = getBugId(bug);
      if (!bugId) {
        failed.push({ id: null, error: "Missing bug id in list item" });
        if (stopOnError) break;
        continue;
      }
      try {
        const result = await resolveBug({
          id: bugId,
          resolution,
          solution,
          comment,
          path: resolvePath,
        });
        success.push({ id: bugId, status: result.raw.status });
      } catch (err) {
        failed.push({ id: bugId, error: String(err?.message || err) });
        if (stopOnError) break;
      }
    }

    return {
      requested: listResult.matched,
      attempted: candidates.length,
      resolved: success.length,
      failed: failed.length,
      success,
      errors: failed,
    };
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

  return {
    getToken,
    call,
    callWithRetry,
    listMyProjects,
    getMyBugs,
    getBugDetail,
    resolveBug,
    closeBug,
    verifyBug,
    commentBug,
    batchResolveMyBugs,
  };
}
