// utils/parse.js — tiny, local, deterministic text parsing for "الإضافة السريعة".
// No AI, no network. Just regex + keyword heuristics tuned for common Arabic phrasing.

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function normalizeDigits(str) {
  return str.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)));
}

function stripDiacritics(str) {
  return str.replace(/[\u064B-\u065F\u0670]/g, '');
}

const WEEKDAYS = [
  { names: ['الأحد', 'الاحد'], day: 0 },
  { names: ['الإثنين', 'الاثنين', 'الاتنين'], day: 1 },
  { names: ['الثلاثاء', 'التلات', 'الثلاثا'], day: 2 },
  { names: ['الأربعاء', 'الاربعاء', 'الاربع'], day: 3 },
  { names: ['الخميس'], day: 4 },
  { names: ['الجمعة', 'الجمعه'], day: 5 },
  { names: ['السبت'], day: 6 }
];

const MEDICINE_WORDS = ['دواء', 'علاج', 'حبة', 'حبوب', 'قرص', 'دوا', 'شراب', 'كبسول', 'فيتامين'];
const MONEY_WORDS = ['جنيه', 'جنية', 'ج.م', 'ج م', 'egp', 'دولار', '$', 'ريال', 'درهم'];
const MONEY_VERBS = ['ادفع', 'ادفعلي', 'استلم', 'حصل', 'قسط', 'فاتورة', 'دين', 'عليّ', 'عليا', 'علي ', 'ليّ', 'ليا'];
const HABIT_WORDS = ['كل يوم', 'يوميا', 'يوميًا', 'عادة'];

function findTime(text) {
  // matches: 7:30, 7.30, "الساعة 7", "7 مساءً", "8 صباحا", "9م", "9ص"
  const t = normalizeDigits(text);

  let m = t.match(/(\d{1,2})[:.](\d{2})\s*(ص|صباحا|صباحاً|م|مساء|مساءً)?/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const suffix = m[3] || '';
    if (/م|مساء/.test(suffix) && h < 12) h += 12;
    if (/ص|صباح/.test(suffix) && h === 12) h = 0;
    return { hour: h, minute: min, matched: m[0] };
  }

  m = t.match(/(?:الساعة|الساعه|الساعة\s*)\s*(\d{1,2})\s*(ص|صباحا|صباحاً|م|مساء|مساءً)?/);
  if (m) {
    let h = parseInt(m[1], 10);
    const suffix = m[2] || '';
    if (/م|مساء/.test(suffix) && h < 12) h += 12;
    else if (!suffix && h >= 1 && h <= 6) h += 12; // heuristic: bare small hour likely PM (e.g. "الساعة 7")
    if (/ص|صباح/.test(suffix) && h === 12) h = 0;
    return { hour: h, minute: 0, matched: m[0] };
  }

  m = t.match(/(\d{1,2})\s*(ص|صباحا|صباحاً|م|مساء|مساءً)/);
  if (m) {
    let h = parseInt(m[1], 10);
    const suffix = m[2] || '';
    if (/م|مساء/.test(suffix) && h < 12) h += 12;
    if (/ص|صباح/.test(suffix) && h === 12) h = 0;
    return { hour: h, minute: 0, matched: m[0] };
  }

  return null;
}

function findDate(text) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (/بعد بكرة|بعد بكره|بعد غد/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return { date: d, matched: 'بعد بكرة' };
  }
  if (/بكرة|بكره|غدا|غداً/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return { date: d, matched: 'بكرة' };
  }
  if (/النهاردة|النهارده|اليوم/.test(text)) {
    return { date: today, matched: 'اليوم' };
  }

  for (const wd of WEEKDAYS) {
    for (const name of wd.names) {
      if (text.includes(name)) {
        const d = new Date(today);
        const diff = (wd.day - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        return { date: d, matched: name };
      }
    }
  }

  // dd/mm or dd-mm
  const t = normalizeDigits(text);
  const m = t.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : today.getFullYear();
    const d = new Date(year, month, day);
    return { date: d, matched: m[0] };
  }

  return null;
}

function findAmount(text) {
  const t = normalizeDigits(text);
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(جنيه|جنية|ج\.م|ج م|egp|دولار|\$|ريال|درهم)?/i);
  if (m && MONEY_WORDS.some((w) => text.includes(w)) || (m && /\$/.test(text))) {
    return { amount: parseFloat(m[1].replace(',', '.')), matched: m[0] };
  }
  if (m && m[2]) {
    return { amount: parseFloat(m[1].replace(',', '.')), matched: m[0] };
  }
  return null;
}

function detectType(text) {
  if (MEDICINE_WORDS.some((w) => text.includes(w))) return 'medicine';
  if (MONEY_WORDS.some((w) => text.includes(w)) || MONEY_VERBS.some((w) => text.includes(w))) return 'money';
  if (HABIT_WORDS.some((w) => text.includes(w))) return 'habit';
  return 'reminder';
}

function detectRepeat(text) {
  if (/كل يوم|يوميا|يوميًا/.test(text)) return 'daily';
  if (/كل أسبوع|كل اسبوع|أسبوعيا|اسبوعيا/.test(text)) return 'weekly';
  return 'none';
}

function cleanTitle(text, matches) {
  let out = text;
  matches.filter(Boolean).forEach((m) => {
    out = out.replace(m, ' ');
  });
  out = out
    .replace(/كل يوم|يوميا|يوميًا|كل أسبوع|كل اسبوع/g, ' ')
    .replace(/الساعة|الساعه/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || text.trim();
}

/**
 * Parses free text into a best-guess structured suggestion.
 * Never throws; always returns a usable object.
 */
export function parseQuickAdd(rawText) {
  const text = stripDiacritics((rawText || '').trim());
  const type = detectType(text);
  const timeInfo = findTime(text);
  const dateInfo = findDate(text);
  const amountInfo = type === 'money' ? findAmount(text) : null;
  const repeat = detectRepeat(text);

  const title = cleanTitle(text, [
    timeInfo && timeInfo.matched,
    dateInfo && dateInfo.matched,
    amountInfo && amountInfo.matched
  ]);

  const date = dateInfo ? dateInfo.date : new Date(new Date().setHours(0, 0, 0, 0));
  let time = '20:00';
  if (timeInfo) {
    time = String(timeInfo.hour).padStart(2, '0') + ':' + String(timeInfo.minute).padStart(2, '0');
  } else if (repeat === 'daily' && type === 'medicine') {
    time = '09:00';
  }

  return {
    type,
    title: title || 'بدون عنوان',
    date: date.toISOString().slice(0, 10),
    time,
    repeat,
    amount: amountInfo ? amountInfo.amount : null,
    hadTimeGuess: !!timeInfo,
    hadDateGuess: !!dateInfo
  };
}
