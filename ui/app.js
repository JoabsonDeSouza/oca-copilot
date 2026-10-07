// OCA Copilot - render dos aneis + hover expand/collapse + refresh.

const invoke = window.__TAURI__?.core?.invoke;

// Logos oficiais carregadas de icons.js (gerado via Simple Icons).
const ICONS = window.OFFICIAL_ICONS || {};
const PROVIDERS = [
  { id: 'claude', label: 'Claude', color: '#e8853a', description: 'Uso local do Claude Code' },
  { id: 'codex', label: 'Codex', color: '#a855f7', description: 'Limites nativos da conta' },
  { id: 'gemini', label: 'Gemini', color: '#4285f4', description: 'Estado do Gemini CLI' },
  { id: 'opencode', label: 'OpenCode', color: '#f3f3f3', description: 'Quota oficial OpenCode Go' },
];

function resetLabel(a) {
  if (a.resetPassed) return 'renovado';
  if (!a.resetAt) return '';
  const diff = a.resetAt * 1000 - Date.now();
  if (diff <= 0) return 'renovado';
  if (diff > 72 * 60 * 60 * 1000) return `renova em ${Math.round(diff / (24 * 60 * 60 * 1000))} dias`;
  const m = Math.round(diff / 60000), h = Math.floor(m / 60);
  return h > 0 ? `renova em ${h}h${String(m % 60).padStart(2, '0')}` : `renova em ${m} min`;
}

function fmtTokens(n) {
  if (n == null) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function ringHtml(a) {
  const size = 50, stroke = 4, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const known = typeof a.percent === 'number';
  const off = known ? c * (1 - Math.max(0, Math.min(100, a.percent)) / 100) : c;
  const exhausted = a.status === 'exhausted' || (known && a.percent >= 98)
    || (a.windows || []).some((w) => w.usedPercent >= 98 || w.status === 'rate-limited');
  const subtitle = a.available === false
    ? (a.status === 'unavailable' ? (a.detail || 'quota indisponível') : 'sem login')
    : (resetLabel(a) || '&nbsp;');
  const windows = (a.windows || []).map((w) => {
    const hit = w.usedPercent >= 98 || w.status === 'rate-limited';
    const remaining = w.remainingPercent ?? (100 - w.usedPercent);
    return `<div class="window-row${hit ? ' exhausted' : ''}"><span>${w.label}</span><b>${w.usedPercent}% usado</b><small>${remaining}% disponível · ${resetLabel({ resetAt: w.resetAt }) || 'renovação não informada'}</small></div>`;
  }).join('');
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
    <div class="label">${a.label}</div>
    <div class="sub">${subtitle}</div>
    ${windows ? `<div class="window-details" aria-label="Janelas de quota">${windows}</div>` : ''}
  </div>`;
}

let providerOrder = PROVIDERS.map((p) => p.id);
let draggedProvider = null;

function normalizedOrder(order) {
  const ids = Array.isArray(order) ? order.filter((id) => PROVIDERS.some((p) => p.id === id)) : [];
  return [...new Set([...ids, ...PROVIDERS.map((p) => p.id)])];
}

function renderSettings(enabledProviders = {}, order = providerOrder) {
  const root = document.getElementById('provider-options');
  if (!root) return;
  providerOrder = normalizedOrder(order);
  const stateKey = providerOrder.join(',') + ':' + PROVIDERS.map((p) => enabledProviders[p.id] !== false ? '1' : '0').join('');
  if (root.dataset.state === stateKey) return;
  root.dataset.state = stateKey;
  root.innerHTML = providerOrder.map((id) => PROVIDERS.find((p) => p.id === id)).map((p) => {
    const enabled = enabledProviders[p.id] !== false;
    return `<div class="provider-setting" draggable="true" data-provider-row="${p.id}" style="--provider-color:${p.color}">
      <span class="drag-handle" title="Arraste para reordenar" aria-hidden="true">⠿</span>
      <span class="setting-glyph">${ICONS[p.id] || ''}</span>
      <span class="setting-copy"><b>${p.label}</b><small>${p.description}</small></span>
      <button class="toggle" type="button" role="switch" data-provider="${p.id}" aria-checked="${enabled}" aria-label="${p.label}" ${invoke ? '' : 'disabled'}></button>
    </div>`;
  }).join('');
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
  providerOrder = normalizedOrder(data.providerOrder || providerOrder);
  const agents = providerOrder.map((id) => (data.agents || []).find((x) => x.id === id)).filter(Boolean);
  document.getElementById('agents').innerHTML = agents.map(ringHtml).join('');
  renderSettings(data.enabledProviders, providerOrder);
  const tab = document.getElementById('tab');
  [...tab.querySelectorAll('.dot')].sort((a, b) => providerOrder.indexOf(a.dataset.id) - providerOrder.indexOf(b.dataset.id)).forEach((dot) => tab.append(dot));
  const activeIds = new Set(agents.map((a) => a.id));
  document.querySelectorAll('#tab .dot').forEach((dot) => {
    dot.hidden = !activeIds.has(dot.dataset.id);
  });
  document.getElementById('tab').style.setProperty('--provider-count', String(activeIds.size));
  const modeSelect = document.getElementById('launch-mode');
  if (modeSelect && !modeSelect.matches(':focus')) modeSelect.value = data.openMode === 'terminal' ? 'terminal' : 'cli';

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
let settingsOpen = false;
let movingTab = false;
let dragY = null;
let holdTimer = null;
let didLongPress = false;

function showSettings(open) {
  settingsOpen = open;
  document.body.classList.toggle('settings-open', open);
  if (open) {
    document.body.classList.add('expanded');
    document.body.classList.remove('collapsed');
  }
  invoke?.('set_settings', { open });
}

function expand() {
  document.body.classList.add('expanded');
  document.body.classList.remove('collapsed');
  if (settingsOpen) invoke?.('set_settings', { open: true });
  else invoke?.('set_expanded', { expanded: true });
}
function collapseNow() {
  document.body.classList.add('collapsed');
  document.body.classList.remove('expanded');
  invoke?.('set_expanded', { expanded: false });
}
const tabToggle = document.getElementById('tab-toggle');
const tabToggleIcon = document.getElementById('tab-toggle-icon');
tabToggle?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  didLongPress = false;
  dragY = e.screenY;
  tabToggle.setPointerCapture(e.pointerId);
  holdTimer = setTimeout(() => {
    didLongPress = true;
    movingTab = true;
    tabToggle.classList.add('drag-mode');
    tabToggleIcon.textContent = '⠿';
  }, 350);
});
tabToggle?.addEventListener('pointermove', async (e) => {
  if (!movingTab) return;
  dragY = e.screenY;
  try { await invoke('set_widget_vertical_position', { y: dragY }); }
  catch (error) { console.warn('falha ao mover aba:', error); }
});
async function finishTabMove() {
  clearTimeout(holdTimer);
  if (!didLongPress) { expand(); return; }
  movingTab = false;
  tabToggle?.classList.remove('drag-mode');
  if (tabToggleIcon) tabToggleIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>';
  try { await invoke('save_window_position'); }
  catch (error) { console.warn('falha ao salvar posição:', error); }
}
tabToggle?.addEventListener('pointerup', finishTabMove);
tabToggle?.addEventListener('pointercancel', finishTabMove);

// ---------- Rodape ----------
function wireFooter() {
  // Setinha = recolher pra abinha (nao some mais; reabre passando o cursor).
  document.getElementById('btn-min')?.addEventListener('click', () => collapseNow());
  document.getElementById('btn-settings')?.addEventListener('click', () => showSettings(true));
  document.getElementById('btn-settings-back')?.addEventListener('click', () => showSettings(false));
  document.getElementById('provider-options')?.addEventListener('click', async (e) => {
    const button = e.target.closest('.toggle[data-provider]');
    if (!button || !invoke) return;
    const enabled = button.getAttribute('aria-checked') !== 'true';
    button.disabled = true;
    const status = document.getElementById('settings-status');
    if (status) status.textContent = '';
    try {
      await invoke('set_provider_enabled', { id: button.dataset.provider, enabled });
      await render();
    } catch (error) {
      console.warn('falha ao salvar provedor:', error);
      button.disabled = false;
      if (status) status.textContent = 'Não foi possível salvar a preferência.';
    }
  });
  const rows = document.getElementById('provider-options');
  rows?.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-provider-row]');
    if (!row) return;
    draggedProvider = row.dataset.providerRow;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedProvider);
  });
  rows?.addEventListener('dragend', () => {
    rows.querySelector('.dragging')?.classList.remove('dragging');
    rows.querySelectorAll('.drag-over').forEach((row) => row.classList.remove('drag-over'));
    draggedProvider = null;
  });
  rows?.addEventListener('dragover', (e) => {
    const row = e.target.closest('[data-provider-row]');
    if (row && draggedProvider && row.dataset.providerRow !== draggedProvider) {
      e.preventDefault();
      rows.querySelectorAll('.drag-over').forEach((item) => item.classList.remove('drag-over'));
      row.classList.add('drag-over');
    }
  });
  rows?.addEventListener('drop', async (e) => {
    const target = e.target.closest('[data-provider-row]');
    if (!target || !draggedProvider || target.dataset.providerRow === draggedProvider) return;
    e.preventDefault();
    const next = [...providerOrder];
    const from = next.indexOf(draggedProvider), to = next.indexOf(target.dataset.providerRow);
    next.splice(from, 1); next.splice(to, 0, draggedProvider);
    providerOrder = next;
    const status = document.getElementById('settings-status');
    try {
      await invoke('set_provider_order', { order: next });
      if (status) status.textContent = '';
      await render();
    } catch (error) {
      console.warn('falha ao salvar ordem:', error);
      if (status) status.textContent = 'Não foi possível salvar a ordem.';
    }
  });
  const ov = document.getElementById('btn-overlap');
  ov?.addEventListener('click', async () => {
    const on = ov.getAttribute('aria-pressed') !== 'true';
    ov.setAttribute('aria-pressed', String(on));
    try { await invoke?.('set_overlap', { on }); } catch (e) { console.warn(e); }
  });
  document.getElementById('launch-mode')?.addEventListener('change', async (e) => {
    try { await invoke('set_open_mode', { mode: e.target.value }); }
    catch (error) { console.warn('falha ao salvar preferência de abertura:', error); }
  });
}

// Clique num anel abre o terminal com aquela IA carregada.
document.getElementById('agents')?.addEventListener('click', (e) => {
  const el = e.target.closest('.agent');
  if (el?.dataset.id) {
    invoke?.('launch_agent', { id: el.dataset.id });
    collapseNow();
  }
});

wireFooter();
render();

// Posiciona no canto superior direito (expandido). Repete pra garantir.
invoke?.('set_expanded', { expanded: true });
setTimeout(() => invoke?.('set_expanded', { expanded: true }), 700);

// Recolhe pro tab discreto apos 3s se o cursor nao estiver em cima.
setTimeout(() => collapseNow(), 3000);
