// IndexedDB 데이터 접근 계층. app.js는 이 모듈을 통해서만 데이터에 접근한다.

const DB_NAME = 'daily-grow-db';
const DB_VERSION = 1;

const STORE_DEFS = {
  schedules: { keyPath: 'id', indexes: [{ name: 'date', keyPath: 'date' }] },
  subQuests: { keyPath: 'id', indexes: [] },
  questCompletions: {
    keyPath: 'id',
    indexes: [
      { name: 'questId', keyPath: 'questId' },
      { name: 'date', keyPath: 'date' },
    ],
  },
  transactions: {
    keyPath: 'id',
    indexes: [
      { name: 'date', keyPath: 'date' },
      { name: 'categoryId', keyPath: 'categoryId' },
    ],
  },
  budgetGoals: {
    keyPath: 'id',
    indexes: [
      { name: 'period', keyPath: 'period' },
      { name: 'startDate', keyPath: 'startDate' },
    ],
  },
  categories: { keyPath: 'id', indexes: [] },
  character: { keyPath: 'id', indexes: [] },
  ownedRoomItems: { keyPath: 'id', indexes: [] },
  unlockedAchievements: { keyPath: 'id', indexes: [] },
};

const DEFAULT_CATEGORIES = [
  { id: 'food', name: '식비', icon: '🍚' },
  { id: 'cafe', name: '카페', icon: '☕' },
  { id: 'shopping', name: '쇼핑', icon: '🛍️' },
  { id: 'transport', name: '교통', icon: '🚇' },
  { id: 'hobby', name: '취미', icon: '🎮' },
  { id: 'living', name: '생활', icon: '🧴' },
  { id: 'etc', name: '기타', icon: '📦' },
];

let dbPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [name, cfg] of Object.entries(STORE_DEFS)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: cfg.keyPath });
          cfg.indexes.forEach((idx) => store.createIndex(idx.name, idx.keyPath));
        }
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function getDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode) {
  const db = await getDB();
  return db.transaction(name, mode).objectStore(name);
}

async function put(name, value) {
  const s = await store(name, 'readwrite');
  await reqToPromise(s.put(value));
  return value;
}

async function get(name, id) {
  const s = await store(name, 'readonly');
  return reqToPromise(s.get(id));
}

async function getAll(name) {
  const s = await store(name, 'readonly');
  return reqToPromise(s.getAll());
}

async function remove(name, id) {
  const s = await store(name, 'readwrite');
  await reqToPromise(s.delete(id));
}

async function getAllByIndex(name, indexName, value) {
  const s = await store(name, 'readonly');
  return reqToPromise(s.index(indexName).getAll(value));
}

async function getAllByRange(name, indexName, lower, upper) {
  const s = await store(name, 'readonly');
  const range = IDBKeyRange.bound(lower, upper);
  return reqToPromise(s.index(indexName).getAll(range));
}

export function genId(prefix) {
  const rand = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  return prefix ? `${prefix}-${rand}` : rand;
}

export async function seedDefaults() {
  const existingCategories = await getAll('categories');
  if (existingCategories.length === 0) {
    for (const cat of DEFAULT_CATEGORIES) await put('categories', cat);
  }
  const character = await get('character', 'main');
  if (!character) {
    await put('character', {
      id: 'main',
      name: 'Ellie',
      exp: 0,
      gold: 0,
      level: 1,
      claimedMoneyQuests: [],
    });
  }
}

// ---- schedules (메인 퀘스트) ----
export const addSchedule = (s) => put('schedules', s);
export const updateSchedule = (s) => put('schedules', s);
export const deleteSchedule = (id) => remove('schedules', id);
export const getAllSchedules = () => getAll('schedules');
export const getSchedulesByDate = (date) => getAllByIndex('schedules', 'date', date);
export const getSchedulesByRange = (start, end) => getAllByRange('schedules', 'date', start, end);

// ---- subQuests (반복 서브 퀘스트 정의) ----
export const addSubQuest = (q) => put('subQuests', q);
export const updateSubQuest = (q) => put('subQuests', q);
export const deleteSubQuest = (id) => remove('subQuests', id);
export const getAllSubQuests = () => getAll('subQuests');

// ---- questCompletions (서브 퀘스트 날짜별 완료 기록) ----
export const getAllCompletions = () => getAll('questCompletions');
export const getCompletionsByDate = (date) => getAllByIndex('questCompletions', 'date', date);
export const getCompletionsByQuest = (questId) => getAllByIndex('questCompletions', 'questId', questId);
export async function isSubQuestCompleted(questId, date) {
  const list = await getCompletionsByDate(date);
  return list.some((c) => c.questId === questId);
}
export async function addCompletion(questId, date) {
  const id = `${questId}_${date}`;
  return put('questCompletions', { id, questId, date, completedAt: new Date().toISOString() });
}
export async function removeCompletion(questId, date) {
  return remove('questCompletions', `${questId}_${date}`);
}

// ---- transactions (소비 내역) ----
export const addTransaction = (t) => put('transactions', t);
export const updateTransaction = (t) => put('transactions', t);
export const deleteTransaction = (id) => remove('transactions', id);
export const getTransactionsByDate = (date) => getAllByIndex('transactions', 'date', date);
export const getTransactionsByRange = (start, end) => getAllByRange('transactions', 'date', start, end);
export const getAllTransactions = () => getAll('transactions');

// ---- categories ----
export const getAllCategories = () => getAll('categories');
export const addCategory = (c) => put('categories', c);

// ---- budgetGoals ----
export const saveBudgetGoal = (b) => put('budgetGoals', b);
export const getBudgetGoal = (id) => get('budgetGoals', id);
export const getAllBudgetGoals = () => getAll('budgetGoals');

// ---- character ----
export const getCharacter = () => get('character', 'main');
export const saveCharacter = (c) => put('character', c);

// ---- room items ----
export const getOwnedRoomItems = () => getAll('ownedRoomItems');
export const addOwnedRoomItem = (itemId) =>
  put('ownedRoomItems', { id: itemId, itemId, purchasedAt: new Date().toISOString() });

// ---- achievements ----
export const getUnlockedAchievements = () => getAll('unlockedAchievements');
export const unlockAchievement = (id) =>
  put('unlockedAchievements', { id, unlockedAt: new Date().toISOString() });

// ---- backup (JSON export/import) ----
export async function exportAllData() {
  const data = {};
  for (const name of Object.keys(STORE_DEFS)) {
    data[name] = await getAll(name);
  }
  return { exportedAt: new Date().toISOString(), version: DB_VERSION, data };
}

export async function importAllData(payload) {
  if (!payload || !payload.data) throw new Error('잘못된 백업 파일입니다.');
  for (const [name, rows] of Object.entries(payload.data)) {
    if (!STORE_DEFS[name]) continue;
    const s = await store(name, 'readwrite');
    await reqToPromise(s.clear());
    for (const row of rows) {
      await reqToPromise(s.put(row));
    }
  }
}
