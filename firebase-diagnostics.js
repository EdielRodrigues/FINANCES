/* Finance IA Pro v10.1.7 — Diagnóstico Firebase */
(() => {
  'use strict';

  let lastShown = '';

  function currentUid(){
    try { return state?.user?.id || cloudAuth?.currentUser?.uid || null; }
    catch { return null; }
  }

  function showOnce(message){
    if (!message || message === lastShown) return;
    lastShown = message;
    console.warn('[Finance IA Pro / Firebase]', message);
    try { if (typeof toast === 'function') toast(message); } catch {}
  }

  async function testFirebaseWrite(reason='manual'){
    const uid = currentUid();
    if (!uid) return { ok:false, reason:'sem-uid' };
    if (!cloudReady || !cloudDb) {
      showOnce('Firebase não inicializou. Os dados estão ficando somente no aparelho.');
      return { ok:false, reason:'firebase-nao-inicializado' };
    }

    try {
      const ref = cloudDb.ref(`finance/${uid}/_diagnostic`);
      const payload = {
        ok: true,
        reason,
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        appVersion: '10.1.7'
      };
      await ref.update(payload);
      return { ok:true, uid };
    } catch (err) {
      const code = String(err?.code || '');
      const msg = String(err?.message || err || '');
      if (/permission|denied/i.test(code + ' ' + msg)) {
        showOnce('Firebase bloqueou a gravação (PERMISSION_DENIED). Publique as regras do database.rules.json.');
      } else {
        showOnce(`Falha ao gravar no Firebase: ${msg || code || 'erro desconhecido'}`);
      }
      return { ok:false, reason:code || msg };
    }
  }

  async function forceSync(){
    const test = await testFirebaseWrite('force-sync');
    if (!test.ok) return test;

    try {
      if (window.FirebasePrimaryStorage?.flushNow) await window.FirebasePrimaryStorage.flushNow();
      if (window.FinanceIASync?.syncNow) await window.FinanceIASync.syncNow();
      return { ok:true, uid:currentUid() };
    } catch (err) {
      showOnce(`Não foi possível sincronizar: ${err?.message || err}`);
      return { ok:false, reason:err?.message || String(err) };
    }
  }

  window.addEventListener('online', () => forceSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') forceSync();
  });

  const timer = setInterval(() => {
    if (currentUid()) {
      clearInterval(timer);
      setTimeout(() => forceSync(), 500);
    }
  }, 300);
  setTimeout(() => clearInterval(timer), 20000);

  window.FirebaseDiagnostics = { testFirebaseWrite, forceSync };
})();
