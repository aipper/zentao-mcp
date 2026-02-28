#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
release-npm.sh (zentao-mcp-server)

Default mode is dry-run: run checks + npm pack --dry-run, no npm publish.

Usage:
  bash scripts/release-npm.sh
  bash scripts/release-npm.sh --publish

Options:
  --release <tag>        Set package version from tag (vX.Y.Z), then commit + tag
  --bump <level>         Auto bump version: patch | minor | major, then commit + tag
  --publish              Run npm publish after checks
  --yes                  Skip interactive confirmation
  --require-tag          Require a semver git tag on HEAD matching package version
  --skip-secrets-scan    Skip ripgrep-based secrets scan
  --skip-whoami          Skip npm whoami check
  --no-git-clean-check   Skip clean-worktree check (not recommended)
  -h, --help             Show help

Environment:
  ZENTAO_NPM_CACHE_DIR   Override npm cache dir used by this script
EOF
}

PUBLISH=0
YES=0
REQUIRE_TAG=0
RELEASE_TAG=""
BUMP_LEVEL=""
SKIP_SECRETS_SCAN=0
SKIP_WHOAMI=0
SKIP_GIT_CLEAN_CHECK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      shift
      if [[ $# -lt 1 ]]; then
        echo "error: --release requires <tag> (e.g. v0.1.0)" >&2
        usage
        exit 2
      fi
      RELEASE_TAG="$1"
      ;;
    --bump)
      shift
      if [[ $# -lt 1 ]]; then
        echo "error: --bump requires <level> (patch|minor|major)" >&2
        usage
        exit 2
      fi
      BUMP_LEVEL="$1"
      ;;
    --publish) PUBLISH=1 ;;
    --yes) YES=1 ;;
    --require-tag) REQUIRE_TAG=1 ;;
    --skip-secrets-scan) SKIP_SECRETS_SCAN=1 ;;
    --skip-whoami) SKIP_WHOAMI=1 ;;
    --no-git-clean-check) SKIP_GIT_CLEAN_CHECK=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

log() { echo "info: $*"; }
warn() { echo "warn: $*" >&2; }
die() { echo "error: $*" >&2; exit 2; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

command -v node >/dev/null 2>&1 || die "node is required"
command -v npm >/dev/null 2>&1 || die "npm is required"

DEFAULT_NPM_CACHE_DIR="${ZENTAO_NPM_CACHE_DIR:-/tmp/zentao-npm-cache}"

maybe_use_safe_npm_cache() {
  if [[ -z "${npm_config_cache:-}" && -z "${NPM_CONFIG_CACHE:-}" ]]; then
    export npm_config_cache="$DEFAULT_NPM_CACHE_DIR"
  fi
  local cache_dir="${npm_config_cache:-${NPM_CONFIG_CACHE:-}}"
  if [[ -n "${cache_dir:-}" ]]; then
    mkdir -p "$cache_dir" 2>/dev/null || true
    log "npm_cache=$cache_dir"
  fi
}

maybe_use_safe_npm_cache

pkg_name=""
pkg_version=""
pkg_private=""
release_version=""
release_tag_name=""
release_tmpdir=""
release_restore_on_exit=0

cleanup_release() {
  if [[ "${release_restore_on_exit:-0}" == "1" && -n "${release_tmpdir:-}" ]]; then
    cp "$release_tmpdir/package.json" package.json 2>/dev/null || true
  fi
  if [[ -n "${release_tmpdir:-}" ]]; then
    rm -rf "$release_tmpdir" 2>/dev/null || true
  fi
}
trap cleanup_release EXIT

is_semver() {
  printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-.+].+)?$'
}

normalize_release_tag() {
  local input="$1"
  if [[ "$input" == v* ]]; then
    release_tag_name="$input"
    release_version="${input#v}"
  else
    release_tag_name="v$input"
    release_version="$input"
  fi
  if ! is_semver "$release_version"; then
    die "--release requires semver tag (vX.Y.Z); got: $input"
  fi
}

calc_bumped_version() {
  local current="$1"
  local level="$2"
  ZENTAO_CURRENT_VERSION="$current" ZENTAO_BUMP_LEVEL="$level" node - <<'NODE'
const current = process.env.ZENTAO_CURRENT_VERSION || "";
const level = process.env.ZENTAO_BUMP_LEVEL || "";
const m = current.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
if (!m) {
  console.error(`error: current version is not semver-like: ${current}`);
  process.exit(2);
}
let major = Number(m[1]);
let minor = Number(m[2]);
let patch = Number(m[3]);
if (level === "patch") {
  patch += 1;
} else if (level === "minor") {
  minor += 1;
  patch = 0;
} else if (level === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else {
  console.error(`error: unsupported bump level: ${level} (expected patch|minor|major)`);
  process.exit(2);
}
process.stdout.write(`${major}.${minor}.${patch}`);
NODE
}

read_pkg() {
  pkg_name="$(node -p "require('./package.json').name")"
  pkg_version="$(node -p "require('./package.json').version")"
  pkg_private="$(node -p "Boolean(require('./package.json').private)")"
}

write_version() {
  local v="$1"
  ZENTAO_RELEASE_VERSION="$v" node - <<'NODE'
const fs = require("node:fs");
const file = "package.json";
const v = process.env.ZENTAO_RELEASE_VERSION;
if (!v) {
  console.error("missing ZENTAO_RELEASE_VERSION");
  process.exit(2);
}
const src = fs.readFileSync(file, "utf8");
const pkg = JSON.parse(src);
pkg.version = v;
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
NODE
}

backup_package_for_restore() {
  release_tmpdir="$(mktemp -d)"
  cp package.json "$release_tmpdir/package.json"
  release_restore_on_exit=1
}

run_cmd_with_timeout() {
  local seconds="$1"
  shift
  local cmd="$1"
  shift
  local -a cmd_args=("$@")
  NPM_TIMEOUT_SECONDS="$seconds" NPM_TIMEOUT_CMD="$cmd" NPM_TIMEOUT_ARGS="$(printf '%s\n' "${cmd_args[@]-}" | node -e "const fs=require('fs'); const lines=fs.readFileSync(0,'utf8').split(/\r?\n/).filter(Boolean); process.stdout.write(JSON.stringify(lines));")" \
    node - <<'NODE'
const { spawn } = require("node:child_process");
const seconds = Number.parseInt(process.env.NPM_TIMEOUT_SECONDS || "0", 10);
const cmd = process.env.NPM_TIMEOUT_CMD;
const args = JSON.parse(process.env.NPM_TIMEOUT_ARGS || "[]");
if (!cmd || !Number.isFinite(seconds) || seconds <= 0) {
  console.error("error: invalid timeout config");
  process.exit(2);
}
const child = spawn(cmd, args, { stdio: "inherit" });
const timer = setTimeout(() => {
  console.error(`error: timeout after ${seconds}s: ${cmd} ${args.join(" ")}`.trim());
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 1000);
}, seconds * 1000);
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (signal) process.exit(1);
  process.exit(typeof code === "number" ? code : 1);
});
NODE
}

read_pkg

log "repo_root=$repo_root"
log "package=$pkg_name"
log "version=$pkg_version"
log "mode=$(
  if [[ "$PUBLISH" == "1" ]]; then
    echo publish
  elif [[ -n "${RELEASE_TAG:-}" || -n "${BUMP_LEVEL:-}" ]]; then
    echo prepare
  else
    echo dry-run
  fi
)"

if [[ -n "${RELEASE_TAG:-}" && -n "${BUMP_LEVEL:-}" ]]; then
  die "cannot combine --release and --bump"
fi

VERSION_UPDATE=0
if [[ -n "${RELEASE_TAG:-}" ]]; then
  normalize_release_tag "$RELEASE_TAG"
  VERSION_UPDATE=1
fi
if [[ -n "${BUMP_LEVEL:-}" ]]; then
  release_version="$(calc_bumped_version "$pkg_version" "$BUMP_LEVEL")"
  release_tag_name="v$release_version"
  VERSION_UPDATE=1
  log "bump_level=$BUMP_LEVEL"
fi

if [[ "$VERSION_UPDATE" == "1" && "$REQUIRE_TAG" == "1" ]]; then
  die "cannot combine --release/--bump with --require-tag (release flow creates a tag)"
fi

if [[ "$VERSION_UPDATE" == "1" ]]; then
  command -v git >/dev/null 2>&1 || die "--release/--bump requires git"
  log "release_tag=$release_tag_name"
  log "release_version=$release_version"

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    die "--release requires running inside a git repository"
  fi

  if git rev-parse -q --verify "refs/tags/$release_tag_name" >/dev/null 2>&1; then
    die "--release tag already exists: $release_tag_name"
  fi

  if [[ "$SKIP_GIT_CLEAN_CHECK" != "1" ]]; then
    dirty="$(git status --porcelain || true)"
    if [[ -n "${dirty:-}" ]]; then
      die "--release requires a clean git working tree; commit or stash changes first"
    fi
  fi

  backup_package_for_restore
  write_version "$release_version"
  read_pkg
  log "(after release) version=$pkg_version"
fi

if [[ "$REQUIRE_TAG" == "1" ]]; then
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    die "--require-tag requires running inside a git repository"
  fi
  git_tag="$(git describe --tags --exact-match 2>/dev/null || true)"
  if [[ -z "${git_tag:-}" ]]; then
    die "--require-tag expected a semver tag on HEAD (e.g. v$pkg_version); found none"
  fi
  tag_version="${git_tag#v}"
  if ! is_semver "$tag_version"; then
    die "--require-tag expected tag in vX.Y.Z (or X.Y.Z) form; got: $git_tag"
  fi
  if [[ "$tag_version" != "$pkg_version" ]]; then
    die "--require-tag tag version mismatch: tag=$git_tag (=> $tag_version) but package version=$pkg_version"
  fi
  log "git_tag=$git_tag"
fi

if [[ "$PUBLISH" == "1" && "$pkg_version" == "0.0.0" ]]; then
  die "refusing to publish version 0.0.0; bump version first"
fi

if [[ "$VERSION_UPDATE" != "1" ]]; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [[ "$SKIP_GIT_CLEAN_CHECK" != "1" ]]; then
      dirty="$(git status --porcelain || true)"
      if [[ -n "${dirty:-}" ]]; then
        if [[ "$PUBLISH" == "1" ]]; then
          die "git working tree is not clean; commit or stash changes before publishing"
        fi
        warn "git working tree is not clean (ok for dry-run):"
        echo "$dirty" | sed -n '1,20p'
        if [[ "$(echo "$dirty" | wc -l | tr -d ' ')" -gt 20 ]]; then
          warn "(truncated)"
        fi
      fi
    fi
  else
    warn "not a git repository; skip git clean check"
  fi
fi

if [[ "$SKIP_SECRETS_SCAN" != "1" ]]; then
  if command -v rg >/dev/null 2>&1; then
    log "secrets scan (filenames only):"
    secret_re='(_authToken\\s*=\\s*[^\\s#]{16,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIzaSy[A-Za-z0-9_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Authorization:\\s*Bearer\\s+[^\\s<]{20,}|Bearer\\s+[A-Za-z0-9._-]{20,}|(api[_-]?key|token|password|secret)\\s*[:=]\\s*[\\x27\\\"][^\\x27\\\"<]{12,}[\\x27\\\"])'
    matches="$(rg -i -l "$secret_re" . --glob '!node_modules/**' --glob '!.git/**' --glob '!dist/**' --glob '!.env' --glob '!.env.*' || true)"
    if [[ -n "${matches:-}" ]]; then
      if [[ "$PUBLISH" == "1" ]]; then
        echo "$matches"
        die "potential secret-like patterns found; inspect files above before publishing"
      fi
      warn "potential secret-like patterns found (dry-run continues):"
      echo "$matches"
    else
      log "secrets scan: ok"
    fi
  else
    warn "rg not found; skip secrets scan"
  fi
fi

if [[ "$SKIP_WHOAMI" == "1" ]]; then
  warn "npm whoami skipped (--skip-whoami)"
else
  whoami_timeout_seconds=15
  if [[ "$PUBLISH" != "1" ]]; then
    whoami_timeout_seconds=5
  fi
  set +e
  run_cmd_with_timeout "$whoami_timeout_seconds" npm whoami >/dev/null 2>&1
  whoami_code=$?
  set -e
  if [[ "$whoami_code" == "0" ]]; then
    log "npm whoami: ok"
  else
    if [[ "$PUBLISH" == "1" ]]; then
      die "npm whoami failed (or timed out); run npm login and retry"
    fi
    warn "npm whoami failed (or timed out; ok for dry-run)"
  fi
fi

log "pack preview: npm pack --dry-run"
pack_out=""
set +e
pack_out="$(npm pack --dry-run 2>&1)"
pack_code=$?
set -e
if [[ "$pack_code" != "0" ]]; then
  if echo "$pack_out" | grep -Eqi "(EPERM|EACCES)" && [[ "${npm_config_cache:-${NPM_CONFIG_CACHE:-}}" != "$DEFAULT_NPM_CACHE_DIR" ]]; then
    warn "npm pack failed with EPERM/EACCES; retry with npm_config_cache=$DEFAULT_NPM_CACHE_DIR"
    export npm_config_cache="$DEFAULT_NPM_CACHE_DIR"
    mkdir -p "$DEFAULT_NPM_CACHE_DIR" 2>/dev/null || true
    npm pack --dry-run >/dev/null
  else
    echo "$pack_out" >&2
    exit "$pack_code"
  fi
fi
log "pack preview: ok"

publish_cmd=(npm publish)
if [[ "$pkg_name" == @*/* ]]; then
  publish_cmd=(npm publish --access public)
fi
log "publish command: ${publish_cmd[*]}"

if [[ "$PUBLISH" != "1" ]]; then
  if [[ "$VERSION_UPDATE" == "1" ]]; then
    if [[ "$YES" != "1" ]]; then
      echo ""
      echo "About to prepare git release:"
      echo "  - set version to $release_version"
      echo "  - git commit: chore(release): $release_tag_name"
      echo "  - git tag: $release_tag_name"
      echo ""
      read -r -p "Type 'release' to continue: " confirm_release
      if [[ "${confirm_release:-}" != "release" ]]; then
        die "aborted"
      fi
    fi
    if ! git diff --quiet -- package.json; then
      git add package.json
      git commit -m "chore(release): $release_tag_name"
    else
      log "release: no version changes to commit"
    fi
    git tag "$release_tag_name"
    log "release: created git tag $release_tag_name"
    release_restore_on_exit=0
    log "prepare complete (no npm publish performed)"
    exit 0
  fi
  log "dry-run complete (no publish performed)"
  exit 0
fi

if [[ "$pkg_private" == "true" ]]; then
  die "package.json has private=true; set private=false before publishing"
fi

if [[ "$YES" != "1" ]]; then
  echo ""
  echo "About to publish to npm:"
  echo "  - $pkg_name@$pkg_version"
  if [[ "$VERSION_UPDATE" == "1" ]]; then
    echo ""
    echo "And prepare git release:"
    echo "  - git commit: chore(release): $release_tag_name"
    echo "  - git tag: $release_tag_name"
  fi
  echo ""
  read -r -p "Type 'publish' to continue: " confirm_publish
  if [[ "${confirm_publish:-}" != "publish" ]]; then
    die "aborted"
  fi
fi

if [[ "$VERSION_UPDATE" == "1" ]]; then
  if ! git diff --quiet -- package.json; then
    git add package.json
    git commit -m "chore(release): $release_tag_name"
  else
    log "release: no version changes to commit"
  fi
  git tag "$release_tag_name"
  log "release: created git tag $release_tag_name"
  release_restore_on_exit=0
fi

"${publish_cmd[@]}"
log "publish complete"
