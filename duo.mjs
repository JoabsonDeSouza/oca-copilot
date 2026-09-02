#!/usr/bin/env node
// Dupla: Claude x Codex discutindo um tema no mesmo terminal.
// Uso: node duo.mjs [tema...]   (sem tema, pergunta)
// Var: DUO_ROUNDS=3 (numero de rodadas; cada rodada = 1 fala de cada)

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir, tmpdir } from 'node:os';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const HOME = homedir();
const ROUNDS = Math.max(1, parseInt(process.env.DUO_ROUNDS || '3', 10));
const C = {
  claude: '\x1b[38;5;208m', codex: '\x1b[38;5;141m',
  dim: '\x1b[2m', b: '\x1b[1m', r: '\x1b[0m', g: '\x1b[38;5;250m',
};

function ask(q) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res(a.trim()); });
  });
}

function callClaude(prompt) {
  return execFileSync('claude', ['-p', prompt], {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, cwd: HOME,
  }).trim();
}

function callCodex(prompt) {
  const out = join(tmpdir(), `duo-codex-${process.pid}.txt`);
  try { if (existsSync(out)) unlinkSync(out); } catch {}
  execFileSync('codex', ['exec', prompt, '--skip-git-repo-check', '--color', 'never', '-o', out], {
    maxBuffer: 20 * 1024 * 1024, cwd: HOME, stdio: ['ignore', 'ignore', 'ignore'],
  });
  return existsSync(out) ? readFileSync(out, 'utf8').trim() : '(sem resposta)';
}

function turnPrompt(topic, transcript, me, other) {
  const conv = transcript.length
    ? transcript.map((t) => `${t.who}: ${t.text}`).join('\n\n')
    : '(inicio da conversa)';
  return `Tema em discussao: ${topic}

Conversa ate aqui:
${conv}

Voce e o ${me}, batendo papo com o ${other} (outra IA) pra trocar ideias e ir mais fundo no tema. Leia a conversa e de a SUA proxima fala: reaja ao que o ${other} disse, concorde ou discorde com motivo, traga um angulo novo, provoque quando fizer sentido. Seja direto e curto (no maximo ~120 palavras). Nao repita o que ja foi dito. Responda so com a sua fala, sem preambulo tipo "aqui esta".`;
}

function spinner(color, name, round) {
  process.stdout.write(`${color}${C.b}● ${name}${C.r} ${C.dim}(rodada ${round}, pensando...)${C.r}`);
}
function clearLine(color, name) {
  process.stdout.write(`\r\x1b[2K${color}${C.b}● ${name}${C.r}\n`);
}

const topic = process.argv.slice(2).join(' ').trim()
  || await ask(`${C.b}Tema da discussao entre Claude e Codex:${C.r} `);
if (!topic) { console.log('Sem tema. Saindo.'); process.exit(0); }

console.log(`\n${C.b}=== DUPLA: Claude × Codex ===${C.r}`);
console.log(`${C.g}Tema: ${topic}${C.r}`);
console.log(`${C.dim}${ROUNDS} rodadas (${ROUNDS * 2} chamadas). Consome tokens dos dois. Ctrl+C pra parar.${C.r}\n`);

const transcript = [];
for (let i = 1; i <= ROUNDS; i++) {
  spinner(C.claude, 'Claude', i);
  let cl;
  try { cl = callClaude(turnPrompt(topic, transcript, 'Claude', 'Codex')); }
  catch (e) { cl = `(erro ao chamar claude: ${e.message})`; }
  clearLine(C.claude, 'Claude');
  console.log(cl + '\n');
  transcript.push({ who: 'Claude', text: cl });

  spinner(C.codex, 'Codex', i);
  let cx;
  try { cx = callCodex(turnPrompt(topic, transcript, 'Codex', 'Claude')); }
  catch (e) { cx = `(erro ao chamar codex: ${e.message})`; }
  clearLine(C.codex, 'Codex');
  console.log(cx + '\n');
  transcript.push({ who: 'Codex', text: cx });
}

console.log(`${C.dim}--- fim da discussao (${ROUNDS} rodadas) ---${C.r}`);
