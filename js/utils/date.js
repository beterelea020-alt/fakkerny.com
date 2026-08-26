// utils/date.js — small formatting helpers, Arabic-first, zero dependencies.

export const WEEKDAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const WEEKDAY_SHORT = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
export const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

export function todayStr() {
  return toDateStr(new Date());
}

export function toDateStr(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function isToday(dateStr) {
  return dateStr === todayStr();
}

export function isPast(dateStr) {
  return dateStr < todayStr();
}

export function isFuture(dateStr) {
  return dateStr > todayStr();
}

export function friendlyDate(dateStr) {
  if (isToday(dateStr)) return 'اليوم';
  if (dateStr === addDays(todayStr(), 1)) return 'بكرة';
  if (dateStr === addDays(todayStr(), -1)) return 'أمس';
  const d = parseDateStr(dateStr);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

export function friendlyTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h < 12 ? 'ص' : 'م';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'تصبح على خير 🌙';
  if (h < 12) return 'صباح الخير ☀️';
  if (h < 17) return 'مساء الخير 👋';
  if (h < 21) return 'مساء الخير 🌆';
  return 'مساء الخير 🌙';
}

export function monthGrid(year, month) {
  // returns array of weeks, each week array of { dateStr, inMonth }
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < startOffset; i++) {
    const day = daysInPrevMonth - startOffset + 1 + i;
    const d = new Date(year, month - 1, day);
    cells.push({ dateStr: toDateStr(d), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    cells.push({ dateStr: toDateStr(d), inMonth: true });
  }
  while (cells.length % 7 !== 0 || cells.length < 35) {
    const last = parseDateStr(cells[cells.length - 1].dateStr);
    last.setDate(last.getDate() + 1);
    cells.push({ dateStr: toDateStr(last), inMonth: false });
    if (cells.length >= 42) break;
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Computes current consecutive-day streak ending today or yesterday from a sorted list of yyyy-mm-dd strings. */
export function computeStreak(doneDates) {
  if (!doneDates || doneDates.length === 0) return 0;
  const set = new Set(doneDates);
  let streak = 0;
  let cursor = set.has(todayStr()) ? todayStr() : addDays(todayStr(), -1);
  if (!set.has(cursor)) return 0;
  while (set.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
