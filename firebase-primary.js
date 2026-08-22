/* Finance IA Pro v10.1.6 — Firebase principal + LocalStorage cache
   Regra: toda gravação de dados do usuário é persistida no Firebase primeiro que possível,
   mantendo LocalStorage como cache imediato/offline. Escritas offline entram na fila e são
   enviadas assim que a conexão/Firebase voltar. */
(() => {
  'use strict';

  const MAP = {
    fia_transactions: 'transactions',
    fia_goals: 'goals',
    fia_bills: 'bills',
    fia_cards: 'cards',
    fia_installments: 'installments',
    fia_categories: 'categories',
    fia_budgets: 'budgets',
    fia_recurring: 'recurring',
    fia_investments: 'investments',
    fia_debts: 'debts',
    fia_assets: 'assets',
    fia_v10_bankAccounts: 'v10/bankAccounts',
    fia_v10_subscriptions: 'v10/subscriptions',
    fia_v10_loans: 'v10/loans',
    fia_v10_cashFlow: 'v10/cashFlow',
    fia_v10_wallets: 'v10/wallets',
    fia_v10_clients: 'v10/clients',
    fia_v10_suppliers: 'v10/suppliers',
    fia_v10_receipts: 'v10/receipts',
    fia_v10_documents: 'v10/documents',
    fia_v10_planning: 'v10/planning',
    fia_v10_audit: 'v10/audit',
    fia_v10_monthlyClients: 'v10/monthlyClients'
  };

  const QUEUE_KEY = 'fia_firebase_write_queue_v1016';
  let flushing = false;
  let suppressBridge = false;

  const uid = () => (typeof state !== 'undefined' && state?.user?.id) || cloudAuth?.currentUser?.uid || null;
  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  function parse(raw, fallback = null) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  function queueRead() { return parse(localStorage.getItem(QUEUE_KEY) || '[]', []); }
  function queueWrite(q) { originalSetItem(QUEUE_KEY, JSON.stringify(q.slice(-500))); }
  function enqueue(op) {
    const q = queueRead();
    // Compacta operações repetidas da mesma chave para não crescer sem necessidade.
    const next = q.filter(x => !(x.key === op.key && x.uid === op.uid));
    next.push({ ...op, queuedAt: Date.now() });
    queueWrite(next);
  }
  function strip(item) {
    if (!item || typeof item !== 'object') return item;
    const { id, userId, ...data } = item;
    return data;
  }
  function userMapFromLocal(key, id) {
    const value = parse(localStorage.getItem(key) || '[]', []);
    if (!Array.isArray(value)) return {};
    const out = {};
    value.filter(x => x && x.id && (!x.userId || x.userId === id)).forEach(x => { out[String(x.id)] = strip(x); });
    return out;
  }
  async function writeDataset(key, id) {
    const path = MAP[key];
    if (!path || !id) return;
    const payload = userMapFromLocal(key, id);
    await cloudDb.ref(`finance/${id}/${path}`).set(payload);
  }
  async function writePreferences(id) {
    const dashboard = parse(localStorage.getItem('fia_v10_preferences') || '{"hidden":[]}', { hidden: [] });
    const theme = localStorage.getItem('fia_theme') || 'dark';
    await cloudDb.ref(`finance/${id}/preferences`).set({ dashboard, theme, updatedAt: Date.now() });
  }
  async function writeProfile(id) {
    const user = parse(localStorage.getItem('fia_user') || 'null', null);
    if (!user || !id || user.id !== id) return;
    const { id: _id, ...data } = user;
    // Não grava credenciais/senhas no banco; apenas dados de perfil existentes no app.
    delete data.password;
    delete data.senha;
    await cloudDb.ref(`users/${id}`).update(data);
  }
  async function writeAppointmentCache(key, id) {
    if (!key.startsWith('fia_booking_cache_v1_') || !id) return false;
    const value = parse(localStorage.getItem(key) || '{}', {});
    const payload = {};
    Object.entries(value || {}).forEach(([rid, item]) => {
      if (!item || item.status === 'cancelled') return;
      payload[rid] = strip(item);
    });
    await cloudDb.ref(`finance/${id}/appointments`).set(payload);
    return true;
  }

  async function mirrorKey(key, id = uid()) {
    if (!id || !cloudReady || !cloudDb || !navigator.onLine) throw new Error('firebase-offline');
    if (MAP[key]) return writeDataset(key, id);
    if (key === 'fia_v10_preferences' || key === 'fia_theme') return writePreferences(id);
    if (key === 'fia_user') return writeProfile(id);
    if (key.startsWith('fia_booking_cache_v1_')) return writeAppointmentCache(key, id);
    return false;
  }

  async function flushQueue(reason = 'manual') {
    if (flushing || !cloudReady || !cloudDb || !navigator.onLine) return false;
    const id = uid();
    if (!id) return false;
    flushing = true;
    try {
      const q = queueRead();
      const failed = [];
      for (const op of q) {
        // Só envia itens da conta atual; os demais ficam na fila para a conta correspondente.
        if (op.uid && op.uid !== id) { failed.push(op); continue; }
        try { await mirrorKey(op.key, id); }
        catch (e) { failed.push(op); }
      }
      queueWrite(failed);
      await cloudDb.ref(`finance/${id}/_sync`).update({
        lastWriteThroughAt: Date.now(),
        storageMode: 'firebase-primary-local-cache',
        reason
      });
      return failed.length === 0;
    } finally { flushing = false; }
  }

  function scheduleMirror(key) {
    if (suppressBridge || key === QUEUE_KEY || key.startsWith('fia_cloud_') || key.startsWith('fia_last_sync_')) return;
    const id = uid();
    const relevant = !!MAP[key] || key === 'fia_v10_preferences' || key === 'fia_theme' || key === 'fia_user' || key.startsWith('fia_booking_cache_v1_');
    if (!relevant || !id) return;

    enqueue({ key, uid: id });
    clearTimeout(window.__fiaFirebasePrimaryDebounce);
    window.__fiaFirebasePrimaryDebounce = setTimeout(() => flushQueue('gravacao-app').catch(console.error), 120);
  }

  // Cache local continua imediato; logo em seguida fazemos write-through para o Firebase.
  localStorage.setItem = function(key, value) {
    originalSetItem(key, value);
    scheduleMirror(String(key));
  };

  localStorage.removeItem = function(key) {
    originalRemoveItem(key);
    scheduleMirror(String(key));
  };

  async function hydrateFromFirebase() {
    const id = uid();
    if (!id || !cloudReady || !cloudDb || !navigator.onLine) return false;
    try {
      // O cloud-sync existente faz merge e atualiza state/local. Aqui garantimos uma passagem
      // imediata no login, mantendo o Firebase como fonte persistente principal.
      if (window.FinanceIASync?.syncNow) await window.FinanceIASync.syncNow();
      await flushQueue('hydrate-login');
      return true;
    } catch (e) {
      console.error('Firebase principal:', e);
      return false;
    }
  }

  window.addEventListener('online', () => flushQueue('voltou-online').catch(console.error));
  window.addEventListener('focus', () => flushQueue('foco').catch(console.error));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushQueue('visivel').catch(console.error);
  });

  const boot = setInterval(() => {
    if (uid() && cloudReady && cloudDb) {
      clearInterval(boot);
      hydrateFromFirebase();
    }
  }, 350);
  setTimeout(() => clearInterval(boot), 20000);

  window.FirebasePrimaryStorage = {
    flushNow: () => flushQueue('manual'),
    status: () => ({
      primary: 'firebase',
      cache: 'localStorage',
      online: navigator.onLine,
      firebaseReady: !!cloudReady,
      pendingWrites: queueRead().length,
      uid: uid()
    })
  };
})();
