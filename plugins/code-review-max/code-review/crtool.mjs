#!/usr/bin/env node
// Deterministic data movement for the `code-review-max` KAS workflow -- a
// zero-dependency Node port of crtool.py, run by the node binary kiro-cli
// already extracts for KAS (%LOCALAPPDATA%\Kiro-Cli\node.exe on Windows,
// ~/.local/share/kiro-cli/node elsewhere), so a review needs no Python.
//
// crtool.py is the reference: the run directory layout, every file shape and
// every printed line follow it. Departures are the ones docs/crtool-contract.md
// records for the native port: LF newlines on every OS, an absent file or line
// prints `?`, a repeated comment decoration is dropped silently, and parse-error
// text is Node's. `diagnostics` is not ported (the recipe never calls it).
//
// Subcommands: gather, facts, merge, shard, ballots, collate, finalize, comments.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const MAX_PER_ANGLE = 8;
const MAX_FINDINGS = 15;
const VERDICTS = ["CONFIRMED", "PLAUSIBLE", "REFUTED"];
const PAGE_BUDGET = 20000; // chars per digest page; the tool-result cap is ~30,000

class Die extends Error {
  constructor(msg, code = 2) {
    super(msg);
    this.code = code;
  }
}

const die = (msg, code = 2) => {
  throw new Die(msg, code);
};

// ---------------------------------------------------------------------------
// Python-compatible helpers: the models read this text, so it must render the
// way crtool.py renders it.
// ---------------------------------------------------------------------------

const has = (o, k) => o !== null && typeof o === "object" && Object.hasOwn(o, k);
const get = (o, k, dflt = null) => (has(o, k) ? o[k] : dflt);

/** Python truthiness. */
function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** Python str(). */
function pyStr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return pyRepr(v);
}

/** Python repr(), close enough for warning text. */
function pyRepr(v) {
  if (typeof v === "string") {
    return v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replaceAll("'", "\\'")}'`;
  }
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(", ")}}`;
  }
  return pyStr(v);
}

const ws = (s) => s.split(/\s+/).filter(Boolean);
const chars = (s) => Array.from(s);
const splitlines = (s) => {
  const out = s.split(/\r\n|\n|\r/);
  if (out.length && out[out.length - 1] === "") out.pop();
  return out;
};
const pad2 = (n) => String(n).padStart(2, "0");
const pad3 = (n) => String(n).padStart(3, "0");
const posix = (p) => p.replaceAll("\\", "/");

/** Lexicographic tuple comparison, Python-style. */
function cmpTuple(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

function oneLine(text, limit) {
  const t = ws(pyStr(truthy(text) ? text : "")).join(" ").replaceAll("|", "/");
  const cs = chars(t);
  return cs.length <= limit ? t : cs.slice(0, limit - 1).join("").trimEnd() + "…";
}

/** Python int() on an agent-written line number; null when it is not one. */
function toLine(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === "string" && /^\s*[+-]?\d+(_\d+)*\s*$/.test(v)) return parseInt(v.replaceAll("_", ""), 10);
  return null;
}

const shown = (v) => (v === null || v === undefined ? "?" : pyStr(v));

function where(c) {
  const file = has(c, "file") && c.file !== null ? pyStr(c.file) : "?";
  return `${file}:${shown(get(c, "line"))}`;
}

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

function writeText(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, "utf8");
}

/** Write `lines` to <stem>-N.txt pages that each fit one tool read. Returns rel paths. */
function writePages(run, stem, header, lines) {
  const dir = path.join(run, path.dirname(stem));
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(stem);
  const stale = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+\\.txt$`);
  for (const old of fs.readdirSync(dir).sort()) {
    if (stale.test(old)) fs.rmSync(path.join(dir, old));
  }
  const pages = [];
  let cur = [];
  let size = 0;
  for (const ln of lines) {
    const n = chars(ln).length;
    if (cur.length && size + n + 1 > PAGE_BUDGET) {
      pages.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(ln);
    size += n + 1;
  }
  pages.push(cur);
  return pages.map((body, i) => {
    const rel = `${stem}-${i + 1}.txt`;
    writeText(path.join(run, rel), `# ${header} -- page ${i + 1} of ${pages.length}\n` + body.join("\n") + "\n");
    return rel;
  });
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

function git(args, { check = true } = {}) {
  const r = spawnSync("git", args, { maxBuffer: 1 << 30 });
  if (r.error) die(`cannot run git: ${r.error.message}`);
  if (check && r.status !== 0) {
    die(`git ${args.join(" ")} failed: ${r.stderr.toString("utf8").trim()}`);
  }
  return r;
}

const gitBytes = (...args) => git(args).stdout;
const gitText = (...args) => gitBytes(...args).toString("utf8");
const revOk = (rev) => git(["rev-parse", "--verify", "--quiet", rev + "^{commit}"], { check: false }).status === 0;

// ---------------------------------------------------------------------------
// gather
// ---------------------------------------------------------------------------

/** Phase 0 of the review prompt: pick the diff when the caller says `auto`. */
function resolveTarget(target) {
  if (target !== "auto") return [target, null];
  const base = ["@{upstream}", "main", "master"].find(revOk) ?? null;
  const dirty = gitText("status", "--porcelain", "--untracked-files=no").trim() !== "";
  if (base === null) {
    const fallback = dirty ? "HEAD" : "HEAD~1";
    return [fallback, "no upstream/main: fell back to " + fallback];
  }
  const rng = `${base}...HEAD`;
  const empty = gitText("diff", "--name-only", rng).trim() === "";
  if (dirty || empty) {
    const mb = gitText("merge-base", base, "HEAD").trim();
    const py = (b) => (b ? "True" : "False");
    return [mb, `working tree included (dirty=${py(dirty)}, empty_range=${py(empty)}); diffing against merge-base ${mb.slice(0, 12)}`];
  }
  return [rng, null];
}

function headSide(target) {
  for (const sep of ["...", ".."]) {
    const i = target.indexOf(sep);
    if (i >= 0) return target.slice(i + sep.length) || "HEAD";
  }
  return null; // single commit: diff is against the working tree
}

const scopeOf = (scope) => (ws(scope).length ? ws(scope) : ["."]);

function cmdGather(run, target0, scopeArg) {
  const mpath = path.join(run, "manifest.json");
  const scope = scopeOf(scopeArg);
  if (fs.existsSync(mpath)) {
    // A client may gather before invoking; the workflow's setup step then finds its work done.
    const prior = readJson(mpath);
    if (prior.requested_target === target0 && JSON.stringify(prior.scope) === JSON.stringify(scope)) {
      if (!fs.existsSync(path.join(run, "facts", "symbols.json"))) buildFacts(run, prior);
      console.log(`already gathered: ${prior.total_files} files, target=${prior.target}`);
      return;
    }
    die(`${run} already holds a different gathered run; use a fresh run directory`);
  }
  for (const sub of ["patches", "candidates", "deduped", "queues", "verdicts", "facts"]) {
    fs.mkdirSync(path.join(run, sub), { recursive: true });
  }

  const [target, note] = resolveTarget(target0);
  const warnings = note ? [note] : [];

  const hs = headSide(target);
  let matchesHead = true;
  if (hs !== null) {
    matchesHead = gitText("rev-parse", hs + "^{commit}").trim() === gitText("rev-parse", "HEAD").trim();
    if (!matchesHead) {
      warnings.push(`working tree (HEAD) is not at the diff's head (${hs}); source files may not match the patches`);
    }
  }

  const full = gitBytes("diff", "--no-renames", target, "--", ...scope);
  if (full.toString("utf8").trim() === "") {
    die(`empty diff for target=${pyRepr(target)} scope=${pyRepr(scope)}`, 3);
  }
  fs.writeFileSync(path.join(run, "diff.patch"), full);

  const status = new Map();
  const parts = gitText("diff", "--no-renames", "--name-status", "-z", target, "--", ...scope).split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) status.set(parts[i + 1], parts[i]);

  const files = [];
  for (const rec of gitText("diff", "--no-renames", "--numstat", "-z", target, "--", ...scope).split("\0")) {
    if (!rec) continue;
    const [ins, dele, ...rest] = rec.split("\t");
    const p = rest.join("\t");
    const idx = files.length + 1;
    const patchRel = `patches/${pad3(idx)}.patch`;
    const patch = gitBytes("diff", "--no-renames", target, "--", p);
    fs.writeFileSync(path.join(run, patchRel), patch);
    const binary = ins === "-";
    files.push({
      index: idx, path: p, status: status.get(p) ?? "?",
      insertions: binary ? null : parseInt(ins, 10),
      deletions: binary ? null : parseInt(dele, 10),
      binary, patch: patchRel, patch_bytes: patch.length,
    });
  }
  writeText(path.join(run, "changed-files.txt"), files.map((x) => x.path + "\n").join(""));

  const manifest = {
    requested_target: target0, target, scope,
    head: gitText("rev-parse", "HEAD").trim(),
    worktree_matches_diff_head: matchesHead,
    gathered_at: new Date().toISOString().slice(0, 19) + "+00:00",
    total_files: files.length, total_patch_bytes: full.length,
    warnings, files,
  };
  writeJson(mpath, manifest);
  buildFacts(run, manifest);
  console.log(`gathered ${files.length} files, ${full.length} patch bytes, target=${target}` +
    (warnings.length ? ` | WARNINGS: ${warnings.join("; ")}` : ""));
}

// ---------------------------------------------------------------------------
// facts: code intelligence computed once per review
// ---------------------------------------------------------------------------

const DOC_EXT = [".md", ".rst", ".adoc", ".txt"];
const DEFS = [
  [[".rs"], String.raw`(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|default)\s+)*(?:extern\s+"[^"]*"\s+)?` +
    String.raw`(fn|struct|enum|trait|type|const|static|mod|union)\s+([A-Za-z_][A-Za-z0-9_]*)`],
  [[".py"], String.raw`(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)`],
  [[".js", ".jsx", ".ts", ".tsx", ".mjs"], String.raw`(?:export\s+)?(?:default\s+)?(?:async\s+)?` +
    String.raw`(function|class|interface|type|enum|const)\s+([A-Za-z_$][\w$]*)`],
  [[".go"], String.raw`(func|type)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)`],
];
const TEST_ATTR = /#\[(?:[a-z_:]+::)?test\b|@pytest|\bit\(|\btest\(/;
// Names that match half the codebase: their usages are listed short and flagged.
const COMMON = new Set(["new", "default", "fmt", "from", "into", "main", "run", "get", "set", "render", "update",
  "init", "len", "is_empty", "clone", "drop", "build", "name", "id", "parse", "apply", "handle", "tests", "test",
  "value"]);
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)/;

const defEntry = (p) => DEFS.find(([exts]) => exts.some((e) => p.endsWith(e))) ?? null;

/** Symbols the diff ADDS (a `+` definition line) or MODIFIES (a hunk's enclosing definition). */
function changedSymbols(run, files) {
  const found = new Map();
  for (const f of files) {
    const def = defEntry(f.path);
    if (def === null || f.binary) continue;
    const search = new RegExp(def[1]);
    const match = new RegExp(`^(?:${def[1]})`);
    const lines = splitlines(fs.readFileSync(path.join(run, f.patch), "utf8"));
    let newLine = 0;
    let prevAdded = "";
    for (const ln of lines) {
      const hunk = HUNK.exec(ln);
      if (hunk) {
        newLine = parseInt(hunk[1], 10) - 1;
        const m = search.exec(hunk[2]);
        const key = `${f.path}\0${m?.[2]}`;
        if (m && !found.has(key)) {
          found.set(key, { name: m[2], kind: m[1], file: f.path, line: null, status: "modified" });
        }
        prevAdded = "";
        continue;
      }
      if (ln.startsWith("+++") || ln.startsWith("---") ||
          (newLine === 0 && !(ln.startsWith("+") || ln.startsWith(" ")))) continue;
      if (ln.startsWith("-")) continue;
      newLine += 1;
      if (ln.startsWith("+")) {
        const m = match.exec(ln.slice(1).trimStart());
        if (m && !TEST_ATTR.test(prevAdded)) {
          found.set(`${f.path}\0${m[2]}`, { name: m[2], kind: m[1], file: f.path, line: newLine, status: "added" });
        }
        prevAdded = ln.slice(1).trim() || prevAdded;
      } else {
        prevAdded = "";
      }
    }
  }
  return [...found.values()].sort((a, b) => cmpTuple([a.file, a.line || 0, a.name], [b.file, b.line || 0, b.name]));
}

function buildFacts(run, manifest) {
  fs.mkdirSync(path.join(run, "facts"), { recursive: true });
  // The change's own documents: what the same diff says about its intent.
  const docs = [];
  for (const p of splitlines(gitText("diff", "--no-renames", "--name-only", manifest.target))) {
    if (DOC_EXT.some((e) => p.toLowerCase().endsWith(e)) && !p.startsWith(".code-review/") &&
        fs.statSync(p, { throwIfNoEntry: false })?.isFile()) {
      docs.push({ path: p, bytes: fs.statSync(p).size });
    }
  }
  manifest.change_docs = docs.slice(0, 40);

  const symbols = changedSymbols(run, manifest.files).filter((x) => !(x.kind === "mod" && COMMON.has(x.name)));
  for (const sym of symbols) {
    // Usages in CODE of the same language only: a design doc is not a caller.
    const exts = defEntry(sym.file)[0];
    const r = git(["grep", "-n", "-w", "-F", "-I", "--", sym.name, "--", ...exts.map((e) => `*${e}`)], { check: false });
    const hits = [];
    for (const raw of splitlines(r.stdout.toString("utf8"))) {
      const a = raw.indexOf(":");
      const p = a < 0 ? raw : raw.slice(0, a);
      const rest = a < 0 ? "" : raw.slice(a + 1);
      const b = rest.indexOf(":");
      const num = b < 0 ? rest : rest.slice(0, b);
      const text = b < 0 ? "" : rest.slice(b + 1);
      if (p.startsWith(".code-review/") || !/^\d+$/.test(num)) continue;
      if (p === sym.file && sym.line !== null && parseInt(num, 10) === sym.line) continue;
      hits.push({ file: p, line: parseInt(num, 10), text: chars(text.trim()).slice(0, 140).join("") });
    }
    sym.ambiguous = COMMON.has(sym.name) || sym.name.length < 4;
    sym.usage_count = hits.length;
    sym.usages = hits;
  }
  writeJson(path.join(run, "facts", "symbols.json"), symbols);

  const render = (cap) => {
    const out = [];
    const unused = [];
    const common = [];
    for (const sym of symbols) {
      const at = sym.line ? `${sym.file}:${sym.line}` : sym.file;
      if (sym.ambiguous) {
        common.push(`${sym.name} (${at}, ${sym.usage_count} textual hits)`);
      } else if (!sym.usages.length) {
        unused.push(`${sym.name} (${sym.kind}, ${at})`);
      } else {
        const more = sym.usage_count > cap ? `, first ${cap} shown` : "";
        out.push(`## ${sym.name}  (${sym.kind}, ${sym.status}, ${at}) — ${sym.usage_count} usages${more}`);
        out.push(...sym.usages.slice(0, cap).map((u) => `${u.file}:${u.line}: ${u.text}`), "");
      }
    }
    if (unused.length) {
      out.push("## defined or changed by this diff, used NOWHERE else in code (tests have no callers; " +
        "for anything else this is worth a look):", unused.join("; "), "");
    }
    if (common.length) {
      out.push("## names too common for a textual map to mean anything — search these yourself:", common.join("; "));
    }
    return out.length ? out : ["(no symbols detected)"];
  };

  const header = "usages of every symbol this diff adds or changes — textual (git grep -w, same language), so a " +
    "comment or a same-named symbol counts. Start here for callers instead of grepping.";
  let cap;
  let body;
  for (cap of [25, 12, 6, 3]) { // shrink until the whole map is at most four reads
    body = render(cap);
    if (body.reduce((n, x) => n + chars(x).length + 1, 0) <= 4 * PAGE_BUDGET || cap === 3) break;
  }
  const pages = writePages(run, "facts/usages", header, body);
  manifest.facts = { ...(manifest.facts || {}), symbols: symbols.length, usages_pages: pages };
  writeJson(path.join(run, "manifest.json"), manifest);
  console.log(`facts: ${symbols.length} changed symbols (usages capped at ${cap} each), ` +
    `${docs.length} change docs -> ${pages.join(" ")}`);
}

function cmdFacts(run) {
  buildFacts(run, readJson(path.join(run, "manifest.json")));
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

/** [list_of_objects, problem_or_null]. Accepts {"candidates": [...]} or a bare list. */
function loadCandidates(p) {
  let data;
  try {
    data = readJson(p);
  } catch (e) {
    return [[], `unreadable: ${e.message}`];
  }
  const items = data !== null && typeof data === "object" && !Array.isArray(data) ? get(data, "candidates") : data;
  if (!Array.isArray(items)) return [[], "no `candidates` array"];
  const good = items.filter((c) => c !== null && typeof c === "object" && !Array.isArray(c));
  return [good, good.length === items.length ? null : "non-object entries skipped"];
}

function cmdMerge(run, expectArg) {
  const expect = expectArg.split(",").filter(Boolean);
  const reported = [];
  const missing = [];
  const problems = [];
  const out = [];
  for (const angle of expect) {
    const p = path.join(run, "candidates", `${angle}.json`);
    if (!fs.existsSync(p)) {
      missing.push(angle);
      continue;
    }
    let [items, problem] = loadCandidates(p);
    if (problem) problems.push({ angle, file: `candidates/${angle}.json`, problem });
    if (problem && !items.length) {
      missing.push(angle);
      continue;
    }
    reported.push(angle);
    if (items.length > MAX_PER_ANGLE) {
      problems.push({ angle, problem: `${items.length} candidates; kept first ${MAX_PER_ANGLE}` });
      items = items.slice(0, MAX_PER_ANGLE);
    }
    items.forEach((c, i) => {
      const rec = { ...c, pid: `${angle}-${i + 1}`, angle, line: toLine(get(c, "line")) };
      const absent = ["file", "summary", "failure_scenario"].filter((k) => !truthy(get(c, k)));
      if (absent.length) rec.incomplete = absent;
      out.push(rec);
    });
  }
  writeJson(path.join(run, "candidates", "all.json"), {
    angles_expected: expect, angles_reported: reported, angles_missing: missing,
    problems, raw_count: out.length, candidates: out,
  });
  for (const c of out) writeJson(path.join(run, "candidates", "raw", `${c.pid}.json`), c);
  // Sorted by location so probable duplicates sit on adjacent lines.
  const fileKey = (c) => (has(c, "file") && c.file !== null ? pyStr(c.file) : "?");
  const ordered = [...out].sort((a, b) => cmpTuple([fileKey(a), a.line || 0, a.pid], [fileKey(b), b.line || 0, b.pid]));
  // A shared location is a mechanical fact, so state it.
  const locKey = (c) => `${fileKey(c)}\0${c.line}`;
  const at = new Map();
  for (const c of ordered) at.set(locKey(c), (at.get(locKey(c)) ?? 0) + 1);
  const lines = [];
  const flagged = new Set();
  for (const c of ordered) {
    const key = locKey(c);
    if (at.get(key) > 1 && !flagged.has(key)) {
      flagged.add(key);
      lines.push(`>>> the next ${at.get(key)} candidates cite the SAME location, ${where(c)}: if they describe one ` +
        "defect they are ONE group (keep them apart only if the reasons genuinely differ)");
    }
    lines.push(`${c.pid} | ${where(c)} | ${oneLine(get(c, "category"), 14)} | ` +
      `${oneLine(get(c, "summary"), 300)} || fails: ${oneLine(get(c, "failure_scenario"), 160)}`);
  }
  const pages = writePages(run, "candidates/digest",
    "pid | file:line | category | summary || fails: failure-scenario excerpt   " +
    "(full record: candidates/raw/<pid>.json)", lines);
  console.log(`digest pages (read these, not all.json): ${pages.join(" ")}`);
  console.log(`merged ${out.length} candidates from ${reported.length}/${expect.length} angles` +
    (missing.length ? ` | MISSING: ${missing.join(",")}` : "") +
    (problems.length ? ` | ${problems.length} problem(s), see candidates/all.json` : ""));
}

// ---------------------------------------------------------------------------
// shard
// ---------------------------------------------------------------------------

function cmdShard(run, shards) {
  if (!Number.isInteger(shards) || shards < 1) die("--shards must be a positive integer");
  const merged = readJson(path.join(run, "candidates", "all.json"));
  const cands = new Map(merged.candidates.map((c) => [c.pid, c]));
  const warnings = [];

  const decPath = path.join(run, "deduped", "decisions.json");
  let decisions = {};
  if (fs.existsSync(decPath)) {
    try {
      decisions = readJson(decPath);
      if (decisions === null || typeof decisions !== "object" || Array.isArray(decisions)) {
        throw new Error("top level is not an object");
      }
    } catch (e) {
      decisions = {};
      warnings.push(`decisions.json unreadable (${e.message}); no dedup applied`);
    }
  } else {
    warnings.push("decisions.json missing; no dedup applied");
  }

  // Accept groups ({"pids": [...], "keep"?, "reason"}) and the older pairs
  // ({"drop","keep","reason"}). Both reduce to "these pids are one defect".
  const parent = new Map([...cands.keys()].map((p) => [p, p]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const isObj = (g) => g !== null && typeof g === "object" && !Array.isArray(g);
  const listOf = (v) => (Array.isArray(v) ? v : []);
  const entries = [
    ...listOf(get(decisions, "groups")).filter(isObj).map((g) => ({ ...g, _pids: get(g, "pids") })),
    ...listOf(get(decisions, "duplicates")).filter(isObj).map((d) => ({ ...d, _pids: [get(d, "drop"), get(d, "keep")] })),
  ];
  const preferred = new Set();
  const reasonOf = new Map();
  const known = (x) => typeof x === "string" && cands.has(x);
  for (const e of entries) {
    const raw = Array.isArray(e._pids) ? e._pids : [];
    const pids = raw.filter(known);
    if (pids.length !== raw.length) {
      warnings.push(`decision names unknown pid(s) ${pyRepr(raw.filter((x) => !known(x)))}; ignored those`);
    }
    if (new Set(pids).size < 2) continue;
    for (const other of pids.slice(1)) parent.set(find(other), find(pids[0]));
    if (pids.includes(get(e, "keep"))) preferred.add(e.keep);
    for (const x of pids) if (!reasonOf.has(x)) reasonOf.set(x, get(e, "reason", ""));
  }

  const order = new Map(merged.candidates.map((c, n) => [c.pid, n]));
  const members = new Map();
  for (const pid of cands.keys()) {
    const root = find(pid);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(pid);
  }

  const byOrder = (a, b) => order.get(a) - order.get(b);
  const weight = (x) => {
    const c = cands.get(x);
    const len = (v) => chars(pyStr(truthy(v) ? v : "")).length;
    return len(get(c, "failure_scenario")) + len(get(c, "evidence"));
  };
  const dropped = [];
  for (const group of members.values()) {
    if (group.length < 2) continue;
    const named = group.filter((x) => preferred.has(x)).sort(byOrder);
    const keeper = named.length ? named[0] : group.reduce((best, x) =>
      cmpTuple([weight(x), -order.get(x)], [weight(best), -order.get(best)]) > 0 ? x : best);
    for (const x of [...group].sort(byOrder)) {
      if (x === keeper) continue;
      const k = cands.get(keeper);
      (k.also_flagged_by ??= []).push({ pid: x, angle: cands.get(x).angle, summary: get(cands.get(x), "summary", "") });
      dropped.push({ pid: x, kept_as: keeper, reason: reasonOf.get(x) ?? "" });
    }
  }
  const droppedPids = new Set(dropped.map((d) => d.pid));

  const survivors = merged.candidates.filter((c) => !droppedPids.has(c.pid));
  survivors.forEach((c, i) => {
    c.id = `C${pad2(i + 1)}`;
    writeJson(path.join(run, "deduped", `${c.id}.json`), c);
  });

  const queues = Array.from({ length: shards }, () => []);
  survivors.forEach((c, n) => queues[n % shards].push(c.id));
  // `verdict_dir` is ABSOLUTE, one directory PER queue (see crtool.py).
  queues.forEach((pending, i) => {
    const dir = path.join(run, "verdicts", `q${i + 1}`);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(run, "queues", `queue-${i + 1}.json`), { done: !pending.length, ids: pending, verdict_dir: posix(dir) });
  });
  fs.mkdirSync(path.join(run, "verdicts", "sweep"), { recursive: true });

  writeJson(path.join(run, "deduped", "index.json"), {
    angles_reported: merged.angles_reported, angles_missing: merged.angles_missing,
    raw_count: merged.raw_count, deduped_count: survivors.length,
    dropped, warnings, candidates: survivors,
  });
  const pages = writePages(run, "deduped/digest", "id | file:line | angles | summary   (full record: deduped/<id>.json)",
    survivors.map((c) => `${c.id} | ${where(c)} | x${1 + (c.also_flagged_by?.length ?? 0)} | ${oneLine(get(c, "summary"), 300)}`));
  console.log(`digest pages (the already-raised list): ${pages.join(" ")}`);
  console.log(`sharded ${survivors.length} candidates (${dropped.length} duplicates dropped) into ` +
    `${shards} queues: [${queues.map((q) => q.length).join(", ")}]` +
    (warnings.length ? ` | WARNINGS: ${warnings.join("; ")}` : ""));
}

// ---------------------------------------------------------------------------
// ballots: two more independent votes where one vote proved unstable
// ---------------------------------------------------------------------------

/** Deduped candidates plus the gap sweep's: [index, list, sweep_count]. */
function allCandidates(run, warnings = null) {
  const index = readJson(path.join(run, "deduped", "index.json"));
  const cands = [...index.candidates];
  const sweepPath = path.join(run, "candidates", "sweep.json");
  let nSweep = 0;
  if (fs.existsSync(sweepPath)) {
    const [items, problem] = loadCandidates(sweepPath);
    if (problem && warnings !== null) warnings.push(`sweep.json: ${problem}`);
    items.slice(0, MAX_PER_ANGLE).forEach((c, i) => {
      const rec = { ...c };
      if (!has(rec, "id")) rec.id = `S${pad2(i + 1)}`;
      rec.angle = "sweep";
      rec.line = toLine(get(c, "line"));
      cands.push(rec);
      nSweep += 1;
    });
  } else if (warnings !== null) {
    warnings.push("candidates/sweep.json missing: the gap sweep did not report");
  }
  return [index, cands, nSweep];
}

const isConventions = (c) => pyStr(get(c, "category", "")).toLowerCase().includes("convention") || c.angle === "conventions";

function cmdBallots(run) {
  const [, cands] = allCandidates(run);
  const chosen = [];
  for (const c of cands) {
    const first = loadVerdict(run, c.id).verdict;
    const why = [["first vote REFUTED", first === "REFUTED"], ["conventions claim", isConventions(c)]]
      .filter(([, hit]) => hit).map(([w]) => w);
    if (why.length) {
      chosen.push({ id: c.id, first_vote: first, reason: why.join(" + ") });
      for (const tag of ["v2", "v3"]) {
        writeJson(path.join(run, "deduped", `${c.id}.${tag}.json`), { ...c, id: `${c.id}.${tag}`, ballot_of: c.id });
      }
    }
  }
  for (const [loop, tag] of [["r1", "v2"], ["r2", "v3"]]) {
    const ids = chosen.map((b) => `${b.id}.${tag}`);
    const dir = path.join(run, "verdicts", loop);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(run, "queues", `queue-${loop}.json`), { done: !ids.length, ids, verdict_dir: posix(dir) });
  }
  writeJson(path.join(run, "ballots.json"), { balloted: chosen });
  console.log(`ballots: ${chosen.length} of ${cands.length} candidates get two more votes ` +
    `(${chosen.filter((b) => b.reason.includes("REFUTED")).length} refuted, ` +
    `${chosen.filter((b) => b.reason.includes("conventions")).length} conventions) -> queues/queue-r1.json, queue-r2.json`);
}

/** Final verdict from 1-3 votes. REFUTED needs two; so does CONFIRMED; a split is PLAUSIBLE. */
function tally(votes) {
  const valid = votes.filter((v) => VERDICTS.includes(v));
  if (!valid.length) return "UNVERIFIED";
  if (valid.length === 1) return valid[0] === "REFUTED" ? "PLAUSIBLE" : valid[0];
  for (const verdict of ["REFUTED", "CONFIRMED"]) {
    if (valid.filter((v) => v === verdict).length >= 2) return verdict;
  }
  return "PLAUSIBLE";
}

// ---------------------------------------------------------------------------
// collate
// ---------------------------------------------------------------------------

function findUnder(root, name, insideVerdicts) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  if (insideVerdicts && entries.some((e) => e.isFile() && e.name === name)) return path.join(root, name);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = findUnder(path.join(root, e.name), name, insideVerdicts || e.name === "verdicts");
    if (hit) return hit;
  }
  return null;
}

function loadVerdict(run, cid) {
  let p = path.join(run, "verdicts", `${cid}.json`);
  if (!fs.existsSync(p)) {
    // Per-queue directories -- and wherever under the run a loop really put them.
    p = findUnder(run, `${cid}.json`, false) ?? p;
  }
  if (!fs.existsSync(p)) return { verdict: "UNVERIFIED", reasoning: "no verdict file was written" };
  let v;
  try {
    v = readJson(p);
  } catch (e) {
    return { verdict: "UNVERIFIED", reasoning: `verdict file unreadable: ${e.message}` };
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return { verdict: "UNVERIFIED", reasoning: "verdict file is not a JSON object" };
  }
  const raw = pyStr(get(v, "verdict", "")).trim().toUpperCase();
  if (!VERDICTS.includes(raw)) {
    v.raw_verdict = get(v, "verdict");
    v.verdict = "UNVERIFIED";
  } else {
    v.verdict = raw;
  }
  return v;
}

const angleCount = (c) => 1 + (Array.isArray(c.also_flagged_by) ? c.also_flagged_by.length : 0);

function cmdCollate(run) {
  let warnings = [];
  const [index, cands, sweepCount] = allCandidates(run, warnings);
  warnings = [...(index.warnings ?? []), ...warnings];
  const bpath = path.join(run, "ballots.json");
  const balloted = new Set(fs.existsSync(bpath) ? readJson(bpath).balloted.map((b) => b.id) : []);

  const kept = [];
  const refuted = [];
  const overturned = [];
  for (const c of cands) {
    const ballots = [loadVerdict(run, c.id)];
    if (balloted.has(c.id)) ballots.push(...["v2", "v3"].map((t) => loadVerdict(run, `${c.id}.${t}`)));
    const votes = ballots.map((b) => b.verdict);
    const final = balloted.has(c.id) ? tally(votes) : votes[0];
    const shownBallot = ballots.find((b) => b.verdict === final) ?? ballots[0];
    const rec = { ...c, verdict: final, verification: {} };
    for (const k of ["evidence", "reasoning", "would_confirm", "corrected_line", "raw_verdict"]) {
      const v = get(shownBallot, k);
      if (v !== null && v !== "") rec.verification[k] = v;
    }
    // An accepted limitation is still a finding: any vote's by_design note rides along.
    const note = ballots.map((b) => get(b, "by_design")).find(truthy);
    if (note !== undefined && final !== "REFUTED") rec.by_design = pyStr(note);
    if (balloted.has(c.id)) {
      rec.votes = votes;
      if (final !== votes[0]) overturned.push(`${c.id}: ${votes[0]} -> ${final} (${votes.join(", ")})`);
    }
    (final === "REFUTED" ? refuted : kept).push(rec);
  }

  const counts = { CONFIRMED: 0, PLAUSIBLE: 0, REFUTED: 0, UNVERIFIED: 0 };
  for (const c of [...kept, ...refuted]) counts[c.verdict] += 1;
  const perAngle = {};
  for (const c of cands) perAngle[c.angle] = (perAngle[c.angle] ?? 0) + 1;

  writeJson(path.join(run, "verified.json"), {
    kept, refuted,
    stats: {
      angles_reported: index.angles_reported, angles_missing: index.angles_missing,
      raw_candidates: index.raw_count, after_dedup: index.deduped_count,
      sweep_candidates: sweepCount, verdicts: counts,
      balloted: balloted.size, overturned_by_vote: overturned,
      candidates_per_angle_after_dedup: perAngle,
      unverified_ids: kept.filter((c) => c.verdict === "UNVERIFIED").map((c) => c.id),
    },
    warnings,
  });
  const pages = writePages(run, "verified-digest",
    "id | verdict | angles | category | file:line | summary || fails: excerpt   " +
    "(full: deduped/<id>.json or candidates/sweep.json, verdicts/<id>.json)",
    kept.map((c) => `${c.id} | ${c.verdict}${c.votes ? " (votes " + c.votes.map((v) => v[0]).join("/") + ")" : ""}` +
      `${c.by_design ? " [by design]" : ""}` +
      ` | x${angleCount(c)} | ` +
      `${oneLine(get(c, "category"), 14)} | ${where(c)} | ${oneLine(get(c, "summary"), 300)} ` +
      `|| fails: ${oneLine(get(c, "failure_scenario"), 160)}`));
  console.log(`digest pages (read these, not verified.json): ${pages.join(" ")}`);
  if (overturned.length) console.log("votes changed the outcome: " + overturned.join("; "));
  console.log(`collated: kept ${kept.length} (` +
    Object.entries(counts).filter(([k]) => k !== "REFUTED").map(([k, v]) => `${k}=${v}`).join(", ") +
    `), refuted ${refuted.length}`);
}

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

const bestLine = (c) => toLine(get(c.verification ?? {}, "corrected_line")) || get(c, "line");

function loc(c) {
  const line = bestLine(c);
  const file = has(c, "file") && c.file !== null ? pyStr(c.file) : "?";
  return line ? `\`${file}:${line}\`` : `\`${file}\``;
}

const cell = (s) => pyStr(truthy(s) ? s : "").replaceAll("|", "\\|").replaceAll("\n", " ").trim();
const anglesOf = (c) => [c.angle, ...(c.also_flagged_by ?? []).map((x) => x.angle)];

function cmdFinalize(run) {
  const verified = readJson(path.join(run, "verified.json"));
  const manifest = readJson(path.join(run, "manifest.json"));
  const kept = new Map(verified.kept.map((c) => [c.id, c]));
  const warnings = [...(verified.warnings ?? [])];

  let order = [];
  let notes = {};
  const rankPath = path.join(run, "ranking.json");
  if (fs.existsSync(rankPath)) {
    try {
      const r = readJson(rankPath);
      if (r === null || typeof r !== "object" || Array.isArray(r)) throw new Error("top level is not an object");
      order = Array.isArray(r.order) ? [...r.order] : [];
      notes = r.notes && typeof r.notes === "object" && !Array.isArray(r.notes) ? { ...r.notes } : {};
    } catch (e) {
      warnings.push(`ranking.json unreadable (${e.message}); findings are in discovery order`);
    }
  } else {
    warnings.push("ranking.json missing; findings are in discovery order");
  }

  const ranked = [];
  const seen = new Set();
  for (const cid of order) {
    if (kept.has(cid) && !seen.has(cid)) {
      ranked.push(kept.get(cid));
      seen.add(cid);
    } else if (!kept.has(cid)) {
      warnings.push(`ranking names unknown or refuted id ${pyRepr(cid)}; ignored`);
    }
  }
  const unranked = [...kept.values()].filter((c) => !seen.has(c.id));
  if (unranked.length) { // recall mode: an unranked finding is appended, never dropped
    warnings.push("not ranked, appended in discovery order: " + unranked.map((c) => c.id).join(", "));
    ranked.push(...unranked);
  }

  const top = ranked.slice(0, MAX_FINDINGS);
  const rest = ranked.slice(MAX_FINDINGS);
  writeJson(path.join(run, "findings.json"), top.map((c) => ({
    id: c.id, file: get(c, "file"), line: bestLine(c),
    summary: get(c, "summary"), failure_scenario: get(c, "failure_scenario"),
    verdict: c.verdict, angles: anglesOf(c),
  })));

  const s = verified.stats;
  const md = [`# Code review — \`${manifest.target}\``, "",
    `- **Head:** \`${manifest.head.slice(0, 12)}\`  **Scope:** \`${manifest.scope.join(" ")}\`  ` +
    `**Files:** ${manifest.total_files}  **Patch bytes:** ${manifest.total_patch_bytes}`,
    `- **Pipeline:** ${s.angles_reported.length} finder angles reported` +
    (s.angles_missing.length ? ` (**missing: ${s.angles_missing.join(", ")}**)` : "") +
    ` → ${s.raw_candidates} candidates → ${s.after_dedup} after dedup` +
    ` + ${s.sweep_candidates} from the gap sweep`,
    "- **Verdicts:** " + Object.entries(s.verdicts).map(([k, v]) => `${k} ${v}`).join(", ") +
    (s.balloted ? ` — ${s.balloted} candidates took three votes, ${s.overturned_by_vote.length} changed outcome` : ""),
    "- `CONFIRMED` = trigger and wrong outcome named, line quoted. `PLAUSIBLE` = mechanism real, " +
    "trigger uncertain. `UNVERIFIED` = no verdict was produced; kept because this is a recall-mode review.",
    "", "## Summary", "", "| # | Id | Location | Verdict | Issue |", "|---|---|---|---|---|"];
  ranked.forEach((c, i) => {
    const n = i + 1;
    md.push(`| ${n} | ${c.id} | ${loc(c)} | ${c.verdict} | ${cell(get(c, "summary"))} |`);
    if (n === MAX_FINDINGS && rest.length) {
      md.push(`| | | | | *— reporting cap (${MAX_FINDINGS}); items below are recorded in rank order —* |`);
    }
  });
  md.push("", "## Findings", "");
  ranked.forEach((c, i) => {
    const v = c.verification ?? {};
    md.push(`### ${i + 1}. ${cell(get(c, "summary"))}`, "",
      `- **Where:** ${loc(c)}  **Verdict:** ${c.verdict}  **Id:** ${c.id}  **Angles:** ${anglesOf(c).join(", ")}`,
      `- **Failure scenario:** ${truthy(get(c, "failure_scenario")) ? pyStr(c.failure_scenario) : "—"}`);
    if (truthy(c.votes)) md.push(`- **Votes:** ${c.votes.join(", ")} → ${c.verdict}`);
    if (truthy(c.by_design)) md.push(`- **Accepted by design:** ${c.by_design}`);
    if (truthy(get(c, "evidence"))) md.push(`- **Finder evidence:** ${pyStr(c.evidence)}`);
    if (truthy(get(v, "evidence"))) md.push(`- **Verifier evidence:** ${pyStr(v.evidence)}`);
    if (truthy(get(v, "reasoning"))) md.push(`- **Verifier reasoning:** ${pyStr(v.reasoning)}`);
    if (truthy(get(v, "would_confirm"))) md.push(`- **Would confirm:** ${pyStr(v.would_confirm)}`);
    if (truthy(get(notes, c.id))) md.push(`- **Ranking note:** ${pyStr(notes[c.id])}`);
    md.push("");
  });
  md.push("## Refuted during verification", "", "Listed so they are not re-derived later.", "");
  if (verified.refuted.length) {
    for (const c of verified.refuted) {
      const v = c.verification ?? {};
      const votes = truthy(c.votes) ? ` *(votes: ${c.votes.join(", ")})*` : "";
      const why = [get(v, "reasoning"), get(v, "evidence")].find(truthy);
      md.push(`- **${c.id}** ${loc(c)} — ${cell(get(c, "summary"))}${votes}  \n` +
        `  *Refuted:* ${why !== undefined ? pyStr(why) : "no reasoning recorded"}`);
    }
  } else {
    md.push("None.");
  }
  if (warnings.length) md.push("", "## Run warnings", "", ...warnings.map((w) => `- ${w}`));
  writeText(path.join(run, "report.md"), md.join("\n") + "\n");

  // Everything the commenter needs, in one place.
  const brief = [];
  top.forEach((c, i) => {
    const v = c.verification ?? {};
    const angles = anglesOf(c);
    const file = has(c, "file") && c.file !== null ? pyStr(c.file) : "?";
    brief.push(`===== ${c.id}  (rank ${i + 1})  ${file}:${shown(bestLine(c))}`,
      `verdict: ${c.verdict}` + (truthy(c.votes) ? `  votes: ${c.votes.join(", ")}` : "") +
      `  | category: ${pyStr(get(c, "category", "?"))}  | raised by ${angles.length} angle(s): ${angles.join(", ")}`,
      `summary: ${oneLine(get(c, "summary"), 600)}`,
      `failure scenario: ${oneLine(get(c, "failure_scenario"), 900)}`);
    if (truthy(get(c, "evidence"))) brief.push(`finder evidence: ${oneLine(c.evidence, 500)}`);
    for (const [key, label] of [["evidence", "verifier evidence"], ["reasoning", "verifier reasoning"],
      ["would_confirm", "would confirm"]]) {
      if (truthy(get(v, key))) brief.push(`${label}: ${oneLine(v[key], 900)}`);
    }
    if (truthy(c.by_design)) brief.push(`ACCEPTED BY DESIGN (the author documented this): ${oneLine(c.by_design, 500)}`);
    brief.push("");
  });
  const pages = writePages(run, "comments/brief", "one block per reported finding, in rank order",
    brief.length ? brief : ["(no findings)"]);
  console.log(`comment briefs (one block per reported finding): ${pages.join(" ")}`);
  console.log(`finalized: ${top.length} findings reported, ${rest.length} below the cap, ` +
    `${verified.refuted.length} refuted -> findings.json, report.md`);
}

// ---------------------------------------------------------------------------
// comments: Conventional Comments (conventionalcomments.org)
// ---------------------------------------------------------------------------

const LABELS = ["praise", "nitpick", "suggestion", "issue", "todo", "question", "thought", "chore", "note",
  "typo", "polish", "quibble"];
const NEVER_BLOCKING = ["nitpick", "thought", "note", "praise"]; // "non-blocking by nature" in the spec
const DECORATION = /^[a-z][a-z0-9-]*$/;

/** The fallback when no model-written comment exists: mechanical, but never absent. */
function templateComment(f, c) {
  const cat = pyStr(get(c, "category", "")).toLowerCase();
  let label;
  let decs;
  if (truthy(get(c, "by_design"))) [label, decs] = ["thought", ["non-blocking"]];
  else if (f.verdict !== "CONFIRMED") [label, decs] = ["question", ["non-blocking"]];
  else if (cat === "cleanup" || cat === "altitude") [label, decs] = ["suggestion", ["non-blocking"]];
  else [label, decs] = ["issue", []];
  const parts = [pyStr(truthy(get(f, "failure_scenario")) ? f.failure_scenario : "").trim()];
  if (truthy(get(c, "by_design"))) parts.push(`This looks deliberate: ${c.by_design}`);
  return { label, decorations: decs, subject: oneLine(get(f, "summary"), 240), discussion: parts.filter(Boolean).join("\n\n") };
}

const stripParens = (s) => s.replace(/^[()]+|[()]+$/g, "");

function cmdComments(run, noTrailer) {
  const findings = readJson(path.join(run, "findings.json"));
  const verified = readJson(path.join(run, "verified.json"));
  const kept = new Map(verified.kept.map((c) => [c.id, c]));
  const ids = new Set(findings.map((f) => f.id));
  const out = [];
  const warnings = [];
  const sources = { model: 0, template: 0, duplicate: 0 };
  for (const f of findings) {
    const c = kept.get(f.id) ?? {};
    const p = path.join(run, "comments", `${f.id}.json`);
    let raw = null;
    let source = "template";
    if (fs.existsSync(p)) {
      try {
        raw = readJson(p);
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not a JSON object");
        source = "model";
      } catch (e) {
        warnings.push(`${f.id}: comment file unreadable (${e.message}); template used`);
        raw = null;
      }
    }
    const entry = { id: f.id, file: get(f, "file"), line: get(f, "line"), verdict: f.verdict };
    const dup = get(raw ?? {}, "duplicate_of");
    if (truthy(dup)) {
      if (ids.has(dup) && dup !== f.id) {
        out.push({ ...entry, duplicate_of: dup, source });
        sources.duplicate += 1;
        continue;
      }
      warnings.push(`${f.id}: duplicate_of names ${pyRepr(dup)}, which is not a reported finding; template used`);
      raw = null;
      source = "template";
    }
    let label;
    let subject;
    if (raw !== null) {
      label = pyStr(get(raw, "label", "")).trim().toLowerCase().replace(/:+$/, "");
      subject = ws(pyStr(get(raw, "subject", ""))).join(" ");
      if (!LABELS.includes(label) || !subject) {
        warnings.push(`${f.id}: label ${pyRepr(get(raw, "label"))} or subject invalid; template used`);
        raw = null;
        source = "template";
      }
    }
    if (raw === null) {
      raw = templateComment(f, c);
      ({ label, subject } = raw);
    }
    let decs = [];
    const rawDecs = get(raw, "decorations");
    const list = Array.isArray(rawDecs) ? rawDecs : typeof rawDecs === "string" ? chars(rawDecs) : [];
    for (const d0 of list) {
      const d = stripParens(pyStr(d0).trim().toLowerCase());
      if (DECORATION.test(d)) {
        if (!decs.includes(d)) decs.push(d);
      } else if (d) {
        warnings.push(`${f.id}: decoration ${pyRepr(d)} dropped (not a lowercase word)`);
      }
    }
    const byDesign = truthy(get(c, "by_design"));
    if (decs.includes("blocking") && (NEVER_BLOCKING.includes(label) || f.verdict !== "CONFIRMED" || byDesign)) {
      // Non-blocking by nature, or a claim this pipeline could not confirm / the author documented.
      decs = decs.map((d) => (d === "blocking" ? "non-blocking" : d));
      warnings.push(`${f.id}: \`blocking\` downgraded (label ${label}, verdict ${f.verdict}${byDesign ? ", by design" : ""})`);
    }
    if (decs.includes("blocking") && decs.includes("non-blocking")) decs.splice(decs.indexOf("non-blocking"), 1);
    if ((f.verdict !== "CONFIRMED" || byDesign) && !decs.includes("non-blocking")) {
      decs.push("non-blocking"); // say so explicitly: a bare label reads as "must fix"
    }
    const discussion = pyStr(truthy(get(raw, "discussion")) ? raw.discussion : "").trim();
    const head = `**${label}${decs.length ? " (" + decs.join(",") + ")" : ""}:** ${subject}`;
    const angles = Array.isArray(f.angles) ? f.angles.length : 0;
    const trailer = `_Automated review · ${f.verdict.toLowerCase()}` +
      (truthy(c.votes) ? ` by vote (${c.votes.map((v) => v.toLowerCase()).join(", ")})` : "") +
      (angles > 1 ? ` · raised independently by ${angles} review angles` : "") + ` · ${f.id}_`;
    const body = [head, discussion, noTrailer ? null : trailer].filter(truthy).join("\n\n");
    out.push({ ...entry, label, decorations: decs, subject, discussion, body, source });
    sources[source] += 1;
  }

  writeJson(path.join(run, "comments.json"), out);
  const byId = new Map(out.map((o) => [o.id, o]));
  for (const f of findings) {
    const o = byId.get(f.id);
    delete f.comment;
    delete f.duplicate_of;
    if (o.duplicate_of) f.duplicate_of = o.duplicate_of;
    else f.comment = o.body;
  }
  writeJson(path.join(run, "findings.json"), findings);

  const md = ["# Review comments", "",
    "Conventional Comments format (conventionalcomments.org). Each block is postable as-is at the location above it.", ""];
  out.forEach((o, i) => {
    const file = o.file === null || o.file === undefined ? "?" : pyStr(o.file);
    const at = truthy(o.line) ? `\`${file}:${o.line}\`` : `\`${file}\``;
    md.push(`## ${i + 1}. ${at} — ${o.id}`, "",
      o.duplicate_of ? `Same defect as ${o.duplicate_of}; no separate comment.` : o.body, "");
  });
  const text = md.join("\n") + "\n";
  writeText(path.join(run, "comments.md"), text);
  const rpath = path.join(run, "report.md");
  if (fs.existsSync(rpath)) {
    const report = fs.readFileSync(rpath, "utf8").split("\n# Review comments\n")[0].replace(/\n+$/, "");
    writeText(rpath, report + "\n\n" + text);
  }
  const labels = new Map();
  for (const o of out) if (o.label) labels.set(o.label, (labels.get(o.label) ?? 0) + 1);
  const labelText = `{${[...labels].map(([k, v]) => `'${k}': ${v}`).join(", ")}}`;
  console.log(`comments: ${out.length} findings -> ${sources.model} model-written, ${sources.template} template, ` +
    `${sources.duplicate} marked duplicate | labels ${labelText} | ` +
    `blocking: ${out.filter((o) => (o.decorations ?? []).includes("blocking")).length}` +
    (warnings.length ? ` | WARNINGS: ${warnings.join("; ")}` : "") + " -> comments.json, comments.md");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const USAGE = `usage: crtool.mjs <command> <rundir> [args]
  gather   <rundir> <target> [<scope>]
  facts    <rundir>
  merge    <rundir> --expect <angle,angle,...>
  shard    <rundir> [--shards N]
  ballots  <rundir>
  collate  <rundir>
  finalize <rundir>
  comments <rundir> [--no-trailer]`;

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      expect: { type: "string" },
      shards: { type: "string" },
      "no-trailer": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, rundir, ...rest] = positionals;
  if (values.help || !cmd) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  if (!rundir) die(`${cmd}: missing <rundir>\n${USAGE}`);
  const run = path.resolve(rundir);
  switch (cmd) {
    case "gather":
      if (!rest[0]) die("gather: missing <target>");
      cmdGather(run, rest[0], rest[1] ?? ".");
      break;
    case "facts": cmdFacts(run); break;
    case "merge":
      if (values.expect === undefined) die("merge: --expect is required");
      cmdMerge(run, values.expect);
      break;
    case "shard": {
      const shards = values.shards === undefined ? 4 : Number(values.shards);
      cmdShard(run, shards);
      break;
    }
    case "ballots": cmdBallots(run); break;
    case "collate": cmdCollate(run); break;
    case "finalize": cmdFinalize(run); break;
    case "comments": cmdComments(run, values["no-trailer"] === true); break;
    default: die(`unknown command ${pyRepr(cmd)}\n${USAGE}`);
  }
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`crtool: error: ${e instanceof Die ? e.message : e.message ?? e}\n`);
  process.exitCode = e instanceof Die ? e.code : 2;
}
