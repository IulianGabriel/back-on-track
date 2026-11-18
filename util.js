// Small helpers shared by every tab.

export const TIME_ZONE = 'Europe/Bucharest';

export const $ = (sel, root = document) => root.querySelector(sel);

// A date in Romania as "YYYY-MM-DD" (today by default).
export function romanianDate(when = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(when);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// "YYYY-MM-DD" → readable text, e.g. "Wednesday 18 November 2026".
// Pass false for a part to leave it out, e.g. { year: false }.
export function formatDate(ymd, { weekday = 'long', day = 'numeric', month = 'long', year = 'numeric' } = {}) {
  const [y, m, d] = ymd.split('-').map(Number);
  const opt = (v) => v || undefined;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: opt(weekday), day: opt(day), month: opt(month), year: opt(year),
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function toast(message, ms = 3000) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

export function reportError(err) {
  console.error(err);
  toast('Something went wrong: ' + (err?.message || err), 6000);
}
