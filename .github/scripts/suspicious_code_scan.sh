#!/usr/bin/env bash
# Supply-chain / malware scan for the Cocos2d-x AdMob installer (Node.js).
# Covers: JS installer abuse, remote shell pipes, obfuscated payloads, and
# checked-in binaries. Does not publish or build sample games.
set -euo pipefail

FAILED=0
warn() { echo "WARNING: $1"; }
fail() { echo "ERROR: $1"; FAILED=1; }

# Prefer GNU grep -P (CI bookworm/ubuntu). Fall back to ggrep (Homebrew) or perl (macOS).
USE_PERL_GREP=0
if printf 'x' | grep -Pq 'x' 2>/dev/null; then
  GREP_P_BIN=$(command -v grep)
elif command -v ggrep >/dev/null 2>&1 && printf 'x' | ggrep -Pq 'x' 2>/dev/null; then
  GREP_P_BIN=$(command -v ggrep)
elif command -v perl >/dev/null 2>&1; then
  USE_PERL_GREP=1
  GREP_P_BIN=perl
else
  echo "ERROR: need grep -P, ggrep, or perl for PCRE; cannot run the scan."
  exit 1
fi

pcre_grep_files() {
  local pattern="$1"
  shift
  if [ "$USE_PERL_GREP" -eq 1 ]; then
    local f
    for f in "$@"; do
      [ -f "$f" ] || continue
      perl -ne 'BEGIN{$p=shift} if(/$p/){print "$ARGV:$.:$_"}' "$pattern" "$f"
    done
  else
    printf '%s\n' "$@" | xargs "$GREP_P_BIN" -Pn "$pattern" 2>/dev/null || true
  fi
}

collect_files() {
  find . -type f \( "$@" \) \
    ! -path './.git/*' \
    ! -path './.github/*' \
    ! -path '*/node_modules/*' \
    ! -path '*/build/*' \
    ! -path './cocos2dx-admob-sample/*' \
    2>/dev/null || true
}

scan_pattern() {
  local label="$1"
  local pattern="$2"
  local severity="$3" # fail | warn
  shift 3
  local files
  files=$(printf '%s\n' "$@" | sed '/^$/d')
  if [ -z "$files" ]; then
    return 0
  fi
  # shellcheck disable=SC2086
  if matches=$(pcre_grep_files "$pattern" $files \
    | grep -Ev ':[0-9]+:[[:space:]]*(#|//)'); then
    echo ""
    echo "── Matched: $label ──"
    echo "$matches"
    if [ "$severity" = "fail" ]; then
      fail "BLOCKED — $label"
    else
      warn "Review — $label"
    fi
  fi
}

echo "═══════════════════════════════════════════════════"
echo "  Suspicious code scan (Cocos2d-x installer)      "
echo "═══════════════════════════════════════════════════"

JS_FILES=$(collect_files -name '*.js' -o -name '*.mjs' -o -name '*.cjs')
SCRIPT_FILES=$(collect_files \
  -name '*.sh' -o \
  -name '*.bash' -o \
  -name 'Makefile' -o \
  -name 'Dockerfile' -o \
  -name '*.cmake' -o \
  -name 'CMakeLists.txt')
JSON_FILES=$(collect_files -name 'package.json' -o -name '*.json')

echo "JavaScript:"
echo "${JS_FILES:-  (none)}" | sed 's/^/  /'
echo "Scripts / CMake:"
echo "${SCRIPT_FILES:-  (none)}" | sed 's/^/  /'
echo ""

# ═══════════════════════════════════════════════════════════════
# 1) Node / installer abuse
# ═══════════════════════════════════════════════════════════════
scan_pattern \
  "child_process spawn/exec (arbitrary OS command)" \
  'require\s*\(\s*["'\'']child_process["'\'']\s*\)|child_process\.(exec|execSync|spawn|spawnSync|fork)\s*\(' \
  fail $JS_FILES

scan_pattern \
  "eval() / Function() dynamic code" \
  '\beval\s*\(|\bFunction\s*\(' \
  fail $JS_FILES

scan_pattern \
  "Obfuscated decode in JS (Buffer.from base64 + exec chain risk)" \
  'Buffer\.from\s*\([^)]*base64|atob\s*\(' \
  warn $JS_FILES

scan_pattern \
  "Remote shell pipe in JS string" \
  '(curl|wget)\s[^|]*\|\s*(sh|bash|zsh)' \
  fail $JS_FILES

scan_pattern \
  "Network fetch helpers in installer (manual review)" \
  '\b(https?\.get|https?\.request|fetch\s*\(|axios\.|got\s*\(|node-fetch)' \
  warn $JS_FILES

scan_pattern \
  "fs write of downloaded/remote content patterns" \
  'writeFileSync\s*\([^)]*https?://|createWriteStream\s*\([^)]*https?://' \
  fail $JS_FILES

scan_pattern \
  "Known paste / tunnel C2 hosts" \
  'pastebin\.com|ngrok\.(io|app)|webhook\.site|requestbin|discord\.com/api/webhooks' \
  fail $JS_FILES

scan_pattern \
  "IP-literal URL (possible C2)" \
  'https?://\d{1,3}(\.\d{1,3}){3}' \
  fail $JS_FILES

# ═══════════════════════════════════════════════════════════════
# 2) package.json install hooks (supply chain)
# ═══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════"
echo "  package.json lifecycle scripts                  "
echo "═══════════════════════════════════════════════════"

if [ -n "${JSON_FILES}" ]; then
  # shellcheck disable=SC2086
  if matches=$(pcre_grep_files \
    '"(preinstall|postinstall|preuninstall|postuninstall|prepare)"\s*:' \
    $JSON_FILES | grep -Ev ':[0-9]+:[[:space:]]*(#|//)' || true); then
    if [ -n "${matches}" ]; then
      echo "── Matched: npm lifecycle install hooks ──"
      echo "$matches"
      fail "BLOCKED — npm install lifecycle hooks are not allowed in this package"
    else
      echo "✅ No npm install lifecycle hooks."
    fi
  fi
else
  echo "✅ No package.json files found."
fi

# ═══════════════════════════════════════════════════════════════
# 3) Shell / CMake / Docker
# ═══════════════════════════════════════════════════════════════
scan_pattern \
  "Multi-stage decode chain in project script" \
  'xxd\s+-p\s+-r\s*\|\s*xxd|base64\s+(-d|--decode)\s*\|' \
  fail $SCRIPT_FILES

scan_pattern \
  "Remote shell pipe in project script" \
  '(curl|wget)\s[^|]*\|\s*(sh|bash|zsh)' \
  fail $SCRIPT_FILES

# ═══════════════════════════════════════════════════════════════
# 4) Binary / opaque blob scan
# ═══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Binary / opaque asset scan                      "
echo "═══════════════════════════════════════════════════"

FORBIDDEN_BINARIES=$(git ls-files \
  | grep -vE '^\.github/' \
  | grep -E '\.(so|dex|apk|aab|jar|aar|exe|dll|dylib)$' \
  || true)

if [ -n "$FORBIDDEN_BINARIES" ]; then
  echo "── Matched: Checked-in binaries ──"
  echo "$FORBIDDEN_BINARIES"
  fail "BLOCKED — Binaries must not be committed"
else
  echo "✅ No binary artifacts committed."
fi

XARGS_R=(xargs)
if xargs --help 2>&1 | grep -q -- '-r'; then
  XARGS_R=(xargs -r)
fi

b64_files=$(git ls-files \
  | grep -vE '^\.github/|\.(png|jpg|jpeg|webp|gif|svg|ttf|otf|ico)$' \
  || true)
b64_hits=""
if [ -n "$b64_files" ]; then
  # shellcheck disable=SC2086
  b64_hits=$(pcre_grep_files '[A-Za-z0-9+/]{200,}={0,2}' $b64_files \
    | grep -Ev ':[0-9]+:[[:space:]]*(#|//)' \
    || true)
fi

if [ -n "${b64_hits}" ]; then
  echo "── Matched: Large base64 / opaque blob in source ──"
  echo "$b64_hits" | head -n 50
  fail "BLOCKED — Large opaque base64 blob (possible embedded payload)"
else
  echo "✅ No large opaque base64 blobs in tracked sources."
fi

# ═══════════════════════════════════════════════════════════════
# 5) Repo-wide virus / dangerous-command scan
# ═══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Virus scan (dangerous command patterns)         "
echo "═══════════════════════════════════════════════════"

if matches=$(git ls-files \
  | grep -v '^\.github/' \
  | "${XARGS_R[@]}" grep -nE 'curl.*\|.*sh|wget.*\|.*sh|bash <\(|eval[[:space:]]*\$\(|base64.*\|.*sh|xxd' 2>/dev/null); then
  echo ""
  echo "── Matched: Dangerous commands (virus scan) ──"
  echo "$matches"
  echo "❌ Dangerous commands found."
  fail "BLOCKED — Dangerous commands found"
else
  echo "✅ Virus scan passed (no dangerous command patterns)."
fi

# ═══════════════════════════════════════════════════════════════
# Result
# ═══════════════════════════════════════════════════════════════
if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "ERROR: Suspicious code scan FAILED."
  exit 1
fi

echo ""
echo "✅ Suspicious code scan passed (all injection checks green)."
