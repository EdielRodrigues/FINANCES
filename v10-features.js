/* Finance IA Pro v10.0 — módulos profissionais adicionais */
(() => {
  'use strict';

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
    dashboardSettings: { label: 'Personalizar', icon: '⚙️' }
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
  function addAudit(action, targetId = '') {
    const item = { id: id(), userId: uid(), action, targetId, createdAt: Date.now() };
    state.audit = state.audit || [];
    state.audit.unshift(item);
    state.audit = state.audit.slice(0, 300);
    saveLocal('audit');
    if (cloudReady && uid()) cloudSet('audit', item).catch(() => {});
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
      ['audit','🛡️','Histórico'], ['dashboardSettings','⚙️','Personalizar']
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
    const forecast = banks + toReceive - toPay - subscriptions;
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
      planning: planningModal, audit: auditModal, dashboardSettings: dashboardSettingsModal
    };
    handlers[type]?.();
  }

  function listHtml(type, empty = 'Nenhum registro cadastrado.') {
    const list = mine(state[type]);
    return list.length ? list.map(item => `
      <article class="v10-row">
        <div><b>${esc(item.name || item.description || item.title || 'Registro')}</b>
        <small>${item.value != null ? moneyText(item.value) : item.balance != null ? moneyText(item.balance) : ''}${item.date ? ` • ${brDate(item.date)}` : ''}${item.status ? ` • ${esc(item.status)}` : ''}</small></div>
        <button class="danger-button v10-delete" data-type="${type}" data-id="${item.id}">Excluir</button>
      </article>`).join('') : `<div class="empty-state">${empty}</div>`;
  }
  function bindDeletes(reopen) {
    document.querySelectorAll('.v10-delete').forEach(btn => btn.onclick = async () => {
      if (!confirm('Excluir este registro?')) return;
      await deleteItem(btn.dataset.type, btn.dataset.id);
      reopen();
      toast('Registro excluído.');
    });
  }

  function bankAccountsModal() {
    openModal(`<h2>Contas bancárias e caixas</h2>
      <form id="v10BankForm" class="form-grid">
        <label>Nome da conta<input id="v10BankName" required placeholder="Ex.: Banco, carteira, caixa"></label>
        <label>Tipo<select id="v10BankType"><option>Conta corrente</option><option>Poupança</option><option>Carteira</option><option>Caixa da empresa</option><option>Investimentos</option></select></label>
        <label>Saldo atual<input id="v10BankBalanceInput" inputmode="decimal" required placeholder="0,00"></label>
        <button class="primary">Adicionar conta</button>
      </form><div class="v10-list">${listHtml('bankAccounts')}</div>`);
    $('v10BankForm').onsubmit = async e => { e.preventDefault(); await addItem('bankAccounts',{name:$('v10BankName').value,type:$('v10BankType').value,balance:numberValue($('v10BankBalanceInput').value)}); bankAccountsModal(); toast('Conta adicionada.'); };
    bindDeletes(bankAccountsModal);
  }

  function subscriptionsModal() {
    openModal(`<h2>Assinaturas e despesas recorrentes</h2>
      <form id="v10SubscriptionForm" class="form-grid">
        <label>Serviço<input id="v10SubName" required placeholder="Ex.: Internet, streaming"></label>
        <label>Valor mensal<input id="v10SubValue" inputmode="decimal" required></label>
        <label>Dia de cobrança<input id="v10SubDay" type="number" min="1" max="31" required></label>
        <label>Categoria<input id="v10SubCategory" placeholder="Ex.: Serviços"></label>
        <button class="primary">Adicionar assinatura</button>
      </form><div class="v10-list">${listHtml('subscriptions')}</div>`);
    $('v10SubscriptionForm').onsubmit = async e => { e.preventDefault(); await addItem('subscriptions',{name:$('v10SubName').value,value:numberValue($('v10SubValue').value),day:Number($('v10SubDay').value),category:$('v10SubCategory').value,active:true}); subscriptionsModal(); };
    bindDeletes(subscriptionsModal);
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
    $('v10LoanForm').onsubmit = async e => { e.preventDefault(); await addItem('loans',{name:$('v10LoanName').value,balance:numberValue($('v10LoanBalance').value),installment:numberValue($('v10LoanInstallment').value),date:$('v10LoanDate').value,remaining:Number($('v10LoanCount').value),status:'active'}); loansModal(); };
    bindDeletes(loansModal);
  }

  function cashFlowModal() {
    const tx = userTx();
    const bills = mine(state.bills || []);
    const months = {};
    tx.forEach(x => { const month=String(x.date||'').slice(0,7)||'Sem data'; months[month]=months[month]||{income:0,expense:0}; months[month][x.type==='income'?'income':'expense'] += Number(x.value||0); });
    const rows = Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0])).map(([month,v])=>`<div class="v10-flow-row"><b>${esc(month)}</b><span class="income">+ ${moneyText(v.income)}</span><span class="expense">− ${moneyText(v.expense)}</span><strong>${moneyText(v.income-v.expense)}</strong></div>`).join('');
    const pending = bills.filter(x=>!['paid','received'].includes(x.status));
    openModal(`<h2>Fluxo de caixa</h2><div class="v10-metrics"><article><span>Meses analisados</span><strong>${Object.keys(months).length}</strong></article><article><span>Compromissos abertos</span><strong>${pending.length}</strong></article></div><div class="v10-flow">${rows||'<div class="empty-state">Cadastre lançamentos para gerar o fluxo de caixa.</div>'}</div>`);
  }

  function walletsModal() {
    openModal(`<h2>Carteiras e centros de controle</h2><p class="muted">Separe finanças pessoais, familiares ou empresariais.</p>
      <form id="v10WalletForm" class="form-grid"><label>Nome da carteira<input id="v10WalletName" required placeholder="Ex.: Casa, Empresa, Família"></label><label>Responsável<input id="v10WalletOwner" required></label><label>Limite mensal<input id="v10WalletLimit" inputmode="decimal" required></label><button class="primary">Criar carteira</button></form><div class="v10-list">${listHtml('wallets')}</div>`);
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
    $('v10PlanningForm').onsubmit=async e=>{e.preventDefault();await addItem('planning',{name:$('v10PlanName').value,value:numberValue($('v10PlanValue').value),date:$('v10PlanDate').value,priority:$('v10PlanPriority').value,status:'planejado'});planningModal();}; bindDeletes(planningModal);
  }

  function auditModal() {
    const list=mine(state.audit).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt));
    openModal(`<h2>Histórico de atividades</h2><div class="v10-list">${list.length?list.map(x=>`<article class="v10-row"><div><b>${esc(x.action)}</b><small>${new Date(x.createdAt).toLocaleString('pt-BR')}</small></div></article>`).join(''):'<div class="empty-state">Nenhuma atividade registrada.</div>'}</div>`);
  }

  function dashboardSettingsModal() {
    const hidden=new Set(state.v10Preferences?.hidden||[]);
    openModal(`<h2>Personalizar atalhos</h2><p class="muted">Escolha quais módulos aparecem na tela inicial.</p><div class="v10-settings">${Object.entries(MODULES).filter(([k])=>k!=='dashboardSettings').map(([key,m])=>`<label class="v10-toggle"><input type="checkbox" data-v10-module="${key}" ${hidden.has(key)?'':'checked'}><span>${m.icon} ${m.label}</span></label>`).join('')}</div><button id="v10SavePreferences" class="primary">Salvar configuração</button>`);
    $('v10SavePreferences').onclick=()=>{const newHidden=[];document.querySelectorAll('[data-v10-module]').forEach(x=>{if(!x.checked)newHidden.push(x.dataset.v10Module)});state.v10Preferences={hidden:newHidden};localStorage.setItem('fia_v10_preferences',JSON.stringify(state.v10Preferences));applyDashboardPreferences();closeModal();toast('Tela inicial personalizada.');};
  }

  const observer = new MutationObserver(() => { installDashboard(); renderV10Summary(); });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>{installDashboard();renderV10Summary();},100);
})();
