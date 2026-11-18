// The Achievements tab: your own categories (name + emoji) and the achievements inside them.
import * as store from './db.js';
import { $, romanianDate, formatDate, toast, reportError } from './util.js';

const QUICK_EMOJI = ['🏆', '⭐', '💪', '🏃', '🧠', '🎓', '📚', '💼', '💰', '🎮', '🎨', '🎵', '❤️', '🌱', '🍳', '✈️'];

const state = {
  uid: null,
  categories: [],
  achievements: [],
  loaded: false,
  expanded: new Set(),
  unsubscribe: null,
  editingAchievement: null,   // the achievement being edited, or null when adding
  editingCategory: null,
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

// Keep just the first emoji someone types or pastes.
function firstEmoji(text) {
  const s = text.trim();
  if (!s) return '';
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter().segment(s)][0].segment;
  return [...s][0];
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

$('#cat-emoji-picks').append(...QUICK_EMOJI.map((emoji) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'emoji-pick';
  b.textContent = emoji;
  b.addEventListener('click', () => { $('#cat-emoji').value = emoji; updatePicks(); });
  return b;
}));

function updatePicks() {
  const current = firstEmoji($('#cat-emoji').value);
  for (const b of document.querySelectorAll('.emoji-pick')) b.classList.toggle('active', b.textContent === current);
}
$('#cat-emoji').addEventListener('input', updatePicks);

function openCategorySheet(category) {
  state.editingCategory = category;
  $('#cat-sheet-title').textContent = category ? 'Edit category' : 'New category';
  $('#cat-name').value = category?.name || '';
  $('#cat-emoji').value = category?.emoji || '';
  $('#cat-delete').hidden = !category;
  $('#cat-sheet-error').textContent = '';
  updatePicks();
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
    emoji: firstEmoji($('#cat-emoji').value),
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
  const n = inCategory(c.id).length;
  if (n) {
    $('#cat-sheet-error').textContent = `This category still has ${plural(n)}. Move them to another category or delete them first.`;
    return;
  }
  if (!confirm(`Delete the category "${c.name}"?`)) return;
  closeCategorySheet();
  state.expanded.delete(c.id);
  store.deleteCategory(state.uid, c.id).then(() => toast('Category deleted.')).catch(reportError);
});

// Hide an error message as soon as you start fixing it.
$('#ach-title').addEventListener('input', () => { $('#ach-sheet-error').textContent = ''; });
$('#cat-name').addEventListener('input', () => { $('#cat-sheet-error').textContent = ''; });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!achSheet.hidden) closeAchievementSheet();
  if (!catSheet.hidden) closeCategorySheet();
});
