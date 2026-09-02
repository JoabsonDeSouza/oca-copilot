// OCA Copilot - render dos aneis + hover expand/collapse + refresh.

const invoke = window.__TAURI__?.core?.invoke;

// Logos oficiais carregadas de icons.js (gerado via Simple Icons).
const ICONS = window.OFFICIAL_ICONS || {};

function resetLabel(a) {
  if (a.resetPassed) return 'renovado';
  if (!a.resetAt) return '';
  const diff = a.resetAt * 1000 - Date.now();
  if (diff <= 0) return 'renovado';
  const m = Math.round(diff / 60000), h = Math.floor(m / 60);
  return h > 0 ? `reset ${h}h${String(m % 60).padStart(2, '0')}` : `reset ${m}min`;
}

function fmtTokens(n) {
  if (n == null) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function ringHtml(a) {
  const size = 56, stroke = 4.5, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const known = typeof a.percent === 'number';
  const off = known ? c * (1 - Math.max(0, Math.min(100, a.percent)) / 100) : c;
  const exhausted = known && a.percent >= 98;
  return `<div class="agent status-${a.status}${exhausted ? ' exhausted' : ''}" data-id="${a.id}">
    <div class="ring" style="--color:${a.color}">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"/>
        <circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"
          stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
      </svg>
      <span class="glyph">${ICONS[a.id] || ''}</span>
    </div>
    <div class="pct">${known ? a.percent + '%' : '--'}</div>
    <div class="sub">${a.status === 'setup' ? 'sem login' : (resetLabel(a) || '&nbsp;')}</div>
  </div>`;
}

async function loadUsage() {
  try {
    if (invoke) {
      const raw = await invoke('get_usage');
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
  } catch (e) { console.warn('invoke get_usage falhou:', e); }
  const res = await fetch('./usage.json', { cache: 'no-store' });
  return res.json();
}

let refreshTimer = null;
async function render() {
  let data;
  try { data = await loadUsage(); }
  catch (e) {
    document.getElementById('agents').innerHTML = `<div class="updated">sem dados</div>`;
    return;
  }
  const order = ['claude', 'codex', 'gemini'];
  const agents = order.map((id) => (data.agents || []).find((x) => x.id === id)).filter(Boolean);
  document.getElementById('agents').innerHTML = agents.map(ringHtml).join('');

  let dl = document.querySelector('.dayline');
  if (!dl) {
    dl = document.createElement('div');
    dl.className = 'dayline';
    document.getElementById('agents').after(dl);
  }
  const dt = data.dayTokens;
  const parts = [];
  if (dt && dt.cost > 0) parts.push('$' + Math.round(dt.cost));
  if (dt && dt.real != null) parts.push(fmtTokens(dt.real));
  dl.textContent = parts.length ? `hoje ${parts.join(' / ')}` : '';

  const secs = Math.max(15, data.refreshSeconds || 45);
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(render, secs * 1000);
}

// ---------- Hover: expandir / recolher ----------
let hovered = false;
let collapseTimer = null;

function expand() {
  hovered = true;
  clearTimeout(collapseTimer);
  document.body.classList.add('expanded');
  document.body.classList.remove('collapsed');
  invoke?.('set_expanded', { expanded: true });
}
function collapseNow() {
  document.body.classList.add('collapsed');
  document.body.classList.remove('expanded');
  invoke?.('set_expanded', { expanded: false });
}
function scheduleCollapse() {
  hovered = false;
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => { if (!hovered) collapseNow(); }, 260);
}

document.documentElement.addEventListener('mouseenter', expand);
document.documentElement.addEventListener('mouseleave', scheduleCollapse);

// ---------- Rodape ----------
function wireFooter() {
  // Setinha = recolher pra abinha (nao some mais; reabre passando o cursor).
  document.getElementById('btn-min')?.addEventListener('click', () => collapseNow());
  document.getElementById('btn-settings')?.addEventListener('click', () => invoke?.('open_config'));
  const ov = document.getElementById('btn-overlap');
  ov?.addEventListener('click', async () => {
    const on = ov.getAttribute('aria-pressed') !== 'true';
    ov.setAttribute('aria-pressed', String(on));
    try { await invoke?.('set_overlap', { on }); } catch (e) { console.warn(e); }
  });
  // Botao dupla: abre o terminal com Claude x Codex discutindo.
  document.getElementById('btn-duo')?.addEventListener('click', () => invoke?.('launch_agent', { id: 'duo' }));
}

// Clique num anel abre o terminal com aquela IA carregada.
document.getElementById('agents')?.addEventListener('click', (e) => {
  const el = e.target.closest('.agent');
  if (el?.dataset.id) invoke?.('launch_agent', { id: el.dataset.id });
});

wireFooter();
render();

// Posiciona no canto superior direito (expandido). Repete pra garantir.
invoke?.('set_expanded', { expanded: true });
setTimeout(() => invoke?.('set_expanded', { expanded: true }), 700);

// Recolhe pro tab discreto apos 3s se o cursor nao estiver em cima.
setTimeout(() => { if (!hovered) collapseNow(); }, 3000);
