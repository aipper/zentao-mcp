import { resolveSolutionText } from "./solution.js";

// Constants
const DEFAULT_RESOLUTION_PREFIX = "解决说明：";
const DEFAULT_RESOLUTION_FALLBACK = "已处理";
const MAX_ERROR_TEXT_LENGTH = 2000;
const MAX_BATCH_RESOLVE_ITEMS = 100;
const SAFE_BUG_LIST_PATHS = new Set(["/bugs", "/my/bug", "/my/bugs"]);

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Check if a value looks like an absolute URL
 * @param {string} value - Value to check
 * @returns {boolean}
 */
function isProbablyAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function assertSafeRelativePath(value, fieldName) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error(`${fieldName} is required`);
  if (isProbablyAbsoluteUrl(raw)) {
    throw new Error(`${fieldName} must be a relative path`);
  }
  if (raw.startsWith("//")) {
    throw new Error(`${fieldName} must not be protocol-relative`);
  }

  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  if (normalized.includes("?") || normalized.includes("#")) {
    throw new Error(`${fieldName} must not include query or hash`);
  }
  const lowered = normalized.toLowerCase();
  if (lowered.includes("\\") || lowered.includes("%5c") || lowered.includes("%2f")) {
    throw new Error(`${fieldName} must not contain backslashes or encoded separators`);
  }
  if (/(^|\/)\.{1,2}(?:\/|$)/.test(normalized) || lowered.includes("%2e")) {
    throw new Error(`${fieldName} must not contain dot segments`);
  }
  return normalized;
}

/**
 * Build a full URL from base, prefix, path and query parameters
 * @param {Object} params
 * @param {string} params.baseUrl - Base URL
 * @param {string} params.apiPrefix - API prefix
 * @param {string} params.path - Relative path
 * @param {Object} [params.query] - Query parameters
 * @returns {URL}
 */
function buildUrl({ baseUrl, apiPrefix, path, query }) {
  const normalizedPath = assertSafeRelativePath(path, "path");
  const prefix = assertSafeRelativePath(apiPrefix, "apiPrefix").replace(/\/+$/, "");
  const url = new URL(`${baseUrl}${prefix}${normalizedPath}`);
  const allowedPrefix = `${prefix}/`;
  if (url.pathname !== prefix && !url.pathname.startsWith(allowedPrefix)) {
    throw new Error("path escapes apiPrefix");
  }

  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url;
}

/**
 * Create an abort signal with timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {{signal: AbortSignal, cleanup: Function}}
 */
function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

/**
 * Create a ZenTao API client
 * @param {Object} config - Client configuration
 * @param {string} config.baseUrl - ZenTao base URL
 * @param {string} config.apiPrefix - API prefix path
 * @param {string} config.tokenPath - Token endpoint path
 * @param {number} config.tokenTtlMs - Token TTL in milliseconds
 * @param {number} config.timeoutMs - Request timeout in milliseconds
 * @param {number} [config.defaultProductId] - Default product ID
 * @param {number} [config.defaultProjectSetId] - Default project set ID
 * @param {number} [config.defaultProjectId] - Default project ID
 * @param {string} [config.myBugsPath] - My bugs path
 * @param {string[]} [config.bugsFallbackPaths] - Bug fallback paths
 * @param {string[]} [config.projectSetBugsPaths] - Project set bug paths
 * @param {string} [config.defaultResolvedBuild] - Default resolvedBuild for resolve APIs (e.g. "trunk")
 * @param {Object} config.auth - Authentication credentials
 * @param {string} config.auth.account - Account name
 * @param {string} config.auth.password - Account password
 * @returns {Object} ZenTao client instance
 */
export function createZenTaoClient(config) {
  const {
    baseUrl,
    apiPrefix,
    tokenPath,
    tokenTtlMs,
    timeoutMs,
    allowInsecureHttp,
    defaultProductId,
    defaultProjectSetId,
    defaultProjectId,
    defaultResolvedBuild,
    myBugsPath,
    bugsFallbackPaths,
    projectSetBugsPaths,
    auth,
  } = config;

  const normalizedDefaultResolvedBuild = String(defaultResolvedBuild || "").trim();

  const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
  const parsedBaseUrl = new URL(normalizedBaseUrl);
  if (parsedBaseUrl.protocol !== "https:" && !(allowInsecureHttp && parsedBaseUrl.protocol === "http:")) {
    throw new Error("baseUrl must use HTTPS unless allowInsecureHttp=true");
  }
  const normalizedApiPrefix = assertSafeRelativePath(apiPrefix, "apiPrefix").replace(/\/+$/, "");
  const normalizedTokenPath = assertSafeRelativePath(tokenPath, "tokenPath");
  const baseOrigin = parsedBaseUrl.origin;
  const baseProtocol = parsedBaseUrl.protocol;
  const basePathname = parsedBaseUrl.pathname.replace(/\/+$/, "");
  const deploymentBaseUrl = `${baseOrigin}${basePathname || ""}/`;

  let cachedToken = "";
  let cachedAt = 0;

  async function fetchJson(url, { method, headers, body }) {
    const { signal, cleanup } = createAbortSignal(timeoutMs);
    try {
      const resp = await fetch(url, { method, headers, body, signal, redirect: "error" });
      const text = await resp.text();
      const contentType = resp.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? safeJsonParse(text) : text;
      if (!resp.ok) {
        const detail = formatApiErrorDetail(data, text);
        const err = new Error(
          detail ? `Request failed ${resp.status}: ${detail}` : `Request failed ${resp.status}`
        );
        err.status = resp.status;
        err.data = data;
        err.responseText = truncate(String(text), MAX_ERROR_TEXT_LENGTH);
        throw err;
      }
      return { status: resp.status, data };
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

  function formatApiErrorDetail(data, rawText) {
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const errorNode = data.error ?? data.message ?? data.msg ?? null;
      if (typeof errorNode === "string" && errorNode.trim()) {
        return truncate(errorNode.trim(), 500);
      }
      if (errorNode && typeof errorNode === "object" && !Array.isArray(errorNode)) {
        const parts = [];
        for (const [key, value] of Object.entries(errorNode)) {
          if (Array.isArray(value)) {
            const joined = value.map((item) => String(item || "").trim()).filter(Boolean).join("; ");
            if (joined) parts.push(`${key}: ${joined}`);
            continue;
          }
          if (value != null && String(value).trim()) {
            parts.push(`${key}: ${String(value).trim()}`);
          }
        }
        if (parts.length > 0) return truncate(parts.join(" | "), 500);
      }
      if (typeof data.error === "string" && data.error.trim()) {
        return truncate(data.error.trim(), 500);
      }
    }
    const raw = String(rawText || "").trim();
    if (!raw) return "";
    return truncate(raw, 500);
  }

  function tokenExpired() {
    if (!cachedToken) return true;
    if (!cachedAt) return true;
    return Date.now() - cachedAt > tokenTtlMs;
  }

  function resolveAgainstDeploymentPath(path) {
    const normalizedPath = assertSafeRelativePath(path, "path");
    const relativePath = normalizedPath.replace(/^\/+/, "");
    return new URL(relativePath, deploymentBaseUrl);
  }

  async function getToken({ force } = {}) {
    if (!force && !tokenExpired()) {
      return { token: cachedToken, source: "cache" };
    }
    if (!auth.account || !auth.password) {
      throw new Error("Need ZENTAO_ACCOUNT and ZENTAO_PASSWORD");
    }

    // 兼容性：不同禅道版本 token 接口可能不同；先按常见 v1 约定尝试
    const url = resolveAgainstDeploymentPath(normalizedTokenPath);
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
    const url = buildUrl({ baseUrl: normalizedBaseUrl, apiPrefix: normalizedApiPrefix, path, query });

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

  function parseProductsFromResponse(data) {
    if (Array.isArray(data?.products)) return data.products;
    if (Array.isArray(data?.data?.products)) return data.data.products;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  }

  function parseProjectsFromResponse(data) {
    if (Array.isArray(data?.projects)) return data.projects;
    if (Array.isArray(data?.data?.projects)) return data.data.projects;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  }

  function parseProgramsFromResponse(data) {
    if (Array.isArray(data?.programs)) return data.programs;
    if (Array.isArray(data?.data?.programs)) return data.data.programs;
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

  function buildMyBugsPath(pathTemplate) {
    const template = String(pathTemplate || "").trim();
    if (!template) return "";
    const resolved = template.replaceAll("{account}", encodeURIComponent(auth.account || ""));
    return assertSafeRelativePath(resolved, "myBugsPath");
  }

  function buildProjectSetPath(pathTemplate, projectSetId) {
    const template = String(pathTemplate || "").trim();
    if (!template) return "";
    const pid = normalizePositiveInt(projectSetId);
    if (!pid) return "";
    const resolved = template.replaceAll("{projectSetId}", String(pid));
    return assertSafeRelativePath(resolved, "projectSetBugsPath");
  }

  function isMyBugsPath(path) {
    const normalized = String(path || "").toLowerCase();
    return normalized.includes("/my/bug");
  }

  function isProjectSetPath(path) {
    const normalized = String(path || "").toLowerCase();
    return (
      normalized.includes("/projectset") ||
      normalized.includes("/project-set") ||
      normalized.includes("/projectsets") ||
      normalized.includes("/programs/")
    );
  }

  function isNeedProductIdError(err) {
    const merged = `${String(err?.message || "")} ${JSON.stringify(err?.data || "")}`.toLowerCase();
    return merged.includes("need product id");
  }

  function normalizeBugsListPath(path) {
    const normalizedPath = String(path || "/bugs").trim() || "/bugs";
    if (!SAFE_BUG_LIST_PATHS.has(normalizedPath)) {
      throw new Error("path must be one of /bugs, /my/bug, /my/bugs");
    }
    return normalizedPath;
  }

  function buildProgramProductsPath(projectSetId) {
    const pid = normalizePositiveInt(projectSetId);
    if (!pid) return "";
    return `/programs/${pid}/products`;
  }

  function buildProgramProjectsPath(projectSetId) {
    const pid = normalizePositiveInt(projectSetId);
    if (!pid) return "";
    return `/programs/${pid}/projects`;
  }

  function buildBugsQueryForPath({ path, limit, page, assignedTo, status, productId }) {
    if (isMyBugsPath(path) || isProjectSetPath(path)) {
      // "我的bug"和"项目集bug"类端点在部分实例不接受 assignedTo/status/product 参数，使用最小分页参数后本地过滤。
      return { limit, page };
    }
    return {
      limit,
      page,
      assignedTo: assignedTo || undefined,
      status: status || undefined,
      product: productId || undefined,
    };
  }

  /**
   * Build resolution comment from structured modules, solution, comment or resolution.
   * Structured multi-line solution is written as-is (already labeled).
   * Plain single-line solution keeps the legacy prefix for compatibility.
   * @param {Object} params
   * @param {Object} [params.solutionModules] - Structured solution modules
   * @param {string} [params.solution] - Free-text solution (legacy)
   * @param {string} [params.comment] - Comment text
   * @param {string} [params.resolution] - Resolution type
   * @returns {{ comment: string, solution: string, solutionSource: string, solutionModules: object | null }}
   */
  function buildResolutionComment({ solutionModules, solution, comment, resolution }) {
    const resolved = resolveSolutionText({ solutionModules, solution });
    if (resolved.text) {
      const isStructured = resolved.source === "modules";
      return {
        comment: isStructured ? resolved.text : `${DEFAULT_RESOLUTION_PREFIX}${resolved.text}`,
        solution: resolved.text,
        solutionSource: resolved.source,
        solutionModules: resolved.modules,
      };
    }
    const normalizedComment = String(comment || "").trim();
    if (normalizedComment) {
      return {
        comment: normalizedComment,
        solution: "",
        solutionSource: "comment",
        solutionModules: null,
      };
    }
    return {
      comment: `${DEFAULT_RESOLUTION_FALLBACK}，resolution=${String(resolution || "fixed")}`,
      solution: "",
      solutionSource: "fallback",
      solutionModules: null,
    };
  }

  function normalizeUserIdentity(value) {
    if (!value) return "";
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    if (typeof value === "object") {
      return (
        value.account ||
        value.username ||
        value.userName ||
        value.realname ||
        value.realName ||
        value.name ||
        value.id ||
        ""
      );
    }
    return "";
  }

  function getBugAssignee(bug) {
    return normalizeUserIdentity(
      bug?.assignedTo ??
      bug?.assignedto ??
      bug?.assigned_to ??
      bug?.assignedUser ??
      bug?.owner ??
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

  function buildBugDetailPath({ id }) {
    const normalizedId = Number(id);
    return `/bugs/${normalizedId}`;
  }

  function buildBugResolvePath({ id }) {
    return buildBugTransitionPath({ id, action: "resolve" });
  }

  function buildBugCommentPath({ id }) {
    const normalizedId = Number(id);
    return `/bugs/${normalizedId}/comment`;
  }

  function buildBugTransitionPath({ id, action }) {
    const normalizedId = Number(id);
    const safeAction = String(action || "").trim();
    if (!safeAction) throw new Error("buildBugTransitionPath requires action");
    return `/bugs/${normalizedId}/${safeAction}`;
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

  function normalizeResourceUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.startsWith("data:")) return "";
    const cleaned = raw.replaceAll("&amp;", "&");
    try {
      const candidate = /^https?:\/\//i.test(cleaned)
        ? new URL(cleaned)
        : cleaned.startsWith("//")
          ? new URL(`${baseProtocol}${cleaned}`)
          : cleaned.startsWith("/")
            ? (cleaned.includes("?") || cleaned.includes("#"))
              ? new URL(cleaned.replace(/^\//, ""), deploymentBaseUrl)
              : resolveAgainstDeploymentPath(cleaned)
            : resolveAgainstDeploymentPath(`/${cleaned.replace(/^\.?\//, "")}`);
      if (candidate.origin !== baseOrigin) return "";
      return candidate.toString();
    } catch {
      return "";
    }
  }

  function sanitizeTextContent(value) {
    const text = String(value || "").trim();
    if (!text) return "";

    return text
      .replace(/<img\b[^>]*>/gi, "")
      .replace(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/gi, "")
      .replace(/https?:\/\/[^\s"'<>]+/gi, (match) => normalizeResourceUrl(match) ? match : "")
      .trim();
  }

  function hasMeaningfulValue(value) {
    return value !== undefined && value !== null && value !== "";
  }

  function pickFirstValue(source, aliases) {
    if (!source || typeof source !== "object") return undefined;
    for (const alias of aliases) {
      const value = source[alias];
      if (hasMeaningfulValue(value)) return value;
    }
    return undefined;
  }

  function assignCanonicalValue(target, fieldName, source, aliases, options = {}) {
    const { sanitizeText = false, transform } = options;
    const rawValue = pickFirstValue(source, aliases);
    if (!hasMeaningfulValue(rawValue)) return;

    let value = sanitizeText ? sanitizeTextContent(rawValue) : rawValue;
    if (typeof transform === "function") {
      value = transform(value);
    }
    if (hasMeaningfulValue(value)) {
      target[fieldName] = value;
    }
  }

  function sanitizeFileRecord(record) {
    if (!record || typeof record !== "object") return null;

    const safe = {};
    for (const key of [
      "id",
      "title",
      "name",
      "extension",
      "ext",
      "size",
      "mime",
      "contentType",
      "addedBy",
      "addedDate",
      "createdBy",
      "createdDate",
    ]) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
        safe[key] = record[key];
      }
    }

    const url = normalizeResourceUrl(
      record.webPath ||
      record.url ||
      record.downloadUrl ||
      record.downloadurl ||
      record.path ||
      record.pathname ||
      record.viewUrl ||
      record.href
    );
    if (url) safe.url = url;

    return Object.keys(safe).length > 0 ? safe : null;
  }

  function sanitizeFileCollection(files) {
    if (!files) return [];
    const list = Array.isArray(files) ? files : Object.values(files);
    return list
      .map((item) => sanitizeFileRecord(item))
      .filter(Boolean);
  }

  function buildSafeBugDetail(bug) {
    if (!bug || typeof bug !== "object") return null;

    const safeBug = {};
    const bugId = getBugId(bug);
    if (bugId) safeBug.id = bugId;

    const scalarFieldMappings = [
      ["title", ["title"]],
      ["status", ["status"]],
      ["severity", ["severity"]],
      ["pri", ["pri"]],
      ["type", ["type"]],
      ["openedBy", ["openedBy", "openedby", "opened_by"], { transform: normalizeUserIdentity }],
      ["openedDate", ["openedDate", "openeddate", "opened_date"]],
      ["assignedTo", ["assignedTo", "assignedto", "assigned_to", "assignedUser", "owner"], { transform: normalizeUserIdentity }],
      ["resolvedBy", ["resolvedBy", "resolvedby", "resolved_by"], { transform: normalizeUserIdentity }],
      ["resolvedDate", ["resolvedDate", "resolveddate", "resolved_date"]],
      ["closedBy", ["closedBy", "closedby", "closed_by"], { transform: normalizeUserIdentity }],
      ["closedDate", ["closedDate", "closeddate", "closed_date"]],
      ["product", ["product"]],
      ["project", ["project"]],
      ["projectSet", ["projectSet", "projectset", "project_set", "projectSetId", "projectsetid", "project_set_id"]],
      ["module", ["module"]],
      ["branch", ["branch"]],
      ["story", ["story"]],
      ["task", ["task"]],
      ["deadline", ["deadline"]],
      ["keywords", ["keywords"]],
    ];
    for (const [fieldName, aliases, options] of scalarFieldMappings) {
      assignCanonicalValue(safeBug, fieldName, bug, aliases, options);
    }

    assignCanonicalValue(safeBug, "resolution", bug, ["resolution"], { sanitizeText: true });
    assignCanonicalValue(safeBug, "steps", bug, ["steps", "stepsHtml", "reproStep", "reprostep"], { sanitizeText: true });
    assignCanonicalValue(safeBug, "comment", bug, ["comment"], { sanitizeText: true });

    const files = sanitizeFileCollection(bug.files);
    if (files.length > 0) safeBug.files = files;

    const attachments = sanitizeFileCollection(bug.attachments);
    if (attachments.length > 0) safeBug.attachments = attachments;

    const openedFiles = sanitizeFileCollection(bug.openedFiles);
    if (openedFiles.length > 0) safeBug.openedFiles = openedFiles;

    return safeBug;
  }

  function isImageLikeText(value) {
    const text = String(value || "").toLowerCase();
    if (!text) return false;
    if (text.includes("image/")) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)(?:$|[?#])/i.test(text);
  }

  function fileRecordLooksImage(record) {
    if (!record || typeof record !== "object") return false;
    if (record.isImage === true || record.isImage === 1 || record.image === true) return true;
    const probes = [
      record.mime,
      record.contentType,
      record.extension,
      record.ext,
      record.title,
      record.name,
      record.pathname,
      record.path,
      record.url,
      record.webPath,
      record.downloadUrl,
      record.downloadurl,
    ];
    return probes.some((value) => isImageLikeText(value));
  }

  function extractImageUrlsFromBug(bug) {
    const images = new Set();
    const addImageUrl = (value) => {
      const url = normalizeResourceUrl(value);
      if (url) images.add(url);
    };
    const addMatches = (value) => {
      if (!value) return;
      const text = String(value);
      const srcRegex = /<img[^>]+src=["']([^"']+)["']/gi;
      for (const match of text.matchAll(srcRegex)) {
        if (match[1]) addImageUrl(match[1]);
      }
      const markdownImageRegex = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/gi;
      for (const match of text.matchAll(markdownImageRegex)) {
        if (match[1]) addImageUrl(match[1]);
      }
      const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
      for (const match of text.matchAll(urlRegex)) {
        if (isImageLikeText(match[0])) addImageUrl(match[0]);
      }
    };

    const addImagesFromFiles = (files) => {
      if (!files) return;
      const list = Array.isArray(files) ? files : Object.values(files);
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        if (!fileRecordLooksImage(item)) continue;
        const candidates = [
          item.webPath,
          item.url,
          item.downloadUrl,
          item.downloadurl,
          item.path,
          item.pathname,
          item.viewUrl,
          item.href,
        ];
        for (const candidate of candidates) {
          if (candidate) addImageUrl(candidate);
        }
      }
    };

    addMatches(bug?.steps);
    addMatches(bug?.stepsHtml);
    addMatches(bug?.reproStep);
    addMatches(bug?.comment);
    addMatches(bug?.resolution);
    addMatches(bug?.openedBuild);
    addImagesFromFiles(bug?.files);
    addImagesFromFiles(bug?.attachments);
    addImagesFromFiles(bug?.openedFiles);
    return Array.from(images);
  }

  async function getMyBugs({
    status,
    keyword,
    limit = 20,
    page = 1,
    productId,
    projectId,
    projectSetId,
    path = "/bugs",
  } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    const safePage = Math.max(1, Number(page) || 1);
    const dashboardScanLimit = Math.max(safeLimit, 100);
    const assignee = normalizeString(auth.account);
    const effectiveProjectId = normalizePositiveInt(projectId) || normalizePositiveInt(defaultProjectId);

    if (effectiveProjectId) {
      const query = { limit: safeLimit, page: safePage, assignedTo: assignee, status: status || undefined };
      try {
        const resp = await call({ path: `/projects/${effectiveProjectId}/bugs`, method: "GET", query });
        const bugs = parseBugsFromResponse(resp?.data);
        const filtered = bugs.filter((bug) => matchesBugFilters(bug, { status, keyword, assignee }));
        return {
          total: filtered.length,
          matched: filtered.length,
          page: safePage,
          limit: safeLimit,
          projectId: effectiveProjectId,
          assignedTo: assignee,
          bugs: filtered,
          raw: {
            status: resp?.status ?? null,
            path: `/projects/${effectiveProjectId}/bugs`,
            triedPaths: [{
              path: `/projects/${effectiveProjectId}/bugs`,
              status: resp?.status ?? null,
              total: bugs.length,
              matched: filtered.length,
            }],
            scannedTotal: bugs.length,
            paths: [{ path: `/projects/${effectiveProjectId}/bugs`, status: resp?.status ?? null, total: bugs.length, matched: filtered.length }],
            merged: false,
          },
        };
      } catch (err) {
        throw err;
      }
    }

    const effectiveProductId = normalizePositiveInt(productId) || normalizePositiveInt(defaultProductId);
    const effectiveProjectSetId = normalizePositiveInt(projectSetId) || normalizePositiveInt(defaultProjectSetId);
    const requestedPath = normalizeBugsListPath(path);
    const primaryPath = buildProductScopedBugsPath({ productId: effectiveProductId, path: requestedPath });
    const preferProjectSetPath =
      effectiveProjectSetId &&
      requestedPath === "/bugs";
    const configuredMyBugsPath = buildMyBugsPath(myBugsPath);
    const fallbackPathCandidates = (bugsFallbackPaths && bugsFallbackPaths.length > 0)
      ? bugsFallbackPaths
      : ["/my/bug", "/my/bugs"];
    const fallbackPaths = fallbackPathCandidates.map((item) => buildMyBugsPath(item)).filter(Boolean);
    const projectSetCandidates = (projectSetBugsPaths && projectSetBugsPaths.length > 0)
      ? projectSetBugsPaths
      : ["/projectsets/{projectSetId}/bugs", "/projectset/{projectSetId}/bugs", "/programs/{projectSetId}/bugs"];
    const projectSetPaths = projectSetCandidates
      .map((item) => buildProjectSetPath(item, effectiveProjectSetId))
      .filter(Boolean);

    const baseQuery = {
      limit: safeLimit,
      page: safePage,
      assignedTo: assignee,
      status,
      productId: effectiveProductId,
    };
    const candidatePaths = [];
    if (preferProjectSetPath) {
      for (const projectSetPath of projectSetPaths) {
        if (!candidatePaths.includes(projectSetPath)) candidatePaths.push(projectSetPath);
      }
    }
    candidatePaths.push(primaryPath);
    if (effectiveProductId) {
      const productPath = `/products/${effectiveProductId}/bugs`;
      if (!candidatePaths.includes(productPath)) candidatePaths.push(productPath);
    }
    if (!preferProjectSetPath) {
      for (const projectSetPath of projectSetPaths) {
        if (!candidatePaths.includes(projectSetPath)) candidatePaths.push(projectSetPath);
      }
    }
    if (configuredMyBugsPath && !candidatePaths.includes(configuredMyBugsPath)) {
      candidatePaths.push(configuredMyBugsPath);
    }
    for (const fallback of fallbackPaths) {
      if (!candidatePaths.includes(fallback)) candidatePaths.push(fallback);
    }

    let lastErr = null;
    const triedPaths = [];
    const successful = [];
    for (const candidate of candidatePaths) {
      try {
        const query = buildBugsQueryForPath({ path: candidate, ...baseQuery });
        const resp = await call({ path: candidate, method: "GET", query });
        const bugs = parseBugsFromResponse(resp?.data);
        const filtered = bugs.filter((bug) => matchesBugFilters(bug, { status, keyword, assignee }));

        triedPaths.push({
          path: candidate,
          status: resp?.status ?? null,
          total: bugs.length,
          matched: filtered.length,
        });

        successful.push({
          path: candidate,
          status: resp?.status ?? null,
          total: bugs.length,
          matched: filtered.length,
          bugs,
        });
      } catch (err) {
        lastErr = err;
        triedPaths.push({
          path: candidate,
          status: err?.status ?? null,
          error: String(err?.message || err),
        });
        if (!isNeedProductIdError(err)) continue;
        if (candidate !== primaryPath) continue;
      }
    }

    if (effectiveProjectSetId) {
      const programProductsPath = buildProgramProductsPath(effectiveProjectSetId);
      if (programProductsPath) {
        try {
          const productsResp = await call({
            path: programProductsPath,
            method: "GET",
            query: { limit: safeLimit, page: safePage },
          });
          const products = parseProductsFromResponse(productsResp?.data);
          const productIds = products
            .map((product) => normalizePositiveInt(product?.id ?? product?.productId ?? product?.productID))
            .filter(Boolean);

          triedPaths.push({
            path: programProductsPath,
            status: productsResp?.status ?? null,
            total: productIds.length,
            matched: 0,
          });

          for (const scopedProductId of productIds) {
            const productPath = `/products/${scopedProductId}/bugs`;
            try {
              const query = buildBugsQueryForPath({
                path: productPath,
                limit: safeLimit,
                page: safePage,
                assignedTo: assignee,
                status,
                productId: scopedProductId,
              });
              const resp = await call({ path: productPath, method: "GET", query });
              const bugs = parseBugsFromResponse(resp?.data);
              const filtered = bugs.filter((bug) => matchesBugFilters(bug, { status, keyword, assignee }));

              triedPaths.push({
                path: productPath,
                status: resp?.status ?? null,
                total: bugs.length,
                matched: filtered.length,
              });

              successful.push({
                path: productPath,
                status: resp?.status ?? null,
                total: bugs.length,
                matched: filtered.length,
                bugs,
              });
            } catch (err) {
              lastErr = err;
              triedPaths.push({
                path: productPath,
                status: err?.status ?? null,
                error: String(err?.message || err),
              });
            }
          }
        } catch (err) {
          lastErr = err;
          triedPaths.push({
            path: programProductsPath,
            status: err?.status ?? null,
            error: String(err?.message || err),
          });
        }
      }

      const programProjectsPath = buildProgramProjectsPath(effectiveProjectSetId);
      if (programProjectsPath) {
        try {
          const projectsResp = await call({
            path: programProjectsPath,
            method: "GET",
            query: { limit: safeLimit, page: safePage },
          });
          const projects = parseProjectsFromResponse(projectsResp?.data);
          const projectIds = projects
            .map((project) => normalizePositiveInt(project?.id ?? project?.projectId ?? project?.projectID))
            .filter(Boolean);

          triedPaths.push({
            path: programProjectsPath,
            status: projectsResp?.status ?? null,
            total: projectIds.length,
            matched: 0,
          });

          for (const scopedProjectId of projectIds) {
            const projectPath = `/projects/${scopedProjectId}/bugs`;
            try {
              const resp = await call({
                path: projectPath,
                method: "GET",
                query: { limit: safeLimit, page: safePage, assignedTo: assignee },
              });
              const bugs = parseBugsFromResponse(resp?.data);
              const filtered = bugs.filter((bug) => matchesBugFilters(bug, { status, keyword, assignee }));

              triedPaths.push({
                path: projectPath,
                status: resp?.status ?? null,
                total: bugs.length,
                matched: filtered.length,
              });

              successful.push({
                path: projectPath,
                status: resp?.status ?? null,
                total: bugs.length,
                matched: filtered.length,
                bugs,
              });
            } catch (err) {
              lastErr = err;
              triedPaths.push({
                path: projectPath,
                status: err?.status ?? null,
                error: String(err?.message || err),
              });
            }
          }
        } catch (err) {
          lastErr = err;
          triedPaths.push({
            path: programProjectsPath,
            status: err?.status ?? null,
            error: String(err?.message || err),
          });
        }
      }
    }

    if (!effectiveProjectSetId && !effectiveProductId && successful.length === 0) {
      try {
        const programsResp = await call({
          path: "/programs",
          method: "GET",
          query: { limit: 100, page: 1 },
        });
        const programs = parseProgramsFromResponse(programsResp?.data);
        const programIds = programs
          .map((program) => normalizePositiveInt(program?.id ?? program?.projectSetId ?? program?.programId))
          .filter(Boolean);
        const scannedProjectIds = new Set();

        triedPaths.push({
          path: "/programs",
          status: programsResp?.status ?? null,
          total: programIds.length,
          matched: 0,
        });

        for (const scopedProgramId of programIds) {
          const programProjectsPath = `/programs/${scopedProgramId}/projects`;
          try {
            const projectsResp = await call({
              path: programProjectsPath,
              method: "GET",
              query: { limit: 100, page: 1 },
            });
            const projects = parseProjectsFromResponse(projectsResp?.data);
            const projectIds = projects
              .map((project) => normalizePositiveInt(project?.id ?? project?.projectId ?? project?.projectID))
              .filter(Boolean);

            triedPaths.push({
              path: programProjectsPath,
              status: projectsResp?.status ?? null,
              total: projectIds.length,
              matched: 0,
            });

            for (const scopedProjectId of projectIds) {
              if (scannedProjectIds.has(scopedProjectId)) continue;
              scannedProjectIds.add(scopedProjectId);
              const projectPath = `/projects/${scopedProjectId}/bugs`;
              try {
                const resp = await call({
                  path: projectPath,
                  method: "GET",
                  query: {
                    limit: dashboardScanLimit,
                    page: safePage,
                    assignedTo: assignee,
                    status: status || undefined,
                  },
                });
                const bugs = parseBugsFromResponse(resp?.data);
                const filtered = bugs.filter((bug) => matchesBugFilters(bug, { status, keyword, assignee }));

                triedPaths.push({
                  path: projectPath,
                  status: resp?.status ?? null,
                  total: bugs.length,
                  matched: filtered.length,
                });

                successful.push({
                  path: projectPath,
                  status: resp?.status ?? null,
                  total: bugs.length,
                  matched: filtered.length,
                  bugs,
                });
              } catch (err) {
                lastErr = err;
                triedPaths.push({
                  path: projectPath,
                  status: err?.status ?? null,
                  error: String(err?.message || err),
                });
              }
            }
          } catch (err) {
            lastErr = err;
            triedPaths.push({
              path: programProjectsPath,
              status: err?.status ?? null,
              error: String(err?.message || err),
            });
          }
        }
      } catch (err) {
        lastErr = err;
        triedPaths.push({
          path: "/programs",
          status: err?.status ?? null,
          error: String(err?.message || err),
        });
      }
    }

    if (successful.length === 0) throw lastErr;

    const mergedBugs = [];
    const seenBugIds = new Set();
    for (const result of successful) {
      for (const bug of result.bugs || []) {
        const bugId = getBugId(bug);
        if (bugId) {
          if (seenBugIds.has(bugId)) continue;
          seenBugIds.add(bugId);
        }
        mergedBugs.push(bug);
      }
    }

    const mergedFiltered = mergedBugs.filter((bug) => matchesBugFilters(bug, { status, keyword, assignee }));
    const best = successful.reduce((acc, cur) => {
      if (!acc) return cur;
      if (cur.matched > acc.matched) return cur;
      if (cur.matched === acc.matched && cur.total > acc.total) return cur;
      return acc;
    }, null);

    return {
      total: mergedFiltered.length,
      matched: mergedFiltered.length,
      page: safePage,
      limit: safeLimit,
      productId: effectiveProductId,
      projectSetId: effectiveProjectSetId,
      assignedTo: assignee,
      bugs: mergedFiltered,
      raw: {
        status: best?.status ?? null,
        path: best?.path ?? primaryPath,
        triedPaths,
        scannedTotal: mergedBugs.length,
        paths: successful.map((r) => ({
          path: r.path,
          status: r.status,
          total: r.total,
          matched: r.matched,
        })),
        merged: successful.length > 1,
      },
    };
  }

  async function getBugDetail({ id } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("getBugDetail requires a valid bug id");
    }

    const detailPath = buildBugDetailPath({ id: bugId });
    const resp = await call({ path: detailPath, method: "GET" });
    const bug = parseBugDetailFromResponse(resp.data);
    if (!bug) {
      return {
        id: bugId,
        found: false,
        images: [],
        raw: { status: resp.status },
      };
    }

    return {
      id: bugId,
      found: true,
      bug: buildSafeBugDetail(bug),
      images: extractImageUrlsFromBug(bug),
      raw: { status: resp.status },
    };
  }

  async function resolveBug({
    id,
    resolution = "fixed",
    resolvedBuild,
    solutionModules,
    solution = "",
    comment = "",
  } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("resolveBug requires a valid bug id");
    }

    const resolvePath = buildBugResolvePath({ id: bugId });
    const resolvedValue = String(resolution || "fixed");
    const buildValue = String(
      resolvedBuild !== undefined && resolvedBuild !== null
        ? resolvedBuild
        : normalizedDefaultResolvedBuild
    ).trim();
    if (!buildValue) {
      throw new Error(
        "resolveBug requires resolvedBuild (pass resolvedBuild or set ZENTAO_DEFAULT_RESOLVED_BUILD, e.g. trunk)"
      );
    }
    const resolutionPayload = buildResolutionComment({
      solutionModules,
      solution,
      comment,
      resolution: resolvedValue,
    });
    const body = {
      resolution: resolvedValue,
      resolvedBuild: buildValue,
      comment: resolutionPayload.comment,
    };

    const resp = await call({ path: resolvePath, method: "POST", body });

    // Auto-post the solution/comment text as a separate reply so it appears
    // in the bug discussion, not just in the resolve action record.
    let autoComment;
    if (resolutionPayload.solutionSource !== "fallback" && resolutionPayload.comment) {
      try {
        autoComment = await commentBug({ id: bugId, comment: resolutionPayload.comment });
      } catch (_) {
        autoComment = { commented: false, error: "auto-comment failed, resolve succeeded" };
      }
    }

    return {
      id: bugId,
      resolved: true,
      resolution: resolvedValue,
      resolvedBuild: buildValue,
      solution: resolutionPayload.solution,
      solutionSource: resolutionPayload.solutionSource,
      solutionModules: resolutionPayload.solutionModules,
      comment: resolutionPayload.comment,
      autoComment,
      raw: { status: resp.status },
    };
  }

  async function closeBug({ id, comment = "" } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("closeBug requires a valid bug id");
    }

    const closePath = buildBugTransitionPath({ id: bugId, action: "close" });
    const body = {};
    if (comment) body.comment = String(comment);

    const resp = await call({ path: closePath, method: "POST", body });
    return {
      id: bugId,
      closed: true,
      raw: { status: resp.status },
    };
  }

  async function activateBug({ id, comment = "" } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("activateBug requires a valid bug id");
    }

    const activatePath = buildBugTransitionPath({ id: bugId, action: "activate" });
    const body = {};
    if (comment) body.comment = String(comment);

    const resp = await call({ path: activatePath, method: "POST", body });
    return {
      id: bugId,
      activated: true,
      raw: { status: resp.status },
    };
  }

  async function verifyBug({
    id,
    result = "pass",
    comment = "",
  } = {}) {
    const normalizedResult = normalizeString(result || "pass");
    if (normalizedResult !== "pass" && normalizedResult !== "fail") {
      throw new Error("verifyBug.result must be pass or fail");
    }

    if (normalizedResult === "pass") {
      const closeResult = await closeBug({ id, comment });
      return {
        id: Number(id),
        verified: true,
        result: "pass",
        action: "close",
        raw: closeResult.raw,
      };
    }

    const activateResult = await activateBug({ id, comment });
    return {
      id: Number(id),
      verified: true,
      result: "fail",
      action: "activate",
      raw: activateResult.raw,
    };
  }

  async function commentBug({ id, comment } = {}) {
    const bugId = Number(id);
    if (!Number.isFinite(bugId) || bugId < 1) {
      throw new Error("commentBug requires a valid bug id");
    }
    const text = String(comment || "").trim();
    if (!text) {
      throw new Error("commentBug requires non-empty comment");
    }

    const primaryPath = buildBugCommentPath({ id: bugId });
    const body = { comment: text };
    try {
      const resp = await call({ path: primaryPath, method: "POST", body });
      return {
        id: bugId,
        commented: true,
        comment: text,
        raw: { status: resp.status, path: primaryPath },
      };
    } catch (err) {
      const fallbackPath = primaryPath.replace(/\/comment$/, "/comments");
      if (fallbackPath !== primaryPath && Number(err?.status) === 404) {
        const resp = await call({ path: fallbackPath, method: "POST", body });
        return {
          id: bugId,
          commented: true,
          comment: text,
          raw: { status: resp.status, path: fallbackPath },
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
    projectId,
    projectSetId,
    maxItems = 20,
    resolution = "fixed",
    resolvedBuild,
    solutionModules,
    solution = "",
    comment = "",
    path = "/bugs",
    stopOnError = true,
  } = {}) {
    const safeMaxItems = Math.max(1, Math.min(Number(maxItems) || 20, MAX_BATCH_RESOLVE_ITEMS));
    const listResult = await getMyBugs({
      status,
      keyword,
      limit,
      page,
      productId,
      projectId,
      projectSetId,
      path,
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
          resolvedBuild,
          solutionModules,
          solution,
          comment,
        });
        success.push({
          id: bugId,
          status: result.raw.status,
          resolvedBuild: result.resolvedBuild,
        });
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
