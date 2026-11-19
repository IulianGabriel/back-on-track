// The Achievements tab: your own categories (name + emoji) and the achievements inside them.
// Overview: the list of categories. Tap one to open its page with the achievements as cards
// (title, date, description, photos and links). The phone's back button goes back to the overview.
import * as store from './db.js';
import { $, romanianDate, formatDate, toast, reportError } from './util.js';

const MAX_PHOTOS = 4;
const MAX_LINKS = 5;
const MAX_PHOTO_CHARS = 700_000;   // a stored photo must stay well under Firestore's 1 MB per document

const state = {
  uid: null,
  categories: [],
  achievements: [],
  loaded: false,
  openCategory: null,          // id of the category page being shown, or null for the overview
  unsubscribe: null,
  editingAchievement: null,    // the achievement being edited, or null when adding
  editingCategory: null,
  pickedEmoji: '',             // the emoji chosen in the category form
  draft: { photos: [], links: [] },   // photos and links in the achievement form
  processing: 0,               // photos still being prepared
};

export function start(uid) {
  stop();
  state.uid = uid;
  state.loaded = false;
  render();
  state.unsubscribe = store.watchAchievements(uid, ({ categories, achievements }) => {
    state.categories = categories;
    state.achievements = achievements;
    state.loaded = true;
    render();
  }, reportError);
}

export function stop() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.uid = null;
}

// Called whenever the tab is shown or the address changes (e.g. the phone's back button).
export function onShow() {
  closeViewer();
  state.openCategory = routeCategory();
  render();
}

export const getAll = () => store.getAllAchievements(state.uid);
export const count = () => state.achievements.length;

// ---------- Helpers ----------

const plural = (n) => `${n} achievement${n === 1 ? '' : 's'}`;
const sortedCategories = () => [...state.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
const inCategory = (id) => state.achievements
  .filter((a) => (id === '__none' ? !state.categories.some((c) => c.id === a.categoryId) : a.categoryId === id))
  .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
const NO_CATEGORY = { id: '__none', name: 'No category', emoji: '📁', virtual: true };
const findCategory = (id) => (id === '__none' ? NO_CATEGORY : state.categories.find((c) => c.id === id));

// The first character someone types or pastes, but only if it's really an emoji (not "5" or "a").
function firstEmoji(text) {
  const s = text.trim();
  if (!s) return '';
  const first = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter().segment(s)][0].segment : [...s][0];
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(first) ? first : '';
}

// "faceit.com/en/players/me" → "https://faceit.com/en/players/me". Returns null if it isn't a web link.
function normalizeLink(text) {
  let s = text.trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const url = new URL(s);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    return url.href;
  } catch { return null; }
}
const linkLabel = (href) => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return href; } };

// ---------- Overview and category pages ----------

const routeCategory = () => {
  const m = location.hash.match(/^#achievements\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
};

function openCategory(id) {
  history.pushState(null, '', '#achievements/' + encodeURIComponent(id));
  state.openCategory = id;
  render();
  window.scrollTo(0, 0);
}

function backToOverview() {
  if (routeCategory()) history.back();   // same as the phone's back button
  else { state.openCategory = null; render(); }
}

$('#ach-back').addEventListener('click', backToOverview);

function render() {
  const category = state.openCategory && state.loaded ? findCategory(state.openCategory) : null;
  if (state.openCategory && state.loaded && !category) {   // e.g. it was just deleted
    state.openCategory = null;
    if (routeCategory()) history.replaceState(null, '', '#achievements');
  }
  $('#ach-overview').hidden = !!category;
  $('#ach-category-view').hidden = !category;
  if (category) renderCategoryPage(category); else renderOverview();
}

function renderOverview() {
  const total = state.achievements.length;
  $('#ach-subtitle').textContent = !state.loaded ? 'Loading…'
    : total ? `${plural(total)} in ${state.categories.length} categor${state.categories.length === 1 ? 'y' : 'ies'}`
    : 'Big or small, they all count.';

  const list = $('#ach-list');
  if (!state.loaded) { list.innerHTML = '<p class="empty">Loading…</p>'; return; }
  if (!state.categories.length) {
    list.innerHTML = '<div class="card ach-empty"><p>Start by adding a category, like 🎮 Gaming, 💪 Health or 🎓 School. Then add your achievements to it.</p></div>';
    return;
  }
  const card = document.createElement('div');
  card.className = 'card ach-categories';
  const known = new Set(state.categories.map((c) => c.id));
  const categories = sortedCategories();
  if (state.achievements.some((a) => !known.has(a.categoryId))) categories.push(NO_CATEGORY);   // safety net
  for (const cat of categories) {
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'ach-cat-head';
    head.innerHTML = '<span class="ach-emoji"></span><span class="ach-cat-name"></span><span class="ach-count"></span><span class="chev" aria-hidden="true">›</span>';
    head.querySelector('.ach-emoji').textContent = cat.emoji || '🏆';
    head.querySelector('.ach-cat-name').textContent = cat.name;
    head.querySelector('.ach-count').textContent = plural(inCategory(cat.id).length);
    head.addEventListener('click', () => openCategory(cat.id));
    card.append(head);
  }
  list.replaceChildren(card);
}

function renderCategoryPage(cat) {
  const items = inCategory(cat.id);
  $('#cv-emoji').textContent = cat.emoji || '🏆';
  $('#cv-name').textContent = cat.name;
  $('#cv-count').textContent = plural(items.length);
  $('#cv-edit').hidden = !!cat.virtual;
  $('#cv-add').hidden = !!cat.virtual;
  const list = $('#cv-list');
  if (!items.length) {
    list.innerHTML = '<div class="card ach-empty"><p>No achievements here yet.</p></div>';
    return;
  }
  list.replaceChildren(...items.map(renderCard));
}

$('#cv-add').addEventListener('click', () => openAchievementSheet(null, state.openCategory));
$('#cv-edit').addEventListener('click', () => { const c = findCategory(state.openCategory); if (c && !c.virtual) openCategorySheet(c); });

const ICON_EDIT = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_LINK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderCard(a) {
  const card = document.createElement('article');
  card.className = 'card ach-card';
  card.innerHTML = `<div class="ach-card-top"><div class="ach-card-head"><h3 class="ach-title"></h3><div class="ach-date"></div></div>
    <button type="button" class="icon-btn" aria-label="Edit achievement" title="Edit">${ICON_EDIT}</button></div>`;
  card.querySelector('.ach-title').textContent = a.title;
  card.querySelector('.ach-date').textContent = formatDate(a.date);
  card.querySelector('.icon-btn').addEventListener('click', () => openAchievementSheet(a));
  if (a.description) {
    const p = document.createElement('p');
    p.className = 'ach-desc';
    p.textContent = a.description;
    card.append(p);
  }
  const photos = a.photos || [];
  if (photos.length) {
    const grid = document.createElement('div');
    grid.className = `ach-photos n${photos.length}`;
    photos.forEach((ph, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ach-photo';
      b.setAttribute('aria-label', `Open photo ${i + 1} of ${photos.length}`);
      const img = document.createElement('img');
      img.src = ph.thumb;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      b.append(img);
      b.addEventListener('click', () => openViewer(photos, i));
      grid.append(b);
    });
    card.append(grid);
  }
  const links = a.links || [];
  if (links.length) {
    const row = document.createElement('div');
    row.className = 'ach-links';
    for (const href of links) {
      const l = document.createElement('a');
      l.className = 'ach-link';
      l.href = href;
      l.target = '_blank';
      l.rel = 'noopener noreferrer';
      l.title = href;
      l.innerHTML = `${ICON_LINK}<span></span>`;
      l.querySelector('span').textContent = linkLabel(href);
      row.append(l);
    }
    card.append(row);
  }
  return card;
}

// ---------- Full-screen photo viewer ----------

const viewer = $('#photo-viewer');
const fullCache = new Map();          // photo id → full-size image, once loaded
const view = { photos: [], index: 0 };

function openViewer(photos, index) {
  view.photos = photos;
  view.index = index;
  viewer.hidden = false;
  document.body.classList.add('no-scroll');
  showViewerPhoto();
}

function closeViewer() {
  if (viewer.hidden) return;
  viewer.hidden = true;
  document.body.classList.remove('no-scroll');
}

async function showViewerPhoto() {
  const ph = view.photos[view.index];
  const img = $('#viewer-img');
  const many = view.photos.length > 1;
  $('#viewer-prev').hidden = !many;
  $('#viewer-next').hidden = !many;
  $('#viewer-count').textContent = many ? `${view.index + 1} / ${view.photos.length}` : '';
  img.src = fullCache.get(ph.id) || ph.thumb;          // the small version first, sharp one as soon as it's loaded
  img.classList.toggle('loading', !fullCache.has(ph.id));
  if (fullCache.has(ph.id)) return;
  try {
    const full = await store.getAchievementPhoto(state.uid, ph.id);
    if (full) fullCache.set(ph.id, full);
    if (view.photos[view.index]?.id === ph.id && !viewer.hidden) {
      if (full) img.src = full;
      img.classList.remove('loading');
    }
  } catch (err) {
    img.classList.remove('loading');
    console.warn('Could not load the full photo', err);
  }
}

const step = (d) => { view.index = (view.index + d + view.photos.length) % view.photos.length; showViewerPhoto(); };
$('#viewer-prev').addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
$('#viewer-next').addEventListener('click', (e) => { e.stopPropagation(); step(+1); });
$('#viewer-close').addEventListener('click', closeViewer);
viewer.addEventListener('click', (e) => { if (e.target === viewer) closeViewer(); });
// Swipe left/right on a phone.
let swipeX = null;
viewer.addEventListener('pointerdown', (e) => { swipeX = e.clientX; });
viewer.addEventListener('pointerup', (e) => {
  if (swipeX === null || view.photos.length < 2) return;
  const dx = e.clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 50) step(dx < 0 ? +1 : -1);
});
document.addEventListener('keydown', (e) => {
  if (viewer.hidden) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowLeft' && view.photos.length > 1) step(-1);
  if (e.key === 'ArrowRight' && view.photos.length > 1) step(+1);
});

// ---------- Preparing photos (shrunk to a sensible size before saving) ----------

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return createImageBitmap(file); }
}

function toJpeg(bitmap, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';                       // transparent screenshots get a dark background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function preparePhoto(file) {
  const bitmap = await loadBitmap(file);
  let full;
  // Sharp enough to read text in a screenshot, small enough to store: try good quality first.
  for (const [side, q] of [[1600, 0.82], [1600, 0.7], [1280, 0.7], [1024, 0.65], [800, 0.6]]) {
    full = toJpeg(bitmap, side, q);
    if (full.length < MAX_PHOTO_CHARS) break;
  }
  const thumb = toJpeg(bitmap, 480, 0.7);
  bitmap.close?.();
  return { id: crypto.randomUUID(), thumb, full, isNew: true };
}

// ---------- Achievement form ----------

const achSheet = $('#ach-sheet');

$('#ach-add-btn').addEventListener('click', () => openAchievementSheet(null));
$('#cat-add-btn').addEventListener('click', () => openCategorySheet(null));

function openAchievementSheet(achievement, categoryId = null) {
  if (!state.categories.length) {
    toast('Add a category first.');
    openCategorySheet(null);
    return;
  }
  state.editingAchievement = achievement;
  $('#ach-sheet-title').textContent = achievement ? 'Edit achievement' : 'New achievement';
  $('#ach-title').value = achievement?.title || '';
  $('#ach-date').value = achievement?.date || romanianDate();
  $('#ach-date').max = romanianDate();
  const select = $('#ach-category');
  select.replaceChildren(...sortedCategories().map((c) => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.emoji || '🏆'} ${c.name}`;
    return o;
  }));
  const valid = (id) => id && state.categories.some((c) => c.id === id);
  select.value = (valid(achievement?.categoryId) && achievement.categoryId) || (valid(categoryId) && categoryId)
    || (valid(state.openCategory) && state.openCategory) || sortedCategories()[0].id;
  $('#ach-description').value = achievement?.description || '';
  state.draft = {
    photos: (achievement?.photos || []).map((p) => ({ ...p, isNew: false })),
    links: [...(achievement?.links || [])],
  };
  state.processing = 0;
  renderDraftPhotos();
  renderDraftLinks();
  $('#ach-delete').hidden = !achievement;
  $('#ach-sheet-error').textContent = '';
  achSheet.hidden = false;
  if (!achievement) setTimeout(() => $('#ach-title').focus(), 50);
}

const closeAchievementSheet = () => { achSheet.hidden = true; state.editingAchievement = null; };
$('#ach-cancel').addEventListener('click', closeAchievementSheet);
achSheet.addEventListener('click', (e) => { if (e.target === achSheet) closeAchievementSheet(); });

// Photos in the form
function renderDraftPhotos() {
  const box = $('#ach-photo-list');
  const items = state.draft.photos.map((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'draft-photo';
    const img = document.createElement('img');
    img.src = p.thumb;
    img.alt = `Photo ${i + 1}`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'draft-remove';
    rm.setAttribute('aria-label', `Remove photo ${i + 1}`);
    rm.textContent = '✕';
    rm.addEventListener('click', () => { state.draft.photos.splice(i, 1); renderDraftPhotos(); });
    wrap.append(img, rm);
    return wrap;
  });
  for (let i = 0; i < state.processing; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'draft-photo busy';
    wrap.innerHTML = '<div class="spinner small"></div>';
    items.push(wrap);
  }
  box.replaceChildren(...items);
  const full = state.draft.photos.length + state.processing >= MAX_PHOTOS;
  $('#ach-photo-add').hidden = full;
  $('#ach-photo-hint').textContent = full ? `Up to ${MAX_PHOTOS} photos.` : '';
  $('#ach-save').disabled = state.processing > 0;
  $('#ach-save').textContent = state.processing > 0 ? 'Preparing photos…' : 'Save';
}

$('#ach-photo-add').addEventListener('click', () => $('#ach-photo-file').click());
$('#ach-photo-file').addEventListener('change', async (e) => {
  const room = MAX_PHOTOS - state.draft.photos.length - state.processing;
  const files = [...e.target.files].slice(0, Math.max(room, 0));
  if (e.target.files.length > files.length) toast(`Only ${MAX_PHOTOS} photos per achievement.`);
  e.target.value = '';
  state.processing += files.length;
  renderDraftPhotos();
  for (const file of files) {
    try {
      const photo = await preparePhoto(file);
      if (!achSheet.hidden) state.draft.photos.push(photo);
    } catch (err) {
      console.error(err);
      toast("That file couldn't be opened as a photo.");
    } finally {
      state.processing--;
      renderDraftPhotos();
    }
  }
});

// Links in the form
function renderDraftLinks() {
  const box = $('#ach-link-list');
  box.replaceChildren(...state.draft.links.map((value, i) => {
    const row = document.createElement('div');
    row.className = 'draft-link';
    const input = document.createElement('input');
    input.type = 'text';                 // not type="url": that would refuse "faceit.com/…" without https://
    input.inputMode = 'url';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.setAttribute('autocomplete', 'off');
    input.placeholder = 'https://…';
    input.value = value;
    input.setAttribute('aria-label', `Link ${i + 1}`);
    input.addEventListener('input', () => { state.draft.links[i] = input.value; $('#ach-sheet-error').textContent = ''; });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'draft-remove inline';
    rm.setAttribute('aria-label', `Remove link ${i + 1}`);
    rm.textContent = '✕';
    rm.addEventListener('click', () => { state.draft.links.splice(i, 1); renderDraftLinks(); });
    row.append(input, rm);
    return row;
  }));
  $('#ach-link-add').hidden = state.draft.links.length >= MAX_LINKS;
}

$('#ach-link-add').addEventListener('click', () => {
  state.draft.links.push('');
  renderDraftLinks();
  const inputs = document.querySelectorAll('#ach-link-list input');
  inputs[inputs.length - 1].focus();
});

$('#ach-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.processing > 0) return;
  const title = $('#ach-title').value.trim();
  if (!title) { $('#ach-sheet-error').textContent = 'Give it a title.'; $('#ach-title').focus(); return; }
  const links = [];
  for (const raw of state.draft.links) {
    const href = normalizeLink(raw);
    if (href === null) { $('#ach-sheet-error').textContent = `This doesn't look like a web link: ${raw.trim()}`; return; }
    if (href && !links.includes(href)) links.push(href);
  }
  const today = romanianDate();
  const date = $('#ach-date').value && $('#ach-date').value <= today ? $('#ach-date').value : today;
  const editing = state.editingAchievement;
  const achievement = {
    id: editing?.id || crypto.randomUUID(),
    title: title.slice(0, 120),
    date,
    categoryId: $('#ach-category').value,
    description: $('#ach-description').value.trim().slice(0, 2000),
    links,
    photos: state.draft.photos.map(({ id, thumb }) => ({ id, thumb })),
  };
  const addPhotos = state.draft.photos.filter((p) => p.isNew).map(({ id, full }) => ({ id, full }));
  for (const p of addPhotos) fullCache.set(p.id, p.full);
  const removePhotoIds = (editing?.photos || []).map((p) => p.id).filter((id) => !achievement.photos.some((p) => p.id === id));
  closeAchievementSheet();
  store.saveAchievement(state.uid, achievement, !editing, { addPhotos, removePhotoIds }).catch(reportError);
  toast(editing ? 'Saved.' : 'Achievement added.');
  if (state.openCategory !== achievement.categoryId) openCategory(achievement.categoryId);   // show where it went
});

$('#ach-delete').addEventListener('click', () => {
  const a = state.editingAchievement;
  if (!a || !confirm(`Delete "${a.title}"?\n\nThis can't be undone.`)) return;
  closeAchievementSheet();
  store.deleteAchievement(state.uid, a).then(() => toast('Achievement deleted.')).catch(reportError);
});

// ---------- Category form ----------

const catSheet = $('#cat-sheet');

// ---------- Emoji picker (every standard emoji, by group, with search) ----------
// Laid out like a phone keyboard: all groups in one scrolling list, and the tabs jump to a group.
// Jumping is just a scroll, which is fast; emojis out of view aren't drawn until you get to them.
// (Hiding one big group and showing another was what made it feel slow.)

const CHUNK = 40;               // emojis per block (5 rows of 8)
const COLS = 8;
let emojiGroups = null;         // loaded the first time the picker opens
let sections = [];              // one section per group, in order
let filled = [];                // whether a section's emojis have been added yet
let activeGroup = 0;

function setPicked(emoji) {
  state.pickedEmoji = emoji;
  const btn = $('#cat-emoji-btn');
  btn.textContent = emoji || '＋';
  btn.classList.toggle('empty-choice', !emoji);
  for (const el of document.querySelectorAll('.emoji-cell.active')) el.classList.remove('active');
  if (emoji) for (const el of document.querySelectorAll('.emoji-cell')) if (el.textContent === emoji) el.classList.add('active');
}

function makeBlock(items) {
  const block = document.createElement('div');
  block.className = 'emoji-block';
  block.style.containIntrinsicSize = `auto ${Math.ceil(items.length / COLS) * 40}px`;   // exact height before it's drawn
  for (const [emoji, name] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-cell' + (emoji === state.pickedEmoji ? ' active' : '');
    b.textContent = emoji;
    b.title = name;
    block.append(b);
  }
  return block;
}

const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 150 }) : setTimeout(fn, 16));

// Each section is created with its final height straight away, so filling it later never makes the list jump.
function fillSection(i) {
  if (filled[i]) return;
  filled[i] = true;
  const items = emojiGroups[i].emojis;
  const body = sections[i].querySelector('.emoji-section-body');
  for (let n = 0; n < items.length; n += CHUNK) body.append(makeBlock(items.slice(n, n + CHUNK)));
}

function buildSections() {
  const list = $('#emoji-list');
  sections = emojiGroups.map((g) => {
    const s = document.createElement('section');
    s.className = 'emoji-section';
    s.innerHTML = '<h4 class="emoji-section-title"></h4><div class="emoji-section-body"></div>';
    s.querySelector('h4').textContent = g.name;
    s.querySelector('.emoji-section-body').style.minHeight = `${Math.ceil(g.emojis.length / COLS) * 40}px`;
    return s;
  });
  filled = emojiGroups.map(() => false);
  list.replaceChildren(...sections);
  fillSection(0);
  // Fill the rest in the background, one group at a time.
  const next = (i) => { if (i < sections.length) later(() => { fillSection(i); next(i + 1); }); };
  next(1);
}

function jumpTo(i) {
  fillSection(i);
  activeGroup = i;
  highlightTab(i);
  $('#emoji-list').scrollTop = sections[i].offsetTop;
}

function highlightTab(i) {
  document.querySelectorAll('.emoji-tab').forEach((b, n) => b.classList.toggle('active', n === i));
}

// Keep the right tab highlighted while scrolling.
let scrollQueued = false;
$('#emoji-list').addEventListener('scroll', () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const top = $('#emoji-list').scrollTop + 8;
    let current = 0;
    sections.forEach((s, i) => { if (s.offsetTop <= top) current = i; });
    if (current !== activeGroup) { activeGroup = current; highlightTab(current); }
  });
});

async function togglePicker(open = $('#emoji-picker').hidden) {
  $('#emoji-picker').hidden = !open;
  $('#cat-emoji-btn').setAttribute('aria-expanded', open);
  if (!open) return;
  $('#emoji-search').value = '';
  $('#emoji-results').hidden = true;
  if (!emojiGroups) {
    try {
      emojiGroups = (await import('./emoji-data.js')).EMOJI_GROUPS;
    } catch (err) {
      $('#emoji-list').innerHTML = '<p class="empty">Couldn\'t load the emoji list. You can still paste an emoji above.</p>';
      return;
    }
    $('#emoji-tabs').replaceChildren(...emojiGroups.map((g, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-tab';
      b.textContent = g.icon;
      b.title = g.name;
      b.setAttribute('aria-label', g.name);
      b.addEventListener('click', () => {
        $('#emoji-search').value = '';
        $('#emoji-results').hidden = true;
        jumpTo(i);
      });
      return b;
    }));
    buildSections();
    jumpTo(activeGroup);
    if ($('#emoji-search').value) runSearch();   // you started typing while the list was loading
    return;
  }
  jumpTo(activeGroup);
}

$('#emoji-grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.emoji-cell');
  if (!cell) return;
  setPicked(cell.textContent);
  togglePicker(false);
});

// Type to search by name, or paste/type an emoji to use it directly.
function runSearch() {
  const text = $('#emoji-search').value;
  const pasted = firstEmoji(text);
  if (pasted) {
    setPicked(pasted);
    togglePicker(false);
    return;
  }
  if (!emojiGroups) return;              // still loading: runs again as soon as the list arrives
  const q = text.trim().toLowerCase();
  const results = $('#emoji-results');
  if (!q) { results.hidden = true; return; }
  const found = [];
  for (const g of emojiGroups) for (const item of g.emojis) if (item[1].includes(q)) found.push(item);
  results.replaceChildren();
  if (!found.length) results.innerHTML = '<p class="empty">No emoji found.</p>';
  for (let n = 0; n < Math.min(found.length, 400); n += CHUNK) results.append(makeBlock(found.slice(n, Math.min(n + CHUNK, 400))));
  results.hidden = false;
  results.scrollTop = 0;
}
$('#emoji-search').addEventListener('input', runSearch);
$('#emoji-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

$('#cat-emoji-btn').addEventListener('click', () => togglePicker());
$('#emoji-clear').addEventListener('click', () => { setPicked(''); togglePicker(false); });

function openCategorySheet(category) {
  state.editingCategory = category;
  $('#cat-sheet-title').textContent = category ? 'Edit category' : 'New category';
  $('#cat-name').value = category?.name || '';
  setPicked(category?.emoji || '');
  togglePicker(false);
  $('#cat-delete').hidden = !category;
  $('#cat-sheet-error').textContent = '';
  catSheet.hidden = false;
  if (!category) setTimeout(() => $('#cat-name').focus(), 50);
}

const closeCategorySheet = () => { catSheet.hidden = true; state.editingCategory = null; };
$('#cat-cancel').addEventListener('click', closeCategorySheet);
catSheet.addEventListener('click', (e) => { if (e.target === catSheet) closeCategorySheet(); });

$('#cat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#cat-name').value.trim();
  if (!name) { $('#cat-sheet-error').textContent = 'Give the category a name.'; $('#cat-name').focus(); return; }
  const editing = state.editingCategory;
  const category = {
    id: editing?.id || crypto.randomUUID(),
    name: name.slice(0, 40),
    emoji: state.pickedEmoji,
    order: editing?.order ?? Date.now(),
  };
  closeCategorySheet();
  store.saveCategory(state.uid, category, !editing).catch(reportError);
  toast(editing ? 'Saved.' : 'Category added.');
  if (!editing) openCategory(category.id);
});

$('#cat-delete').addEventListener('click', () => {
  const c = state.editingCategory;
  if (!c) return;
  const items = inCategory(c.id);
  const question = items.length
    ? `"${c.name}" has ${plural(items.length)} in it.\n\nDeleting the category also deletes ${items.length === 1 ? 'that achievement' : `all ${items.length} of them`}. This can't be undone.\n\nDelete it anyway?`
    : `Delete the category "${c.name}"?`;
  if (!confirm(question)) return;
  closeCategorySheet();
  if (state.openCategory === c.id) backToOverview();
  store.deleteCategory(state.uid, c.id, items)
    .then(() => toast(items.length ? `Category and ${plural(items.length)} deleted.` : 'Category deleted.'))
    .catch(reportError);
});

// Hide an error message as soon as you start fixing it.
$('#ach-title').addEventListener('input', () => { $('#ach-sheet-error').textContent = ''; });
$('#cat-name').addEventListener('input', () => { $('#cat-sheet-error').textContent = ''; });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!achSheet.hidden) closeAchievementSheet();
  if (!catSheet.hidden) closeCategorySheet();
});
