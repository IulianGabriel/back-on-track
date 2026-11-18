// Small helpers shared by every tab.

export const TIME_ZONE = 'Europe/Bucharest';

export const $ = (sel, root = document) => root.querySelector(sel);

// Your day starts at 4:00 AM Romanian time, not at midnight, so tasks done after midnight
// still count for the evening before. Change this number to move the reset time.
export const DAY_START_HOUR = 4;

// A date in Romania as "YYYY-MM-DD". With no argument: today, where "today" starts at 4:00 AM.
export function romanianDate(when = new Date(Date.now() - DAY_START_HOUR * 3600_000)) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(when);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Which of "your days" a moment belongs to (a moment at 2:00 AM belongs to the day before).
export const dayOf = (date) => romanianDate(new Date(date.getTime() - DAY_START_HOUR * 3600_000));

// "YYYY-MM-DD" plus/minus a number of days.
export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
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
