/* Finance IA Pro v10.0 — módulos profissionais adicionais */
(() => {
  'use strict';

  function iniciarModulosV10() {
    try {

      const MODULES = {
        bankAccounts: { label: 'Contas bancárias', icon: '🏦' },
        subscriptions: { label: 'Assinaturas', icon: '🔁' },
        loans: { label: 'Empréstimos', icon: '🤝' },
        cashFlow: { label: 'Fluxo de caixa', icon: '📈' },
        wallets: { label: 'Carteiras', icon: '👨‍👩‍👧' },
        clients: { label: 'Clientes', icon: '👥' },
        suppliers: { label: 'Fornecedores', icon: '🚚' },
        receipts: { label: 'Recibos', icon: '🧾' },
        documents: { label: 'Documentos', icon: '📂' },
        planning: { label: 'Planejamento', icon: '🗓️' },
        audit: { label: 'Histórico', icon: '🛡️' },
        dashboardSettings: { label: 'Personalizar', icon: '⚙️' },
        monthlyClients: { label: 'Clientes mensais', icon: '📆' }
      };

      const safeRead = (key, fallback = []) => {
        try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
        catch { return fallback; }
      };
      const saveLocal = (type) => localStorage.setItem(`fia_v10_${type}`, JSON.stringify(state[type] || []));
      const mine = (list) => (list || []).filter(item => item.userId === state.user?.id);
      const uid = () => state.user?.id;
      const id = () => (crypto.randomUUID ? crypto.randomUUID() : `v10_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      const brDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : '—';
      const esc = value => typeof escapeHtml === 'function' ? escapeHtml(value) : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const numberValue = value => typeof parseBRMoney === 'function' ? parseBRMoney(value) : Number(String(value).replace(/\./g,'').replace(',','.')) || 0;
      const moneyText = value => typeof money === 'function' ? money(value) : Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

      Object.keys(MODULES).forEach(type => {
        if (!Array.isArray(state[type])) state[type] = safeRead(`fia_v10_${type}`);
      });
      state.v10Preferences = safeRead('fia_v10_preferences', { hidden: [] });
      if (Array.isArray(state.v10Preferences)) state.v10Preferences = { hidden: [] };

      async function cloudSet(type, item) {
        if (!cloudReady || !uid()) return;
        const { id: itemId, userId, ...data } = item;
        await cloudDb.ref(`finance/${uid()}/v10/${type}/${itemId}`).set(data);
      }
      async function cloudRemove(type, itemId) {
        if (!cloudReady || !uid()) return;
        await cloudDb.ref(`finance/${uid()}/v10/${type}/${itemId}`).remove();
      }
      async function addItem(type, data) {
        const item = { id: id(), userId: uid(), createdAt: Date.now(), ...data };
        state[type].push(item);
        saveLocal(type);
        await cloudSet(type, item);
        addAudit(`Criou registro em ${MODULES[type]?.label || type}`, item.id);
        return item;
      }
      async function deleteItem(type, itemId) {
        state[type] = (state[type] || []).filter(x => x.id !== itemId);
        saveLocal(type);
        await cloudRemove(type, itemId);
        addAudit(`Excluiu registro de ${MODULES[type]?.label || type}`, itemId);
      }
      async function updateItem(type, itemId, changes) {
        const item = (state[type] || []).find(x => x.id === itemId);
        if (!item) return null;
        Object.assign(item, changes, { updatedAt: Date.now() });
        saveLocal(type);
        await cloudSet(type, item);
        addAudit(`Editou registro em ${MODULES[type]?.label || type}`, itemId);
        return item;
      }
      function nextMonthDate(value, fallbackDay = 1) {
        const base = value ? new Date(`${value}T12:00:00`) : new Date();
        const originalDay = Number(fallbackDay || base.getDate() || 1);
        const next = new Date(base.getFullYear(), base.getMonth() + 1, 1, 12, 0, 0);
        const max = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(originalDay, max));
        return next.toISOString().slice(0, 10);
      }
      function bindMoneyInput(el) {
        if (!el) return;
        if (typeof enableLiveMoneyMask === 'function') enableLiveMoneyMask(el);
      }
      function bindV10MoneyInputs(...ids) { ids.forEach(key => bindMoneyInput($(key))); }
      function addAudit(action, targetId = '') {
        const item = { id: id(), userId: uid(), action, targetId, createdAt: Date.now() };
        state.audit = state.audit || [];
        state.audit.unshift(item);
        state.audit = state.audit.slice(0, 300);
        saveLocal('audit');
        if (cloudReady && uid()) cloudSet('audit', item).catch(() => {});
      }

      async function deleteAuditItem(itemId) {
        state.audit = (state.audit || []).filter(item => !(item.userId === uid() && item.id === itemId));
        saveLocal('audit');
        if (cloudReady && uid()) await cloudRemove('audit', itemId);
      }
      async function clearAuditHistory() {
        state.audit = (state.audit || []).filter(item => item.userId !== uid());
        saveLocal('audit');
        if (cloudReady && uid()) await cloudDb.ref(`finance/${uid()}/v10/audit`).remove();
      }

      const previousSubscribe = subscribeCloudData;
      subscribeCloudData = function(userId) {
        previousSubscribe(userId);
        Object.keys(MODULES).forEach(type => {
          const ref = cloudDb.ref(`finance/${userId}/v10/${type}`);
          const listener = ref.on('value', snap => {
            const value = snap.val() || {};
            const remote = Object.entries(value).map(([itemId, data]) => ({ id: itemId, userId, ...data }));
            const local = mine(state[type]);
            if (remote.length || !local.length) {
              state[type] = [...(state[type] || []).filter(x => x.userId !== userId), ...remote];
              saveLocal(type);
              render();

              // V10.1.8 — atualização em tempo real das telas abertas.
              // Antes, o Firebase atualizava o state, mas o modal de recibos
              // continuava mostrando o HTML antigo até fechar e abrir novamente.
              if (type === 'receipts' && document.getElementById('v10ReceiptSearch')) {
                clearTimeout(window.__fiaReceiptLiveRefresh);
                window.__fiaReceiptLiveRefresh = setTimeout(() => receiptsModal(), 80);
              }
              if (type === 'documents' && document.getElementById('v10DocumentSearch')) {
                clearTimeout(window.__fiaDocumentLiveRefresh);
                window.__fiaDocumentLiveRefresh = setTimeout(() => documentsModal(), 80);
              }
            }
          });
          cloudUnsubs.push(() => ref.off('value', listener));
        });
      };

      function quickButtonHtml(key, icon, label) {
        return `<button id="v10_${key}"><span>${icon}</span>${label}</button>`;
      }

      function installDashboard() {
        const quick = document.querySelector('.quick-actions');
        if (!quick || document.getElementById('v10_bankAccounts')) return;
        const items = [
          ['bankAccounts','🏦','Bancos'], ['subscriptions','🔁','Assinaturas'],
          ['loans','🤝','Empréstimos'], ['cashFlow','📈','Fluxo de caixa'],
          ['wallets','👨‍👩‍👧','Carteiras'], ['clients','👥','Clientes'],
          ['suppliers','🚚','Fornecedores'], ['receipts','🧾','Recibos'],
          ['documents','📂','Documentos'], ['planning','🗓️','Planejamento'],
          ['monthlyClients','📆','Clientes mensais'], ['audit','🛡️','Histórico'],
          ['dashboardSettings','⚙️','Personalizar']
        ];
        quick.insertAdjacentHTML('beforeend', items.map(x => quickButtonHtml(...x)).join(''));
        items.forEach(([key]) => {
          const btn = document.getElementById(`v10_${key}`);
          if (btn) btn.onclick = () => openModule(key);
        });
        applyDashboardPreferences();
        addV10Summary();
      }

      function applyDashboardPreferences() {
        const hidden = new Set(state.v10Preferences?.hidden || []);
        Object.keys(MODULES).forEach(key => {
          const button = document.getElementById(`v10_${key}`);
          if (button) button.style.display = hidden.has(key) ? 'none' : '';
        });
      }

      function addV10Summary() {
        const summary = document.querySelector('.summary-grid');
        if (!summary || document.getElementById('v10BankBalance')) return;
        summary.insertAdjacentHTML('beforeend', `
          <article class="summary"><span>Saldo em bancos</span><strong id="v10BankBalance">R$ 0,00</strong></article>
          <article class="summary"><span>Assinaturas/mês</span><strong id="v10SubscriptionsTotal">R$ 0,00</strong></article>
          <article class="summary"><span>Dívidas abertas</span><strong id="v10LoansTotal">R$ 0,00</strong></article>
          <article class="summary"><span>Previsão 30 dias</span><strong id="v10Forecast">R$ 0,00</strong></article>`);
      }

      function renderV10Summary() {
        if (!uid()) return;
        const banks = mine(state.bankAccounts).reduce((s,x)=>s+Number(x.balance||0),0);
        const subscriptions = mine(state.subscriptions).filter(x=>x.active!==false).reduce((s,x)=>s+Number(x.value||0),0);
        const loans = mine(state.loans).filter(x=>x.status!=='paid').reduce((s,x)=>s+Number(x.balance||x.value||0),0);
        const upcomingBills = mine(state.bills || []).filter(x=>!['paid','received'].includes(x.status));
        const toReceive = upcomingBills.filter(x=>x.kind==='receivable').reduce((s,x)=>s+Number(x.value||0),0);
        const toPay = upcomingBills.filter(x=>x.kind==='payable').reduce((s,x)=>s+Number(x.value||0),0);
        const monthlyOpen = mine(state.monthlyClients || []).reduce((sum,client)=>sum+(client.entries||[]).reduce((s,entry)=>s+Number(entry.value||0),0),0);
        const forecast = banks + toReceive + monthlyOpen - toPay - subscriptions;
        const put=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=moneyText(value)};
        put('v10BankBalance',banks); put('v10SubscriptionsTotal',subscriptions); put('v10LoansTotal',loans); put('v10Forecast',forecast);
      }

      const previousRender = render;
      render = function() {
        previousRender();
        installDashboard();
        renderV10Summary();
      };

      function openModule(type) {
        if (typeof canUsePremiumApp === 'function' && !canUsePremiumApp()) return paymentModal();
        const handlers = {
          bankAccounts: bankAccountsModal, subscriptions: subscriptionsModal, loans: loansModal,
          cashFlow: cashFlowModal, wallets: walletsModal, clients: clientsModal,
          suppliers: suppliersModal, receipts: receiptsModal, documents: documentsModal,
          planning: planningModal, monthlyClients: monthlyClientsModal, audit: auditModal, dashboardSettings: dashboardSettingsModal
        };
        handlers[type]?.();
      }

      function listHtml(type, empty = 'Nenhum registro cadastrado.') {
        const list = mine(state[type]);
        return list.length ? list.map(item => `
          <article class="v10-row">
            <div><b>${esc(item.name || item.description || item.title || 'Registro')}</b>
            <small>${item.value != null ? moneyText(item.value) : item.balance != null ? moneyText(item.balance) : ''}${item.date ? ` • ${brDate(item.date)}` : ''}${item.dueDate ? ` • vence ${brDate(item.dueDate)}` : ''}${item.status ? ` • ${esc(item.status)}` : ''}</small></div>
            <div class="v10-row-actions"><button class="secondary v10-edit" data-type="${type}" data-id="${item.id}">Editar</button><button class="danger-button v10-delete" data-type="${type}" data-id="${item.id}">Excluir</button></div>
          </article>`).join('') : `<div class="empty-state">${empty}</div>`;
      }
      function bindRowActions(reopen) {
        document.querySelectorAll('.v10-delete').forEach(btn => btn.onclick = async () => {
          if (!confirm('Excluir este registro?')) return;
          await deleteItem(btn.dataset.type, btn.dataset.id);
          reopen();
          toast('Registro excluído.');
        });
        document.querySelectorAll('.v10-edit').forEach(btn => btn.onclick = () => genericEditModal(btn.dataset.type, btn.dataset.id, reopen));
      }
      const bindDeletes = bindRowActions;
      function genericEditModal(type, itemId, reopen) {
        const item = (state[type] || []).find(x => x.id === itemId);
        if (!item) return;
        const hasValue = item.value != null;
        const hasBalance = item.balance != null;
        const hasDate = item.date != null || item.dueDate != null;
        openModal(`<h2>Editar ${esc(MODULES[type]?.label || 'registro')}</h2><form id="v10GenericEdit" class="form-grid">
          <label>Nome/descrição<input id="v10EditName" value="${esc(item.name || item.description || item.title || '')}" required></label>
          ${hasValue ? `<label>Valor<input id="v10EditValue" inputmode="decimal" value="${esc(moneyText(item.value).replace(/[^0-9,.-]/g,''))}"></label>` : ''}
          ${hasBalance ? `<label>Saldo/valor<input id="v10EditBalance" inputmode="decimal" value="${esc(moneyText(item.balance).replace(/[^0-9,.-]/g,''))}"></label>` : ''}
          ${hasDate ? `<label>Data<input id="v10EditDate" type="date" value="${esc(item.dueDate || item.date || '')}"></label>` : ''}
          <label>Categoria<input id="v10EditCategory" value="${esc(item.category || '')}"></label>
          <label>Status<select id="v10EditStatus"><option value="active" ${item.status==='active'?'selected':''}>Ativo</option><option value="pending" ${item.status==='pending'?'selected':''}>Pendente</option><option value="paid" ${item.status==='paid'?'selected':''}>Pago</option><option value="received" ${item.status==='received'?'selected':''}>Recebido</option><option value="paused" ${item.status==='paused'?'selected':''}>Pausado</option></select></label>
          <label>Observações<textarea id="v10EditNotes">${esc(item.notes || '')}</textarea></label>
          <button class="primary">Salvar alterações</button></form>`);
        bindV10MoneyInputs('v10EditValue','v10EditBalance');
        $('v10GenericEdit').onsubmit = async e => { e.preventDefault(); const changes={};
          const name=$('v10EditName').value.trim(); if ('description' in item && !('name' in item)) changes.description=name; else if ('title' in item && !('name' in item)) changes.title=name; else changes.name=name;
          if (hasValue) changes.value=numberValue($('v10EditValue').value);
          if (hasBalance) changes.balance=numberValue($('v10EditBalance').value);
          if (hasDate) { if (item.dueDate != null) changes.dueDate=$('v10EditDate').value; else changes.date=$('v10EditDate').value; }
          changes.category=$('v10EditCategory').value.trim(); changes.status=$('v10EditStatus').value; changes.notes=$('v10EditNotes').value.trim();
          await updateItem(type,itemId,changes); reopen(); toast('Registro atualizado.'); };
      }

      function bankAccountsModal() {
        openModal(`<h2>Contas bancárias e caixas</h2>
          <form id="v10BankForm" class="form-grid">
            <label>Nome da conta<input id="v10BankName" required placeholder="Ex.: Banco, carteira, caixa"></label>
            <label>Tipo<select id="v10BankType"><option>Conta corrente</option><option>Poupança</option><option>Carteira</option><option>Caixa da empresa</option><option>Investimentos</option></select></label>
            <label>Saldo atual<input id="v10BankBalanceInput" inputmode="decimal" required placeholder="0,00"></label>
            <button class="primary">Adicionar conta</button>
          </form><div class="v10-list">${listHtml('bankAccounts')}</div>`);
        bindV10MoneyInputs('v10BankBalanceInput');
        $('v10BankForm').onsubmit = async e => { e.preventDefault(); await addItem('bankAccounts',{name:$('v10BankName').value,type:$('v10BankType').value,balance:numberValue($('v10BankBalanceInput').value)}); bankAccountsModal(); toast('Conta adicionada.'); };
        bindDeletes(bankAccountsModal);
      }

      function subscriptionsModal(editId = null) {
        const editing = editId ? (state.subscriptions || []).find(x => x.id === editId) : null;
        const rows = mine(state.subscriptions).map(item => `<article class="v10-row subscription-row"><div><b>${esc(item.name)}</b><small>${moneyText(item.value)} • Próxima cobrança: ${brDate(item.dueDate || nextMonthDate('', item.day || 1))}${item.lastPaidAt ? ` • Último pagamento: ${new Date(item.lastPaidAt).toLocaleDateString('pt-BR')}` : ''}</small></div><div class="v10-row-actions"><button class="primary v10-sub-pay" data-id="${item.id}">Dar como paga</button><button class="secondary v10-sub-edit" data-id="${item.id}">Editar</button><button class="danger-button v10-delete" data-type="subscriptions" data-id="${item.id}">Excluir</button></div></article>`).join('');
        openModal(`<h2>Assinaturas e contas mensais</h2>
          <form id="v10SubscriptionForm" class="form-grid">
            <label>Serviço/conta<input id="v10SubName" required placeholder="Ex.: Internet, água, aluguel" value="${esc(editing?.name || '')}"></label>
            <label>Valor mensal<input id="v10SubValue" inputmode="decimal" required value="${editing ? esc(moneyText(editing.value).replace(/[^0-9,.-]/g,'')) : ''}"></label>
            <label>Próxima cobrança<input id="v10SubDue" type="date" required value="${esc(editing?.dueDate || todayISO())}"></label>
            <label>Categoria<input id="v10SubCategory" placeholder="Ex.: Serviços" value="${esc(editing?.category || '')}"></label>
            <button class="primary">${editing ? 'Salvar alteração' : 'Adicionar assinatura'}</button>
          </form><div class="v10-list">${rows || '<div class="empty-state">Nenhuma assinatura cadastrada.</div>'}</div>`);
        bindV10MoneyInputs('v10SubValue');
        $('v10SubscriptionForm').onsubmit = async e => { e.preventDefault(); const data={name:$('v10SubName').value.trim(),value:numberValue($('v10SubValue').value),dueDate:$('v10SubDue').value,day:Number($('v10SubDue').value.slice(8,10)),category:$('v10SubCategory').value.trim(),active:true,status:'pending'}; if(editing) await updateItem('subscriptions',editing.id,data); else await addItem('subscriptions',data); subscriptionsModal(); toast(editing?'Assinatura atualizada.':'Assinatura adicionada.'); };
        document.querySelectorAll('.v10-sub-edit').forEach(btn=>btn.onclick=()=>subscriptionsModal(btn.dataset.id));
        document.querySelectorAll('.v10-sub-pay').forEach(btn=>btn.onclick=()=>paySubscription(btn.dataset.id));
        bindDeletes(subscriptionsModal);
      }
      async function paySubscription(itemId) {
        const item=(state.subscriptions||[]).find(x=>x.id===itemId); if(!item)return;
        if(!confirm(`Confirmar pagamento de ${item.name} no valor de ${moneyText(item.value)}?`))return;
        const paidAt=Date.now(); const oldDue=item.dueDate || todayISO(); const nextDue=nextMonthDate(oldDue,item.day || Number(oldDue.slice(8,10)) || 1);
        const tx={id:id(),userId:uid(),type:'expense',description:item.name,value:Number(item.value||0),category:item.category||'Assinaturas',date:todayISO(),createdAt:paidAt,sourceSubscriptionId:item.id};
        state.transactions.push(tx); item.lastPaidAt=paidAt; item.lastPaidDate=todayISO(); item.dueDate=nextDue; item.day=Number(nextDue.slice(8,10)); item.status='pending'; item.paymentCount=Number(item.paymentCount||0)+1; item.updatedAt=paidAt;
        saveLocal('subscriptions'); if(typeof persist==='function')persist(); await cloudSet('subscriptions',item);
        if(cloudReady){const {id:txId,userId,...data}=tx;await cloudDb.ref(`finance/${uid()}/transactions/${txId}`).set(data)}
        addAudit(`Pagou assinatura ${item.name}`,item.id); subscriptionsModal(); if(typeof render==='function')render(); toast(`Pagamento registrado. Próxima cobrança: ${brDate(nextDue)}.`);
      }

      function loansModal() {
        openModal(`<h2>Empréstimos e financiamentos</h2>
          <form id="v10LoanForm" class="form-grid">
            <label>Descrição<input id="v10LoanName" required></label>
            <label>Saldo devedor<input id="v10LoanBalance" inputmode="decimal" required></label>
            <label>Valor da parcela<input id="v10LoanInstallment" inputmode="decimal" required></label>
            <label>Próximo vencimento<input id="v10LoanDate" type="date" required></label>
            <label>Quantidade de parcelas restantes<input id="v10LoanCount" type="number" min="1" required></label>
            <button class="primary">Adicionar empréstimo</button>
          </form><div class="v10-list">${listHtml('loans')}</div>`);
        bindV10MoneyInputs('v10LoanBalance','v10LoanInstallment');
        $('v10LoanForm').onsubmit = async e => { e.preventDefault(); await addItem('loans',{name:$('v10LoanName').value,balance:numberValue($('v10LoanBalance').value),installment:numberValue($('v10LoanInstallment').value),date:$('v10LoanDate').value,remaining:Number($('v10LoanCount').value),status:'active'}); loansModal(); };
        bindDeletes(loansModal);
      }

      function cashFlowModal() {
        const tx = userTx();
        const bills = mine(state.bills || []);
        const monthlyClients = mine(state.monthlyClients || []);
        const months = {};
        tx.forEach(x => {
          const month=String(x.date||'').slice(0,7)||'Sem data';
          months[month]=months[month]||{income:0,expense:0};
          months[month][x.type==='income'?'income':'expense'] += Number(x.value||0);
        });
        const rows = Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0])).map(([month,v])=>`<div class="v10-flow-row"><b>${esc(month)}</b><span class="income">+ ${moneyText(v.income)}</span><span class="expense">− ${moneyText(v.expense)}</span><strong>${moneyText(v.income-v.expense)}</strong></div>`).join('');
        const pending = bills.filter(x=>!['paid','received'].includes(x.status));
        const pendingPay = pending.filter(x=>x.kind==='payable').reduce((s,x)=>s+Number(x.value||0),0);
        const pendingReceive = pending.filter(x=>x.kind==='receivable').reduce((s,x)=>s+Number(x.value||0),0);
        const monthlyOpen = monthlyClients.reduce((sum,client)=>sum+(client.entries||[]).reduce((s,entry)=>s+Number(entry.value||0),0),0);
        const monthlyRows = monthlyClients.filter(c=>(c.entries||[]).length).map(c=>{
          const total=(c.entries||[]).reduce((s,e)=>s+Number(e.value||0),0);
          return `<article class="v10-row"><div><b>${esc(c.name)}</b><small>${(c.entries||[]).length} lançamento(s) em aberto • fechamento dia ${c.closingDay||30}</small></div><strong>${moneyText(total)}</strong></article>`;
        }).join('');
        openModal(`<h2>Fluxo de caixa consolidado</h2>
          <p class="muted">Receitas, despesas, contas e clientes mensais usam o mesmo histórico financeiro.</p>
          <div class="v10-metrics">
            <article><span>Meses analisados</span><strong>${Object.keys(months).length}</strong></article>
            <article><span>Contas a pagar</span><strong>${moneyText(pendingPay)}</strong></article>
            <article><span>Contas a receber</span><strong>${moneyText(pendingReceive)}</strong></article>
            <article><span>Clientes mensais em aberto</span><strong>${moneyText(monthlyOpen)}</strong></article>
          </div>
          <h3>Movimentação realizada</h3>
          <div class="v10-flow">${rows||'<div class="empty-state">Cadastre lançamentos para gerar o fluxo de caixa.</div>'}</div>
          <h3>Valores ainda em aberto</h3>
          <div class="v10-list">${monthlyRows||'<div class="empty-state">Nenhum acerto mensal em aberto.</div>'}</div>`);
      }

      async function familyWalletList() {
        if (!cloudReady || !BACKEND_URL || !cloudAuth?.currentUser) return [];
        try { const r=await apiFetch('/familyWallet/list'); return Array.isArray(r.wallets)?r.wallets:[]; }
        catch(e){ console.warn('Carteiras compartilhadas:',e.message); return []; }
      }

      function familyWalletCard(w) {
        const members=Object.values(w.members||{});
        const total=Object.values(w.entries||{}).reduce((sum,e)=>sum+(e.kind==='expense'?-Number(e.value||0):Number(e.value||0)),0);
        return `<article class="family-wallet-card">
          <div class="family-wallet-head"><div><span class="family-wallet-badge">👨‍👩‍👧 Compartilhada</span><h3>${esc(w.name||'Família')}</h3><small>${members.length} membro(s) • código ${esc(w.inviteCode||'—')}</small></div><strong>${moneyText(total)}</strong></div>
          <div class="family-wallet-members">${members.slice(0,5).map(m=>`<span title="${esc(m.email||'')}">${esc((m.name||m.email||'U').slice(0,1).toUpperCase())}</span>`).join('')}${members.length>5?`<i>+${members.length-5}</i>`:''}</div>
          <div class="family-wallet-actions"><button class="primary family-open" data-id="${esc(w.id)}">Abrir compartilhada</button><button class="secondary family-copy" data-code="${esc(w.inviteCode||'')}">Copiar código</button></div>
        </article>`;
      }

      async function walletsModal() {
        const shared=await familyWalletList();
        const personal=mine(state.wallets);
        openModal(`<div class="wallets-advanced-head"><div><h2>Carteiras e centros de controle</h2><p class="muted">Organize finanças pessoais, empresariais e compartilhe uma carteira com toda a família em tempo real.</p></div></div>
          <div class="v10-metrics wallet-metrics"><article><span>Minhas carteiras</span><strong>${personal.length}</strong></article><article><span>Compartilhadas</span><strong>${shared.length}</strong></article><article><span>Limites pessoais</span><strong>${moneyText(personal.reduce((s,x)=>s+Number(x.value||0),0))}</strong></article></div>
          <div class="wallet-tabs"><button id="walletTabPersonal" class="secondary">＋ Carteira pessoal</button><button id="walletTabFamily" class="primary">👨‍👩‍👧 Criar família</button><button id="walletJoinBtn" class="secondary">🔗 Entrar com código</button></div>
          <section id="walletCreateBox" class="wallet-create-box hidden"></section>
          <label class="wallet-search">Pesquisar carteira<input id="walletSearch" placeholder="Nome, responsável ou código"></label>
          <h3>Carteiras compartilhadas</h3><div id="familyWalletList" class="family-wallet-grid">${shared.length?shared.map(familyWalletCard).join(''):'<div class="empty-state">Nenhuma carteira familiar compartilhada ainda.</div>'}</div>
          <h3>Carteiras pessoais</h3><div id="personalWalletList" class="v10-list">${listHtml('wallets')}</div>`);

        const showPersonal=()=>{ $('walletCreateBox').classList.remove('hidden'); $('walletCreateBox').innerHTML=`<form id="v10WalletForm" class="form-grid"><label>Nome da carteira<input id="v10WalletName" required placeholder="Ex.: Casa, Empresa"></label><label>Responsável<input id="v10WalletOwner" required value="${esc(state.user?.name||'')}"></label><label>Limite mensal<input id="v10WalletLimit" inputmode="decimal" required placeholder="0,00"></label><button class="primary">Criar carteira pessoal</button></form>`; bindV10MoneyInputs('v10WalletLimit'); $('v10WalletForm').onsubmit=async e=>{e.preventDefault();await addItem('wallets',{name:$('v10WalletName').value.trim(),owner:$('v10WalletOwner').value.trim(),value:numberValue($('v10WalletLimit').value),scope:'personal'});walletsModal();}; };
        const showFamily=()=>{ $('walletCreateBox').classList.remove('hidden'); $('walletCreateBox').innerHTML=`<form id="familyWalletForm" class="form-grid"><label>Nome da família/carteira<input id="familyWalletName" required placeholder="Ex.: Família Rodrigues"></label><label>Limite mensal compartilhado<input id="familyWalletLimit" inputmode="decimal" required placeholder="0,00"></label><p class="muted">Ao criar, será gerado um código. Cada familiar entra com sua própria conta do Finance IA Pro e usa o código para visualizar a mesma carteira.</p><button class="primary">Criar e gerar código</button></form>`; bindV10MoneyInputs('familyWalletLimit'); $('familyWalletForm').onsubmit=async e=>{e.preventDefault();try{const r=await apiFetch('/familyWallet/create',{method:'POST',body:JSON.stringify({name:$('familyWalletName').value.trim(),monthlyLimit:numberValue($('familyWalletLimit').value)})});toast(`Carteira criada. Código: ${r.inviteCode}`);walletsModal();}catch(err){toast(err.message)}}; };
        $('walletTabPersonal').onclick=showPersonal; $('walletTabFamily').onclick=showFamily;
        $('walletJoinBtn').onclick=()=>{ $('walletCreateBox').classList.remove('hidden'); $('walletCreateBox').innerHTML=`<form id="familyJoinForm" class="form-grid"><label>Código compartilhado<input id="familyJoinCode" required maxlength="12" placeholder="Ex.: FAM8K2P4"></label><button class="primary">Entrar na carteira da família</button></form>`; $('familyJoinForm').onsubmit=async e=>{e.preventDefault();try{await apiFetch('/familyWallet/join',{method:'POST',body:JSON.stringify({code:$('familyJoinCode').value.trim().toUpperCase()})});toast('Você entrou na carteira compartilhada.');walletsModal();}catch(err){toast(err.message)}}; };
        $('walletSearch').oninput=e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('.family-wallet-card,.v10-row').forEach(card=>card.style.display=card.textContent.toLowerCase().includes(q)?'':'none')};
        document.querySelectorAll('.family-copy').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.code);toast('Código copiado.')}catch{toast(`Código: ${b.dataset.code}`)}});
        document.querySelectorAll('.family-open').forEach(b=>b.onclick=()=>familyWalletDetail(b.dataset.id));
        bindDeletes(walletsModal);
      }

      async function familyWalletDetail(walletId) {
        let wallet; try{wallet=(await apiFetch(`/familyWallet/get?id=${encodeURIComponent(walletId)}`)).wallet;}catch(e){return toast(e.message)}
        if(!wallet)return;
        const entries=Object.entries(wallet.entries||{}).map(([entryId,x])=>({entryId,...x})).sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
        const income=entries.filter(x=>x.kind==='income').reduce((s,x)=>s+Number(x.value||0),0), expense=entries.filter(x=>x.kind==='expense').reduce((s,x)=>s+Number(x.value||0),0);
        const members=Object.values(wallet.members||{});
        openModal(`<h2>👨‍👩‍👧 ${esc(wallet.name)}</h2><p class="muted">Tudo que qualquer membro adicionar aqui aparece para a família inteira.</p>
          <div class="v10-metrics"><article><span>Saldo compartilhado</span><strong>${moneyText(income-expense)}</strong></article><article><span>Receitas</span><strong>${moneyText(income)}</strong></article><article><span>Despesas</span><strong>${moneyText(expense)}</strong></article><article><span>Membros</span><strong>${members.length}</strong></article></div>
          <div class="family-invite-box"><div><small>Código para compartilhar</small><b>${esc(wallet.inviteCode||'—')}</b></div><button id="familyDetailCopy" class="secondary">Copiar</button></div>
          <form id="familyEntryForm" class="form-grid family-entry-form"><label>Tipo<select id="familyEntryKind"><option value="expense">Despesa</option><option value="income">Receita</option></select></label><label>Descrição<input id="familyEntryDesc" required placeholder="Ex.: Mercado"></label><label>Valor<input id="familyEntryValue" required inputmode="decimal" placeholder="0,00"></label><button class="primary">Adicionar para toda família</button></form>
          <h3>Membros</h3><div class="family-member-list">${members.map(m=>`<div><span>${esc(m.name||'Usuário')}</span><small>${esc(m.email||'')}</small></div>`).join('')}</div>
          <h3>Movimentações compartilhadas</h3><div class="v10-list">${entries.length?entries.map(x=>`<article class="v10-row"><div><b>${esc(x.description||'Lançamento')}</b><small>${esc(x.memberName||'Família')} • ${new Date(x.createdAt||Date.now()).toLocaleDateString('pt-BR')}</small></div><strong class="${x.kind==='income'?'safe-text':'danger-text'}">${x.kind==='income'?'+':'−'} ${moneyText(x.value)}</strong></article>`).join(''):'<div class="empty-state">Nenhuma movimentação compartilhada.</div>'}</div>`);
        bindV10MoneyInputs('familyEntryValue'); $('familyDetailCopy').onclick=async()=>{try{await navigator.clipboard.writeText(wallet.inviteCode);toast('Código copiado.')}catch{toast(wallet.inviteCode)}};
        $('familyEntryForm').onsubmit=async e=>{e.preventDefault();try{await apiFetch('/familyWallet/addEntry',{method:'POST',body:JSON.stringify({walletId,kind:$('familyEntryKind').value,description:$('familyEntryDesc').value.trim(),value:numberValue($('familyEntryValue').value)})});toast('Movimentação sincronizada com a família.');familyWalletDetail(walletId);}catch(err){toast(err.message)}};
      }

      function contactModal(type,title) {
        openModal(`<h2>${title}</h2><form id="v10ContactForm" class="form-grid"><label>Nome<input id="v10ContactName" required></label><label>Telefone<input id="v10ContactPhone" inputmode="tel"></label><label>E-mail<input id="v10ContactEmail" type="email"></label><label>CPF/CNPJ<input id="v10ContactDocument"></label><label>Observações<textarea id="v10ContactNotes"></textarea></label><button class="primary">Salvar</button></form><div class="v10-list">${listHtml(type)}</div>`);
        $('v10ContactForm').onsubmit=async e=>{e.preventDefault();await addItem(type,{name:$('v10ContactName').value,phone:$('v10ContactPhone').value,email:$('v10ContactEmail').value,document:$('v10ContactDocument').value,notes:$('v10ContactNotes').value});contactModal(type,title);}; bindDeletes(()=>contactModal(type,title));
      }
      const clientsModal=()=>contactModal('clients','Clientes');
      const suppliersModal=()=>contactModal('suppliers','Fornecedores');

      function receiptCode(item) {
        if (item?.number) return item.number;
        const date = String(item?.date || todayISO()).replace(/-/g,'');
        return `REC-${date}-${String(item?.id || '').replace(/[^a-z0-9]/gi,'').slice(-5).toUpperCase() || '00000'}`;
      }

      function receiptSearchMatch(item, query, filter) {
        const text=[item.name,item.description,item.document,item.phone,item.paymentMethod,item.notes,receiptCode(item)]
          .map(v=>String(v||'').toLowerCase()).join(' ');
        if(query && !text.includes(query)) return false;
        if(filter==='month') return String(item.date||'').slice(0,7)===todayISO().slice(0,7);
        if(filter==='today') return String(item.date||'')===todayISO();
        return true;
      }

      function receiptsModal(editId = null) {
        const editing=editId?(state.receipts||[]).find(x=>x.id===editId):null;
        const query=String(window.__fiaReceiptSearch||'').trim().toLowerCase();
        const filter=String(window.__fiaReceiptFilter||'all');
        const mineReceipts=mine(state.receipts).filter(x=>receiptSearchMatch(x,query,filter))
          .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || Number(b.createdAt||0)-Number(a.createdAt||0));
        const total=mineReceipts.reduce((sum,x)=>sum+Number(x.value||0),0);
        const allMine=mine(state.receipts);
        const monthTotal=allMine.filter(x=>String(x.date||'').slice(0,7)===todayISO().slice(0,7)).reduce((sum,x)=>sum+Number(x.value||0),0);
        const formTitle=editing?'Editar recibo':'Novo recibo';
        const rows=mineReceipts.length?mineReceipts.map(item=>`
          <article class="receipt-card">
            <div class="receipt-card-head">
              <div><b>${esc(item.name||'Sem nome')}</b><small>${esc(receiptCode(item))}</small></div>
              <strong>${moneyText(item.value)}</strong>
            </div>
            <div class="receipt-card-meta">
              <span>📅 ${brDate(item.date)}</span>
              <span>💳 ${esc(item.paymentMethod||'Não informado')}</span>
              ${item.document?`<span>🪪 ${esc(item.document)}</span>`:''}
            </div>
            <p>${esc(item.description||'Sem descrição')}</p>
            ${item.notes?`<small class="receipt-note">${esc(item.notes)}</small>`:''}
            <div class="receipt-actions">
              <button class="primary receipt-open" data-id="${item.id}">📄 Gerar / salvar PDF</button>
              <button class="secondary receipt-share" data-id="${item.id}">📤 Compartilhar PDF</button>
              <button class="secondary receipt-edit" data-id="${item.id}">Editar</button>
              <button class="secondary receipt-copy" data-id="${item.id}">Duplicar</button>
              <button class="danger-button receipt-delete" data-id="${item.id}">Excluir</button>
            </div>
          </article>`).join(''):'<div class="empty-state">Nenhum recibo encontrado.</div>';

        openModal(`<div class="receipt-title"><div><h2>Gerador de recibos</h2><p class="muted">Gere o recibo em PDF, salve no aparelho ou compartilhe direto no WhatsApp e outros aplicativos.</p><span class="receipt-live-badge">● Atualização automática • Firebase + cache local</span></div></div>
          <div class="receipt-dashboard">
            <article><span>Recibos</span><strong>${allMine.length}</strong></article>
            <article><span>Total no mês</span><strong>${moneyText(monthTotal)}</strong></article>
            <article><span>Na pesquisa</span><strong>${mineReceipts.length}</strong></article>
            <article><span>Valor filtrado</span><strong>${moneyText(total)}</strong></article>
          </div>
          <div class="receipt-search">
            <input id="v10ReceiptSearch" placeholder="Pesquisar nome, recibo, CPF/CNPJ, telefone..." value="${esc(window.__fiaReceiptSearch||'')}">
            <select id="v10ReceiptFilter"><option value="all" ${filter==='all'?'selected':''}>Todos</option><option value="today" ${filter==='today'?'selected':''}>Hoje</option><option value="month" ${filter==='month'?'selected':''}>Este mês</option></select>
          </div>
          <details class="receipt-form-box" ${editing?'open':''}><summary>➕ ${formTitle}</summary>
            <form id="v10ReceiptForm" class="form-grid receipt-form">
              <label>Recebido de<input id="v10ReceiptName" required value="${esc(editing?.name||'')}" placeholder="Nome do cliente"></label>
              <div class="receipt-form-two"><label>CPF/CNPJ<input id="v10ReceiptDocument" value="${esc(editing?.document||'')}" placeholder="Opcional"></label><label>Telefone<input id="v10ReceiptPhone" inputmode="tel" value="${esc(editing?.phone||'')}" placeholder="Opcional"></label></div>
              <div class="receipt-form-two"><label>Valor<input id="v10ReceiptValue" inputmode="decimal" required value="${editing?esc(Number(editing.value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})):''}" placeholder="0,00"></label><label>Forma de pagamento<select id="v10ReceiptPayment"><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option><option>Boleto</option><option>Outro</option></select></label></div>
              <label>Referente a<input id="v10ReceiptDescription" required value="${esc(editing?.description||'')}" placeholder="Ex.: Serviços prestados"></label>
              <div class="receipt-form-two"><label>Data<input id="v10ReceiptDate" type="date" value="${esc(editing?.date||todayISO())}" required></label><label>Número do recibo<input id="v10ReceiptNumber" value="${esc(editing?.number||'')}" placeholder="Automático se vazio"></label></div>
              <label>Observações<textarea id="v10ReceiptNotes" placeholder="Informações adicionais">${esc(editing?.notes||'')}</textarea></label>
              <div class="modal-actions"><button class="primary" type="submit">${editing?'Salvar alterações':'Salvar e gerar PDF'}</button>${editing?'<button id="v10ReceiptCancelEdit" class="secondary" type="button">Cancelar</button>':''}</div>
            </form>
          </details>
          <div class="receipt-list">${rows}</div>`);

        const payment=$('v10ReceiptPayment'); if(payment) payment.value=editing?.paymentMethod||'Pix';
        bindV10MoneyInputs('v10ReceiptValue');
        const search=$('v10ReceiptSearch'); if(search) search.oninput=()=>{window.__fiaReceiptSearch=search.value;clearTimeout(window.__fiaReceiptTimer);window.__fiaReceiptTimer=setTimeout(()=>receiptsModal(),180)};
        const sel=$('v10ReceiptFilter'); if(sel) sel.onchange=()=>{window.__fiaReceiptFilter=sel.value;receiptsModal()};
        if($('v10ReceiptCancelEdit')) $('v10ReceiptCancelEdit').onclick=()=>receiptsModal();
        $('v10ReceiptForm').onsubmit=async e=>{
          e.preventDefault();
          const data={name:$('v10ReceiptName').value.trim(),document:$('v10ReceiptDocument').value.trim(),phone:$('v10ReceiptPhone').value.trim(),value:numberValue($('v10ReceiptValue').value),paymentMethod:$('v10ReceiptPayment').value,description:$('v10ReceiptDescription').value.trim(),date:$('v10ReceiptDate').value,number:$('v10ReceiptNumber').value.trim(),notes:$('v10ReceiptNotes').value.trim(),status:'issued'};
          if(!data.number) data.number=`REC-${data.date.replace(/-/g,'')}-${String(Date.now()).slice(-6)}`;
          if(editing){
            await updateItem('receipts',editing.id,data);
            toast('Recibo atualizado.');
            receiptsModal();
          } else {
            const item = await addItem('receipts',data);

            // Atualiza lista, contadores e valores imediatamente,
            // sem precisar fechar e abrir a página.
            receiptsModal();
            toast('Recibo salvo e lista atualizada.');

            // O PDF é gerado depois do refresh visual.
            setTimeout(() => {
              saveReceiptPdf(item).catch(err => {
                console.error('Erro ao gerar PDF do recibo:', err);
                toast('Recibo salvo. Não foi possível gerar o PDF automaticamente.');
              });
            }, 120);
          }
        };
        document.querySelectorAll('.receipt-open').forEach(btn=>btn.onclick=async()=>{const item=(state.receipts||[]).find(x=>x.id===btn.dataset.id);if(item)await saveReceiptPdf(item)});
        document.querySelectorAll('.receipt-edit').forEach(btn=>btn.onclick=()=>receiptsModal(btn.dataset.id));
        document.querySelectorAll('.receipt-share').forEach(btn=>btn.onclick=async()=>{const item=(state.receipts||[]).find(x=>x.id===btn.dataset.id);if(item)await shareReceiptPdf(item)});
        document.querySelectorAll('.receipt-copy').forEach(btn=>btn.onclick=async()=>{const src=(state.receipts||[]).find(x=>x.id===btn.dataset.id);if(!src)return;const {id:_id,userId:_uid,createdAt:_created,updatedAt:_updated,...copy}=src;copy.date=todayISO();copy.number=`REC-${copy.date.replace(/-/g,'')}-${String(Date.now()).slice(-6)}`;await addItem('receipts',copy);receiptsModal();toast('Recibo duplicado e atualizado na lista.')});
        document.querySelectorAll('.receipt-delete').forEach(btn=>btn.onclick=async()=>{if(!confirm('Excluir este recibo?'))return;await deleteItem('receipts',btn.dataset.id);toast('Recibo excluído.');receiptsModal()});
      }

      function receiptText(item) {
        return `RECIBO ${receiptCode(item)}\nValor: ${moneyText(item.value)}\nRecebido de: ${item.name||''}${item.document?`\nCPF/CNPJ: ${item.document}`:''}\nReferente a: ${item.description||''}\nForma de pagamento: ${item.paymentMethod||'Não informado'}\nData: ${brDate(item.date)}${item.notes?`\nObservações: ${item.notes}`:''}`;
      }

      function receiptPdfFileName(item) {
        const safeName=String(item?.name||'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,40)||'cliente';
        return `recibo-${receiptCode(item)}-${safeName}.pdf`;
      }

      function buildReceiptPdf(item) {
        const jsPDFCtor=window.jspdf?.jsPDF;
        if(!jsPDFCtor) throw new Error('Gerador de PDF ainda não carregou. Verifique a internet e tente novamente.');
        const doc=new jsPDFCtor({unit:'mm',format:'a4',orientation:'portrait'});
        const issuer=state.user?.name||'Finance IA Pro';
        const pageW=210;
        const margin=18;
        const contentW=pageW-(margin*2);
        const code=receiptCode(item);
        const date=brDate(item.date);
        const value=moneyText(item.value);
        const line=(y)=>{doc.setDrawColor(45,211,164);doc.setLineWidth(.7);doc.line(margin,y,pageW-margin,y)};
        const box=(x,y,w,h)=>{doc.setFillColor(246,249,250);doc.roundedRect(x,y,w,h,3,3,'F')};
        doc.setTextColor(20,32,43);
        doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text(String(issuer),margin,24);
        doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(100,116,132);doc.text('COMPROVANTE DE RECEBIMENTO',margin,30);
        doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(20,32,43);doc.text(String(code),pageW-margin,23,{align:'right'});
        doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(100,116,132);doc.text(String(date),pageW-margin,29,{align:'right'});
        line(35);
        doc.setFont('helvetica','bold');doc.setFontSize(26);doc.setTextColor(11,143,114);doc.text(String(value),margin,51);
        box(margin,59,84,29);box(108,59,84,29);
        doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(113,128,143);doc.text('RECEBIDO DE',margin+5,66);
        doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(20,32,43);doc.text(doc.splitTextToSize(String(item.name||''),74),margin+5,73);
        if(item.document){doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,116,132);doc.text(String(item.document),margin+5,84)}
        doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(113,128,143);doc.text('FORMA DE PAGAMENTO',113,66);
        doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(20,32,43);doc.text(String(item.paymentMethod||'Nao informado'),113,74);
        if(item.phone){doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,116,132);doc.text(String(item.phone),113,84)}
        box(margin,96,contentW,38);
        doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(20,32,43);doc.text('REFERENTE A',margin+5,104);
        doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(40,54,67);
        const desc=doc.splitTextToSize(String(item.description||''),contentW-10);doc.text(desc,margin+5,112);
        if(item.notes){
          doc.setFontSize(8);doc.setTextColor(100,116,132);
          const note=doc.splitTextToSize(`Observacoes: ${item.notes}`,contentW-10);doc.text(note,margin+5,126);
        }
        doc.setDrawColor(70,80,90);doc.setLineWidth(.25);doc.line(60,177,150,177);
        doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(20,32,43);doc.text(String(issuer),105,183,{align:'center'});
        doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(113,128,143);doc.text('Assinatura / responsavel',105,188,{align:'center'});
        doc.setFontSize(7);doc.setTextColor(145,155,165);doc.text(`Gerado pelo Finance IA Pro • ${code}`,105,281,{align:'center'});
        return doc;
      }

      async function saveReceiptPdf(item) {
        try{
          const doc=buildReceiptPdf(item);
          doc.save(receiptPdfFileName(item));
          toast('PDF gerado e salvo. Agora você pode enviar ao cliente.');
        }catch(e){toast(e.message||'Não foi possível gerar o PDF.');}
      }

      async function shareReceiptPdf(item) {
        try{
          const doc=buildReceiptPdf(item);
          const blob=doc.output('blob');
          const file=new File([blob],receiptPdfFileName(item),{type:'application/pdf'});
          const text=`Recibo ${receiptCode(item)} • ${moneyText(item.value)} • ${item.name||''}`;
          if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
            await navigator.share({title:`Recibo ${receiptCode(item)}`,text,files:[file]});
            return;
          }
          // Fallback: salva o PDF e abre o WhatsApp com uma mensagem pronta. O usuário só anexa o PDF salvo.
          doc.save(receiptPdfFileName(item));
          const wa=`https://wa.me/?text=${encodeURIComponent(`${text}\nPDF salvo no aparelho. Estou enviando o recibo em anexo.`)}`;
          window.open(wa,'_blank');
          toast('PDF salvo. Selecione o arquivo no WhatsApp para enviar.');
        }catch(e){if(e?.name!=='AbortError')toast(e.message||'Não foi possível compartilhar o PDF.');}
      }

      function documentDaysUntil(value) {
        if(!value) return null;
        const target=new Date(`${value}T12:00:00`);
        const today=new Date(); today.setHours(12,0,0,0);
        return Math.ceil((target-today)/86400000);
      }

      function documentStatus(item) {
        if(item.status==='arquivado') return {key:'archived',label:'Arquivado'};
        const days=documentDaysUntil(item.expiryDate);
        if(days!==null && days<0) return {key:'expired',label:'Vencido'};
        if(days!==null && days<=30) return {key:'warning',label:`Vence em ${days} dia${days===1?'':'s'}`};
        return {key:'active',label:'Ativo'};
      }

      function documentSearchMatch(item, query, filter) {
        const text=[item.title,item.name,item.type,item.issuer,item.documentNumber,item.tags,item.notes]
          .map(v=>String(v||'').toLowerCase()).join(' ');
        if(query && !text.includes(query)) return false;
        const status=documentStatus(item).key;
        if(filter==='file' && !item.fileUrl && !item.fileName) return false;
        if(filter==='expiring' && status!=='warning') return false;
        if(filter==='expired' && status!=='expired') return false;
        if(filter!=='all' && !['file','expiring','expired'].includes(filter) && String(item.type||'')!==filter) return false;
        return true;
      }

      async function uploadDocumentFile(file, documentId) {
        if(!file) return null;
        if(file.size>12*1024*1024) throw new Error('O arquivo deve ter no máximo 12 MB.');
        if(!window.firebase?.storage || !cloudReady || !uid()) throw new Error('Firebase Storage não está disponível nesta publicação.');
        const safeName=String(file.name||'arquivo').replace(/[^a-zA-Z0-9._-]/g,'_');
        const path=`userDocuments/${uid()}/${documentId}/${Date.now()}_${safeName}`;
        const ref=firebase.storage().ref(path);
        await ref.put(file,{contentType:file.type||'application/octet-stream'});
        return {fileUrl:await ref.getDownloadURL(),filePath:path,fileName:file.name,fileType:file.type||'',fileSize:file.size};
      }

      async function deleteDocumentFile(item) {
        if(!item?.filePath || !window.firebase?.storage) return;
        try{await firebase.storage().ref(item.filePath).delete();}catch(_e){}
      }

      async function shareDocumentItem(item) {
        const title=item.title||item.name||'Documento';
        const text=`${title}${item.type?` • ${item.type}`:''}${item.date?` • ${brDate(item.date)}`:''}${item.fileUrl?`\n${item.fileUrl}`:''}`;
        try{
          if(navigator.share){await navigator.share({title,text,url:item.fileUrl||undefined});return;}
        }catch(e){if(e?.name==='AbortError')return;}
        if(item.fileUrl){try{await navigator.clipboard.writeText(item.fileUrl);toast('Link do documento copiado.');return;}catch(_e){}}
        toast('Compartilhamento não disponível neste aparelho.');
      }

      function documentsModal(editId = null) {
        const editing=editId?(state.documents||[]).find(x=>x.id===editId):null;
        const query=String(window.__fiaDocumentSearch||'').trim().toLowerCase();
        const filter=String(window.__fiaDocumentFilter||'all');
        const allDocs=mine(state.documents).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || Number(b.createdAt||0)-Number(a.createdAt||0));
        const docs=allDocs.filter(x=>documentSearchMatch(x,query,filter));
        const withFiles=allDocs.filter(x=>x.fileUrl||x.fileName).length;
        const expiring=allDocs.filter(x=>documentStatus(x).key==='warning').length;
        const expired=allDocs.filter(x=>documentStatus(x).key==='expired').length;
        const rows=docs.length?docs.map(item=>{
          const status=documentStatus(item);
          return `<article class="doc-card doc-${status.key}">
            <div class="doc-card-head"><div><b>${esc(item.title||item.name||'Documento')}</b><small>${esc(item.type||'Outro')} • ${brDate(item.date)}</small></div><span class="doc-status">${esc(status.label)}</span></div>
            <div class="doc-meta">
              ${item.issuer?`<span>👤 ${esc(item.issuer)}</span>`:''}
              ${item.documentNumber?`<span>🔖 ${esc(item.documentNumber)}</span>`:''}
              ${item.expiryDate?`<span>⏳ ${brDate(item.expiryDate)}</span>`:''}
              ${item.fileName?`<span>📎 ${esc(item.fileName)}</span>`:'<span>📄 Sem arquivo anexado</span>'}
            </div>
            ${item.tags?`<small class="doc-tags">${esc(item.tags)}</small>`:''}
            ${item.notes?`<p>${esc(item.notes)}</p>`:''}
            <div class="doc-actions">
              ${item.fileUrl?`<button class="primary doc-open" data-id="${item.id}">Abrir arquivo</button><button class="secondary doc-share" data-id="${item.id}">Compartilhar</button>`:''}
              <button class="secondary doc-edit" data-id="${item.id}">Editar</button>
              <button class="danger-button doc-delete" data-id="${item.id}">Excluir</button>
            </div>
          </article>`;
        }).join(''):'<div class="empty-state">Nenhum documento encontrado.</div>';

        openModal(`<div class="doc-title"><div><h2>Central de documentos</h2><p class="muted">Organize comprovantes, contratos, notas, garantias e arquivos importantes em um só lugar.</p></div></div>
          <section class="doc-dashboard">
            <article><span>Documentos</span><strong>${allDocs.length}</strong></article>
            <article><span>Com arquivo</span><strong>${withFiles}</strong></article>
            <article><span>Vencem em 30 dias</span><strong>${expiring}</strong></article>
            <article><span>Vencidos</span><strong>${expired}</strong></article>
          </section>
          <div class="doc-search"><input id="v10DocSearch" placeholder="Pesquisar título, número, pessoa, tag..."><select id="v10DocFilter">
            <option value="all">Todos</option><option value="file">Com arquivo</option><option value="expiring">Vencendo</option><option value="expired">Vencidos</option>
            <option>Comprovante</option><option>Contrato</option><option>Nota fiscal</option><option>Garantia</option><option>Documento pessoal</option><option>Orçamento</option><option>Outro</option></select></div>
          <details class="doc-form-box" ${editing?'open':''}><summary>➕ ${editing?'Editar documento':'Novo documento'}</summary>
            <form id="v10DocumentForm" class="form-grid">
              <label>Título<input id="v10DocTitle" required value="${esc(editing?.title||editing?.name||'')}" placeholder="Ex.: Contrato de aluguel"></label>
              <div class="doc-form-two"><label>Tipo<select id="v10DocType"><option>Comprovante</option><option>Contrato</option><option>Nota fiscal</option><option>Garantia</option><option>Documento pessoal</option><option>Orçamento</option><option>Outro</option></select></label><label>Número / referência<input id="v10DocNumber" value="${esc(editing?.documentNumber||'')}" placeholder="Opcional"></label></div>
              <div class="doc-form-two"><label>Data<input id="v10DocDate" type="date" required value="${esc(editing?.date||todayISO())}"></label><label>Validade / vencimento<input id="v10DocExpiry" type="date" value="${esc(editing?.expiryDate||'')}"></label></div>
              <label>Pessoa / empresa relacionada<input id="v10DocIssuer" value="${esc(editing?.issuer||'')}" placeholder="Ex.: Cliente, fornecedor, imobiliária"></label>
              <label>Tags<input id="v10DocTags" value="${esc(editing?.tags||'')}" placeholder="Ex.: casa, imposto, cliente"></label>
              <label>Status<select id="v10DocStatus"><option value="ativo">Ativo</option><option value="arquivado">Arquivado</option></select></label>
              <label>Anexar arquivo<input id="v10DocFile" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"><small class="muted">PDF, foto ou documento até 12 MB. ${editing?.fileName?`Atual: ${esc(editing.fileName)}`:'O arquivo será salvo no Firebase Storage.'}</small></label>
              <label>Observações<textarea id="v10DocNotes" placeholder="Informações importantes">${esc(editing?.notes||'')}</textarea></label>
              <button id="v10DocSave" class="primary">${editing?'Salvar alterações':'Salvar documento'}</button>
            </form>
          </details>
          <div class="doc-list">${rows}</div>`);

        $('v10DocSearch').value=window.__fiaDocumentSearch||''; $('v10DocFilter').value=filter;
        $('v10DocType').value=editing?.type||'Comprovante'; $('v10DocStatus').value=editing?.status||'ativo';
        $('v10DocSearch').oninput=e=>{window.__fiaDocumentSearch=e.target.value;documentsModal(editId)};
        $('v10DocFilter').onchange=e=>{window.__fiaDocumentFilter=e.target.value;documentsModal(editId)};
        $('v10DocumentForm').onsubmit=async e=>{
          e.preventDefault(); const saveBtn=$('v10DocSave'); saveBtn.disabled=true; saveBtn.textContent='Salvando...';
          try{
            const base={title:$('v10DocTitle').value.trim(),name:$('v10DocTitle').value.trim(),type:$('v10DocType').value,date:$('v10DocDate').value,expiryDate:$('v10DocExpiry').value,issuer:$('v10DocIssuer').value.trim(),documentNumber:$('v10DocNumber').value.trim(),tags:$('v10DocTags').value.trim(),status:$('v10DocStatus').value,notes:$('v10DocNotes').value.trim()};
            const file=$('v10DocFile').files?.[0]||null;
            if(editing){
              let fileData={}; if(file){fileData=await uploadDocumentFile(file,editing.id);await deleteDocumentFile(editing)}
              await updateItem('documents',editing.id,{...base,...fileData}); toast('Documento atualizado.');
            }else{
              const item=await addItem('documents',base); if(file){const fileData=await uploadDocumentFile(file,item.id);await updateItem('documents',item.id,fileData)} toast('Documento salvo.');
            }
            documentsModal();
          }catch(err){toast(err.message||'Não foi possível salvar o documento.');saveBtn.disabled=false;saveBtn.textContent=editing?'Salvar alterações':'Salvar documento';}
        };
        document.querySelectorAll('.doc-open').forEach(b=>b.onclick=()=>{const item=(state.documents||[]).find(x=>x.id===b.dataset.id);if(item?.fileUrl)window.open(item.fileUrl,'_blank')});
        document.querySelectorAll('.doc-share').forEach(b=>b.onclick=()=>{const item=(state.documents||[]).find(x=>x.id===b.dataset.id);if(item)shareDocumentItem(item)});
        document.querySelectorAll('.doc-edit').forEach(b=>b.onclick=()=>documentsModal(b.dataset.id));
        document.querySelectorAll('.doc-delete').forEach(b=>b.onclick=async()=>{const item=(state.documents||[]).find(x=>x.id===b.dataset.id);if(!item||!confirm('Excluir este documento?'))return;await deleteDocumentFile(item);await deleteItem('documents',item.id);documentsModal();toast('Documento excluído.');});
      }

      function planningModal() {
        openModal(`<h2>Planejamento anual</h2><form id="v10PlanningForm" class="form-grid"><label>Objetivo<input id="v10PlanName" required></label><label>Valor desejado<input id="v10PlanValue" inputmode="decimal" required></label><label>Prazo<input id="v10PlanDate" type="date" required></label><label>Prioridade<select id="v10PlanPriority"><option>Alta</option><option>Média</option><option>Baixa</option></select></label><button class="primary">Adicionar objetivo</button></form><div class="v10-list">${listHtml('planning')}</div>`);
        bindV10MoneyInputs('v10PlanValue');
        $('v10PlanningForm').onsubmit=async e=>{e.preventDefault();await addItem('planning',{name:$('v10PlanName').value,value:numberValue($('v10PlanValue').value),date:$('v10PlanDate').value,priority:$('v10PlanPriority').value,status:'planejado'});planningModal();}; bindDeletes(planningModal);
      }

      function monthlyClientsModal(editId = null) {
        const editing=editId?(state.monthlyClients||[]).find(x=>x.id===editId):null;
        const allClients=mine(state.monthlyClients);
        const query=String(window.__fiaMonthlySearch||'').trim().toLowerCase();
        const filter=String(window.__fiaMonthlyFilter||'all');
        const sort=String(window.__fiaMonthlySort||'name');
        const today=new Date();
        const todayDay=today.getDate();
        const daysUntilClosing=(day)=>{
          const closing=Math.min(Math.max(Number(day||30),1),31);
          if(closing>=todayDay) return closing-todayDay;
          const next=new Date(today.getFullYear(),today.getMonth()+1,closing);
          return Math.ceil((next-new Date(today.getFullYear(),today.getMonth(),todayDay))/(86400000));
        };
        const calcTotal=c=>(c.entries||[]).reduce((sum,e)=>sum+Number(e.value||0),0);
        const matches=c=>{
          const total=calcTotal(c);
          const text=[c.name,c.category,c.phone,c.notes].map(v=>String(v||'').toLowerCase()).join(' ');
          if(query && !text.includes(query)) return false;
          if(filter==='open' && total<=0) return false;
          if(filter==='empty' && total>0) return false;
          if(filter==='closing' && daysUntilClosing(c.closingDay)>7) return false;
          if(filter==='today' && daysUntilClosing(c.closingDay)!==0) return false;
          return true;
        };
        const clients=allClients.filter(matches).sort((a,b)=>{
          if(sort==='totalDesc') return calcTotal(b)-calcTotal(a);
          if(sort==='totalAsc') return calcTotal(a)-calcTotal(b);
          if(sort==='closing') return daysUntilClosing(a.closingDay)-daysUntilClosing(b.closingDay);
          return String(a.name||'').localeCompare(String(b.name||''),'pt-BR',{sensitivity:'base'});
        });
        const totalOpen=allClients.reduce((sum,c)=>sum+calcTotal(c),0);
        const withOpen=allClients.filter(c=>calcTotal(c)>0).length;
        const closingSoon=allClients.filter(c=>daysUntilClosing(c.closingDay)<=7).length;
        openModal(`<h2>Clientes com acerto mensal</h2><p class="muted">Cadastre clientes que usam o serviço durante o mês e pagam tudo de uma vez no fechamento.</p>
          <section class="monthly-dashboard">
            <article><span>Clientes</span><strong>${allClients.length}</strong></article>
            <article><span>Com saldo aberto</span><strong>${withOpen}</strong></article>
            <article><span>Total a receber</span><strong>${moneyText(totalOpen)}</strong></article>
            <article><span>Fecham em até 7 dias</span><strong>${closingSoon}</strong></article>
          </section>
          <section class="monthly-search-box">
            <div class="monthly-search-row"><input id="monthlySearch" placeholder="🔎 Buscar cliente, telefone ou categoria" value="${esc(window.__fiaMonthlySearch||'')}"><button id="monthlyClearSearch" type="button" class="secondary">Limpar</button></div>
            <div class="monthly-filter-grid">
              <select id="monthlyFilter"><option value="all" ${filter==='all'?'selected':''}>Todos</option><option value="open" ${filter==='open'?'selected':''}>Com saldo aberto</option><option value="empty" ${filter==='empty'?'selected':''}>Sem lançamentos</option><option value="closing" ${filter==='closing'?'selected':''}>Fecha em até 7 dias</option><option value="today" ${filter==='today'?'selected':''}>Fecha hoje</option></select>
              <select id="monthlySort"><option value="name" ${sort==='name'?'selected':''}>Nome A-Z</option><option value="totalDesc" ${sort==='totalDesc'?'selected':''}>Maior saldo</option><option value="totalAsc" ${sort==='totalAsc'?'selected':''}>Menor saldo</option><option value="closing" ${sort==='closing'?'selected':''}>Próximo fechamento</option></select>
            </div>
            <small class="monthly-result-count">${clients.length} de ${allClients.length} cliente(s) exibido(s)</small>
          </section>
          <details class="monthly-new-client" ${editing?'open':''}><summary>${editing?'✏️ Editando cliente':'＋ Cadastrar novo cliente mensal'}</summary>
          <form id="monthlyClientForm" class="form-grid"><label>Nome do cliente<input id="monthlyClientName" required value="${esc(editing?.name||'')}"></label><label>Telefone / WhatsApp<input id="monthlyClientPhone" inputmode="tel" placeholder="(00) 00000-0000" value="${esc(editing?.phone||'')}"></label><label>Dia do fechamento<input id="monthlyClientDay" type="number" min="1" max="31" required value="${editing?.closingDay||30}"></label><label>Categoria<input id="monthlyClientCategory" value="${esc(editing?.category||'Serviços')}"></label><label>Observações<textarea id="monthlyClientNotes" placeholder="Informações importantes do cliente">${esc(editing?.notes||'')}</textarea></label><button class="primary">${editing?'Salvar alterações':'Adicionar cliente mensal'}</button>${editing?'<button id="monthlyCancelEdit" type="button" class="secondary">Cancelar edição</button>':''}</form></details>
          <div class="v10-list monthly-client-list">${clients.length?clients.map(c=>{const total=calcTotal(c);const d=daysUntilClosing(c.closingDay);const dueText=d===0?'Fecha hoje':d===1?'Fecha amanhã':`Fecha em ${d} dias`;const statusClass=total>0?'has-open':'is-clear';return `<article class="monthly-client-card ${statusClass}">
              <div class="monthly-client-head">
                <div class="monthly-client-identity"><b>${esc(c.name)}</b>${c.category?`<small>${esc(c.category)}</small>`:''}</div>
                <span class="monthly-status-chip ${statusClass}">${total>0?'Em aberto':'Em dia'}</span>
              </div>
              <div class="monthly-client-stats">
                <div><span>Lançamentos</span><strong>${(c.entries||[]).length}</strong></div>
                <div><span>Total aberto</span><strong>${moneyText(total)}</strong></div>
                <div><span>Fechamento</span><strong>${d===0?'Hoje':`Dia ${c.closingDay||30}`}</strong><small>${d===0?'Fechamento hoje':dueText}</small></div>
              </div>
              ${c.phone?`<div class="monthly-client-contact">📱 <span>${esc(c.phone)}</span></div>`:''}
              ${c.notes?`<div class="monthly-client-note">${esc(c.notes)}</div>`:''}
              <div class="monthly-client-actions">
                <button class="primary monthly-open" data-id="${c.id}">Abrir cliente</button>
                ${c.phone?`<button class="secondary monthly-whatsapp" data-phone="${esc(c.phone)}" data-name="${esc(c.name)}">WhatsApp</button>`:''}
                <button class="secondary monthly-edit" data-id="${c.id}">Editar</button>
                <button class="danger-button monthly-delete" data-id="${c.id}">Excluir</button>
              </div>
            </article>`}).join(''):'<div class="empty-state">Nenhum cliente encontrado com esses filtros.</div>'}</div>`);
        const rerender=()=>monthlyClientsModal(editId);
        const searchEl=$('monthlySearch');
        if(searchEl){let timer;searchEl.oninput=()=>{clearTimeout(timer);window.__fiaMonthlySearch=searchEl.value;timer=setTimeout(()=>monthlyClientsModal(editId),180);};}
        $('monthlyClearSearch').onclick=()=>{window.__fiaMonthlySearch='';window.__fiaMonthlyFilter='all';window.__fiaMonthlySort='name';monthlyClientsModal(editId);};
        $('monthlyFilter').onchange=e=>{window.__fiaMonthlyFilter=e.target.value;monthlyClientsModal(editId);};
        $('monthlySort').onchange=e=>{window.__fiaMonthlySort=e.target.value;monthlyClientsModal(editId);};
        $('monthlyClientForm').onsubmit=async e=>{e.preventDefault();const data={name:$('monthlyClientName').value.trim(),phone:$('monthlyClientPhone').value.trim(),closingDay:Number($('monthlyClientDay').value),category:$('monthlyClientCategory').value.trim()||'Serviços',notes:$('monthlyClientNotes').value.trim(),entries:editing?.entries||[],settlements:editing?.settlements||[],status:'active'};if(editing)await updateItem('monthlyClients',editing.id,data);else await addItem('monthlyClients',data);monthlyClientsModal();toast('Cliente mensal salvo.');};
        const cancel=$('monthlyCancelEdit');if(cancel)cancel.onclick=()=>monthlyClientsModal();
        document.querySelectorAll('.monthly-open').forEach(b=>b.onclick=()=>monthlyClientDetails(b.dataset.id));
        document.querySelectorAll('.monthly-edit').forEach(b=>b.onclick=()=>monthlyClientsModal(b.dataset.id));
        document.querySelectorAll('.monthly-whatsapp').forEach(b=>b.onclick=()=>{const phone=String(b.dataset.phone||'').replace(/\D/g,'');if(!phone)return toast('Telefone não informado.');const normalized=phone.startsWith('55')?phone:`55${phone}`;window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(`Olá ${b.dataset.name||''}, tudo bem? Estou entrando em contato sobre seu acerto mensal.`)}`,'_blank');});
        document.querySelectorAll('.monthly-delete').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir este cliente mensal e seus lançamentos abertos?'))return;await deleteItem('monthlyClients',b.dataset.id);monthlyClientsModal();});
      }
      function monthlyClientDetails(clientId) {
        const client=(state.monthlyClients||[]).find(x=>x.id===clientId);if(!client)return;const entries=client.entries||[];const total=entries.reduce((s,e)=>s+Number(e.value||0),0);
        const settlements=client.settlements||[];
        openModal(`<h2>${esc(client.name)}</h2><p class="muted">${client.phone?`📱 ${esc(client.phone)} • `:''}fecha dia ${client.closingDay||30}${client.category?` • ${esc(client.category)}`:''}</p><div class="summary-grid"><article class="summary"><span>Lançamentos abertos</span><strong>${entries.length}</strong></article><article class="summary"><span>Total a receber</span><strong>${moneyText(total)}</strong></article><article class="summary"><span>Fechamentos anteriores</span><strong>${settlements.length}</strong></article><article class="summary"><span>Último recebimento</span><strong>${client.lastReceivedAt?new Date(client.lastReceivedAt).toLocaleDateString('pt-BR'):'—'}</strong></article></div>
          <form id="monthlyEntryForm" class="form-grid"><label>Descrição<input id="monthlyEntryDescription" required placeholder="Ex.: Serviço da semana"></label><label>Valor<input id="monthlyEntryValue" inputmode="decimal" required></label><label>Data<input id="monthlyEntryDate" type="date" value="${todayISO()}" required></label><button class="primary">Adicionar ao mês</button></form>
          <div class="monthly-entry-toolbar"><input id="monthlyEntrySearch" placeholder="🔎 Buscar lançamento"><span>${entries.length} item(ns)</span></div>
          <div id="monthlyEntriesList" class="v10-list">${entries.length?entries.map(e=>`<article class="v10-row monthly-entry-row" data-search="${esc(String(e.description||'').toLowerCase())}"><div><b>${esc(e.description)}</b><small>${brDate(e.date)} • ${moneyText(e.value)}</small></div><div class="v10-row-actions"><button class="secondary monthly-entry-edit" data-id="${e.id}">Editar</button><button class="danger-button monthly-entry-delete" data-id="${e.id}">Excluir</button></div></article>`).join(''):'<div class="empty-state">Nenhum serviço lançado neste mês.</div>'}</div>
          ${settlements.length?`<details class="monthly-settlements"><summary>Ver últimos fechamentos</summary>${settlements.slice(0,6).map(s=>`<div class="monthly-settlement-row"><span>${brDate(s.date)}</span><strong>${moneyText(s.value)}</strong><small>${(s.entries||[]).length} item(ns)</small></div>`).join('')}</details>`:''}
          <div class="modal-actions"><button id="monthlyReceiveAll" class="primary" ${total<=0?'disabled':''}>Receber total ${moneyText(total)}</button><button id="monthlyBack" class="secondary">Voltar</button></div>`);
        bindV10MoneyInputs('monthlyEntryValue');
        $('monthlyEntryForm').onsubmit=async e=>{e.preventDefault();client.entries=client.entries||[];client.entries.push({id:id(),description:$('monthlyEntryDescription').value.trim(),value:numberValue($('monthlyEntryValue').value),date:$('monthlyEntryDate').value,createdAt:Date.now()});await updateItem('monthlyClients',client.id,{entries:client.entries});monthlyClientDetails(client.id);toast('Valor adicionado ao acerto mensal.');};
        const entrySearch=$('monthlyEntrySearch');if(entrySearch)entrySearch.oninput=()=>{const q=entrySearch.value.trim().toLowerCase();document.querySelectorAll('.monthly-entry-row').forEach(row=>row.style.display=!q||String(row.dataset.search||'').includes(q)?'':'none');};
        document.querySelectorAll('.monthly-entry-edit').forEach(b=>b.onclick=()=>{const entry=(client.entries||[]).find(e=>e.id===b.dataset.id);if(!entry)return;openModal(`<h2>Editar lançamento</h2><form id="monthlyEntryEditForm" class="form-grid"><label>Descrição<input id="monthlyEntryEditDescription" value="${esc(entry.description||'')}" required></label><label>Valor<input id="monthlyEntryEditValue" inputmode="decimal" value="${esc(Number(entry.value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}))}" required></label><label>Data<input id="monthlyEntryEditDate" type="date" value="${esc(entry.date||todayISO())}" required></label><button class="primary">Salvar</button><button id="monthlyEntryEditCancel" type="button" class="secondary">Cancelar</button></form>`);bindV10MoneyInputs('monthlyEntryEditValue');$('monthlyEntryEditCancel').onclick=()=>monthlyClientDetails(client.id);$('monthlyEntryEditForm').onsubmit=async e=>{e.preventDefault();entry.description=$('monthlyEntryEditDescription').value.trim();entry.value=numberValue($('monthlyEntryEditValue').value);entry.date=$('monthlyEntryEditDate').value;entry.updatedAt=Date.now();await updateItem('monthlyClients',client.id,{entries:client.entries});monthlyClientDetails(client.id);toast('Lançamento atualizado.');};});
        document.querySelectorAll('.monthly-entry-delete').forEach(b=>b.onclick=async()=>{client.entries=(client.entries||[]).filter(e=>e.id!==b.dataset.id);await updateItem('monthlyClients',client.id,{entries:client.entries});monthlyClientDetails(client.id);});
        $('monthlyBack').onclick=()=>monthlyClientsModal();
        $('monthlyReceiveAll').onclick=async()=>{if(total<=0)return;if(!confirm(`Confirmar recebimento total de ${moneyText(total)} de ${client.name}?`))return;const now=Date.now();const tx={id:id(),userId:uid(),type:'income',description:`Acerto mensal - ${client.name}`,value:total,category:client.category||'Serviços',date:todayISO(),createdAt:now,sourceMonthlyClientId:client.id,sourceType:'monthlyClient',itemsCount:entries.length,status:'received'};state.transactions.push(tx);client.settlements=client.settlements||[];client.settlements.unshift({id:id(),value:total,date:todayISO(),createdAt:now,entries:[...entries]});client.entries=[];client.lastReceivedAt=now;client.nextClosingDate=nextMonthDate(todayISO(),client.closingDay||30);await updateItem('monthlyClients',client.id,{entries:client.entries,settlements:client.settlements,lastReceivedAt:now,nextClosingDate:client.nextClosingDate});if(typeof persist==='function')persist();if(cloudReady){const {id:txId,userId,...data}=tx;await cloudDb.ref(`finance/${uid()}/transactions/${txId}`).set(data)}monthlyClientDetails(client.id);if(typeof render==='function')render();toast('Acerto recebido, salvo nas receitas e lançamentos abertos limpos.');};
      }

      function auditModal() {
        const list=mine(state.audit).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt));
        openModal(`<div class="v10-history-header"><div><h2>Histórico de atividades</h2><p class="muted">Ações sincronizadas desta conta.</p></div>${list.length?'<button id="clearAuditHistory" class="danger-button v10-history-clear">Excluir tudo</button>':''}</div>
          <div class="v10-list">${list.length?list.map(x=>`<article class="v10-row v10-history-row"><div><b>${esc(x.action)}</b><small>${new Date(x.createdAt).toLocaleString('pt-BR')}</small></div><button type="button" class="v10-audit-delete" data-id="${x.id}" aria-label="Excluir atividade" title="Excluir">×</button></article>`).join(''):'<div class="empty-state">Nenhuma atividade registrada.</div>'}</div>`);
        document.querySelectorAll('.v10-audit-delete').forEach(btn=>btn.onclick=async()=>{
          if(!confirm('Tem certeza que quer excluir esta atividade?'))return;
          await deleteAuditItem(btn.dataset.id);
          auditModal();
          toast('Atividade excluída.');
        });
        const clearBtn=$('clearAuditHistory');
        if(clearBtn) clearBtn.onclick=async()=>{
          if(!confirm('Tem certeza que quer excluir todo o histórico?'))return;
          clearBtn.disabled=true; clearBtn.textContent='Excluindo...';
          await clearAuditHistory();
          auditModal();
          toast('Histórico excluído.');
        };
      }

      function dashboardSettingsModal() {
        const hidden=new Set(state.v10Preferences?.hidden||[]);
        openModal(`<h2>Personalizar atalhos</h2><p class="muted">Escolha quais módulos aparecem na tela inicial.</p><div class="v10-settings">${Object.entries(MODULES).filter(([k])=>k!=='dashboardSettings').map(([key,m])=>`<label class="v10-toggle"><input type="checkbox" data-v10-module="${key}" ${hidden.has(key)?'':'checked'}><span>${m.icon} ${m.label}</span></label>`).join('')}</div><button id="v10SavePreferences" class="primary">Salvar configuração</button>`);
        $('v10SavePreferences').onclick=()=>{const newHidden=[];document.querySelectorAll('[data-v10-module]').forEach(x=>{if(!x.checked)newHidden.push(x.dataset.v10Module)});state.v10Preferences={hidden:newHidden};localStorage.setItem('fia_v10_preferences',JSON.stringify(state.v10Preferences));applyDashboardPreferences();closeModal();toast('Tela inicial personalizada.');};
      }

      // Inicialização segura: não observar toda a página.
      // O observador anterior reagia às próprias alterações de texto e criava
      // um ciclo infinito, travando o aplicativo na tela inicial.
      const bootV10 = () => {
        try {
          installDashboard();
          renderV10Summary();
        } catch (erro) {
          console.error('Finance IA Pro v10: falha ao atualizar os módulos.', erro);
        }
      };
      setTimeout(bootV10, 150);
      window.addEventListener('financeia:render', bootV10);
    } catch (erro) {
      console.error('Finance IA Pro v10: módulos avançados não foram carregados.', erro);
    }
  }

  const iniciar = () => setTimeout(iniciarModulosV10, 0);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  } else {
    iniciar();
  }
})();
