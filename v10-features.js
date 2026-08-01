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

      function walletsModal() {
        openModal(`<h2>Carteiras e centros de controle</h2><p class="muted">Separe finanças pessoais, familiares ou empresariais.</p>
          <form id="v10WalletForm" class="form-grid"><label>Nome da carteira<input id="v10WalletName" required placeholder="Ex.: Casa, Empresa, Família"></label><label>Responsável<input id="v10WalletOwner" required></label><label>Limite mensal<input id="v10WalletLimit" inputmode="decimal" required></label><button class="primary">Criar carteira</button></form><div class="v10-list">${listHtml('wallets')}</div>`);
        bindV10MoneyInputs('v10WalletLimit');
        $('v10WalletForm').onsubmit=async e=>{e.preventDefault();await addItem('wallets',{name:$('v10WalletName').value,owner:$('v10WalletOwner').value,value:numberValue($('v10WalletLimit').value)});walletsModal();}; bindDeletes(walletsModal);
      }

      function contactModal(type,title) {
        openModal(`<h2>${title}</h2><form id="v10ContactForm" class="form-grid"><label>Nome<input id="v10ContactName" required></label><label>Telefone<input id="v10ContactPhone" inputmode="tel"></label><label>E-mail<input id="v10ContactEmail" type="email"></label><label>CPF/CNPJ<input id="v10ContactDocument"></label><label>Observações<textarea id="v10ContactNotes"></textarea></label><button class="primary">Salvar</button></form><div class="v10-list">${listHtml(type)}</div>`);
        $('v10ContactForm').onsubmit=async e=>{e.preventDefault();await addItem(type,{name:$('v10ContactName').value,phone:$('v10ContactPhone').value,email:$('v10ContactEmail').value,document:$('v10ContactDocument').value,notes:$('v10ContactNotes').value});contactModal(type,title);}; bindDeletes(()=>contactModal(type,title));
      }
      const clientsModal=()=>contactModal('clients','Clientes');
      const suppliersModal=()=>contactModal('suppliers','Fornecedores');

      function receiptsModal() {
        openModal(`<h2>Gerador de recibos</h2><form id="v10ReceiptForm" class="form-grid"><label>Recebido de<input id="v10ReceiptName" required></label><label>Valor<input id="v10ReceiptValue" inputmode="decimal" required></label><label>Referente a<input id="v10ReceiptDescription" required></label><label>Data<input id="v10ReceiptDate" type="date" value="${todayISO()}" required></label><button class="primary">Gerar recibo</button></form><div class="v10-list">${listHtml('receipts')}</div>`);
        bindV10MoneyInputs('v10ReceiptValue');
        $('v10ReceiptForm').onsubmit=async e=>{e.preventDefault();const item=await addItem('receipts',{name:$('v10ReceiptName').value,value:numberValue($('v10ReceiptValue').value),description:$('v10ReceiptDescription').value,date:$('v10ReceiptDate').value});printReceipt(item);}; bindDeletes(receiptsModal);
      }
      function printReceipt(item) {
        const win=window.open('','_blank'); if(!win)return toast('Permita pop-ups para imprimir o recibo.');
        win.document.write(`<html><head><title>Recibo</title><style>body{font-family:Arial;padding:40px;line-height:1.6}h1{text-align:center}.value{font-size:28px;font-weight:bold}</style></head><body><h1>RECIBO</h1><p class="value">${moneyText(item.value)}</p><p>Recebi de <b>${esc(item.name)}</b> a importância acima, referente a <b>${esc(item.description)}</b>.</p><p>Data: ${brDate(item.date)}</p><br><br><hr><p style="text-align:center">Assinatura</p><script>window.print()</script></body></html>`);win.document.close();
      }

      function documentsModal() {
        openModal(`<h2>Central de documentos</h2><p class="muted">Cadastre referências de comprovantes, contratos e garantias. Os arquivos podem ser guardados no Firebase Storage em uma atualização posterior.</p><form id="v10DocumentForm" class="form-grid"><label>Título<input id="v10DocTitle" required></label><label>Tipo<select id="v10DocType"><option>Comprovante</option><option>Contrato</option><option>Nota fiscal</option><option>Garantia</option><option>Outro</option></select></label><label>Data<input id="v10DocDate" type="date" required></label><label>Observações<textarea id="v10DocNotes"></textarea></label><button class="primary">Salvar referência</button></form><div class="v10-list">${listHtml('documents')}</div>`);
        $('v10DocumentForm').onsubmit=async e=>{e.preventDefault();await addItem('documents',{title:$('v10DocTitle').value,name:$('v10DocTitle').value,type:$('v10DocType').value,date:$('v10DocDate').value,notes:$('v10DocNotes').value});documentsModal();}; bindDeletes(documentsModal);
      }

      function planningModal() {
        openModal(`<h2>Planejamento anual</h2><form id="v10PlanningForm" class="form-grid"><label>Objetivo<input id="v10PlanName" required></label><label>Valor desejado<input id="v10PlanValue" inputmode="decimal" required></label><label>Prazo<input id="v10PlanDate" type="date" required></label><label>Prioridade<select id="v10PlanPriority"><option>Alta</option><option>Média</option><option>Baixa</option></select></label><button class="primary">Adicionar objetivo</button></form><div class="v10-list">${listHtml('planning')}</div>`);
        bindV10MoneyInputs('v10PlanValue');
        $('v10PlanningForm').onsubmit=async e=>{e.preventDefault();await addItem('planning',{name:$('v10PlanName').value,value:numberValue($('v10PlanValue').value),date:$('v10PlanDate').value,priority:$('v10PlanPriority').value,status:'planejado'});planningModal();}; bindDeletes(planningModal);
      }

      function monthlyClientsModal(editId = null) {
        const editing=editId?(state.monthlyClients||[]).find(x=>x.id===editId):null;
        const clients=mine(state.monthlyClients);
        openModal(`<h2>Clientes com acerto mensal</h2><p class="muted">Cadastre clientes que usam o serviço durante o mês e pagam tudo de uma vez no fechamento.</p>
          <form id="monthlyClientForm" class="form-grid"><label>Nome do cliente<input id="monthlyClientName" required value="${esc(editing?.name||'')}"></label><label>Dia do fechamento<input id="monthlyClientDay" type="number" min="1" max="31" required value="${editing?.closingDay||30}"></label><label>Categoria<input id="monthlyClientCategory" value="${esc(editing?.category||'Serviços')}"></label><button class="primary">${editing?'Salvar cliente':'Adicionar cliente mensal'}</button></form>
          <div class="v10-list">${clients.length?clients.map(c=>{const total=(c.entries||[]).reduce((sum,e)=>sum+Number(e.value||0),0);return `<article class="v10-row"><div><b>${esc(c.name)}</b><small>${(c.entries||[]).length} lançamento(s) • Total aberto ${moneyText(total)} • fecha dia ${c.closingDay||30}</small></div><div class="v10-row-actions"><button class="primary monthly-open" data-id="${c.id}">Abrir</button><button class="secondary monthly-edit" data-id="${c.id}">Editar</button><button class="danger-button monthly-delete" data-id="${c.id}">Excluir</button></div></article>`}).join(''):'<div class="empty-state">Nenhum cliente mensal cadastrado.</div>'}</div>`);
        $('monthlyClientForm').onsubmit=async e=>{e.preventDefault();const data={name:$('monthlyClientName').value.trim(),closingDay:Number($('monthlyClientDay').value),category:$('monthlyClientCategory').value.trim()||'Serviços',entries:editing?.entries||[],settlements:editing?.settlements||[],status:'active'};if(editing)await updateItem('monthlyClients',editing.id,data);else await addItem('monthlyClients',data);monthlyClientsModal();toast('Cliente mensal salvo.');};
        document.querySelectorAll('.monthly-open').forEach(b=>b.onclick=()=>monthlyClientDetails(b.dataset.id));
        document.querySelectorAll('.monthly-edit').forEach(b=>b.onclick=()=>monthlyClientsModal(b.dataset.id));
        document.querySelectorAll('.monthly-delete').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir este cliente mensal e seus lançamentos abertos?'))return;await deleteItem('monthlyClients',b.dataset.id);monthlyClientsModal();});
      }
      function monthlyClientDetails(clientId) {
        const client=(state.monthlyClients||[]).find(x=>x.id===clientId);if(!client)return;const entries=client.entries||[];const total=entries.reduce((s,e)=>s+Number(e.value||0),0);
        openModal(`<h2>${esc(client.name)}</h2><div class="summary-grid"><article class="summary"><span>Lançamentos abertos</span><strong>${entries.length}</strong></article><article class="summary"><span>Total a receber</span><strong>${moneyText(total)}</strong></article></div>
          <form id="monthlyEntryForm" class="form-grid"><label>Descrição<input id="monthlyEntryDescription" required placeholder="Ex.: Serviço da semana"></label><label>Valor<input id="monthlyEntryValue" inputmode="decimal" required></label><label>Data<input id="monthlyEntryDate" type="date" value="${todayISO()}" required></label><button class="primary">Adicionar ao mês</button></form>
          <div class="v10-list">${entries.length?entries.map(e=>`<article class="v10-row"><div><b>${esc(e.description)}</b><small>${brDate(e.date)} • ${moneyText(e.value)}</small></div><button class="danger-button monthly-entry-delete" data-id="${e.id}">Excluir</button></article>`).join(''):'<div class="empty-state">Nenhum serviço lançado neste mês.</div>'}</div>
          <div class="modal-actions"><button id="monthlyReceiveAll" class="primary" ${total<=0?'disabled':''}>Receber total ${moneyText(total)}</button><button id="monthlyBack" class="secondary">Voltar</button></div>`);
        bindV10MoneyInputs('monthlyEntryValue');
        $('monthlyEntryForm').onsubmit=async e=>{e.preventDefault();client.entries=client.entries||[];client.entries.push({id:id(),description:$('monthlyEntryDescription').value.trim(),value:numberValue($('monthlyEntryValue').value),date:$('monthlyEntryDate').value,createdAt:Date.now()});await updateItem('monthlyClients',client.id,{entries:client.entries});monthlyClientDetails(client.id);toast('Valor adicionado ao acerto mensal.');};
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
