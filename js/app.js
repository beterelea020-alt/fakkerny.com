import { Reminders, Medicine, Money, Habits, HabitLogs, Notes, Settings, exportAllData, importAllData, wipeAllData, uid } from './storage/db.js';
import { todayStr, toDateStr, friendlyTime, WEEKDAY_SHORT } from './utils/date.js';
import { parseQuickAdd } from './utils/parse.js';
import { initNotifications, requestPermission, sendNotification } from './features/notify.js';
import { openFeedback } from './features/feedback.js';
import { applyThemeColor, setPreset, setCustomColor, resetTheme } from './core/theme-manager.js';
import * as PushSync from './features/push-sync.js';
import { APP_CONFIG } from './config.js';
import * as R from './features/render.js';

/* ------------------------------------------------------------------------ */
/* State                                                                     */
/* ------------------------------------------------------------------------ */

const state = {
  view: 'dashboard',
  filter: 'all',
  search: '',
  noteSearch: '',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  calSelected: todayStr(),
  addType: 'reminder',
  editingId: null,
  editingKind: null,
  lastParse: null
};

const NAV_TITLES = {
  dashboard: 'فَكّرني', reminders: 'التذكيرات', medicine: 'الأدوية', money: 'الفلوس',
  habits: 'العادات', notes: 'الملاحظات', calendar: 'التقويم', settings: 'الإعدادات',
  about: 'عن فكّرني'
};

const $viewRoot = document.getElementById('view-root');
const $topbarTitle = document.getElementById('topbar-title');
const $toastRoot = document.getElementById('toast-root');
const $overlayRoot = document.getElementById('overlay-root');

/* ------------------------------------------------------------------------ */
/* Rendering / routing                                                       */
/* ------------------------------------------------------------------------ */

function render() {
  let html = '';
  switch (state.view) {
    case 'dashboard': html = R.renderDashboard(); break;
    case 'reminders': html = R.renderReminders(state.filter, state.search); break;
    case 'medicine': html = R.renderMedicine(); break;
    case 'money': html = R.renderMoney(); break;
    case 'habits': html = R.renderHabits(); break;
    case 'notes': html = R.renderNotes(state.noteSearch); break;
    case 'calendar': html = R.renderCalendar(state.calYear, state.calMonth, state.calSelected); break;
    case 'settings': html = R.renderSettings(); break;
    case 'about': html = R.renderAbout(); break;
    default: html = R.renderDashboard();
  }
  $viewRoot.innerHTML = html;
  $topbarTitle.textContent = NAV_TITLES[state.view];
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-nav') === state.view);
  });
  const searchInput = $viewRoot.querySelector('[data-role="search-input"]');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      if (state.view === 'reminders') state.search = e.target.value;
      if (state.view === 'notes') state.noteSearch = e.target.value;
      renderPartialList();
    });
  }
}

// Re-render only the list part to avoid losing input focus while typing search
function renderPartialList() {
  if (state.view === 'reminders') $viewRoot.innerHTML = R.renderReminders(state.filter, state.search);
  else if (state.view === 'notes') $viewRoot.innerHTML = R.renderNotes(state.noteSearch);
  const input = $viewRoot.querySelector('[data-role="search-input"]');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('input', (e) => {
      if (state.view === 'reminders') state.search = e.target.value;
      if (state.view === 'notes') state.noteSearch = e.target.value;
      renderPartialList();
    });
  }
}

function setView(view) {
  state.view = view;
  state.search = '';
  state.noteSearch = '';
  window.scrollTo({ top: 0 });
  render();
}

/* ------------------------------------------------------------------------ */
/* Toasts                                                                     */
/* ------------------------------------------------------------------------ */

function toast(message, { actionLabel, onAction, duration = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${message}</span>${actionLabel ? `<button type="button">${actionLabel}</button>` : ''}`;
  $toastRoot.appendChild(el);
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  };
  if (actionLabel && onAction) {
    el.querySelector('button').addEventListener('click', () => { onAction(); remove(); });
  }
  setTimeout(remove, duration);
}

/* ------------------------------------------------------------------------ */
/* Overlay / bottom-sheet helpers                                            */
/* ------------------------------------------------------------------------ */

function openSheet(innerHtml, { onClose } = {}) {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'active-overlay';
  overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-handle"></div>${innerHtml}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  $overlayRoot.appendChild(overlay);
  overlay._onClose = onClose;
  document.body.style.overflow = 'hidden';
  return overlay;
}

function closeSheet() {
  const overlay = document.getElementById('active-overlay');
  if (overlay) {
    if (overlay._onClose) overlay._onClose();
    overlay.remove();
  }
  document.body.style.overflow = '';
}

/* ------------------------------------------------------------------------ */
/* Smart Add sheet                                                           */
/* ------------------------------------------------------------------------ */

const TYPE_META = {
  reminder: { emoji: '⏰', label: 'تذكير' },
  medicine: { emoji: '💊', label: 'دواء' },
  money: { emoji: '💰', label: 'فلوس' },
  habit: { emoji: '🔁', label: 'عادة' },
  note: { emoji: '📝', label: 'ملاحظة' }
};

function openAddSheet(presetType) {
  state.addType = presetType || 'reminder';
  state.editingId = null;
  state.editingKind = null;
  state.lastParse = null;
  renderAddSheet();
}

function typeGridHtml() {
  return `<div class="type-grid">` + Object.entries(TYPE_META).map(([key, meta]) => `
    <button type="button" class="type-btn ${state.addType === key ? 'selected' : ''}" data-action="pick-type" data-type="${key}">
      <span class="ic">${meta.emoji}</span><span>${meta.label}</span>
    </button>`).join('') + `</div>`;
}

function dynamicFieldsHtml(type, prefill = {}) {
  const today = todayStr();
  if (type === 'reminder') {
    return `
      <div class="field"><label>العنوان</label><input type="text" id="f-title" placeholder="زي: موعد الطبيب" value="${prefill.title || ''}"></div>
      <div class="field-row">
        <div class="field"><label>التاريخ</label><input type="date" id="f-date" value="${prefill.date || today}"></div>
        <div class="field"><label>الوقت</label><input type="time" id="f-time" value="${prefill.time || '20:00'}"></div>
      </div>
      <div class="field"><label>التكرار</label>
        <div class="chip-toggle-row" id="f-repeat" data-value="${prefill.repeat || 'none'}">
          <button type="button" class="chip-toggle ${(!prefill.repeat || prefill.repeat === 'none') ? 'selected' : ''}" data-val="none">مرة واحدة</button>
          <button type="button" class="chip-toggle ${prefill.repeat === 'daily' ? 'selected' : ''}" data-val="daily">كل يوم</button>
          <button type="button" class="chip-toggle ${prefill.repeat === 'weekly' ? 'selected' : ''}" data-val="weekly">كل أسبوع</button>
        </div>
      </div>`;
  }
  if (type === 'medicine') {
    return `
      <div class="field"><label>اسم الدواء</label><input type="text" id="f-title" placeholder="زي: Panadol" value="${prefill.title || ''}"></div>
      <div class="field"><label>الجرعة</label><input type="text" id="f-dosage" placeholder="زي: قرص واحد" value="${prefill.dosage || ''}"></div>
      <div class="field"><label>الوقت</label><input type="time" id="f-time" value="${prefill.time || '09:00'}"></div>
      <div class="field"><label>التكرار</label>
        <div class="chip-toggle-row" id="f-repeat" data-value="${prefill.repeat === 'none' ? 'none' : 'daily'}">
          <button type="button" class="chip-toggle ${prefill.repeat === 'none' ? 'selected' : ''}" data-val="none">مرة واحدة</button>
          <button type="button" class="chip-toggle ${prefill.repeat !== 'none' ? 'selected' : ''}" data-val="daily">كل يوم</button>
        </div>
      </div>`;
  }
  if (type === 'money') {
    return `
      <div class="field"><label>البيان</label><input type="text" id="f-title" placeholder="زي: محمد" value="${prefill.title || ''}"></div>
      <div class="field"><label>النوع</label>
        <div class="chip-toggle-row" id="f-money-type" data-value="${prefill.moneyType || 'owe'}">
          <button type="button" class="chip-toggle ${(!prefill.moneyType || prefill.moneyType === 'owe') ? 'selected' : ''}" data-val="owe">عليّ فلوس</button>
          <button type="button" class="chip-toggle ${prefill.moneyType === 'owed' ? 'selected' : ''}" data-val="owed">ليّ فلوس</button>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>المبلغ (ج.م)</label><input type="number" inputmode="decimal" id="f-amount" placeholder="0" value="${prefill.amount || ''}"></div>
        <div class="field"><label>موعد السداد</label><input type="date" id="f-date" value="${prefill.date || today}"></div>
      </div>`;
  }
  if (type === 'habit') {
    const days = prefill.days || [];
    return `
      <div class="field"><label>اسم العادة</label><input type="text" id="f-title" placeholder="زي: Gym" value="${prefill.title || ''}"></div>
      <div class="field"><label>الوقت (اختياري)</label><input type="time" id="f-time" value="${prefill.time || '20:00'}"></div>
      <div class="field"><label>الأيام (اتركها فاضية = كل يوم)</label>
        <div class="chip-toggle-row" id="f-days" data-value="${days.join(',')}">
          ${WEEKDAY_SHORT.map((w, i) => `<button type="button" class="chip-toggle ${days.includes(i) ? 'selected' : ''}" data-val="${i}">${w}</button>`).join('')}
        </div>
      </div>`;
  }
  if (type === 'note') {
    return `
      <div class="field"><label>العنوان</label><input type="text" id="f-title" placeholder="عنوان الملاحظة" value="${prefill.title || ''}"></div>
      <div class="field"><label>المحتوى</label><textarea id="f-content" placeholder="اكتب ملاحظتك...">${prefill.content || ''}</textarea></div>`;
  }
  return '';
}

function renderAddSheet() {
  const isEdit = !!state.editingId;
  const overlay = openSheet(`
    <div class="sheet-title">${isEdit ? 'تعديل' : 'ما الذي تريد تذكره؟'}</div>
    <div class="sheet-sub">${isEdit ? '' : 'اختر النوع أو اكتب وخلي فكرني يقترح التفاصيل'}</div>
    ${isEdit ? '' : typeGridHtml()}
    ${isEdit ? '' : `
      <div class="field">
        <label>كتابة سريعة</label>
        <input type="text" id="quick-text" placeholder="مثال: فوق العربية الساعة 7" autocomplete="off">
      </div>
      <div id="suggest-banner-slot"></div>
    `}
    <div id="dynamic-fields">${dynamicFieldsHtml(state.addType)}</div>
    <div class="sheet-actions">
      <button type="button" class="btn btn-ghost" data-action="close-sheet">إلغاء</button>
      <button type="button" class="btn btn-primary btn-block" data-action="save-item">${isEdit ? 'حفظ التعديلات' : 'حفظ'}</button>
    </div>
  `);

  wireTypeGrid(overlay);
  wireChipToggles(overlay);

  const quickText = overlay.querySelector('#quick-text');
  if (quickText) {
    quickText.addEventListener('input', () => {
      const val = quickText.value.trim();
      if (!val) {
        overlay.querySelector('#suggest-banner-slot').innerHTML = '';
        return;
      }
      const parsed = parseQuickAdd(val);
      state.lastParse = parsed;
      state.addType = parsed.type;
      overlay.querySelectorAll('.type-btn').forEach((b) => b.classList.toggle('selected', b.dataset.type === parsed.type));
      const prefill = {
        title: parsed.title,
        date: parsed.date,
        time: parsed.time,
        repeat: parsed.repeat,
        amount: parsed.amount || '',
        moneyType: 'owe'
      };
      overlay.querySelector('#dynamic-fields').innerHTML = dynamicFieldsHtml(parsed.type, prefill);
      wireChipToggles(overlay);
      overlay.querySelector('#suggest-banner-slot').innerHTML = `
        <div class="suggest-banner">💡 اقترحنا: ${TYPE_META[parsed.type].emoji} ${TYPE_META[parsed.type].label} — «${escHtml(parsed.title)}»${parsed.hadTimeGuess ? ' — ' + friendlyTime(parsed.time) : ''}</div>`;
    });
  }
}

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wireTypeGrid(overlay) {
  overlay.querySelectorAll('[data-action="pick-type"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.addType = btn.dataset.type;
      overlay.querySelectorAll('.type-btn').forEach((b) => b.classList.toggle('selected', b === btn));
      overlay.querySelector('#dynamic-fields').innerHTML = dynamicFieldsHtml(state.addType);
      wireChipToggles(overlay);
    });
  });
}

function wireChipToggles(overlay) {
  overlay.querySelectorAll('.chip-toggle-row').forEach((row) => {
    const isMulti = row.id === 'f-days';
    row.querySelectorAll('.chip-toggle').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (isMulti) {
          chip.classList.toggle('selected');
          const selected = Array.from(row.querySelectorAll('.chip-toggle.selected')).map((c) => c.dataset.val);
          row.dataset.value = selected.join(',');
        } else {
          row.querySelectorAll('.chip-toggle').forEach((c) => c.classList.remove('selected'));
          chip.classList.add('selected');
          row.dataset.value = chip.dataset.val;
        }
      });
    });
  });
}

function collectFormData(type) {
  const q = (sel) => document.querySelector(sel);
  if (type === 'reminder') {
    return {
      title: (q('#f-title').value || '').trim() || 'بدون عنوان',
      date: q('#f-date').value || todayStr(),
      time: q('#f-time').value || '20:00',
      repeat: q('#f-repeat').dataset.value || 'none',
      completed: false
    };
  }
  if (type === 'medicine') {
    return {
      name: (q('#f-title').value || '').trim() || 'دواء',
      dosage: (q('#f-dosage').value || '').trim(),
      time: q('#f-time').value || '09:00',
      repeat: q('#f-repeat').dataset.value || 'daily',
      completed: false
    };
  }
  if (type === 'money') {
    return {
      title: (q('#f-title').value || '').trim() || 'بدون بيان',
      type: q('#f-money-type').dataset.value || 'owe',
      amount: parseFloat(q('#f-amount').value || '0') || 0,
      dueDate: q('#f-date').value || todayStr(),
      status: 'pending'
    };
  }
  if (type === 'habit') {
    const daysVal = q('#f-days').dataset.value || '';
    return {
      title: (q('#f-title').value || '').trim() || 'عادة جديدة',
      time: q('#f-time').value || '',
      reminder: !!q('#f-time').value,
      days: daysVal ? daysVal.split(',').map(Number) : []
    };
  }
  if (type === 'note') {
    return {
      title: (q('#f-title').value || '').trim(),
      content: (q('#f-content').value || '').trim()
    };
  }
  return {};
}

function collectionFor(kind) {
  return { reminder: Reminders, medicine: Medicine, money: Money, habit: Habits, note: Notes }[kind];
}

function saveItemFromSheet() {
  const type = state.addType;
  const data = collectFormData(type);
  const col = collectionFor(type);
  if (state.editingId) {
    col.update(state.editingId, data);
    toast('تم حفظ التعديلات');
  } else {
    col.add(data);
    toast('تمت الإضافة ✓');
  }
  closeSheet();
  render();
  if (type === 'reminder' || type === 'medicine') PushSync.syncSchedule();
}

/* ------------------------------------------------------------------------ */
/* Item detail sheet                                                         */
/* ------------------------------------------------------------------------ */

function openItemDetail(kind, id) {
  const col = collectionFor(kind);
  const item = col.get(id);
  if (!item) return;
  const meta = TYPE_META[kind];
  let detailLines = '';
  if (kind === 'reminder') detailLines = `${item.date} · ${friendlyTime(item.time)}${item.repeat !== 'none' ? ' · تكرار: ' + (item.repeat === 'daily' ? 'يومي' : 'أسبوعي') : ''}`;
  if (kind === 'medicine') detailLines = `${item.dosage || ''} · ${friendlyTime(item.time)} · ${item.repeat === 'daily' ? 'يوميًا' : 'مرة واحدة'}`;
  if (kind === 'money') detailLines = `${item.type === 'owe' ? 'عليّ' : 'ليّ'} ${item.amount} ج.م${item.dueDate ? ' · موعد: ' + item.dueDate : ''}`;
  if (kind === 'habit') detailLines = `${item.time ? friendlyTime(item.time) : 'بدون وقت محدد'}`;
  if (kind === 'note') detailLines = item.content || '';

  const overlay = openSheet(`
    <div class="sheet-title">${meta.emoji} ${escHtml(item.title || item.name)}</div>
    <div class="sheet-sub">${escHtml(detailLines)}</div>
    <div class="sheet-actions">
      <button type="button" class="btn btn-danger" data-action="request-delete" data-kind="${kind}" data-id="${id}">حذف</button>
      <button type="button" class="btn btn-primary btn-block" data-action="edit-item" data-kind="${kind}" data-id="${id}">تعديل</button>
    </div>
    <div id="confirm-slot"></div>
  `);

  overlay.querySelector('[data-action="request-delete"]').addEventListener('click', (e) => {
    overlay.querySelector('#confirm-slot').innerHTML = `
      <div class="suggest-banner" style="background:rgba(228,91,102,0.1);color:var(--danger);">حذف نهائيًا؟ ممكن تتراجع خلال ثواني بعدها.</div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-ghost btn-block" data-action="cancel-delete">إلغاء</button>
        <button type="button" class="btn btn-danger btn-block" data-action="confirm-delete" data-kind="${kind}" data-id="${id}">حذف</button>
      </div>`;
    overlay.querySelector('[data-action="cancel-delete"]').addEventListener('click', () => {
      overlay.querySelector('#confirm-slot').innerHTML = '';
    });
    overlay.querySelector('[data-action="confirm-delete"]').addEventListener('click', () => {
      const removed = col.remove(id);
      closeSheet();
      render();
      if (kind === 'reminder' || kind === 'medicine') PushSync.syncSchedule();
      toast('تم الحذف', {
        actionLabel: 'تراجع',
        onAction: () => {
          col.restore(removed);
          render();
          if (kind === 'reminder' || kind === 'medicine') PushSync.syncSchedule();
        }
      });
    });
  });

  overlay.querySelector('[data-action="edit-item"]').addEventListener('click', () => {
    state.editingId = id;
    state.editingKind = kind;
    state.addType = kind;
    const prefill = kind === 'medicine'
      ? { title: item.name, dosage: item.dosage, time: item.time, repeat: item.repeat }
      : kind === 'money'
        ? { title: item.title, moneyType: item.type, amount: item.amount, date: item.dueDate }
        : kind === 'habit'
          ? { title: item.title, time: item.time, days: item.days }
          : item;
    closeSheet();
    const ov = openSheet(`
      <div class="sheet-title">تعديل</div>
      <div id="dynamic-fields">${dynamicFieldsHtml(kind, prefill)}</div>
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost" data-action="close-sheet">إلغاء</button>
        <button type="button" class="btn btn-primary btn-block" data-action="save-item">حفظ التعديلات</button>
      </div>`);
    wireChipToggles(ov);
  });
}

/* ------------------------------------------------------------------------ */
/* Global event delegation                                                   */
/* ------------------------------------------------------------------------ */

document.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  switch (action) {
    case 'open-quick-add': openAddSheet('reminder'); break;
    case 'open-quick-add-reminder': openAddSheet('reminder'); break;
    case 'open-quick-add-medicine': openAddSheet('medicine'); break;
    case 'open-quick-add-money': openAddSheet('money'); break;
    case 'open-quick-add-habit': openAddSheet('habit'); break;
    case 'open-quick-add-note': openAddSheet('note'); break;
    case 'close-sheet': closeSheet(); break;
    case 'save-item': saveItemFromSheet(); break;
    case 'open-item': openItemDetail(actionEl.dataset.kind, actionEl.dataset.id); break;

    case 'set-filter': state.filter = actionEl.dataset.filter; render(); break;

    case 'toggle-reminder': {
      const item = Reminders.get(actionEl.dataset.id);
      Reminders.update(item.id, { completed: !item.completed });
      render();
      PushSync.syncSchedule();
      break;
    }
    case 'toggle-medicine': {
      const item = Medicine.get(actionEl.dataset.id);
      const today = todayStr();
      const nowDone = !(item.completed && item._completedDate === today);
      Medicine.update(item.id, { completed: nowDone, _completedDate: nowDone ? today : null });
      render();
      PushSync.syncSchedule();
      break;
    }
    case 'toggle-money': {
      const item = Money.get(actionEl.dataset.id);
      Money.update(item.id, { status: item.status === 'paid' ? 'pending' : 'paid' });
      render();
      break;
    }
    case 'toggle-habit': {
      HabitLogs.toggle(actionEl.dataset.id, todayStr());
      render();
      break;
    }

    case 'cal-prev': {
      state.calMonth--;
      if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      render();
      break;
    }
    case 'cal-next': {
      state.calMonth++;
      if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      render();
      break;
    }
    case 'cal-select': state.calSelected = actionEl.dataset.date; render(); break;

    case 'set-theme-mode': {
      Settings.set({ theme: actionEl.dataset.mode });
      applyTheme();
      render();
      break;
    }
    case 'set-theme-preset': {
      setPreset(actionEl.dataset.preset);
      render();
      break;
    }
    case 'reset-theme': {
      resetTheme();
      render();
      toast('تمت إعادة المظهر الافتراضي');
      break;
    }
    case 'toggle-notifications': {
      const cur = Settings.get().notificationsEnabled;
      if (!cur) {
        requestPermission().then((perm) => {
          Settings.set({ notificationsEnabled: perm === 'granted' });
          if (perm !== 'granted') toast('محتاجين إذنك عشان نبعتلك تذكيرات');
          render();
        });
      } else {
        Settings.set({ notificationsEnabled: false });
        render();
      }
      break;
    }
    case 'toggle-notification-sound': {
      Settings.set({ notificationSound: !(Settings.get().notificationSound !== false) });
      render();
      break;
    }
    case 'toggle-push-sync': {
      const cur = PushSync.isEnabled();
      if (!cur) {
        PushSync.enable(APP_CONFIG.push.vapidPublicKey).then((ok) => {
          if (!ok) toast('محتاجين إذن الإشعارات عشان نفعّل الميزة دي');
          render();
        });
      } else {
        PushSync.disable().then(render);
      }
      break;
    }
    case 'export-data': doExport(); break;
    case 'import-data': document.getElementById('import-file-input').click(); break;
    case 'clear-data': confirmWipe(); break;
    case 'feedback-bug': openFeedback('bug'); break;
    case 'feedback-feature': openFeedback('feature'); break;
    case 'feedback-review': openFeedback('review'); break;
  }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'custom-color-input') {
    setCustomColor(e.target.value);
    render();
  }
});

document.addEventListener('click', (e) => {
  const navEl = e.target.closest('[data-nav]');
  if (navEl) setView(navEl.getAttribute('data-nav'));
});

/* ------------------------------------------------------------------------ */
/* Backup / restore / wipe                                                   */
/* ------------------------------------------------------------------------ */

function doExport() {
  const payload = exportAllData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fakkerny-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('تم تصدير نسخة احتياطية');
}

function confirmWipe() {
  const overlay = openSheet(`
    <div class="sheet-title">مسح كل البيانات؟</div>
    <div class="sheet-sub">هيتم حذف كل التذكيرات والأدوية والملاحظات والفلوس والعادات نهائيًا من هذا الجهاز. الإجراء ده لا يمكن التراجع عنه.</div>
    <div class="sheet-actions">
      <button type="button" class="btn btn-ghost" data-action="close-sheet">إلغاء</button>
      <button type="button" class="btn btn-danger btn-block" id="confirm-wipe-btn">مسح كل شيء</button>
    </div>`);
  overlay.querySelector('#confirm-wipe-btn').addEventListener('click', () => {
    wipeAllData();
    closeSheet();
    setView('settings');
    toast('تم مسح كل البيانات');
  });
}

document.getElementById('import-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      importAllData(payload);
      toast('تم استيراد البيانات بنجاح');
      applyTheme();
      render();
    } catch (err) {
      toast('الملف غير صالح، جرّب ملف تصدير آخر');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ------------------------------------------------------------------------ */
/* Theme                                                                      */
/* ------------------------------------------------------------------------ */

function applyTheme() {
  const s = Settings.get();
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = s.theme === 'system' ? (prefersDark ? 'dark' : 'light') : s.theme;
  document.documentElement.setAttribute('data-theme', effective);
  applyThemeColor();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const activePrimary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    meta.setAttribute('content', effective === 'dark' ? '#16171D' : (activePrimary || '#5B6EF5'));
  }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (Settings.get().theme === 'system') applyTheme();
});

/* ------------------------------------------------------------------------ */
/* Notifications -> in-app toast fallback                                    */
/* ------------------------------------------------------------------------ */

function handleInAppNotification({ title, body }) {
  toast(`${title}: ${body}`);
}

/* ------------------------------------------------------------------------ */
/* Service worker registration                                               */
/* ------------------------------------------------------------------------ */

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'notif-action') {
        const { kind, id, action } = ev.data;
        if (kind === 'medicine' && action === 'done') {
          Medicine.update(id, { completed: true, _completedDate: todayStr() });
          render();
        } else if (kind === 'medicine' && action === 'snooze10') {
          const item = Medicine.get(id);
          if (item) {
            const [h, m] = item.time.split(':').map(Number);
            const d = new Date(); d.setHours(h, m + 10);
            Medicine.update(id, { time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, _notifiedToday: false });
          }
        }
      }
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Install prompt (Add to Home Screen)                                       */
/* ------------------------------------------------------------------------ */

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('install-btn');
  if (btn) btn.classList.remove('hidden');
});

document.getElementById('install-btn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    toast('لتثبيت التطبيق: افتح قائمة المتصفح واختر "إضافة إلى الشاشة الرئيسية"');
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('install-btn').classList.add('hidden');
});

/* ------------------------------------------------------------------------ */
/* Onboarding                                                                 */
/* ------------------------------------------------------------------------ */

function maybeShowOnboarding() {
  const s = Settings.get();
  if (s.onboarded) return;
  const screen = document.getElementById('onboard-screen');
  screen.classList.remove('hidden');
  document.getElementById('onboard-start').addEventListener('click', () => {
    Settings.set({ onboarded: true });
    screen.classList.add('hidden');
  });
}

/* ------------------------------------------------------------------------ */
/* Boot                                                                       */
/* ------------------------------------------------------------------------ */

function boot() {
  applyTheme();
  registerSW();
  maybeShowOnboarding();
  render();
  initNotifications(handleInAppNotification);

  document.getElementById('fab-add').addEventListener('click', () => openAddSheet('reminder'));
  document.getElementById('desktop-add-btn').addEventListener('click', () => openAddSheet('reminder'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
    if (e.key === 'Enter' || e.key === ' ') {
      const el = e.target.closest('[tabindex="0"]');
      if (el) {
        e.preventDefault();
        el.click();
      }
    }
  });
}

boot();
