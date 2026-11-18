// The Finance tab: savings on card and in cash, every movement with an optional note, and charts.
// Entries stay forever unless you delete one yourself.
import * as store from './db.js';
import { $, romanianDate, addDays, formatDate, toast, reportError } from './util.js';

const PAGE = 20;                          // history entries per page
const RANGES = { '7D': 7, '1M': 30, '3M': 90, '1Y': 365 };
const COLORS = { card: '#5b8fd9', cash: '#3f9b62' };   // checked for colour-blind safety on the dark background
const SVG = 'http://www.w3.org/2000/svg';

const state = {
  uid: null,
  totals: { card: 0, cash: 0 },
  totalsLoaded: false,
  unsubscribe: null,
  history: null, hasMore: false, loadingHistory: false,
  range: '1M',
  chartTx: null,             // entries since the chart's start date
  chartFrom: null,
  points: [],                // [{date, value}] for the line chart
  open: null,                // id of the history entry showing its Delete button
  shown: false,
};

// ---------- Money helpers ----------

export function formatMoney(bani, { sign = false } = {}) {
  const n = Math.abs(bani) / 100;
  const text = n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prefix = bani < 0 ? '−' : sign && bani > 0 ? '+' : '';
  return `${prefix}${text} RON`;
}

// "5", "5.5", "0,04", "1 234.50" → bani. Returns null if it isn't a valid positive amount.
function parseAmount(text) {
  let s = text.trim().replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    // Both used, e.g. "1,234.50" or "1.234,50": the last one is the decimal point.
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const bani = Math.round(parseFloat(s) * 100);
  return bani > 0 ? bani : null;
}

const toInput = (bani) => (bani / 100).toFixed(2);

// ---------- Start / stop ----------

export function start(uid) {
  stop();
  state.uid = uid;
  state.totals = { card: 0, cash: 0 };
  state.totalsLoaded = false;
  state.history = null;
  state.chartTx = null;
  renderTotals();
  state.unsubscribe = store.watchFinanceTotals(uid, (totals) => {
    state.totals = totals;
    state.totalsLoaded = true;
    renderTotals();
    renderChart();
  }, reportError);
}

export function stop() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.uid = null;
  state.shown = false;
}

export function onShow() {
  if (!state.uid) return;
  state.shown = true;
  if (!state.history && !state.loadingHistory) loadHistory();
  if (!state.chartTx) loadChart();
  else renderChart();
}

let lastDay = romanianDate();
export function checkForNewDay() {
  const today = romanianDate();
  if (today === lastDay) return;
  lastDay = today;
  if (state.history) renderHistory();          // "Today" becomes "Yesterday"
  state.chartTx = null;                         // the chart moves one day on
  if (state.shown && !$('#tab-finance').hidden) loadChart();
}

export const getAllEntries = () => store.getAllFinance(state.uid);

// ---------- Totals + ring chart ----------

function renderTotals() {
  const { card, cash } = state.totals;
  $('#fin-card').textContent = formatMoney(card);
  $('#fin-cash').textContent = formatMoney(cash);
  $('#fin-card').classList.toggle('negative', card < 0);
  $('#fin-cash').classList.toggle('negative', cash < 0);
  renderHero('fin');   // Finance tab
  renderHero('pf');    // the same card on the Profile tab
}

function renderHero(prefix) {
  const { card, cash } = state.totals;
  const total = card + cash;
  const totalEl = $(`#${prefix}-total`);
  totalEl.textContent = state.totalsLoaded ? formatMoney(total) : '…';
  totalEl.classList.toggle('negative', total < 0);
  $(`#${prefix}-legend-card`).textContent = formatMoney(card);
  $(`#${prefix}-legend-cash`).textContent = formatMoney(cash);
  renderDonut(prefix, Math.max(card, 0), Math.max(cash, 0));
}

function renderDonut(prefix, card, cash) {
  const svg = $(`#${prefix}-donut`);
  svg.replaceChildren();
  const r = 42, c = 2 * Math.PI * r, sum = card + cash;
  const ring = (color, len, offset, title) => {
    const el = document.createElementNS(SVG, 'circle');
    Object.entries({
      cx: 50, cy: 50, r, fill: 'none', stroke: color, 'stroke-width': 11,
      'stroke-dasharray': `${len} ${c - len}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 50 50)',
    }).forEach(([k, v]) => el.setAttribute(k, v));
    if (title) { const t = document.createElementNS(SVG, 'title'); t.textContent = title; el.append(t); }
    svg.append(el);
  };
  ring('#22252a', c, 0);                              // empty track
  if (sum > 0) {
    const gap = card > 0 && cash > 0 ? 2.5 : 0;       // a small gap between the two parts
    const cardLen = (card / sum) * c;
    if (card > 0) ring(COLORS.card, Math.max(cardLen - gap, 0.5), 0, `Card: ${formatMoney(card)}`);
    if (cash > 0) ring(COLORS.cash, Math.max(c - cardLen - gap, 0.5), cardLen, `Cash: ${formatMoney(cash)}`);
  }
  const pct = sum > 0 ? Math.round((card / sum) * 100) : null;
  $(`#${prefix}-donut-label`).innerHTML = pct === null ? '' : `<b>${pct}%</b><span>on card</span>`;
}

// ---------- Add / spend / move ----------

const sheet = $('#fin-sheet');
let sheetAction = null;

const ACTIONS = {
  'add-card': { title: 'Add to card', type: 'add', account: 'card', button: 'Add', note: 'Where is it from? (optional)' },
  'add-cash': { title: 'Add to cash', type: 'add', account: 'cash', button: 'Add', note: 'Where is it from? (optional)' },
  'spend-card': { title: 'Spent from card', type: 'spend', account: 'card', button: 'Save', note: 'What did you spend it on? (optional)' },
  'spend-cash': { title: 'Spent from cash', type: 'spend', account: 'cash', button: 'Save', note: 'What did you spend it on? (optional)' },
  move: { title: 'Move cash to card', type: 'move', account: 'cash', button: 'Move', note: 'Note (optional)' },
};

for (const btn of document.querySelectorAll('[data-fin-action]')) {
  btn.addEventListener('click', () => openSheet(btn.dataset.finAction));
}

function openSheet(key) {
  const action = ACTIONS[key];
  if (action.type === 'move' && state.totals.cash <= 0) { toast('There is no cash to move.'); return; }
  sheetAction = action;
  $('#fin-sheet-title').textContent = action.title;
  $('#fin-sheet-submit').textContent = action.button;
  $('#fin-sheet-submit').className = 'sheet-submit ' + action.type;
  $('#fin-note').placeholder = action.note;
  $('#fin-amount').value = action.type === 'move' ? toInput(state.totals.cash) : '';
  $('#fin-note').value = '';
  $('#fin-date').value = romanianDate();
  $('#fin-date').max = romanianDate();
  $('#fin-sheet-hint').textContent = action.type === 'move'
    ? `All your cash (${formatMoney(state.totals.cash)}) is filled in. Change it to move only part.` : '';
  $('#fin-sheet-error').textContent = '';
  sheet.hidden = false;
  setTimeout(() => $('#fin-amount').focus(), 50);
}

function closeSheet() {
  sheet.hidden = true;
  sheetAction = null;
}

$('#fin-sheet-cancel').addEventListener('click', closeSheet);
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

$('#fin-sheet-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const action = sheetAction;
  if (!action) return;
  const amount = parseAmount($('#fin-amount').value);
  if (!amount) { $('#fin-sheet-error').textContent = 'Enter an amount, like 5 or 0.04.'; return; }
  const from = action.account;
  if ((action.type === 'spend' || action.type === 'move') && amount > state.totals[from]) {
    const where = from === 'card' ? 'on your card' : 'in cash';
    if (!confirm(`That's more than you have ${where} (${formatMoney(state.totals[from])}). Save it anyway?`)) return;
  }
  const today = romanianDate();
  let date = $('#fin-date').value || today;
  if (date > today) date = today;
  const at = Date.now();
  const tx = {
    id: crypto.randomUUID(),
    type: action.type,
    account: action.account,
    amount,
    note: $('#fin-note').value.trim().slice(0, 200),
    date,
    at,
    key: `${date}|${String(at).padStart(15, '0')}`,
  };
  closeSheet();
  store.addFinanceEntry(state.uid, tx).then(refreshLists).catch(reportError);
  // Show it straight away (the totals update by themselves).
  if (state.history) { state.history.unshift(tx); state.history.sort((a, b) => b.key.localeCompare(a.key)); renderHistory(); }
  if (state.chartTx && date >= state.chartFrom) { state.chartTx.unshift(tx); }
  toast(action.type === 'add' ? `Added ${formatMoney(amount)}.` : action.type === 'move' ? `Moved ${formatMoney(amount)} to card.` : `Saved: ${formatMoney(-amount)}.`);
});

function refreshLists() {
  if (!state.shown) { state.history = null; state.chartTx = null; return; }
  loadHistory();
  loadChart();
}

// ---------- History (newest first, a page at a time) ----------

async function loadHistory(more = false) {
  if (state.loadingHistory) return;
  state.loadingHistory = true;
  renderHistory();
  try {
    const afterKey = more && state.history?.length ? state.history[state.history.length - 1].key : null;
    const page = await store.getFinancePage(state.uid, { afterKey, size: PAGE });
    state.history = more ? [...state.history, ...page] : page;
    state.hasMore = page.length === PAGE;
  } catch (err) {
    console.error(err);
    if (!state.history) state.history = [];
  } finally {
    state.loadingHistory = false;
    renderHistory();
  }
}

const describe = (tx) => tx.type === 'move' ? 'Moved cash to card'
  : `${tx.type === 'add' ? 'Added to' : 'Spent from'} ${tx.account}`;

function renderHistory() {
  const list = $('#fin-history');
  if (!state.history) {
    list.innerHTML = `<p class="empty">${state.loadingHistory ? 'Loading…' : ''}</p>`;
    return;
  }
  if (!state.history.length) {
    list.innerHTML = '<p class="empty">Nothing yet. Use the buttons above to add your first amount.</p>';
    return;
  }
  const days = new Map();
  for (const tx of state.history) {
    if (!days.has(tx.date)) days.set(tx.date, []);
    days.get(tx.date).push(tx);
  }
  const today = romanianDate();
  const nodes = [];
  for (const [date, items] of days) {
    const head = document.createElement('div');
    head.className = 'day-head';
    const net = items.reduce((s, t) => { const e = store.financeEffect(t); return s + e.card + e.cash; }, 0);
    const label = date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday'
      : formatDate(date, { weekday: 'short', month: 'short', year: date.slice(0, 4) === today.slice(0, 4) ? false : 'numeric' });
    head.innerHTML = `<span></span><span class="day-net"></span>`;
    head.firstChild.textContent = label;
    head.lastChild.textContent = items.length > 1 && net ? formatMoney(net, { sign: true }) : '';
    const card = document.createElement('div');
    card.className = 'card entries';
    card.append(...items.map(renderTx));
    nodes.push(head, card);
  }
  if (state.hasMore) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more-btn';
    more.textContent = state.loadingHistory ? 'Loading…' : 'Show older entries';
    more.disabled = state.loadingHistory;
    more.addEventListener('click', () => loadHistory(true));
    nodes.push(more);
  }
  list.replaceChildren(...nodes);
}

function renderTx(tx) {
  const row = document.createElement('div');
  row.className = `tx ${tx.type}` + (state.open === tx.id ? ' open' : '');
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'tx-main';
  const icon = document.createElement('span');
  icon.className = `tx-icon ${tx.type}`;
  icon.textContent = tx.type === 'add' ? '+' : tx.type === 'spend' ? '−' : '⇄';
  const text = document.createElement('span');
  text.className = 'tx-text';
  const title = document.createElement('span');
  title.className = 'tx-title';
  title.textContent = describe(tx);
  text.append(title);
  if (tx.note) {
    const note = document.createElement('span');
    note.className = 'tx-note';
    note.textContent = tx.note;
    text.append(note);
  }
  const amount = document.createElement('span');
  amount.className = `tx-amount ${tx.type}`;
  amount.textContent = tx.type === 'move' ? formatMoney(tx.amount) : formatMoney(tx.type === 'spend' ? -tx.amount : tx.amount, { sign: true });
  main.append(icon, text, amount);
  main.addEventListener('click', () => {
    state.open = state.open === tx.id ? null : tx.id;
    renderHistory();
  });
  row.append(main);
  if (state.open === tx.id) {
    const tools = document.createElement('div');
    tools.className = 'tx-tools';
    const time = document.createElement('span');
    time.className = 'muted small';
    time.textContent = `${formatDate(tx.date)}${tx.at ? ' · ' + new Date(tx.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' }) : ''}`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-link';
    del.textContent = 'Delete entry';
    del.addEventListener('click', () => deleteTx(tx));
    tools.append(time, del);
    row.append(tools);
  }
  return row;
}

function deleteTx(tx) {
  const what = `${describe(tx).toLowerCase()}: ${formatMoney(tx.amount)}${tx.note ? ` (${tx.note})` : ''}`;
  if (!confirm(`Delete this entry?\n\n${what}\n\nYour totals will be corrected. This can't be undone.`)) return;
  state.open = null;
  state.history = state.history.filter((t) => t.id !== tx.id);
  if (state.chartTx) state.chartTx = state.chartTx.filter((t) => t.id !== tx.id);
  renderHistory();
  store.deleteFinanceEntry(state.uid, tx).then(() => { toast('Entry deleted.'); refreshLists(); }).catch(reportError);
}

// ---------- Savings over time (line chart) + this month ----------

for (const btn of document.querySelectorAll('.range-btn')) {
  btn.addEventListener('click', () => {
    state.range = btn.dataset.range;
    for (const b of document.querySelectorAll('.range-btn')) b.classList.toggle('active', b === btn);
    loadChart();
  });
}

async function loadChart() {
  const today = romanianDate();
  const from = addDays(today, -(RANGES[state.range] - 1));
  const monthStart = today.slice(0, 8) + '01';
  const loadFrom = from < monthStart ? from : monthStart;
  try {
    const txs = await store.getFinanceSince(state.uid, loadFrom);
    state.chartTx = txs;
    state.chartFrom = loadFrom;
    renderChart();
  } catch (err) {
    console.error(err);
  }
}

// Works backwards from today's totals, so the line is always exact.
function buildPoints() {
  const today = romanianDate();
  const days = RANGES[state.range];
  const byDay = new Map();
  for (const tx of state.chartTx) {
    const e = store.financeEffect(tx);
    byDay.set(tx.date, (byDay.get(tx.date) || 0) + e.card + e.cash);
  }
  const points = [];
  let value = state.totals.card + state.totals.cash;
  for (let i = 0; i < days; i++) {
    const date = addDays(today, -i);
    points.push({ date, value });
    value -= byDay.get(date) || 0;
  }
  return points.reverse();
}

function renderChart() {
  if (!state.chartTx || !state.totalsLoaded) return;
  // This month
  const monthStart = romanianDate().slice(0, 8) + '01';
  let added = 0, spent = 0;
  for (const tx of state.chartTx) {
    if (tx.date < monthStart) continue;
    if (tx.type === 'add') added += tx.amount;
    if (tx.type === 'spend') spent += tx.amount;
  }
  $('#fin-month-added').textContent = formatMoney(added, { sign: true });
  $('#fin-month-spent').textContent = formatMoney(-spent);

  state.points = buildPoints();
  drawLine();
}

function drawLine() {
  const svg = $('#fin-chart');
  const width = svg.clientWidth || 320;
  const height = 150;
  const pad = { top: 22, right: 8, bottom: 22, left: 8 };
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const pts = state.points;
  const values = pts.map((p) => p.value);
  // Starts at 0 (or below, if you ever go negative) so changes look their real size.
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  if (min === max) max = 100;
  max += (max - min) * 0.08;
  const x = (i) => pad.left + (i / Math.max(pts.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - (v - min) / (max - min)) * (height - pad.top - pad.bottom);
  const el = (name, attrs, parent = svg) => {
    const n = document.createElementNS(SVG, name);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    parent.append(n);
    return n;
  };

  const defs = el('defs', {});
  const grad = el('linearGradient', { id: 'fin-fill', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#c8ccd1', 'stop-opacity': 0.14 }, grad);
  el('stop', { offset: '100%', 'stop-color': '#c8ccd1', 'stop-opacity': 0 }, grad);

  // Recessive grid: a line at 0 and one at the highest value, labelled.
  const top = Math.max(...values);
  el('line', { x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0), stroke: '#2c3036', 'stroke-width': 1 });
  if (top > 0) {
    el('line', { x1: pad.left, x2: width - pad.right, y1: y(top), y2: y(top), stroke: '#22252a', 'stroke-width': 1, 'stroke-dasharray': '3 4' });
    const t = el('text', { x: pad.left, y: y(top) - 5, class: 'axis-label' });
    t.textContent = formatMoney(top);
  }

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const base = y(Math.max(min, 0));
  el('path', { d: `${line}L${x(pts.length - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`, fill: 'url(#fin-fill)' });
  el('path', { d: line, fill: 'none', stroke: '#c8ccd1', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });

  const label = (text, xPos, anchor) => {
    const t = el('text', { x: xPos, y: height - 6, 'text-anchor': anchor, fill: '#6b7178', 'font-size': 11 });
    t.textContent = text;
  };
  label(formatDate(pts[0].date, { weekday: false, month: 'short', year: false }), pad.left, 'start');
  label('Today', width - pad.right, 'end');

  // Hover / touch: a guide line, a dot and the value for that day.
  const guide = el('line', { y1: pad.top, y2: height - pad.bottom, stroke: '#4a4f55', 'stroke-width': 1, visibility: 'hidden' });
  const dot = el('circle', { r: 4.5, fill: '#c8ccd1', stroke: '#15171a', 'stroke-width': 2, visibility: 'hidden' });
  const tip = $('#fin-tip');
  const show = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - pad.left) / (width - pad.left - pad.right)) * (pts.length - 1));
    const idx = Math.min(Math.max(i, 0), pts.length - 1);
    const p = pts[idx];
    guide.setAttribute('x1', x(idx)); guide.setAttribute('x2', x(idx)); guide.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(idx)); dot.setAttribute('cy', y(p.value)); dot.setAttribute('visibility', 'visible');
    tip.innerHTML = '<span></span><b></b>';
    tip.firstChild.textContent = formatDate(p.date, { weekday: 'short', month: 'short', year: false });
    tip.lastChild.textContent = formatMoney(p.value);
    tip.hidden = false;
    const left = (x(idx) / width) * rect.width;
    tip.style.left = `${Math.min(Math.max(left, 60), rect.width - 60)}px`;
  };
  const hide = () => { guide.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const hit = el('rect', { x: 0, y: 0, width, height, fill: 'transparent' });
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);

  // Text version for screen readers.
  const first = pts[0], last = pts[pts.length - 1];
  svg.setAttribute('aria-label', `Total savings went from ${formatMoney(first.value)} on ${formatDate(first.date)} to ${formatMoney(last.value)} today.`);
}

window.addEventListener('resize', () => { if (state.points.length && !$('#tab-finance').hidden) drawLine(); });
