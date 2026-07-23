/**
 * Structured bug solution helpers.
 * Formats MCP solutionModules into multi-line ZenTao solution text.
 */

export const SOLUTION_SECTION_DEFS = [
  { key: "rootCause", label: "【根因】" },
  { key: "fixApproach", label: "【修复思路】" },
  { key: "logicChange", label: "【改动逻辑】" },
  { key: "impact", label: "【影响范围】" },
];

export const SOLUTION_MODULE_KEYS = SOLUTION_SECTION_DEFS.map((item) => item.key);

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSolutionText(value) {
  return String(value || "").trim();
}

/**
 * @param {unknown} modules
 * @returns {{ rootCause: string, fixApproach: string, logicChange: string, impact: string } | null}
 */
export function normalizeSolutionModules(modules) {
  if (modules == null) return null;
  if (typeof modules !== "object" || Array.isArray(modules)) {
    throw new Error("solutionModules must be an object");
  }

  const normalized = {
    rootCause: "",
    fixApproach: "",
    logicChange: "",
    impact: "",
  };

  for (const key of SOLUTION_MODULE_KEYS) {
    if (modules[key] === undefined || modules[key] === null) continue;
    if (typeof modules[key] !== "string") {
      throw new Error(`solutionModules.${key} must be a string`);
    }
    normalized[key] = modules[key].trim();
  }

  const unknownKeys = Object.keys(modules).filter((key) => !SOLUTION_MODULE_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `solutionModules only supports: ${SOLUTION_MODULE_KEYS.join(", ")}; unknown: ${unknownKeys.join(", ")}`
    );
  }

  const hasContent = SOLUTION_MODULE_KEYS.some((key) => normalized[key]);
  return hasContent ? normalized : null;
}

/**
 * Format structured modules into multi-line solution text.
 * Empty sections are omitted.
 *
 * @param {unknown} modules
 * @returns {string}
 */
export function formatSolutionModules(modules) {
  const normalized = normalizeSolutionModules(modules);
  if (!normalized) return "";

  const blocks = [];
  for (const { key, label } of SOLUTION_SECTION_DEFS) {
    const text = normalized[key];
    if (!text) continue;
    blocks.push(`${label}\n${text}`);
  }
  return blocks.join("\n\n");
}

/**
 * Resolve final solution text.
 * Priority: solutionModules (any non-empty field) > plain solution string.
 *
 * @param {Object} params
 * @param {unknown} [params.solutionModules]
 * @param {unknown} [params.solution]
 * @returns {{ text: string, source: "modules" | "solution" | "empty", modules: object | null }}
 */
export function resolveSolutionText({ solutionModules, solution } = {}) {
  const formattedModules = formatSolutionModules(solutionModules);
  if (formattedModules) {
    return {
      text: formattedModules,
      source: "modules",
      modules: normalizeSolutionModules(solutionModules),
    };
  }

  const plain = normalizeSolutionText(solution);
  if (plain) {
    return {
      text: plain,
      source: "solution",
      modules: null,
    };
  }

  return {
    text: "",
    source: "empty",
    modules: null,
  };
}

/**
 * Validate solution-related args for a tool.
 * @param {string} toolName
 * @param {Object} args
 */
export function assertSolutionArgs(toolName, args) {
  if (!args || typeof args !== "object") return;

  if (args.solution !== undefined && typeof args.solution !== "string") {
    throw new Error(`${toolName}.solution must be a string`);
  }

  if (args.solutionModules === undefined) return;

  // Throws on invalid shape / unknown keys / non-string fields.
  const normalized = normalizeSolutionModules(args.solutionModules);
  if (args.solutionModules != null && normalized == null) {
    // Object provided but all fields empty / missing
    if (typeof args.solutionModules !== "object" || Array.isArray(args.solutionModules)) {
      throw new Error(`${toolName}.solutionModules must be an object`);
    }
    throw new Error(
      `${toolName}.solutionModules requires at least one non-empty field among: ${SOLUTION_MODULE_KEYS.join(", ")}`
    );
  }
}
