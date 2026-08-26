// features/render.js — pure-ish functions that turn state + storage into HTML strings.
import { Reminders, Medicine, Money, Habits, HabitLogs, Notes, Settings } from '../storage/db.js';
import {
  todayStr, friendlyDate, friendlyTime, greeting, monthGrid,
  computeStreak, WEEKDAY_SHORT, MONTH_NAMES, parseDateStr, toDateStr
} from '../utils/date.js';
import { PRESETS } from '../core/theme-manager.js';
import { APP_CONFIG } from '../config.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function emptyState({ emoji, msg, sub, btnLabel, btnAction }) {
  return `
    <div class="empty-state">
      <span class="emoji">${emoji}</span>
      <div class="msg">${esc(msg)}</div>
      <div class="sub">${esc(sub)}</div>
      ${btnLabel ? `<button class="btn btn-primary" data-action="${btnAction}">${esc(btnLabel)}</button>` : ''}
    </div>`;
}

function checkbox(checked, action, id, label) {
  return `<div class="checkbox ${checked ? 'checked' : ''}" data-action="${action}" data-id="${id}" role="checkbox" aria-checked="${checked ? 'true' : 'false'}" aria-label="${esc(label)}" tabindex="0">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>
  </div>`;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export function renderDashboard() {
  const today = todayStr();
  const reminders = Reminders.all().filter((r) => r.date === today);
  const medicine = Medicine.all(); // daily meds always show today
  const money = Money.all().filter((m) => m.dueDate === today && m.status !== 'paid');
  const habits = Habits.all().filter((h) => (h.days || []).length === 0 || (h.days || []).includes(new Date().getDay()));

  const items = [];
  reminders.forEach((r) => items.push({ kind: 'reminder', id: r.id, time: r.time || '23:59', title: r.title, emoji: '⏰', completed: !!r.completed }));
  medicine.forEach((m) => items.push({ kind: 'medicine', id: m.id, time: m.time || '23:59', title: m.name, emoji: '💊', completed: !!m.completed && m._completedDate === today }));
  money.forEach((m) => items.push({ kind: 'money', id: m.id, time: '20:00', title: `${m.type === 'owe' ? 'ادفع' : 'استلم'} ${m.title}`, emoji: '💰', completed: m.status === 'paid' }));
  habits.forEach((h) => items.push({ kind: 'habit', id: h.id, time: h.time || '20:00', title: h.title, emoji: '🔁', completed: HabitLogs.isDone(h.id, today) }));

  items.sort((a, b) => a.time.localeCompare(b.time));

  const total = items.length;
  const done = items.filter((i) => i.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const summary = `
    <div class="summary-card">
      <div class="label">اليوم</div>
      <div class="stats">
        <div class="stat"><b>${reminders.length}</b><span>تذكيرات</span></div>
        <div class="stat"><b>${habits.length}</b><span>عادات</span></div>
        <div class="stat"><b>${money.length}</b><span>ماليات</span></div>
        <div class="stat"><b>${medicine.length}</b><span>أدوية</span></div>
      </div>
      ${total ? `
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-pct">${done} من ${total} خلصانين — ${pct}%</div>
      ` : ''}
    </div>`;

  let timeline;
  if (items.length === 0) {
    timeline = emptyState({
      emoji: '☕',
      msg: 'مفيش حاجة مهمة دلوقتي',
      sub: 'أضف أول تذكير وخلي التطبيق يفتكره معاك.',
      btnLabel: 'إضافة',
      btnAction: 'open-quick-add'
    });
  } else {
    timeline = `<div class="timeline">` + items.map((it, i) => `
      <div class="timeline-item ${it.completed ? 'completed' : ''}" style="animation-delay:${i * 35}ms" data-action="open-item" data-kind="${it.kind}" data-id="${it.id}" role="button" tabindex="0" aria-label="${esc(it.title)}, ${friendlyTime(it.time)}${it.completed ? ', تم' : ''}">
        <div class="timeline-node">
          <div class="timeline-time">${friendlyTime(it.time)}</div>
          <div class="timeline-dot"></div>
        </div>
        <div class="timeline-card">
          <span class="item-emoji" aria-hidden="true">${it.emoji}</span>
          <div class="row-body">
            <div class="item-title">${esc(it.title)}</div>
          </div>
        </div>
      </div>`).join('') + `</div>`;
  }

  return `
    <div class="greeting">
      <div class="hello">${greeting()}</div>
      <div class="sub">إيه المهم النهارده؟</div>
    </div>
    ${summary}
    <div class="section-title">جدول اليوم</div>
    ${timeline}
  `;
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                   */
/* -------------------------------------------------------------------------- */

const FILTER_LABELS = { today: 'اليوم', upcoming: 'قادمة', completed: 'مكتملة', overdue: 'متأخرة', all: 'الكل' };

function applyFilter(list, filter, dateField = 'date', completedField = 'completed') {
  const today = todayStr();
  switch (filter) {
    case 'today': return list.filter((x) => x[dateField] === today);
    case 'upcoming': return list.filter((x) => x[dateField] > today && !x[completedField]);
    case 'completed': return list.filter((x) => x[completedField]);
    case 'overdue': return list.filter((x) => x[dateField] < today && !x[completedField]);
    default: return list;
  }
}

export function renderFilterRow(filter, options = ['all', 'today', 'upcoming', 'overdue', 'completed']) {
  return `<div class="filter-row">` + options.map((f) => `
    <button class="filter-chip ${filter === f ? 'active' : ''}" data-action="set-filter" data-filter="${f}">${FILTER_LABELS[f]}</button>
  `).join('') + `</div>`;
}

export function renderReminders(filter, search) {
  let list = Reminders.all().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (search) list = list.filter((r) => r.title.toLowerCase().includes(search.toLowerCase()));
  else list = applyFilter(list, filter);

  const body = list.length === 0
    ? emptyState({ emoji: '⏰', msg: 'مفيش تذكيرات', sub: 'أضف أول تذكير وخلي فكرني يفتكره معاك.', btnLabel: 'إضافة تذكير', btnAction: 'open-quick-add-reminder' })
    : list.map((r) => `
      <div class="list-row" data-action="open-item" data-kind="reminder" data-id="${r.id}" role="button" tabindex="0" aria-label="${esc(r.title)}">
        ${checkbox(r.completed, 'toggle-reminder', r.id, r.title)}
        <div class="row-body">
          <div class="row-title ${r.completed ? 'done' : ''}">${esc(r.title)}</div>
          <div class="row-meta">
            <span>${friendlyDate(r.date)}</span>
            ${r.time ? `<span>· ${friendlyTime(r.time)}</span>` : ''}
            ${r.repeat && r.repeat !== 'none' ? `<span class="pill">تكرار</span>` : ''}
            ${!r.completed && r.date < todayStr() ? `<span class="pill danger">متأخر</span>` : ''}
          </div>
        </div>
      </div>`).join('');

  return `
    <div class="search-wrap">
      <input class="search-input" type="text" placeholder="بحث في التذكيرات..." data-role="search-input" value="${esc(search || '')}">
      <span class="search-icon">🔍</span>
    </div>
    ${search ? '' : renderFilterRow(filter)}
    <div class="card" style="padding:4px 14px;">${body}</div>
  `;
}

/* -------------------------------------------------------------------------- */
/* Medicine                                                                    */
/* -------------------------------------------------------------------------- */

export function renderMedicine() {
  const list = Medicine.all().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const today = todayStr();
  const body = list.length === 0
    ? emptyState({ emoji: '💊', msg: 'مفيش أدوية مسجلة', sub: 'أضف دوائك عشان فكرني يفكرك في معاده.', btnLabel: 'إضافة دواء', btnAction: 'open-quick-add-medicine' })
    : list.map((m) => {
      const doneToday = m.completed && m._completedDate === today;
      return `
      <div class="list-row" data-action="open-item" data-kind="medicine" data-id="${m.id}" role="button" tabindex="0" aria-label="${esc(m.name)}">
        ${checkbox(doneToday, 'toggle-medicine', m.id, m.name)}
        <div class="row-body">
          <div class="row-title ${doneToday ? 'done' : ''}">${esc(m.name)}</div>
          <div class="row-meta">
            <span>${esc(m.dosage || '')}</span>
            ${m.time ? `<span>· ${friendlyTime(m.time)}</span>` : ''}
            <span class="pill">${m.repeat === 'daily' ? 'يوميًا' : 'مرة واحدة'}</span>
          </div>
        </div>
      </div>`;
    }).join('');

  return `<div class="card" style="padding:4px 14px;">${body}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

export function renderMoney() {
  const list = Money.all();
  const owedToMe = list.filter((m) => m.type === 'owed' && m.status !== 'paid').reduce((s, m) => s + Number(m.amount || 0), 0);
  const iOwe = list.filter((m) => m.type === 'owe' && m.status !== 'paid').reduce((s, m) => s + Number(m.amount || 0), 0);

  const now = new Date();
  const thisMonth = list.filter((m) => {
    if (!m.dueDate) return false;
    const d = parseDateStr(m.dueDate);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).reduce((s, m) => s + Number(m.amount || 0), 0);

  const grid = `
    <div class="money-grid">
      <div class="money-tile owed-to-me"><div class="m-label">ليّ</div><div class="m-value">${owedToMe.toLocaleString('ar-EG')} ج.م</div></div>
      <div class="money-tile i-owe"><div class="m-label">عليّ</div><div class="m-value">${iOwe.toLocaleString('ar-EG')} ج.م</div></div>
      <div class="money-tile money-month-tile card" style="background:var(--card);">
        <div><div class="m-label">هذا الشهر</div><div class="m-value">${thisMonth.toLocaleString('ar-EG')} ج.م</div></div>
        <span style="font-size:26px;">📅</span>
      </div>
    </div>`;

  const sorted = list.slice().sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const body = sorted.length === 0
    ? emptyState({ emoji: '💰', msg: 'مفيش حاجة مسجلة', sub: 'سجّل أول عملية مالية تحب فكرني يفكرك بيها.', btnLabel: 'إضافة', btnAction: 'open-quick-add-money' })
    : sorted.map((m) => `
      <div class="list-row" data-action="open-item" data-kind="money" data-id="${m.id}" role="button" tabindex="0" aria-label="${esc(m.title)}">
        ${checkbox(m.status === 'paid', 'toggle-money', m.id, m.title)}
        <div class="row-body">
          <div class="row-title ${m.status === 'paid' ? 'done' : ''}">${esc(m.title)}</div>
          <div class="row-meta">
            <span class="pill ${m.type === 'owe' ? 'danger' : 'success'}">${m.type === 'owe' ? 'عليّ' : 'ليّ'} ${Number(m.amount || 0).toLocaleString('ar-EG')} ج.م</span>
            ${m.dueDate ? `<span>${friendlyDate(m.dueDate)}</span>` : ''}
          </div>
        </div>
      </div>`).join('');

  return `
    ${grid}
    <div class="section-title">كل العمليات</div>
    <div class="card" style="padding:4px 14px;">${body}</div>
  `;
}

/* -------------------------------------------------------------------------- */
/* Habits                                                                      */
/* -------------------------------------------------------------------------- */

export function renderHabits() {
  const list = Habits.all();
  if (list.length === 0) {
    return emptyState({ emoji: '🔁', msg: 'مفيش عادات لسه', sub: 'ابدأ عادة جديدة وتابع الاستمرارية يوم بيوم.', btnLabel: 'إضافة عادة', btnAction: 'open-quick-add-habit' });
  }
  const today = todayStr();
  return list.map((h) => {
    const days = HabitLogs.daysFor(h.id);
    const streak = computeStreak(days);
    const doneToday = HabitLogs.isDone(h.id, today);
    const pct = Math.min(100, streak * 8);
    return `
      <div class="card habit-card" data-action="open-item" data-kind="habit" data-id="${h.id}" role="button" tabindex="0" aria-label="${esc(h.title)}, ${streak} يوم متتالي">
        <div class="habit-info">
          <span class="row-title">${esc(h.title)}</span>
          <div class="habit-bar-track"><div class="habit-bar-fill" style="width:${pct}%"></div></div>
          <div class="habit-streak" aria-hidden="true">🔥 ${streak} يوم متتالي</div>
        </div>
        <button class="habit-done-btn ${doneToday ? 'done' : ''}" data-action="toggle-habit" data-id="${h.id}" aria-label="تسجيل ${esc(h.title)} اليوم">${doneToday ? '✓' : '+'}</button>
      </div>`;
  }).join('');
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                       */
/* -------------------------------------------------------------------------- */

export function renderNotes(search) {
  let list = Notes.all().sort((a, b) => b.createdAt - a.createdAt);
  if (search) list = list.filter((n) => (n.title + n.content).toLowerCase().includes(search.toLowerCase()));

  if (list.length === 0) {
    return `
      <div class="search-wrap">
        <input class="search-input" type="text" placeholder="بحث في الملاحظات..." data-role="search-input" value="${esc(search || '')}">
        <span class="search-icon">🔍</span>
      </div>
      ${emptyState({ emoji: '📝', msg: 'مفيش ملاحظات', sub: 'دوّن أول فكرة أو حاجة مهمة تحب تفتكرها.', btnLabel: 'إضافة ملاحظة', btnAction: 'open-quick-add-note' })}
    `;
  }

  const body = list.map((n) => `
    <div class="card note-card" data-action="open-item" data-kind="note" data-id="${n.id}" role="button" tabindex="0" aria-label="${esc(n.title || 'ملاحظة')}">
      <span class="row-title">${esc(n.title || 'ملاحظة')}</span>
      <div class="note-preview">${esc(n.content || '')}</div>
      <div class="note-date">${friendlyDate(toDateStr(new Date(n.createdAt)))}</div>
    </div>`).join('');

  return `
    <div class="search-wrap">
      <input class="search-input" type="text" placeholder="بحث في الملاحظات..." data-role="search-input" value="${esc(search || '')}">
      <span class="search-icon">🔍</span>
    </div>
    ${body}
  `;
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                    */
/* -------------------------------------------------------------------------- */

function eventsForDate(dateStr) {
  const out = [];
  Reminders.all().forEach((r) => { if (r.date === dateStr) out.push({ kind: 'reminder', emoji: '⏰', title: r.title, time: r.time, id: r.id }); });
  Money.all().forEach((m) => { if (m.dueDate === dateStr) out.push({ kind: 'money', emoji: '💰', title: m.title, time: null, id: m.id }); });
  if (Medicine.all().length && dateStr === todayStr()) {
    Medicine.all().forEach((m) => out.push({ kind: 'medicine', emoji: '💊', title: m.name, time: m.time, id: m.id }));
  }
  return out.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

export function renderCalendar(year, month, selectedDate) {
  const weeks = monthGrid(year, month);
  const today = todayStr();

  const head = `
    <div class="calendar-head">
      <button class="icon-btn" data-action="cal-prev" aria-label="الشهر السابق">‹</button>
      <h2>${MONTH_NAMES[month]} ${year}</h2>
      <button class="icon-btn" data-action="cal-next" aria-label="الشهر التالي">›</button>
    </div>`;

  const weekdays = `<div class="calendar-weekdays">${WEEKDAY_SHORT.map((w) => `<span>${w[0]}</span>`).join('')}</div>`;

  const grid = `<div class="calendar-grid">` + weeks.flat().map((cell) => {
    const evts = eventsForDate(cell.dateStr);
    const classes = ['cal-cell'];
    if (!cell.inMonth) classes.push('out');
    if (cell.dateStr === today) classes.push('today');
    if (cell.dateStr === selectedDate) classes.push('selected');
    const day = parseDateStr(cell.dateStr).getDate();
    const evtLabel = evts.length ? `، ${evts.length} ${evts.length === 1 ? 'حدث' : 'أحداث'}` : '';
    return `<div class="${classes.join(' ')}" data-action="cal-select" data-date="${cell.dateStr}" role="button" tabindex="0" aria-label="${day}${evtLabel}">
      <span>${day}</span>
      ${evts.length ? `<div class="dot-row" aria-hidden="true">${evts.slice(0, 3).map(() => '<span class="evt-dot"></span>').join('')}</div>` : ''}
    </div>`;
  }).join('') + `</div>`;

  const dayEvents = eventsForDate(selectedDate);
  const eventsHtml = dayEvents.length === 0
    ? emptyState({ emoji: '📅', msg: 'مفيش حاجة في اليوم ده', sub: '', btnLabel: '', btnAction: '' })
    : `<div class="card" style="padding:4px 14px;">` + dayEvents.map((e) => `
        <div class="list-row" data-action="open-item" data-kind="${e.kind}" data-id="${e.id}" role="button" tabindex="0" aria-label="${esc(e.title)}">
          <span class="item-emoji" aria-hidden="true">${e.emoji}</span>
          <div class="row-body">
            <div class="row-title">${esc(e.title)}</div>
            ${e.time ? `<div class="row-meta">${friendlyTime(e.time)}</div>` : ''}
          </div>
        </div>`).join('') + `</div>`;

  return `
    <div class="card">${head}${weekdays}${grid}</div>
    <div class="calendar-day-events">
      <div class="section-title">${friendlyDate(selectedDate)}</div>
      ${eventsHtml}
    </div>
  `;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export function renderSettings() {
  const s = Settings.get();
  const notifSupported = 'Notification' in window;
  const activePreset = s.themePreset || 'default';

  const modeBtn = (mode, label) =>
    `<button type="button" class="${s.theme === mode ? 'selected' : ''}" data-action="set-theme-mode" data-mode="${mode}" aria-pressed="${s.theme === mode}">${label}</button>`;

  const presetSwatches = PRESETS.map((p) => `
    <button type="button" class="swatch-btn ${activePreset === p.id ? 'selected' : ''}" data-action="set-theme-preset" data-preset="${p.id}" aria-pressed="${activePreset === p.id}" aria-label="${esc(p.name)}" title="${esc(p.name)}">
      <span class="swatch-fill" style="background:${p.hex}"></span>
    </button>`).join('');

  const customHex = activePreset === 'custom' && s.themeCustomColor ? s.themeCustomColor : null;

  return `
    <div class="settings-group-title">المظهر</div>
    <div class="card" style="padding:16px;">
      <div class="lbl" style="margin-bottom:8px;">الوضع</div>
      <div class="segmented" role="group" aria-label="وضع العرض">
        ${modeBtn('light', '☀️ فاتح')}
        ${modeBtn('dark', '🌙 غامق')}
        ${modeBtn('system', '🌓 تلقائي')}
      </div>

      <div class="lbl" style="margin-top:20px;margin-bottom:2px;">لون التطبيق</div>
      <div class="desc" style="margin-bottom:2px;">اختار اللون اللي يريحك</div>
      <div class="swatch-row">
        ${presetSwatches}
        <label class="swatch-btn custom-swatch ${activePreset === 'custom' ? 'selected' : ''}" title="لون مخصص" aria-label="لون مخصص">
          <span class="swatch-fill" style="${customHex ? `background:${customHex}` : 'background:var(--bg);border:1px dashed var(--border);'}">${customHex ? '' : '🎨'}</span>
          <input type="color" id="custom-color-input" value="${customHex || '#5B6EF5'}" aria-label="اختيار لون مخصص">
        </label>
      </div>
      ${activePreset !== 'default' ? `<button type="button" class="appearance-reset" data-action="reset-theme">إعادة المظهر الافتراضي</button>` : ''}
    </div>

    <div class="settings-group-title">الإشعارات</div>
    <div class="card" style="padding:4px 14px;">
      <div class="switch-row">
        <div><div class="lbl">تفعيل الإشعارات</div><div class="desc">${notifSupported ? 'هتوصلك تنبيهات بمواعيدك' : 'غير مدعوم على هذا الجهاز'}</div></div>
        <button class="switch ${s.notificationsEnabled ? 'on' : ''}" data-action="toggle-notifications" ${!notifSupported ? 'disabled' : ''}></button>
      </div>
      <div class="switch-row">
        <div><div class="lbl">نغمة تنبيه صوتية</div><div class="desc">صوت واضح لما يجيلك تذكير والتطبيق شغال أو مفتوح في الخلفية</div></div>
        <button class="switch ${s.notificationSound !== false ? 'on' : ''}" data-action="toggle-notification-sound" ${!s.notificationsEnabled ? 'disabled' : ''}></button>
      </div>
      ${APP_CONFIG.push && APP_CONFIG.push.vapidPublicKey ? `
      <div class="switch-row">
        <div><div class="lbl">تذكيرات حتى لو التطبيق مقفول (Beta)</div><div class="desc">بيبعت وقت وعنوان التذكير فقط لسيرفرنا عشان يوصّلك الإشعار حتى لو التطبيق مش فاتح. اقرأ خصوصيتك تحت.</div></div>
        <button class="switch ${s.pushSyncEnabled ? 'on' : ''}" data-action="toggle-push-sync"></button>
      </div>` : ''}
    </div>

    <div class="settings-group-title">خصوصيتك</div>
    <div class="card" style="padding:16px;">
      <p style="font-size:13.5px;color:var(--text-secondary);line-height:1.7;">
        بياناتك (الأدوية، الفلوس، الملاحظات، العادات) محفوظة على جهازك فقط ولا تتحرك منه أبدًا. فكرني تطبيق بدون إنترنت وبدون حساب.
        ${APP_CONFIG.push && APP_CONFIG.push.vapidPublicKey ? 'الاستثناء الوحيد: لو فعّلت "تذكيرات حتى لو التطبيق مقفول" فوق، بيتبعت لسيرفرنا وقت وعنوان التذكير بس (مش الأدوية أو الفلوس أو الملاحظات) عشان يقدر يوصّلك إشعار — وده اختياري بالكامل وتقدر تقفله في أي وقت.' : ''}
      </p>
    </div>

    <div class="settings-group-title">النسخ الاحتياطي</div>
    <div class="card" style="padding:4px 14px;">
      <div class="list-row" data-action="export-data" role="button" tabindex="0" aria-label="تصدير البيانات، حفظ نسخة JSON على جهازك"><span class="item-emoji" aria-hidden="true">⬇️</span><div class="row-body"><div class="row-title">تصدير البيانات (Backup)</div><div class="row-meta">حفظ نسخة JSON على جهازك</div></div><span class="chevron" aria-hidden="true">‹</span></div>
      <div class="list-row" data-action="import-data" role="button" tabindex="0" aria-label="استيراد البيانات، استرجاع نسخة سابقة"><span class="item-emoji" aria-hidden="true">⬆️</span><div class="row-body"><div class="row-title">استيراد البيانات (Restore)</div><div class="row-meta">استرجاع نسخة سابقة</div></div><span class="chevron" aria-hidden="true">‹</span></div>
      <div class="list-row" data-action="clear-data" role="button" tabindex="0" aria-label="مسح كل البيانات، إجراء لا يمكن التراجع عنه"><span class="item-emoji" aria-hidden="true">🗑️</span><div class="row-body"><div class="row-title" style="color:var(--danger);">مسح كل البيانات</div><div class="row-meta">إجراء لا يمكن التراجع عنه</div></div><span class="chevron" aria-hidden="true">‹</span></div>
    </div>

    <div class="settings-group-title">المساعدة</div>
    <div class="card" style="padding:16px 14px 14px;">
      <div class="desc" style="line-height:1.7;">فكّرني بيتطور مع مستخدميه. كل فكرة أو ملاحظة بتساعدنا نخليه أفضل.</div>
      <div class="help-actions">
        <div class="list-row" data-action="feedback-bug" role="button" tabindex="0" aria-label="بلغ عن مشكلة عبر واتساب"><span class="item-emoji" aria-hidden="true">🐞</span><div class="row-body"><div class="row-title">بلغ عن مشكلة</div></div><span class="chevron" aria-hidden="true">‹</span></div>
        <div class="list-row" data-action="feedback-feature" role="button" tabindex="0" aria-label="اقترح ميزة عبر واتساب"><span class="item-emoji" aria-hidden="true">💡</span><div class="row-body"><div class="row-title">اقترح ميزة</div></div><span class="chevron" aria-hidden="true">‹</span></div>
        <div class="list-row" data-action="feedback-review" role="button" tabindex="0" aria-label="شارك رأيك عبر واتساب"><span class="item-emoji" aria-hidden="true">💬</span><div class="row-body"><div class="row-title">شارك رأيك</div></div><span class="chevron" aria-hidden="true">‹</span></div>
      </div>
    </div>

    <div class="settings-group-title">عن فكرني</div>
    <div class="card" style="padding:4px 14px;">
      <div class="list-row" data-nav="about" role="button" tabindex="0" aria-label="عن فكّرني، القصة والمطور"><span class="item-emoji" aria-hidden="true">🧠</span><div class="row-body"><div class="row-title">عن فكّرني</div><div class="row-meta">القصة، المطور، وتواصل معايا</div></div><span class="chevron" aria-hidden="true">‹</span></div>
    </div>
  `;
}

export function renderAbout() {
  const dev = APP_CONFIG.developer;
  const links = dev.links || {};

  const socialLink = (label, emoji, url) =>
    url ? `<a class="social-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">${emoji}</span> ${label}</a>` : '';

  return `
    <button type="button" class="about-back" data-nav="settings"><span aria-hidden="true">‹</span> الإعدادات</button>

    <div class="about-header">
      <span class="badge-free">✓ مجاني</span>
      <h2>عن فكّرني</h2>
      <div class="sub">فكّرني تطبيق مجاني هدفه مساعدة الناس، وما زال يتطور مع الوقت.</div>
    </div>

    <div class="card" style="padding:4px 18px;">
      <div class="story-step">
        <div class="story-num">01</div>
        <div class="story-body">
          <h3>الفكرة</h3>
          <p>بصراحة، فكرة فكّرني ما بدأتش من مشروع كبير أو خطة إني أعمل تطبيق وأشهره.
بدأت من حاجة أبسط من كده بكتير.</p>
        </div>
      </div>
      <div class="about-divider"></div>
      <div class="story-step">
        <div class="story-num">02</div>
        <div class="story-body">
          <h3>المشكلة</h3>
          <p>كنت بفكر في الناس اللي حواليا، أهلي، صحابي، وكل واحد فينا عنده حاجات كتير لازم يفتكرها كل يوم.
ميعاد، دوا، فلوس، عادة، حاجة لازم يعملها، أو حتى ملاحظة صغيرة.

وسألت نفسي: ليه ما يكونش فيه مكان بسيط جدًا أكتب فيه الحاجة دي، وهو يفتكرها معايا؟
ومن هنا بدأت فكرة فكّرني.</p>
        </div>
      </div>
      <div class="about-divider"></div>
      <div class="story-step">
        <div class="story-num">03</div>
        <div class="story-body">
          <h3>التحدي</h3>
          <p>وأنا بعمل الموقع، قابلتني مشاكل وتفاصيل أكتر مما كنت متخيل.
كنت عايز التطبيق يكون بسيط جدًا، لكن في نفس الوقت يكون مفيد فعلًا.

كنت بفكر: إزاي أخلي المستخدم يضيف حاجة في ثواني؟ إزاي أخليه يفتكرها في الوقت الصح؟
إزاي أخلي الموقع يشتغل كويس على الموبايل والتابلت واللاب توب، من غير حسابات ومن غير ما أطلب بيانات مش محتاجها؟</p>
        </div>
      </div>
      <div class="about-divider"></div>
      <div class="story-step">
        <div class="story-num">04</div>
        <div class="story-body">
          <h3>التطوير</h3>
          <p>أكتر تحدي واجهني كان إني ما أعقدش الحاجة وأنا بحاول أخليها مفيدة.
كل مرة كنت أضيف فكرة، كنت بسأل نفسي: هل دي فعلًا هتساعد المستخدم؟ ولا أنا بزود حاجة وخلاص؟</p>
        </div>
      </div>
      <div class="about-divider"></div>
      <div class="story-step">
        <div class="story-num">05</div>
        <div class="story-body">
          <h3>اليوم</h3>
          <p>دلوقتي فكّرني بقى تطبيق تقدر تفتحه من غير إنترنت ومن غير حساب، وتلاقي فيه حاجتك.
لسه بيتطور خطوة بخطوة، بنفس الفكرة اللي بدأ بيها: مكان بسيط يفتكر معاك.</p>
        </div>
      </div>
    </div>

    <div class="about-section">
      <h3>ليه فكّرني مجاني؟</h3>
      <p>لأن الهدف من البداية ما كانش إني أعمل تطبيق وخلاص.
أنا عملته علشان أستخدمه أنا، ويستخدمه أهلي وصحابي، وبعد كده أي حد ممكن يحتاجه.
وعايز أفضل أطور فيه بناءً على الناس اللي بتستخدمه فعلًا.

علشان كده: فكّرني مجاني. ومش مهم عندي إن التطبيق يبقى كبير من أول يوم. المهم إنه يكون مفيد.</p>
    </div>

    <div class="about-divider"></div>

    <div class="about-section">
      <h3>ساعدني أطوّره</h3>
      <p>أنا مؤمن إن أفضل طريقة لتطوير أي حاجة هي إنك تسمع الناس اللي بتستخدمها.
علشان كده في فكّرني هتلاقي طرق تبلغ بيها عن مشكلة، أو تقترح ميزة، أو تشاركني رأيك — لأن ممكن تكون عندك فكرة أنا ما فكرتش فيها أصلًا.</p>
      <div class="help-actions">
        <div class="list-row" data-action="feedback-bug" role="button" tabindex="0" aria-label="بلغ عن مشكلة عبر واتساب"><span class="item-emoji" aria-hidden="true">🐞</span><div class="row-body"><div class="row-title">بلغ عن مشكلة</div></div><span class="chevron" aria-hidden="true">‹</span></div>
        <div class="list-row" data-action="feedback-feature" role="button" tabindex="0" aria-label="اقترح ميزة عبر واتساب"><span class="item-emoji" aria-hidden="true">💡</span><div class="row-body"><div class="row-title">اقترح ميزة</div></div><span class="chevron" aria-hidden="true">‹</span></div>
        <div class="list-row" data-action="feedback-review" role="button" tabindex="0" aria-label="شارك رأيك عبر واتساب"><span class="item-emoji" aria-hidden="true">💬</span><div class="row-body"><div class="row-title">شارك رأيك</div></div><span class="chevron" aria-hidden="true">‹</span></div>
      </div>
      <div class="about-quote">فكّرني بيتطور مع مستخدميه. كل فكرة أو ملاحظة منك بتساعدني أخليه أحسن.</div>
    </div>

    <div class="about-divider"></div>

    <div class="about-section">
      <p>وأخيرًا...

أنا مش عايز فكّرني يكون مجرد موقع بتفتحه وتقفله.
نفسي يكون حاجة بسيطة تدخل في يومك وتساعدك من غير ما تحس إنها عبء جديد عليك.

ولو في يوم استخدمت فكّرني وافتكرت بسببه حاجة كنت هتنساها...
فده بالنسبالي أكبر سبب يخلي كل التعب اللي اتحط فيه يستاهل.</p>
    </div>

    <div class="settings-group-title">صُنع بواسطة</div>
    <div class="card">
      <div class="developer-card">
        <div class="developer-avatar" aria-hidden="true">${esc(dev.name.split(' ').map((w) => w[0]).join(''))}</div>
        <div class="developer-info">
          <strong>${esc(dev.name)}</strong>
          <span class="role">${esc(dev.role)}</span>
        </div>
      </div>
      <div class="developer-tagline">فكّرني مشروع شخصي بدأ بفكرة بسيطة، ولسه بيتطور خطوة بخطوة.</div>
      <div class="social-row" style="padding:0 16px 16px;">
        ${socialLink('LinkedIn', '💼', links.linkedin)}
        ${socialLink('Instagram', '📷', links.instagram)}
        ${socialLink('GitHub', '💻', links.github)}
      </div>
    </div>

    <div class="about-version">فَكّرني — يفتكرها معاك</div>
  `;
}
