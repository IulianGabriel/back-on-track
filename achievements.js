// The Achievements tab: your own categories (name + emoji) and the achievements inside them.
import * as store from './db.js';
import { $, romanianDate, formatDate, toast, reportError } from './util.js';


const state = {
  uid: null,
  categories: [],
  achievements: [],
  loaded: false,
  expanded: new Set(),
  unsubscribe: null,
  editingAchievement: null,   // the achievement being edited, or null when adding
  editingCategory: null,
  pickedEmoji: '',            // the emoji chosen in the category form
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

export const getAll = () => store.getAllAchievements(state.uid);
export const count = () => state.achievements.length;

// ---------- Helpers ----------

const plural = (n) => `${n} achievement${n === 1 ? '' : 's'}`;
const sortedCategories = () => [...state.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
const inCategory = (id) => state.achievements
  .filter((a) => (id === '__none' ? !state.categories.some((c) => c.id === a.categoryId) : a.categoryId === id))
  .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

// The first character someone types or pastes, but only if it's really an emoji (not "5" or "a").
function firstEmoji(text) {
  const s = text.trim();
  if (!s) return '';
  const first = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter().segment(s)][0].segment : [...s][0];
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(first) ? first : '';
}

// ---------- Rendering ----------

function render() {
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
  // Safety net: achievements whose category no longer exists still show up.
  const known = new Set(state.categories.map((c) => c.id));
  const orphans = state.achievements.some((a) => !known.has(a.categoryId));
  const categories = sortedCategories();
  if (orphans) categories.push({ id: '__none', name: 'No category', emoji: '📁', virtual: true });
  for (const cat of categories) {
    const items = inCategory(cat.id);
    const open = state.expanded.has(cat.id);
    const section = document.createElement('div');
    section.className = 'ach-cat' + (open ? ' open' : '');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'ach-cat-head';
    head.setAttribute('aria-expanded', open);
    head.innerHTML = '<span class="ach-emoji"></span><span class="ach-cat-name"></span><span class="ach-count"></span><span class="chev" aria-hidden="true">›</span>';
    head.querySelector('.ach-emoji').textContent = cat.emoji || '🏆';
    head.querySelector('.ach-cat-name').textContent = cat.name;
    head.querySelector('.ach-count').textContent = plural(items.length);
    head.addEventListener('click', () => {
      if (open) state.expanded.delete(cat.id); else state.expanded.add(cat.id);
      render();
    });
    section.append(head);

    if (open) {
      const body = document.createElement('div');
      body.className = 'ach-items';
      if (!items.length) {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = 'No achievements here yet.';
        body.append(p);
      }
      for (const a of items) body.append(renderAchievement(a));
      const tools = document.createElement('div');
      tools.className = 'ach-cat-tools';
      if (!cat.virtual) {
        tools.append(
          linkButton('+ Add achievement', () => openAchievementSheet(null, cat.id)),
          linkButton('Edit category', () => openCategorySheet(cat)),
        );
      }
      body.append(tools);
      section.append(body);
    }
    card.append(section);
  }
  list.replaceChildren(card);
}

function renderAchievement(a) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ach-item';
  b.innerHTML = '<span class="ach-item-top"><span class="ach-title"></span><span class="ach-date"></span></span>';
  b.querySelector('.ach-title').textContent = a.title;
  b.querySelector('.ach-date').textContent = formatDate(a.date, { weekday: false, month: 'short' });
  if (a.description) {
    const d = document.createElement('span');
    d.className = 'ach-desc';
    d.textContent = a.description;
    b.append(d);
  }
  b.addEventListener('click', () => openAchievementSheet(a));
  return b;
}

function linkButton(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
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
  select.value = (valid(achievement?.categoryId) && achievement.categoryId) || (valid(categoryId) && categoryId) || [...state.expanded].find((id) => state.categories.some((c) => c.id === id)) || sortedCategories()[0].id;
  $('#ach-description').value = achievement?.description || '';
  $('#ach-delete').hidden = !achievement;
  $('#ach-sheet-error').textContent = '';
  achSheet.hidden = false;
  if (!achievement) setTimeout(() => $('#ach-title').focus(), 50);
}

const closeAchievementSheet = () => { achSheet.hidden = true; state.editingAchievement = null; };
$('#ach-cancel').addEventListener('click', closeAchievementSheet);
achSheet.addEventListener('click', (e) => { if (e.target === achSheet) closeAchievementSheet(); });

$('#ach-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('#ach-title').value.trim();
  if (!title) { $('#ach-sheet-error').textContent = 'Give it a title.'; $('#ach-title').focus(); return; }
  const today = romanianDate();
  const date = $('#ach-date').value && $('#ach-date').value <= today ? $('#ach-date').value : today;
  const editing = state.editingAchievement;
  const achievement = {
    id: editing?.id || crypto.randomUUID(),
    title: title.slice(0, 120),
    date,
    categoryId: $('#ach-category').value,
    description: $('#ach-description').value.trim().slice(0, 2000),
  };
  closeAchievementSheet();
  state.expanded.add(achievement.categoryId);
  store.saveAchievement(state.uid, achievement, !editing).catch(reportError);
  toast(editing ? 'Saved.' : 'Achievement added.');
});

$('#ach-delete').addEventListener('click', () => {
  const a = state.editingAchievement;
  if (!a || !confirm(`Delete "${a.title}"?\n\nThis can't be undone.`)) return;
  closeAchievementSheet();
  store.deleteAchievement(state.uid, a.id).then(() => toast('Achievement deleted.')).catch(reportError);
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
$('#emoji-search').addEventListener('input', (e) => {
  const text = e.target.value;
  const pasted = firstEmoji(text);
  if (pasted) {
    setPicked(pasted);
    togglePicker(false);
    return;
  }
  if (!emojiGroups) return;
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
});
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
  state.expanded.add(category.id);
  store.saveCategory(state.uid, category, !editing).catch(reportError);
  toast(editing ? 'Saved.' : 'Category added.');
});

$('#cat-delete').addEventListener('click', () => {
  const c = state.editingCategory;
  if (!c) return;
  const items = inCategory(c.id);
  const question = items.length
    ? `"${c.name}" has ${plural(items.length)} in it.\n\nDeleting the category also deletes ${items.length === 1 ? 'that achievement' : `all ${items.length} achievements`} in it. This can't be undone.\n\nDelete it anyway?`
    : `Delete the category "${c.name}"?`;
  if (!confirm(question)) return;
  closeCategorySheet();
  state.expanded.delete(c.id);
  store.deleteCategory(state.uid, c.id, items.map((a) => a.id))
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
