#!/usr/bin/env node
// Coletor de uso dos co-pilots (Claude / Codex / Gemini).
// Lê fontes locais e emite um JSON unificado no stdout.
// Cada adapter é isolado: falha de um não derruba os outros.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const PROJ = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- config opcional (limites/orcamentos ajustaveis) --------------------
const CONFIG = (() => {
  const p = join(PROJ, 'config.json');
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; }
  catch { return {}; }
})();

function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}
const toEpochS = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
};

// ========================= CLAUDE (ccusage) ==============================
// O Claude Code nao expoe % de rate-limit local (diferente do Codex).
// Proxy: uso do bloco de 5h atual vs um teto. Teto = budget manual do
// config.json OU o maior bloco do historico (auto-calibra).
function collectClaude() {
  const base = { id: 'claude', label: 'Claude', color: '#e8853a' };
  const localBin = join(PROJ, 'node_modules', '.bin', 'ccusage');
  const [cmd, pre] = existsSync(localBin)
    ? [localBin, []]
    : ['npx', ['--yes', 'ccusage@latest']];
  const out = safe(() => execFileSync(
    cmd, [...pre, 'blocks', '--json'],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] },
  ));
  if (!out) return { ...base, status: 'error', percent: null, detail: 'ccusage indisponivel' };

  const blocks = safe(() => JSON.parse(out))?.blocks || [];
  const active = blocks.find((x) => x.isActive) || null;
  if (!active) return { ...base, status: 'idle', percent: 0, detail: 'sem bloco ativo (5h)' };

  const tokens = active.totalTokens ?? 0;
  const past = blocks.filter((x) => !x.isGap && !x.isActive).map((x) => x.totalTokens || 0);
  const histMax = past.length ? Math.max(...past) : 0;
  const manual = CONFIG.claude?.blockTokenBudget ?? null;
  const budget = manual ?? (histMax || null);
  let percent = budget ? Math.round((tokens / budget) * 100) : null;
  if (percent != null) percent = Math.max(0, Math.min(100, percent));

  return {
    ...base,
    status: percent == null ? 'nolimit' : 'ok',
    percent,
    tokens,
    budget,
    budgetSource: manual ? 'config' : (histMax ? 'auto' : null),
    costUSD: active.costUSD ?? null,
    windowMinutes: 300,
    resetAt: toEpochS(active.endTime),
    detail: percent == null
      ? 'defina claude.blockTokenBudget em config.json'
      : `${(tokens / 1e6).toFixed(1)}M tokens ${manual ? '/ budget' : 'vs bloco mais pesado'}`,
  };
}

// ========================= CODEX (rollout) ===============================
function latestCodexRollout() {
  const base = join(HOME, '.codex', 'sessions');
  if (!existsSync(base)) return null;
  const all = safe(() => readdirSync(base, { recursive: true }), []) || [];
  let newest = null, newestM = 0;
  for (const rel of all) {
    const s = String(rel);
    if (!s.endsWith('.jsonl') || !s.includes('rollout-')) continue;
    const p = join(base, s);
    const m = safe(() => statSync(p).mtimeMs, 0);
    if (m > newestM) { newestM = m; newest = p; }
  }
  return newest ? { path: newest, mtimeMs: newestM } : null;
}

function collectCodex() {
  const base = { id: 'codex', label: 'Codex', color: '#a855f7' };
  const r = latestCodexRollout();
  if (!r) return { ...base, status: 'unavailable', percent: null, detail: 'sem sessoes do Codex' };

  const lines = safe(() => readFileSync(r.path, 'utf8').split('\n'), []) || [];
  let info = null, rl = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (!ln || ln.indexOf('token_count') === -1) continue;
    const j = safe(() => JSON.parse(ln));
    if (j?.payload?.type === 'token_count') { info = j.payload.info; rl = j.payload.rate_limits; break; }
  }
  if (!rl?.primary) return { ...base, status: 'unavailable', percent: null, detail: 'sessao sem rate_limit' };

  const resetAt = toEpochS(rl.primary.resets_at);
  // Se o horario de reset ja passou, a janela renovou: uso real ~0 (dado antigo).
  const resetPassed = resetAt != null && resetAt * 1000 <= Date.now();
  const percent = resetPassed
    ? 0
    : Math.max(0, Math.min(100, Math.round(rl.primary.used_percent ?? 0)));
  const ageMin = (Date.now() - r.mtimeMs) / 60000;
  return {
    ...base,
    status: ageMin > (rl.primary.window_minutes ?? 300) ? 'stale' : 'ok',
    percent,
    resetPassed,
    tokens: info?.total_token_usage?.total_tokens ?? null,
    contextWindow: info?.model_context_window ?? null,
    windowMinutes: rl.primary.window_minutes ?? 300,
    resetAt,
    plan: rl.plan_type ?? null,
    secondaryPercent: rl.secondary?.used_percent ?? null,
    detail: `janela de ${Math.round((rl.primary.window_minutes ?? 300)/60)}h, plano ${rl.plan_type ?? '?'}`,
  };
}

// ========================= GEMINI ========================================
// O Gemini CLI ainda nao tem % de limite padronizado como o Codex.
// Aqui detectamos login e (quando houver) medimos uso contra um budget.
function collectGemini() {
  const base = { id: 'gemini', label: 'Gemini', color: '#4285f4' };
  const dir = join(HOME, '.gemini');
  const loggedIn = existsSync(join(dir, 'oauth_creds.json')) || existsSync(join(dir, 'google_accounts.json'));
  if (!existsSync(dir) || !loggedIn) {
    return { ...base, status: 'setup', percent: null, detail: 'falta login (rode: gemini)' };
  }
  // Placeholder: ligado apos descobrir a telemetria real do gemini-cli.
  return { ...base, status: 'setup', percent: null, detail: 'login ok, telemetria a mapear' };
}

// ========================= TOKENS DO DIA =================================
// { total, real, cost } do dia. real = input+output (sem cache lido).
function ccusageDaily() {
  const localBin = join(PROJ, 'node_modules', '.bin', 'ccusage');
  const [cmd, pre] = existsSync(localBin) ? [localBin, []] : ['npx', ['--yes', 'ccusage@latest']];
  const out = safe(() => execFileSync(cmd, [...pre, 'daily', '--json'], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const zero = { total: 0, real: 0, cost: 0 };
  if (!out) return zero;
  const days = safe(() => JSON.parse(out))?.daily || [];
  if (!days.length) return zero;
  const today = new Date().toISOString().slice(0, 10);
  const t = days.find((d) => (d.date || '').slice(0, 10) === today) || days[days.length - 1];
  return {
    total: t?.totalTokens ?? 0,
    real: (t?.inputTokens ?? 0) + (t?.outputTokens ?? 0),
    cost: t?.totalCost ?? 0,
  };
}

// Codex: soma dos rollouts de hoje. real = (input - cache) + output.
function codexDay() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dir = join(HOME, '.codex', 'sessions', String(y), m, d);
  const res = { total: 0, real: 0 };
  if (!existsSync(dir)) return res;
  const files = safe(() => readdirSync(dir), []) || [];
  for (const f of files) {
    const s = String(f);
    if (!s.includes('rollout-') || !s.endsWith('.jsonl')) continue;
    const lines = safe(() => readFileSync(join(dir, s), 'utf8').split('\n'), []) || [];
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].indexOf('token_count') === -1) continue;
      const u = safe(() => JSON.parse(lines[i]))?.payload?.info?.total_token_usage;
      if (u) {
        res.total += u.total_tokens ?? 0;
        res.real += Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)) + (u.output_tokens ?? 0);
        break;
      }
    }
  }
  return res;
}

// ========================= SAIDA =========================================
const agents = [collectClaude(), collectCodex(), collectGemini()];
const cl = safe(() => ccusageDaily(), { total: 0, real: 0, cost: 0 });
const cx = safe(() => codexDay(), { total: 0, real: 0 });
process.stdout.write(JSON.stringify({
  generatedAt: Date.now(),
  refreshSeconds: CONFIG.refreshSeconds ?? 45,
  dayTokens: {
    total: (cl.total || 0) + (cx.total || 0),
    real: (cl.real || 0) + (cx.real || 0),
    cost: cl.cost || 0,
  },
  agents,
}, null, 2) + '\n');
