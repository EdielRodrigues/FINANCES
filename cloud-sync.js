/* Finance IA Pro v10.1.6 — Firebase principal + cache local sincronizado */
(() => {
  'use strict';

  const DATASETS = {
    transactions: { local: 'fia_transactions', cloud: 'transactions' },
    goals: { local: 'fia_goals', cloud: 'goals' },
    bills: { local: 'fia_bills', cloud: 'bills' },
    cards: { local: 'fia_cards', cloud: 'cards' },
    installments: { local: 'fia_installments', cloud: 'installments' },
    categories: { local: 'fia_categories', cloud: 'categories' },
    budgets: { local: 'fia_budgets', cloud: 'budgets' },
    recurring: { local: 'fia_recurring', cloud: 'recurring' },
    investments: { local: 'fia_investments', cloud: 'investments' },
    debts: { local: 'fia_debts', cloud: 'debts' },
    assets: { local: 'fia_assets', cloud: 'assets' },
    bankAccounts: { local: 'fia_v10_bankAccounts', cloud: 'v10/bankAccounts' },
    subscriptions: { local: 'fia_v10_subscriptions', cloud: 'v10/subscriptions' },
    loans: { local: 'fia_v10_loans', cloud: 'v10/loans' },
    cashFlow: { local: 'fia_v10_cashFlow', cloud: 'v10/cashFlow' },
    wallets: { local: 'fia_v10_wallets', cloud: 'v10/wallets' },
    clients: { local: 'fia_v10_clients', cloud: 'v10/clients' },
    suppliers: { local: 'fia_v10_suppliers', cloud: 'v10/suppliers' },
    receipts: { local: 'fia_v10_receipts', cloud: 'v10/receipts' },
    documents: { local: 'fia_v10_documents', cloud: 'v10/documents' },
    planning: { local: 'fia_v10_planning', cloud: 'v10/planning' },
    audit: { local: 'fia_v10_audit', cloud: 'v10/audit' },
    monthlyClients: { local: 'fia_v10_monthlyClients', cloud: 'v10/monthlyClients' }
  };

  let syncBusy = false;
  let syncTimer = null;
  let lastSyncAt = 0;

  const uid = () => state?.user?.id || cloudAuth?.currentUser?.uid || null;
  const shadowKey = id => `fia_cloud_shadow_${id}`;
  const metaKey = id => `fia_cloud_meta_${id}`;

  function safeParse(raw, fallback) {
    try { return JSON.parse(raw ?? '') ?? fallback; } catch { return fallback; }
  }
  function safeJson(value) {
    try { return JSON.stringify(value ?? null); } catch { return 'null'; }
  }
  function itemStamp(item) {
    return Number(item?.updatedAt || item?.createdAt || item?.timestamp || 0);
  }
  function stripUser(item) {
    if (!item || typeof item !== 'object') return item;
    const { id, userId, ...data } = item;
    return data;
  }
  function listForUser(key, id) {
    const list = safeParse(localStorage.getItem(key), []);
    return Array.isArray(list) ? list.filter(x => !x?.userId || x.userId === id) : [];
  }
  function writeUserList(key, id, mine) {
    const current = safeParse(localStorage.getItem(key), []);
    const others = Array.isArray(current) ? current.filter(x => x?.userId && x.userId !== id) : [];
    localStorage.setItem(key, JSON.stringify([...others, ...mine]));
  }
  function getShadow(id) { return safeParse(localStorage.getItem(shadowKey(id)), {}); }
  function setShadow(id, shadow) { localStorage.setItem(shadowKey(id), JSON.stringify(shadow)); }

  async function syncDataset(name, cfg, id, shadowRoot) {
    const local = listForUser(cfg.local, id);
    const localMap = Object.fromEntries(local.filter(x => x?.id).map(x => [String(x.id), x]));
    const shadowMap = shadowRoot[name] || {};
    const snap = await cloudDb.ref(`finance/${id}/${cfg.cloud}`).once('value');
    const remoteRaw = snap.val() || {};
    const remoteMap = Object.fromEntries(Object.entries(remoteRaw).map(([rid, data]) => [rid, { id: rid, userId: id, ...(data || {}) }]));
    const updates = {};
    const finalMap = {};
    const ids = new Set([...Object.keys(localMap), ...Object.keys(remoteMap), ...Object.keys(shadowMap)]);

    for (const rid of ids) {
      const l = localMap[rid];
      const r = remoteMap[rid];
      const s = shadowMap[rid];
      const localChanged = !!l && (!s || safeJson(stripUser(l)) !== safeJson(s));
      const localDeleted = !l && !!s;
      const remoteDeleted = !r && !!s;
      const remoteChanged = !!r && (!s || safeJson(stripUser(r)) !== safeJson(s));

      if (localDeleted) {
        updates[rid] = null;
        continue;
      }
      if (remoteDeleted && !localChanged) continue;
      if (l && !r) {
        updates[rid] = stripUser(l);
        finalMap[rid] = l;
        continue;
      }
      if (!l && r) {
        finalMap[rid] = r;
        continue;
      }
      if (!l && !r) continue;

      if (localChanged && remoteChanged) {
        if (itemStamp(r) > itemStamp(l)) finalMap[rid] = r;
        else { finalMap[rid] = l; updates[rid] = stripUser(l); }
      } else if (localChanged) {
        finalMap[rid] = l;
        updates[rid] = stripUser(l);
      } else {
        finalMap[rid] = r;
      }
    }

    if (Object.keys(updates).length) await cloudDb.ref(`finance/${id}/${cfg.cloud}`).update(updates);
    const finalList = Object.values(finalMap);
    writeUserList(cfg.local, id, finalList);
    if (Array.isArray(state?.[name])) {
      const others = state[name].filter(x => x?.userId && x.userId !== id);
      state[name] = [...others, ...finalList];
    }
    shadowRoot[name] = Object.fromEntries(finalList.map(x => [String(x.id), stripUser(x)]));
  }

  async function syncPreferences(id) {
    const localPrefs = safeParse(localStorage.getItem('fia_v10_preferences'), { hidden: [] });
    const remoteSnap = await cloudDb.ref(`finance/${id}/preferences`).once('value');
    const remote = remoteSnap.val() || {};
    const localMeta = safeParse(localStorage.getItem(metaKey(id)), {});
    const localChangedAt = Number(localMeta.preferencesChangedAt || 0);
    const remoteChangedAt = Number(remote.updatedAt || 0);
    if (localChangedAt > remoteChangedAt) {
      await cloudDb.ref(`finance/${id}/preferences`).set({ dashboard: localPrefs, theme: localStorage.getItem('fia_theme') || 'dark', updatedAt: localChangedAt });
    } else if (remote.dashboard) {
      localStorage.setItem('fia_v10_preferences', JSON.stringify(remote.dashboard));
      if (remote.theme) localStorage.setItem('fia_theme', remote.theme);
      if (typeof state !== 'undefined') state.v10Preferences = remote.dashboard;
    } else {
      await cloudDb.ref(`finance/${id}/preferences`).set({ dashboard: localPrefs, theme: localStorage.getItem('fia_theme') || 'dark', updatedAt: Date.now() });
    }
  }

  async function syncEverything(reason = 'manual') {
    const id = uid();
    if (syncBusy || !id || !cloudReady || !cloudDb || !navigator.onLine) return false;
    syncBusy = true;
    try {
      const shadow = getShadow(id);
      for (const [name, cfg] of Object.entries(DATASETS)) await syncDataset(name, cfg, id, shadow);
      await syncPreferences(id);
      await cloudDb.ref(`finance/${id}/_sync`).update({ lastSyncAt: Date.now(), lastDevice: navigator.userAgent.slice(0, 180), reason });
      setShadow(id, shadow);
      lastSyncAt = Date.now();
      localStorage.setItem(`fia_last_sync_${id}`, String(lastSyncAt));
      if (typeof render === 'function') render();
      return true;
    } catch (e) {
      console.error('Sincronização Firebase + local:', e);
      return false;
    } finally { syncBusy = false; }
  }

  function markPreferencesChanged() {
    const id = uid(); if (!id) return;
    const meta = safeParse(localStorage.getItem(metaKey(id)), {});
    meta.preferencesChangedAt = Date.now();
    localStorage.setItem(metaKey(id), JSON.stringify(meta));
  }

  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    originalSetItem(key, value);
    if (key === 'fia_theme' || key === 'fia_v10_preferences') markPreferencesChanged();
  };

  if (typeof subscribeCloudData === 'function') {
    const previousSubscribe = subscribeCloudData;
    subscribeCloudData = function(id) {
      previousSubscribe(id);
      setTimeout(() => syncEverything('login'), 400);
    };
  }
  if (typeof persist === 'function') {
    const previousPersist = persist;
    persist = function() {
      const result = previousPersist();
      clearTimeout(window.__fiaSyncDebounce);
      window.__fiaSyncDebounce = setTimeout(() => syncEverything('alteracao-local'), 900);
      return result;
    };
  }

  window.addEventListener('online', () => syncEverything('voltou-online'));
  window.addEventListener('focus', () => { if (Date.now() - lastSyncAt > 15000) syncEverything('foco'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastSyncAt > 15000) syncEverything('visivel'); });
  syncTimer = setInterval(() => syncEverything('automatico'), 30000);

  window.FinanceIASync = {
    syncNow: () => syncEverything('manual'),
    getStatus: () => ({ online: navigator.onLine, firebase: !!cloudReady, lastSyncAt: Number(localStorage.getItem(`fia_last_sync_${uid()}`) || 0) })
  };
})();
