import * as DB from './db.js';

// ---------------- CONFIG ----------------
const REWARDS = {
  main: { exp: 100, gold: 50 },
  sub: { exp: 30, gold: 10 },
  money: {
    day: { exp: 20, gold: 10 },
    week: { exp: 100, gold: 50 },
    month: { exp: 500, gold: 300 },
  },
};

const LEVEL_BASE = 100;
const LEVEL_EXP_FACTOR = 1.5;
const requiredExpForLevel = (level) => Math.round(LEVEL_BASE * Math.pow(level, LEVEL_EXP_FACTOR));

const CHAR_TIERS = ['🧍', '🧍‍♀️', '🧙‍♀️', '🦸‍♀️'];
const ROOM_TIERS = ['🌱', '🪴', '🛋️', '🏰'];
const tierForLevel = (level) => Math.min(3, Math.floor((level - 1) / 5));

const ROOM_ITEMS = [
  { id: 'plant', name: '작은 화분', emoji: '🪴', price: 100 },
  { id: 'chair', name: '나무 의자', emoji: '🪑', price: 200 },
  { id: 'sofa', name: '소파', emoji: '🛋️', price: 500 },
  { id: 'bookshelf', name: '책장', emoji: '📚', price: 700 },
  { id: 'computer', name: '컴퓨터', emoji: '🖥️', price: 1500 },
  { id: 'bed', name: '침대', emoji: '🛏️', price: 2000 },
];

const ACHIEVEMENTS = [
  { id: 'first_quest', title: '첫 퀘스트 완료', check: (ctx) => ctx.totalCompletions >= 1 },
  { id: 'streak7', title: '7일 연속 습관 달성', check: (ctx) => ctx.maxStreak >= 7 },
  { id: 'level5', title: '레벨 5 달성', check: (ctx) => ctx.level >= 5 },
  { id: 'budget_master', title: '소비 목표 3회 달성', check: (ctx) => ctx.moneyQuestSuccess >= 3 },
];

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const TAG_LABEL = { health: '❤️ 운동/건강', knowledge: '🧠 공부/독서', social: '✨ 기타' };

const THEMES = [
  { id: 'green', primary: '#3fa34d', primaryLight: '#7ed957', accent: '#ffb648' },
  { id: 'blue', primary: '#3f7fa3', primaryLight: '#57b8d9', accent: '#ffb648' },
  { id: 'pink', primary: '#c15a8a', primaryLight: '#f28ab0', accent: '#ffd166' },
  { id: 'purple', primary: '#7c5fd1', primaryLight: '#a98ff0', accent: '#ffb648' },
];

// ---------------- STATE ----------------
const state = {
  weekOffset: 0,
  monthOffset: 0,
  selectedMonthDate: null,
  categories: [],
  theme: 'green',
};

// ---------------- UTIL ----------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const pad2 = (n) => String(n).padStart(2, '0');

function toKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function todayKey() {
  return toKey(new Date());
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toKey(d);
}
function startOfWeekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return toKey(d);
}
function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7);
}
function monthRange(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = toKey(new Date(y, m - 1, 1));
  const end = toKey(new Date(y, m, 0));
  return { start, end, daysInMonth: new Date(y, m, 0).getDate() };
}
function currency(n) {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}
function showToast(msg, duration = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), duration);
}

// ---------------- MODAL ----------------
function openModalEl(id) {
  $$('.modal-backdrop.open').forEach((el) => {
    if (el.id !== id) el.classList.remove('open');
  });
  $(`#${id}`).classList.add('open');
}
function closeModalEl(id) {
  $(`#${id}`).classList.remove('open');
}

// ---------------- THEME ----------------
function applyTheme(themeId) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  document.documentElement.style.setProperty('--primary', theme.primary);
  document.documentElement.style.setProperty('--primary-light', theme.primaryLight);
  document.documentElement.style.setProperty('--accent', theme.accent);
  state.theme = theme.id;
  try {
    localStorage.setItem('theme', theme.id);
  } catch (e) {}
}
function renderThemeSwatches() {
  $('#theme-swatches').innerHTML = THEMES.map(
    (t) => `<button type="button" class="theme-swatch ${state.theme === t.id ? 'selected' : ''}" data-theme="${t.id}" style="background:${t.primary}"></button>`
  ).join('');
}

// ---------------- QUEST DUE-DATE LOGIC ----------------
function isSubQuestDue(sq, dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (sq.repeatType === 'daily') return true;
  if (sq.repeatType === 'weekly') return (sq.days || []).includes(d.getDay());
  if (sq.repeatType === 'period') return dateStr >= sq.periodStart && dateStr <= sq.periodEnd;
  return false;
}
function repeatLabel(sq) {
  if (sq.repeatType === 'daily') return '매일';
  if (sq.repeatType === 'weekly') return (sq.days || []).slice().sort().map((d) => WEEKDAY_KO[d]).join(', ') || '요일 미설정';
  if (sq.repeatType === 'period') return `${sq.periodStart} ~ ${sq.periodEnd}`;
  return '';
}

// ---------------- REWARD / LEVEL ----------------
async function applyReward(exp, gold, message) {
  const char = await DB.getCharacter();
  char.exp = Math.max(0, char.exp + exp);
  char.gold = Math.max(0, char.gold + gold);
  let leveledUp = false;
  while (char.exp >= requiredExpForLevel(char.level)) {
    char.exp -= requiredExpForLevel(char.level);
    char.level += 1;
    leveledUp = true;
  }
  await DB.saveCharacter(char);
  if (message) showToast(message);
  if (leveledUp) setTimeout(() => showToast(`레벨 업! Lv.${char.level} 🎉`), message ? 900 : 0);
  return char;
}

// ---------------- MONEY QUEST ----------------
function budgetIds(period, dateStr) {
  if (period === 'day') return { id: `day-${dateStr}`, start: dateStr, end: dateStr };
  if (period === 'week') {
    const start = startOfWeekKey(dateStr);
    const end = addDays(start, 6);
    return { id: `week-${start}`, start, end };
  }
  const mk = monthKeyOf(dateStr);
  const { start, end } = monthRange(mk);
  return { id: `month-${mk}`, start, end };
}

async function computeMoneyQuestStatus(period, dateStr) {
  const { id, start, end } = budgetIds(period, dateStr);
  const budget = await DB.getBudgetGoal(id);
  if (!budget) return null;
  const txns = await DB.getTransactionsByRange(start, end);
  const actual = txns.reduce((s, t) => s + t.amount, 0);
  const status = actual <= budget.totalBudget * 0.8 ? 'safe' : actual <= budget.totalBudget ? 'warning' : 'over';
  const categoryActuals = {};
  for (const t of txns) categoryActuals[t.categoryId] = (categoryActuals[t.categoryId] || 0) + t.amount;
  return { id, budget, actual, status, start, end, categoryActuals };
}

async function checkMoneyQuestRewards() {
  const char = await DB.getCharacter();
  const claimed = new Set(char.claimedMoneyQuests || []);
  let changed = false;
  let totalExp = 0;
  let totalGold = 0;
  let successMsg = null;

  const yesterday = addDays(todayKey(), -1);
  const dayResult = await computeMoneyQuestStatus('day', yesterday);
  const dayId = `day-${yesterday}`;
  if (dayResult && !claimed.has(dayId)) {
    claimed.add(dayId);
    changed = true;
    if (dayResult.status !== 'over') {
      totalExp += REWARDS.money.day.exp;
      totalGold += REWARDS.money.day.gold;
      successMsg = '어제 일간 소비 목표를 지켰어요! 💰';
    }
  }

  const lastWeekStart = startOfWeekKey(addDays(todayKey(), -7));
  if (lastWeekStart !== startOfWeekKey(todayKey())) {
    const weekResult = await computeMoneyQuestStatus('week', lastWeekStart);
    const weekId = `week-${lastWeekStart}`;
    if (weekResult && !claimed.has(weekId)) {
      claimed.add(weekId);
      changed = true;
      if (weekResult.status !== 'over') {
        totalExp += REWARDS.money.week.exp;
        totalGold += REWARDS.money.week.gold;
        successMsg = '지난주 소비 목표를 지켰어요! 💰';
      }
    }
  }

  const lastMonthDate = new Date();
  lastMonthDate.setDate(1);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonthKey = monthKeyOf(toKey(lastMonthDate));
  if (lastMonthKey !== monthKeyOf(todayKey())) {
    const monthResult = await computeMoneyQuestStatus('month', toKey(lastMonthDate));
    const monthId = `month-${lastMonthKey}`;
    if (monthResult && !claimed.has(monthId)) {
      claimed.add(monthId);
      changed = true;
      if (monthResult.status !== 'over') {
        totalExp += REWARDS.money.month.exp;
        totalGold += REWARDS.money.month.gold;
        successMsg = '지난달 소비 목표를 지켰어요! 💰';
      }
    }
  }

  if (changed) {
    char.claimedMoneyQuests = Array.from(claimed);
    await DB.saveCharacter(char);
    if (totalExp || totalGold) await applyReward(totalExp, totalGold, successMsg);
  }
}

// ---------------- STATS / ACHIEVEMENTS ----------------
function last30Dates() {
  const arr = [];
  for (let i = 0; i < 30; i++) arr.push(addDays(todayKey(), -i));
  return arr;
}

async function computeCharacterStats() {
  const dates = last30Dates();
  const subQuests = await DB.getAllSubQuests();
  const completions = await DB.getAllCompletions();
  const completedKeys = new Set(completions.map((c) => `${c.questId}_${c.date}`));
  const schedules = await DB.getAllSchedules();

  function subScore(tag) {
    const list = subQuests.filter((q) => q.tag === tag);
    let due = 0, done = 0;
    for (const d of dates) {
      for (const q of list) {
        if (q.createdAt && d < q.createdAt) continue;
        if (isSubQuestDue(q, d)) {
          due++;
          if (completedKeys.has(`${q.id}_${d}`)) done++;
        }
      }
    }
    return due ? Math.round((done / due) * 100) : 50;
  }

  const health = subScore('health');
  const knowledge = subScore('knowledge');

  const socialList = subQuests.filter((q) => q.tag === 'social');
  let socialDue = 0, socialDone = 0;
  for (const d of dates) {
    for (const q of socialList) {
      if (q.createdAt && d < q.createdAt) continue;
      if (isSubQuestDue(q, d)) {
        socialDue++;
        if (completedKeys.has(`${q.id}_${d}`)) socialDone++;
      }
    }
  }
  const relevantSchedules = schedules.filter((s) => dates.includes(s.date));
  socialDue += relevantSchedules.length;
  socialDone += relevantSchedules.filter((s) => s.completed).length;
  const social = socialDue ? Math.round((socialDone / socialDue) * 100) : 50;

  let financeTotal = 0, financeSuccess = 0;
  for (const d of dates) {
    const r = await computeMoneyQuestStatus('day', d);
    if (r) {
      financeTotal++;
      if (r.status !== 'over') financeSuccess++;
    }
  }
  const finance = financeTotal ? Math.round((financeSuccess / financeTotal) * 100) : 50;

  return { health, knowledge, finance, social };
}

async function computeStreak() {
  const completions = await DB.getAllCompletions();
  const dateSet = new Set(completions.map((c) => c.date));
  let cursor = new Date();
  if (!dateSet.has(toKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dateSet.has(toKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function renderAchievements() {
  const char = await DB.getCharacter();
  const completions = await DB.getAllCompletions();
  const schedules = await DB.getAllSchedules();
  const totalCompletions = completions.length + schedules.filter((s) => s.completed).length;
  const maxStreak = await computeStreak();
  const ctx = {
    totalCompletions,
    maxStreak,
    level: char.level,
    moneyQuestSuccess: (char.claimedMoneyQuests || []).length,
  };
  const unlocked = new Set((await DB.getUnlockedAchievements()).map((a) => a.id));
  const listEl = $('#achievement-list');
  listEl.innerHTML = '';
  for (const ach of ACHIEVEMENTS) {
    const isUnlocked = unlocked.has(ach.id) || ach.check(ctx);
    if (isUnlocked && !unlocked.has(ach.id)) {
      await DB.unlockAchievement(ach.id);
      showToast(`업적 달성: ${ach.title} 🏆`);
    }
    const li = document.createElement('li');
    li.className = isUnlocked ? '' : 'locked';
    li.innerHTML = `<span>${ach.title}</span><span>${isUnlocked ? '✅' : '🔒'}</span>`;
    listEl.appendChild(li);
  }
}

// ---------------- RENDER: HOME ----------------
async function renderHome() {
  const char = await DB.getCharacter();
  const req = requiredExpForLevel(char.level);
  $('#home-level').textContent = `Lv.${char.level}`;
  $('#home-exp-text').textContent = `${char.exp} / ${req} EXP`;
  $('#home-exp-fill').style.width = `${Math.min(100, (char.exp / req) * 100)}%`;

  const tier = tierForLevel(char.level);
  $('#home-room-emoji').textContent = ROOM_TIERS[tier];
  $('#home-char-emoji').textContent = CHAR_TIERS[tier];

  const dateStr = todayKey();
  const schedules = await DB.getSchedulesByDate(dateStr);
  const subQuests = (await DB.getAllSubQuests()).filter((q) => isSubQuestDue(q, dateStr));
  const completions = await DB.getCompletionsByDate(dateStr);
  const completedSubIds = new Set(completions.map((c) => c.questId));

  const sortedSchedules = [...schedules].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  $('#home-schedule-list').innerHTML = sortedSchedules.length
    ? sortedSchedules
        .map(
          (s) => `
    <li class="quest-item ${s.completed ? 'done' : ''}" data-id="${s.id}">
      <div class="quest-title" data-action="edit-main" data-id="${s.id}">${s.title}
        <div class="quest-meta">${s.time || '시간 미정'}</div>
      </div>
    </li>`
        )
        .join('')
    : '<li class="quest-empty">오늘 등록된 일정이 없어요.</li>';

  const pendingHabits = subQuests.filter((q) => !completedSubIds.has(q.id));
  $('#home-habit-list').innerHTML = pendingHabits.length
    ? pendingHabits
        .map(
          (q) => `
    <li class="quest-item" data-id="${q.id}">
      <button class="quest-check" data-action="toggle-sub" data-id="${q.id}"></button>
      <div class="quest-title" data-action="edit-sub" data-id="${q.id}">${q.title}
        <div class="quest-meta">${repeatLabel(q)}</div>
      </div>
    </li>`
        )
        .join('')
    : '<li class="quest-empty">오늘 습관을 모두 완료했어요! 🎉</li>';

  const txns = await DB.getTransactionsByDate(dateStr);
  const expenseTotal = txns.reduce((s, t) => s + t.amount, 0);
  $('#home-expense-total').textContent = currency(expenseTotal);
  $('#home-expense-list').innerHTML = txns.length
    ? txns
        .map((t) => {
          const cat = state.categories.find((c) => c.id === t.categoryId);
          return `<li class="expense-item" data-action="edit-transaction" data-id="${t.id}"><span>${cat ? cat.icon + ' ' + cat.name : '기타'}</span><span>${currency(t.amount)}</span></li>`;
        })
        .join('')
    : '<li class="quest-empty">오늘 지출 기록이 없어요.</li>';
}

// ---------------- RENDER: QUEST ----------------
async function renderQuest() {
  const dateStr = todayKey();
  $('#quest-date-label').textContent = dateStr;

  const schedules = await DB.getSchedulesByDate(dateStr);
  const mainList = $('#quest-main-list');
  mainList.innerHTML = schedules.length
    ? schedules
        .map(
          (s) => `
    <li class="quest-item ${s.completed ? 'done' : ''}" data-id="${s.id}">
      <button class="quest-check" data-action="toggle-main" data-id="${s.id}">${s.completed ? '✓' : ''}</button>
      <div class="quest-title" data-action="edit-main" data-id="${s.id}">${s.title}
        <div class="quest-meta">${s.time ? s.time + ' · ' : ''}+${REWARDS.main.exp} EXP</div>
      </div>
    </li>`
        )
        .join('')
    : '<li class="quest-empty">오늘 등록된 일정이 없어요.</li>';

  const allSub = await DB.getAllSubQuests();
  const dueSub = allSub.filter((q) => isSubQuestDue(q, dateStr));
  const completions = await DB.getCompletionsByDate(dateStr);
  const completedSubIds = new Set(completions.map((c) => c.questId));
  const subList = $('#quest-sub-list');
  subList.innerHTML = dueSub.length
    ? dueSub
        .map((q) => {
          const done = completedSubIds.has(q.id);
          return `
    <li class="quest-item ${done ? 'done' : ''}" data-id="${q.id}">
      <button class="quest-check" data-action="toggle-sub" data-id="${q.id}">${done ? '✓' : ''}</button>
      <div class="quest-title" data-action="edit-sub" data-id="${q.id}">${q.title}
        <div class="quest-meta">${repeatLabel(q)} · +${REWARDS.sub.exp} EXP</div>
      </div>
    </li>`;
        })
        .join('')
    : '<li class="quest-empty">오늘 반복되는 습관이 없어요.</li>';

  const moneyCard = $('#quest-money-card');
  const result = await computeMoneyQuestStatus('day', dateStr);
  if (!result) {
    moneyCard.innerHTML = `<p class="quest-empty">오늘의 소비 목표가 설정되지 않았어요. 우측 상단 ⚙️ 설정에서 예산을 설정해보세요.</p>`;
  } else {
    const statusLabel = { safe: '🟢 SAFE', warning: '🟡 WARNING', over: '🔴 OVER' }[result.status];
    moneyCard.innerHTML = `
      <span class="money-status-badge status-${result.status}">${statusLabel}</span>
      <div class="money-amount">${currency(result.actual)} / ${currency(result.budget.totalBudget)}</div>
      ${Object.entries(result.budget.categories || {})
        .filter(([, v]) => v > 0)
        .map(([catId, budgetAmt]) => {
          const cat = state.categories.find((c) => c.id === catId);
          const actual = result.categoryActuals[catId] || 0;
          const ok = actual <= budgetAmt;
          return `<div class="money-cat-row"><span>${cat ? cat.icon + ' ' + cat.name : catId}</span><span>${ok ? '✅' : '❌'} ${currency(actual)} / ${currency(budgetAmt)}</span></div>`;
        })
        .join('')}
    `;
  }

  const total = schedules.length + dueSub.length;
  const done = schedules.filter((s) => s.completed).length + dueSub.filter((q) => completedSubIds.has(q.id)).length;
  $('#quest-progress-count').textContent = total ? `${Math.round((done / total) * 100)}%` : '0%';
  $('#quest-progress-fill').style.width = total ? `${(done / total) * 100}%` : '0%';
}

// ---------------- RENDER: WEEK ----------------
async function renderWeek() {
  const base = addDays(startOfWeekKey(todayKey()), state.weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(base, i));
  $('#week-label').textContent = state.weekOffset === 0 ? '이번 주' : `${days[0]} ~ ${days[6]}`;

  const allSub = await DB.getAllSubQuests();
  const listEl = $('#week-list');
  listEl.innerHTML = '';
  for (const dateStr of days) {
    const schedules = await DB.getSchedulesByDate(dateStr);
    const dueSub = allSub.filter((q) => isSubQuestDue(q, dateStr));
    const completions = await DB.getCompletionsByDate(dateStr);
    const completedSubIds = new Set(completions.map((c) => c.questId));
    const money = await computeMoneyQuestStatus('day', dateStr);
    const moneyEmoji = money ? { safe: '🟢', warning: '🟡', over: '🔴' }[money.status] : '';
    const isToday = dateStr === todayKey();
    const d = new Date(`${dateStr}T00:00:00`);

    const rows = [
      ...schedules.map(
        (s) => `<div class="week-quest-row ${s.completed ? 'done' : ''}" data-action="toggle-main" data-id="${s.id}">👑 ${s.title}</div>`
      ),
      ...dueSub.map((q) => {
        const done = completedSubIds.has(q.id);
        return `<div class="week-quest-row ${done ? 'done' : ''}" data-action="toggle-sub" data-id="${q.id}" data-date="${dateStr}">🌱 ${q.title}</div>`;
      }),
    ];
    if (money) rows.push(`<div class="week-quest-row">💰 ${moneyEmoji} ${currency(money.actual)} / ${currency(money.budget.totalBudget)}</div>`);

    const card = document.createElement('div');
    card.className = 'week-day-card';
    card.innerHTML = `
      <div class="week-day-title ${isToday ? 'today' : ''}">
        <span>${WEEKDAY_KO[d.getDay()]}요일 ${dateStr.slice(5)}</span>
      </div>
      ${rows.join('') || '<div class="quest-empty">일정 없음</div>'}
    `;
    listEl.appendChild(card);
  }
}

// ---------------- RENDER: MONTH ----------------
async function renderMonth() {
  const now = new Date();
  now.setMonth(now.getMonth() + state.monthOffset, 1);
  const monthKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  $('#month-label').textContent = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;
  const { start, end, daysInMonth } = monthRange(monthKey);

  const schedules = await DB.getSchedulesByRange(start, end);
  const monthResult = await computeMoneyQuestStatus('month', start);
  const allSub = await DB.getAllSubQuests();
  const allCompletions = await DB.getAllCompletions();
  const completionDateSet = {};
  for (const c of allCompletions) {
    if (c.date >= start && c.date <= end) completionDateSet[c.date] = (completionDateSet[c.date] || 0) + 1;
  }

  let safeDays = 0, warnDays = 0, overDays = 0;
  const dayStatusMap = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthKey}-${pad2(d)}`;
    const r = await computeMoneyQuestStatus('day', dateStr);
    if (r) {
      dayStatusMap[dateStr] = r.status;
      if (r.status === 'safe') safeDays++;
      else if (r.status === 'warning') warnDays++;
      else overDays++;
    }
  }

  const totalQuestCount = schedules.length;
  const doneQuestCount = schedules.filter((s) => s.completed).length;

  $('#month-summary').innerHTML = `
    <div><strong>Quest</strong> ${doneQuestCount} / ${totalQuestCount} 완료</div>
    <div><strong>Finance</strong> ${monthResult ? `${currency(monthResult.actual)} / ${currency(monthResult.budget.totalBudget)}` : '예산 미설정'}</div>
    <div><strong>Money Quest</strong> 🟢 ${safeDays}일 · 🟡 ${warnDays}일 · 🔴 ${overDays}일</div>
  `;

  const firstDow = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const grid = $('#calendar-days');
  grid.innerHTML = '';
  for (let i = 0; i < firstDow; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day empty';
    grid.appendChild(cell);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthKey}-${pad2(d)}`;
    const cell = document.createElement('div');
    cell.className = `cal-day ${dateStr === state.selectedMonthDate ? 'selected' : ''}`;
    cell.dataset.date = dateStr;
    const dotColor = dayStatusMap[dateStr] ? { safe: 'var(--safe)', warning: 'var(--warn)', over: 'var(--over)' }[dayStatusMap[dateStr]] : 'transparent';
    cell.innerHTML = `
      <span>${d}${dateStr === todayKey() ? ' ●' : ''}</span>
      ${completionDateSet[dateStr] ? `<span style="font-size:9px;color:var(--text-muted)">✓${completionDateSet[dateStr]}</span>` : ''}
      <span class="dot" style="background:${dotColor}"></span>
    `;
    grid.appendChild(cell);
  }

  if (!state.selectedMonthDate || monthKeyOf(state.selectedMonthDate) !== monthKey) {
    state.selectedMonthDate = todayKey().startsWith(monthKey) ? todayKey() : `${monthKey}-01`;
  }
  await renderMonthDayDetail(state.selectedMonthDate);
}

async function renderMonthDayDetail(dateStr) {
  const schedules = await DB.getSchedulesByDate(dateStr);
  const allSub = await DB.getAllSubQuests();
  const dueSub = allSub.filter((q) => isSubQuestDue(q, dateStr));
  const completions = await DB.getCompletionsByDate(dateStr);
  const completedSubIds = new Set(completions.map((c) => c.questId));
  const txns = await DB.getTransactionsByDate(dateStr);
  const txnTotal = txns.reduce((s, t) => s + t.amount, 0);

  const detail = $('#month-day-detail');
  detail.innerHTML = `
    <strong>${dateStr}</strong>
    <div style="margin-top:6px;">
      ${schedules.map((s) => `👑 ${s.completed ? '✅' : '⬜'} ${s.title}`).join('<br>') || ''}
      ${dueSub.map((q) => `🌱 ${completedSubIds.has(q.id) ? '✅' : '⬜'} ${q.title}`).join('<br>') || ''}
    </div>
    <div style="margin-top:6px;color:var(--text-muted)">소비 합계: ${currency(txnTotal)}</div>
  `;
}

// ---------------- RENDER: MY LIFE ----------------
async function renderMyLife() {
  const char = await DB.getCharacter();
  const req = requiredExpForLevel(char.level);
  $('#mylife-name').textContent = char.name || 'Ellie';
  $('#mylife-level').textContent = `Lv.${char.level}`;
  $('#mylife-exp-text').textContent = `${char.exp} / ${req} EXP`;
  $('#mylife-exp-fill').style.width = `${Math.min(100, (char.exp / req) * 100)}%`;
  $('#mylife-gold').textContent = char.gold.toLocaleString('ko-KR');

  const stats = await computeCharacterStats();
  const STAT_LABELS = { health: '❤️ Health', knowledge: '🧠 Knowledge', finance: '💰 Finance', social: '✨ Social' };
  $('#mylife-stats').innerHTML = Object.entries(stats)
    .map(
      ([key, val]) => `
    <div class="stat-row">
      <span class="stat-label">${STAT_LABELS[key]}</span>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${val}%"></div></div>
      <span class="stat-value">${val}</span>
    </div>`
    )
    .join('');

  const owned = new Set((await DB.getOwnedRoomItems()).map((i) => i.itemId));
  $('#shop-list').innerHTML = ROOM_ITEMS.map((item) => {
    const isOwned = owned.has(item.id);
    const canAfford = char.gold >= item.price;
    return `
      <div class="shop-item">
        <div class="shop-emoji">${item.emoji}</div>
        <div>${item.name}</div>
        <div>${item.price.toLocaleString('ko-KR')}G</div>
        <button data-action="buy-item" data-id="${item.id}" ${isOwned || !canAfford ? 'disabled' : ''}>${isOwned ? '보유중' : '구매'}</button>
      </div>`;
  }).join('');

  await renderAchievements();
}

// ---------------- RENDER ALL ----------------
async function renderAll() {
  await renderHome();
  await renderQuest();
  await renderWeek();
  await renderMonth();
  await renderMyLife();
}

// ---------------- SCREEN SWITCH ----------------
function switchScreen(name) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${name}`).classList.add('active');
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  try {
    localStorage.setItem('lastSelectedTab', name);
  } catch (e) {}
}

// ---------------- FORM: SCHEDULE (MAIN QUEST) ----------------
function openScheduleModal(schedule, defaultDate) {
  const form = $('#schedule-form');
  form.reset();
  form.id.value = schedule?.id || '';
  form.date.value = schedule?.date || defaultDate || todayKey();
  form.time.value = schedule?.time || '';
  form.title.value = schedule?.title || '';
  form.description.value = schedule?.description || '';
  $('#schedule-delete-btn').hidden = !schedule;
  openModalEl('schedule-modal');
}

async function handleScheduleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  const id = data.get('id') || DB.genId('schedule');
  const existing = data.get('id') ? await DB.getAllSchedules().then((list) => list.find((s) => s.id === id)) : null;
  const schedule = {
    id,
    title: data.get('title'),
    date: data.get('date'),
    time: data.get('time') || '',
    description: data.get('description') || '',
    completed: existing?.completed || false,
    rewardExp: REWARDS.main.exp,
    rewardGold: REWARDS.main.gold,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await DB.updateSchedule(schedule);
  closeModalEl('schedule-modal');
  showToast('일정이 저장되었어요.');
  await renderAll();
}

async function handleScheduleDelete() {
  const id = $('#schedule-form').id.value;
  if (!id) return;
  if (!confirm('이 일정을 삭제할까요?')) return;
  await DB.deleteSchedule(id);
  closeModalEl('schedule-modal');
  showToast('일정을 삭제했어요.');
  await renderAll();
}

// ---------------- FORM: SUB QUEST ----------------
function openSubQuestModal(sq) {
  const form = $('#subquest-form');
  form.reset();
  form.id.value = sq?.id || '';
  form.title.value = sq?.title || '';
  form.repeatType.value = sq?.repeatType || 'daily';
  form.tag.value = sq?.tag || 'social';
  $$('#repeat-weekly-days input[type=checkbox]').forEach((cb) => {
    cb.checked = !!sq?.days?.includes(Number(cb.value));
  });
  form.periodStart.value = sq?.periodStart || '';
  form.periodEnd.value = sq?.periodEnd || '';
  $('#repeat-weekly-days').hidden = form.repeatType.value !== 'weekly';
  $('#repeat-period-range').hidden = form.repeatType.value !== 'period';
  $('#subquest-delete-btn').hidden = !sq;
  openModalEl('subquest-modal');
}

async function handleSubQuestSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  const id = data.get('id') || DB.genId('sub');
  const existing = data.get('id') ? await DB.getAllSubQuests().then((list) => list.find((q) => q.id === id)) : null;
  const repeatType = data.get('repeatType');
  const days = $$('#repeat-weekly-days input[type=checkbox]:checked').map((cb) => Number(cb.value));
  const sq = {
    id,
    type: 'sub',
    title: data.get('title'),
    tag: data.get('tag'),
    repeatType,
    days: repeatType === 'weekly' ? days : [],
    periodStart: repeatType === 'period' ? data.get('periodStart') : '',
    periodEnd: repeatType === 'period' ? data.get('periodEnd') : '',
    target: 1,
    rewardExp: REWARDS.sub.exp,
    rewardGold: REWARDS.sub.gold,
    createdAt: existing?.createdAt || todayKey(),
  };
  await DB.updateSubQuest(sq);
  closeModalEl('subquest-modal');
  showToast('서브 퀘스트가 저장되었어요.');
  await renderAll();
}

async function handleSubQuestDelete() {
  const id = $('#subquest-form').id.value;
  if (!id) return;
  if (!confirm('이 서브 퀘스트를 삭제할까요?')) return;
  await DB.deleteSubQuest(id);
  closeModalEl('subquest-modal');
  showToast('서브 퀘스트를 삭제했어요.');
  await renderAll();
}

// ---------------- FORM: TRANSACTION ----------------
function populateCategorySelect(select, selectedId) {
  select.innerHTML = state.categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
  if (selectedId) select.value = selectedId;
}

function openTransactionModal(txn) {
  const form = $('#transaction-form');
  form.reset();
  populateCategorySelect($('#transaction-category-select'), txn?.categoryId);
  form.id.value = txn?.id || '';
  form.amount.value = txn?.amount || '';
  form.date.value = txn?.date || todayKey();
  form.memo.value = txn?.memo || '';
  $('#transaction-delete-btn').hidden = !txn;
  openModalEl('transaction-modal');
}

async function handleTransactionSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  const id = data.get('id') || DB.genId('txn');
  const txn = {
    id,
    amount: Number(data.get('amount')),
    categoryId: data.get('categoryId'),
    date: data.get('date'),
    memo: data.get('memo') || '',
    createdAt: new Date().toISOString(),
  };
  await DB.updateTransaction(txn);
  closeModalEl('transaction-modal');
  showToast('소비가 기록되었어요.');
  await renderAll();
}

async function handleTransactionDelete() {
  const id = $('#transaction-form').id.value;
  if (!id) return;
  if (!confirm('이 소비 기록을 삭제할까요?')) return;
  await DB.deleteTransaction(id);
  closeModalEl('transaction-modal');
  showToast('소비 기록을 삭제했어요.');
  await renderAll();
}

// ---------------- FORM: BUDGET ----------------
function renderBudgetCategoryInputs(values = {}) {
  $('#budget-category-inputs').innerHTML = state.categories
    .map(
      (c) => `
    <div class="budget-cat-row">
      <span>${c.icon} ${c.name}</span>
      <input type="number" inputmode="numeric" data-cat="${c.id}" value="${values[c.id] || ''}" placeholder="0" />
    </div>`
    )
    .join('');
}

function openBudgetModal() {
  const form = $('#budget-form');
  form.reset();
  form.baseDate.value = todayKey();
  renderBudgetCategoryInputs();
  openModalEl('budget-modal');
}

function readBudgetCategoryInputs() {
  const categories = {};
  $$('#budget-category-inputs input[data-cat]').forEach((inp) => {
    categories[inp.dataset.cat] = Number(inp.value) || 0;
  });
  return categories;
}

async function handleBudgetSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  const period = data.get('period');
  const baseDate = data.get('baseDate');
  const { id, start, end } = budgetIds(period, baseDate);
  const goal = {
    id,
    period,
    startDate: start,
    endDate: end,
    totalBudget: Number(data.get('totalBudget')),
    categories: readBudgetCategoryInputs(),
  };
  await DB.saveBudgetGoal(goal);
  closeModalEl('budget-modal');
  showToast('예산이 저장되었어요.');
  await renderAll();
}

async function handleAutoDistribute() {
  const form = $('#budget-form');
  const period = form.period.value;
  const baseDate = form.baseDate.value;
  const totalBudget = Number(form.totalBudget.value) || 0;
  const categories = readBudgetCategoryInputs();

  if (period === 'day') {
    showToast('일간 예산은 더 작은 단위로 나눌 수 없어요.');
    return;
  }
  const parent = budgetIds(period, baseDate);
  await DB.saveBudgetGoal({
    id: parent.id,
    period,
    startDate: parent.start,
    endDate: parent.end,
    totalBudget,
    categories,
  });

  if (period === 'month') {
    const { start, end } = monthRange(monthKeyOf(baseDate));
    const weekStarts = [];
    let cursor = startOfWeekKey(start);
    while (cursor <= end) {
      weekStarts.push(cursor);
      cursor = addDays(cursor, 7);
    }
    const share = totalBudget / weekStarts.length;
    const catShare = {};
    Object.entries(categories).forEach(([k, v]) => (catShare[k] = Math.round((v / weekStarts.length) * 100) / 100));
    for (const ws of weekStarts) {
      await DB.saveBudgetGoal({
        id: `week-${ws}`,
        period: 'week',
        startDate: ws,
        endDate: addDays(ws, 6),
        totalBudget: Math.round(share),
        categories: catShare,
      });
    }
    showToast(`${weekStarts.length}개 주차로 예산을 분배했어요.`);
  } else if (period === 'week') {
    const weekStart = startOfWeekKey(baseDate);
    const share = totalBudget / 7;
    const catShare = {};
    Object.entries(categories).forEach(([k, v]) => (catShare[k] = Math.round((v / 7) * 100) / 100));
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      await DB.saveBudgetGoal({
        id: `day-${d}`,
        period: 'day',
        startDate: d,
        endDate: d,
        totalBudget: Math.round(share),
        categories: catShare,
      });
    }
    showToast('7일로 예산을 분배했어요.');
  }
  closeModalEl('budget-modal');
  await renderAll();
}

// ---------------- QUEST TOGGLE HANDLERS ----------------
async function toggleMainQuest(id) {
  const schedules = await DB.getAllSchedules();
  const schedule = schedules.find((s) => s.id === id);
  if (!schedule) return;
  schedule.completed = !schedule.completed;
  schedule.updatedAt = new Date().toISOString();
  await DB.updateSchedule(schedule);
  if (schedule.completed) await applyReward(REWARDS.main.exp, REWARDS.main.gold, `"${schedule.title}" 완료! 👑`);
  else await applyReward(-REWARDS.main.exp, -REWARDS.main.gold);
  await renderAll();
}

async function toggleSubQuest(id, dateStr) {
  const subQuests = await DB.getAllSubQuests();
  const sq = subQuests.find((q) => q.id === id);
  if (!sq) return;
  const date = dateStr || todayKey();
  const done = await DB.isSubQuestCompleted(id, date);
  if (!done) {
    await DB.addCompletion(id, date);
    await applyReward(REWARDS.sub.exp, REWARDS.sub.gold, `"${sq.title}" 완료! 🌱`);
  } else {
    await DB.removeCompletion(id, date);
    await applyReward(-REWARDS.sub.exp, -REWARDS.sub.gold);
  }
  await renderAll();
}

async function buyRoomItem(itemId) {
  const item = ROOM_ITEMS.find((i) => i.id === itemId);
  const char = await DB.getCharacter();
  if (!item || char.gold < item.price) return;
  char.gold -= item.price;
  await DB.saveCharacter(char);
  await DB.addOwnedRoomItem(itemId);
  showToast(`${item.name}을(를) 구매했어요! ${item.emoji}`);
  await renderAll();
}

// ---------------- SETTINGS ----------------
function renderSettingsCategoryList() {
  $('#settings-category-list').innerHTML = state.categories
    .map((c) => `<span class="category-chip">${c.icon} ${c.name}<button type="button" class="chip-remove" data-action="delete-category" data-id="${c.id}">×</button></span>`)
    .join('');
}

async function openSettingsModal() {
  const char = await DB.getCharacter();
  $('#settings-name').value = char.name || '';
  $('#settings-income').value = char.monthlyIncome || '';
  renderSettingsCategoryList();
  renderThemeSwatches();
  openModalEl('settings-modal');
}

async function handleProfileSave() {
  const char = await DB.getCharacter();
  const name = $('#settings-name').value.trim() || char.name || 'Ellie';
  const monthlyIncome = Number($('#settings-income').value) || 0;
  char.name = name;
  char.monthlyIncome = monthlyIncome;
  await DB.saveCharacter(char);
  showToast('프로필이 저장되었어요.');
  await renderAll();
}

async function handleSettingsCategorySubmit(e) {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  const name = data.get('name').trim();
  const icon = data.get('icon').trim() || '🏷️';
  if (!name) return;
  const id = DB.genId('cat');
  await DB.addCategory({ id, name, icon });
  state.categories = await DB.getAllCategories();
  form.reset();
  renderSettingsCategoryList();
  showToast(`"${name}" 카테고리를 추가했어요.`);
  await renderAll();
}

async function handleCategoryDelete(id) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  if (!confirm(`"${cat.name}" 카테고리를 삭제할까요? 이미 기록된 소비 내역은 유지돼요.`)) return;
  await DB.deleteCategory(id);
  state.categories = await DB.getAllCategories();
  renderSettingsCategoryList();
  showToast(`"${cat.name}" 카테고리를 삭제했어요.`);
  await renderAll();
}

// ---------------- EXPORT / IMPORT ----------------
async function handleExport() {
  const payload = await DB.exportAllData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `daily-grow-backup-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('백업 파일을 내보냈어요.');
}

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!confirm('가져오기를 진행하면 현재 데이터를 덮어씁니다. 계속할까요?')) return;
    await DB.importAllData(payload);
    showToast('데이터를 가져왔어요.');
    state.categories = await DB.getAllCategories();
    await renderAll();
  } catch (err) {
    showToast('가져오기에 실패했어요. 파일을 확인해주세요.');
  } finally {
    e.target.value = '';
  }
}

// ---------------- EVENT BINDING ----------------
function bindEvents() {
  $$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => switchScreen(btn.dataset.screen)));

  $$('[data-open-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.openModal;
      if (modalId === 'schedule-modal') openScheduleModal(null, todayKey());
      else if (modalId === 'subquest-modal') openSubQuestModal(null);
      else if (modalId === 'transaction-modal') openTransactionModal(null);
      else if (modalId === 'budget-modal') openBudgetModal();
      else if (modalId === 'settings-modal') openSettingsModal();
    });
  });
  $$('[data-close-modal]').forEach((btn) =>
    btn.addEventListener('click', () => closeModalEl(btn.closest('.modal-backdrop').id))
  );
  $$('.modal-backdrop').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target === el) closeModalEl(el.id);
    })
  );

  $('#schedule-form').addEventListener('submit', handleScheduleSubmit);
  $('#schedule-delete-btn').addEventListener('click', handleScheduleDelete);

  $('#subquest-form').addEventListener('submit', handleSubQuestSubmit);
  $('#subquest-delete-btn').addEventListener('click', handleSubQuestDelete);
  $('#subquest-form select[name=repeatType]').addEventListener('change', (e) => {
    $('#repeat-weekly-days').hidden = e.target.value !== 'weekly';
    $('#repeat-period-range').hidden = e.target.value !== 'period';
  });

  $('#transaction-form').addEventListener('submit', handleTransactionSubmit);
  $('#transaction-delete-btn').addEventListener('click', handleTransactionDelete);

  $('#budget-form').addEventListener('submit', handleBudgetSubmit);
  $('#budget-autodist-btn').addEventListener('click', handleAutoDistribute);

  $('#settings-category-form').addEventListener('submit', handleSettingsCategorySubmit);
  $('#settings-category-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="delete-category"]');
    if (btn) handleCategoryDelete(btn.dataset.id);
  });
  $('#settings-profile-save').addEventListener('click', handleProfileSave);
  $('#theme-swatches').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme]');
    if (!btn) return;
    applyTheme(btn.dataset.theme);
    renderThemeSwatches();
  });

  $('#export-btn').addEventListener('click', handleExport);
  $('#import-file').addEventListener('change', handleImport);

  // delegated click handlers for quest lists
  ['#quest-main-list', '#week-list', '#home-schedule-list'].forEach((sel) => {
    $(sel).addEventListener('click', (e) => {
      const toggleMain = e.target.closest('[data-action="toggle-main"]');
      const editMain = e.target.closest('[data-action="edit-main"]');
      const toggleSub = e.target.closest('[data-action="toggle-sub"]');
      if (toggleMain) return toggleMainQuest(toggleMain.dataset.id);
      if (toggleSub) return toggleSubQuest(toggleSub.dataset.id, toggleSub.dataset.date);
      if (editMain) {
        DB.getAllSchedules().then((list) => {
          const s = list.find((x) => x.id === editMain.dataset.id);
          if (s) openScheduleModal(s);
        });
      }
    });
  });

  ['#quest-sub-list', '#home-habit-list'].forEach((sel) => {
    $(sel).addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('[data-action="toggle-sub"]');
      const editBtn = e.target.closest('[data-action="edit-sub"]');
      if (toggleBtn) return toggleSubQuest(toggleBtn.dataset.id, todayKey());
      if (editBtn) {
        DB.getAllSubQuests().then((list) => {
          const q = list.find((x) => x.id === editBtn.dataset.id);
          if (q) openSubQuestModal(q);
        });
      }
    });
  });

  $('#home-expense-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="edit-transaction"]');
    if (!btn) return;
    DB.getAllTransactions().then((list) => {
      const t = list.find((x) => x.id === btn.dataset.id);
      if (t) openTransactionModal(t);
    });
  });

  $('#week-prev').addEventListener('click', () => {
    state.weekOffset -= 1;
    renderWeek();
  });
  $('#week-next').addEventListener('click', () => {
    state.weekOffset += 1;
    renderWeek();
  });
  $('#month-prev').addEventListener('click', () => {
    state.monthOffset -= 1;
    state.selectedMonthDate = null;
    renderMonth();
  });
  $('#month-next').addEventListener('click', () => {
    state.monthOffset += 1;
    state.selectedMonthDate = null;
    renderMonth();
  });

  $('#calendar-days').addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-day[data-date]');
    if (!cell) return;
    state.selectedMonthDate = cell.dataset.date;
    renderMonth();
  });

  $('#shop-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="buy-item"]');
    if (btn) buyRoomItem(btn.dataset.id);
  });
}

// ---------------- ONBOARDING ----------------
function loadTheme() {
  let theme = 'green';
  try {
    theme = localStorage.getItem('theme') || 'green';
  } catch (e) {}
  applyTheme(theme);
}

async function handleOnboardingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  const name = data.get('name').trim();
  const monthlyIncome = Number(data.get('monthlyIncome')) || 0;
  if (!name) return;
  const char = await DB.getCharacter();
  char.name = name;
  char.monthlyIncome = monthlyIncome;
  char.onboarded = true;
  await DB.saveCharacter(char);
  $('#screen-onboarding').classList.remove('active');
  await startApp();
}

async function startApp() {
  await checkMoneyQuestRewards();
  await renderAll();
  let lastTab = 'home';
  try {
    lastTab = localStorage.getItem('lastSelectedTab') || 'home';
  } catch (e) {}
  switchScreen(lastTab);
}

// ---------------- INIT ----------------
async function init() {
  loadTheme();
  await DB.seedDefaults();
  state.categories = await DB.getAllCategories();
  bindEvents();
  $('#onboarding-form').addEventListener('submit', handleOnboardingSubmit);

  const character = await DB.getCharacter();
  if (!character.onboarded) {
    $('#screen-onboarding').classList.add('active');
  } else {
    await startApp();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
