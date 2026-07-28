/* Finance IA Pro v7.0 - módulos financeiros avançados */
(() => {
  const read = (key, fallback=[]) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
  state.bills = read('fia_bills');
  state.cards = read('fia_cards');
  state.installments = read('fia_installments');
  state.categories = read('fia_categories', [
    {id:'moradia',name:'Moradia'},{id:'alimentacao',name:'Alimentação'},{id:'transporte',name:'Transporte'},
    {id:'saude',name:'Saúde'},{id:'lazer',name:'Lazer'},{id:'salario',name:'Salário'},{id:'outros',name:'Outros'}
  ]);

  const saveV7Local = () => {
    localStorage.setItem('fia_bills', JSON.stringify(state.bills));
    localStorage.setItem('fia_cards', JSON.stringify(state.cards));
    localStorage.setItem('fia_installments', JSON.stringify(state.installments));
    localStorage.setItem('fia_categories', JSON.stringify(state.categories));
  };
  const onlyMine = list => list.filter(x => x.userId === state.user?.id);
  const centsSum = (list, field='value') => fromCents(list.reduce((s,x)=>s+toCents(x[field]),0));
  const dateBR = d => d ? new Date(d+'T12:00:00').toLocaleDateString('pt-BR') : '-';
  const statusText = s => ({pending:'Pendente',paid:'Pago',received:'Recebido',overdue:'Vencido'}[s] || s || 'Pendente');
  const uidMap = list => { const out={}; onlyMine(list).forEach(x=>{const {id,userId,...data}=x;out[id]=data}); return out; };

  const originalPersist = persist;
  persist = function(){ saveV7Local(); return originalPersist(); };

  const originalCloudSave = cloudSaveState;
  cloudSaveState = async function(){
    await originalCloudSave();
    if(!cloudReady || !state.user?.id) return;
    await cloudDb.ref(`finance/${state.user.id}`).update({
      bills: uidMap(state.bills), cards: uidMap(state.cards), installments: uidMap(state.installments), categories: uidMap(state.categories)
    });
  };

  const originalSubscribe = subscribeCloudData;
  subscribeCloudData = function(uid){
    originalSubscribe(uid);
    const bindV7 = (name, target, key) => {
      const ref=cloudDb.ref(`finance/${uid}/${name}`);
      const fn=ref.on('value', snap=>{
        const val=snap.val()||{};
        const remote=Object.entries(val).map(([id,x])=>({id,userId:uid,...x}));
        const local=state[target].filter(x=>x.userId===uid);
        if(remote.length || !local.length){
          state[target]=[...state[target].filter(x=>x.userId!==uid),...remote];
          localStorage.setItem(key,JSON.stringify(state[target]));
          render();
        }
      });
      cloudUnsubs.push(()=>ref.off('value',fn));
    };
    bindV7('bills','bills','fia_bills');
    bindV7('cards','cards','fia_cards');
    bindV7('installments','installments','fia_installments');
    bindV7('categories','categories','fia_categories');
  };

  function addDashboardBlocks(){
    const main=document.querySelector('#appScreen main');
    if(!main || document.getElementById('v7FinancialOverview')) return;
    const quick=document.querySelector('.quick-actions');
    quick?.insertAdjacentHTML('beforeend', `
      <button id="billsBtn"><span>▣</span>Contas</button>
      <button id="cardsBtn"><span>💳</span>Cartões</button>
      <button id="calendarBtn"><span>📅</span>Calendário</button>
      <button id="categoriesBtn"><span>🏷</span>Categorias</button>`);
    const summary=document.querySelector('.summary-grid');
    summary?.insertAdjacentHTML('beforeend', `
      <article class="summary"><span>A pagar</span><strong id="payableValue">R$ 0,00</strong></article>
      <article class="summary"><span>A receber</span><strong id="receivableValue">R$ 0,00</strong></article>
      <article class="summary"><span>Patrimônio</span><strong id="netWorthValue">R$ 0,00</strong></article>
      <article class="summary"><span>Próximo vencimento</span><strong id="nextDueValue">—</strong></article>`);
    const firstPanel=document.querySelector('.panel');
    firstPanel?.insertAdjacentHTML('afterend', `
      <section id="v7FinancialOverview" class="panel">
        <div class="panel-head"><h3>Próximos compromissos</h3><button id="manageFinanceBtn" class="link-btn">Gerenciar</button></div>
        <div id="upcomingList" class="empty-state">Nenhuma conta próxima.</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Assistente financeiro</h3><button id="openFullAiBtn" class="link-btn">Analisar</button></div>
        <div id="smartInsight" class="ai-box"><b>Organize seus lançamentos</b><p>Cadastre receitas e despesas para receber uma análise.</p></div>
      </section>`);
    bindDashboardButtons();
  }

  function bindDashboardButtons(){
    const set=(id,fn)=>{const el=$(id);if(el)el.onclick=fn};
    set('billsBtn',()=>financeHubModal('bills'));
    set('cardsBtn',()=>financeHubModal('cards'));
    set('calendarBtn',calendarModal);
    set('categoriesBtn',categoriesModal);
    set('manageFinanceBtn',()=>financeHubModal('bills'));
    set('openFullAiBtn',smartAnalysisModal);
  }

  function dashboardV7(){
    if(!state.user) return;
    const bills=onlyMine(state.bills);
    const tx=userTx();
    const pendingPay=bills.filter(x=>x.kind==='payable'&&x.status!=='paid');
    const pendingReceive=bills.filter(x=>x.kind==='receivable'&&x.status!=='received');
    const payable=centsSum(pendingPay), receivable=centsSum(pendingReceive);
    const income=sumMoney(tx.filter(x=>x.type==='income')), expense=sumMoney(tx.filter(x=>x.type==='expense'));
    const cardDebt=centsSum(onlyMine(state.cards),'currentInvoice');
    const netWorth=fromCents(toCents(income)-toCents(expense)+toCents(receivable)-toCents(payable)-toCents(cardDebt));
    if($('payableValue')) $('payableValue').textContent=money(payable);
    if($('receivableValue')) $('receivableValue').textContent=money(receivable);
    if($('netWorthValue')) $('netWorthValue').textContent=money(netWorth);
    const upcoming=[...pendingPay,...pendingReceive].sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate))).slice(0,4);
    if($('nextDueValue')) $('nextDueValue').textContent=upcoming[0]?dateBR(upcoming[0].dueDate):'—';
    if($('upcomingList')){
      $('upcomingList').className=upcoming.length?'upcoming-list':'empty-state';
      $('upcomingList').innerHTML=upcoming.length?upcoming.map(x=>`<button class="upcoming-item" data-open-bill="${x.id}"><div><b>${escapeHtml(x.description)}</b><small>${x.kind==='payable'?'Pagar':'Receber'} • ${dateBR(x.dueDate)}</small></div><strong>${money(x.value)}</strong></button>`).join(''):'Nenhuma conta próxima.';
      document.querySelectorAll('[data-open-bill]').forEach(b=>b.onclick=()=>billDetailsModal(b.dataset.openBill));
    }
    if($('smartInsight')) $('smartInsight').innerHTML=buildInsight(income,expense,payable,receivable);
    notifyUpcomingBills(pendingPay);
  }

  function notifyUpcomingBills(pendingPay){
    const today=new Date();today.setHours(0,0,0,0);
    const urgent=pendingPay.filter(x=>{const d=new Date(String(x.dueDate||'')+'T12:00:00');if(Number.isNaN(d.getTime()))return false;const days=Math.ceil((d-today)/86400000);return days<=3;}).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));
    if(!urgent.length)return;
    const key='fia_due_alert_'+today.toISOString().slice(0,10)+'_'+state.user.id;
    if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1');
    const overdue=urgent.filter(x=>new Date(String(x.dueDate)+'T12:00:00')<today).length;
    const dueToday=urgent.filter(x=>new Date(String(x.dueDate)+'T12:00:00').toDateString()===today.toDateString()).length;
    const message=overdue?`${overdue} conta(s) vencida(s).`:dueToday?`${dueToday} conta(s) vencem hoje.`:`${urgent.length} conta(s) vencem nos próximos 3 dias.`;
    setTimeout(()=>toast('⚠ '+message),600);
  }

  function buildInsight(income,expense,payable,receivable){
    if(!income&&!expense) return '<b>Comece seu controle</b><p>Cadastre receitas, despesas e contas para receber recomendações automáticas.</p>';
    const balance=income-expense;
    if(expense>income) return `<b>Atenção aos gastos</b><p>Suas despesas estão ${money(expense-income)} acima das receitas. Revise categorias e contas pendentes.</p>`;
    const rate=income?Math.round(balance/income*100):0;
    if(payable>balance) return `<b>Planeje os próximos pagamentos</b><p>Há ${money(payable)} a pagar e seu saldo calculado é ${money(balance)}. Priorize os vencimentos mais próximos.</p>`;
    return `<b>Bom controle financeiro</b><p>Você preservou ${rate}% das receitas. Ainda tem ${money(receivable)} para receber.</p>`;
  }

  const originalRender=render;
  render=function(){ originalRender(); addDashboardBlocks(); dashboardV7(); };

  const billFilters={q:'',kind:'all',status:'all',due:'all',start:'',end:'',min:'',max:'',sort:'date-asc'};
  const normalizeSearch=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const parseFilterMoney=v=>{const t=String(v||'').trim();if(!t)return null;const n=Number(t.replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:null};
  function daysFromToday(date){const today=new Date();today.setHours(0,0,0,0);const d=new Date(String(date||'')+'T12:00:00');return Number.isNaN(d.getTime())?999999:Math.ceil((d-today)/86400000)}
  function applyBillFilters(list){
    const q=normalizeSearch(billFilters.q),min=parseFilterMoney(billFilters.min),max=parseFilterMoney(billFilters.max);
    const filtered=list.filter(x=>{
      const days=daysFromToday(x.dueDate),open=!['paid','received'].includes(x.status);
      const hay=normalizeSearch([x.description,x.category,x.notes,x.cpf,x.phone,x.telefone,x.email,x.value,x.dueDate,statusText(x.status),x.kind==='payable'?'conta a pagar':'conta a receber'].join(' '));
      if(q&&!hay.includes(q))return false;
      if(billFilters.kind!=='all'&&x.kind!==billFilters.kind)return false;
      if(billFilters.status==='pending'&&(!open||days<0))return false;
      if(billFilters.status==='settled'&&open)return false;
      if(billFilters.status==='overdue'&&!(open&&days<0))return false;
      if(billFilters.status==='paid'&&x.status!=='paid')return false;
      if(billFilters.status==='received'&&x.status!=='received')return false;
      if(billFilters.due==='today'&&days!==0)return false;
      if(billFilters.due==='3days'&&!(days>=0&&days<=3))return false;
      if(billFilters.due==='7days'&&!(days>=0&&days<=7))return false;
      if(billFilters.due==='overdue'&&!(open&&days<0))return false;
      if(billFilters.start&&String(x.dueDate||'')<billFilters.start)return false;
      if(billFilters.end&&String(x.dueDate||'')>billFilters.end)return false;
      if(min!==null&&Number(x.value||0)<min)return false;
      if(max!==null&&Number(x.value||0)>max)return false;
      return true;
    });
    const coll=new Intl.Collator('pt-BR',{sensitivity:'base'});
    return filtered.sort((a,b)=>{
      if(billFilters.sort==='date-desc')return String(b.dueDate).localeCompare(String(a.dueDate));
      if(billFilters.sort==='value-asc')return Number(a.value||0)-Number(b.value||0);
      if(billFilters.sort==='value-desc')return Number(b.value||0)-Number(a.value||0);
      if(billFilters.sort==='name-asc')return coll.compare(a.description||'',b.description||'');
      if(billFilters.sort==='name-desc')return coll.compare(b.description||'',a.description||'');
      if(billFilters.sort==='newest')return Number(b.createdAt||0)-Number(a.createdAt||0);
      if(billFilters.sort==='oldest')return Number(a.createdAt||0)-Number(b.createdAt||0);
      return String(a.dueDate).localeCompare(String(b.dueDate));
    });
  }
  function billSummaryHtml(list){
    const open=list.filter(x=>!['paid','received'].includes(x.status));
    const overdue=open.filter(x=>daysFromToday(x.dueDate)<0);
    const payable=open.filter(x=>x.kind==='payable'),receivable=open.filter(x=>x.kind==='receivable');
    const settled=list.filter(x=>['paid','received'].includes(x.status));
    return `<div class="bill-filter-summary"><article><span>Encontrados</span><strong>${list.length}</strong></article><article><span>A pagar</span><strong>${money(centsSum(payable))}</strong></article><article><span>A receber</span><strong>${money(centsSum(receivable))}</strong></article><article><span>Vencido</span><strong>${money(centsSum(overdue))}</strong></article><article><span>Baixado</span><strong>${money(centsSum(settled))}</strong></article></div>`;
  }
  function billsFilterPanelHtml(){return `<section class="bill-advanced-search">
      <div class="bill-search-title"><b>🔎 Pesquisa avançada</b><button id="toggleBillFilters" type="button" class="link-btn">Filtros</button></div>
      <input id="billSearch" value="${escapeHtml(billFilters.q)}" placeholder="Nome, categoria, observação, CPF, telefone ou valor">
      <div id="billFilterFields" class="bill-filter-fields">
        <label>Tipo<select id="billKindFilter"><option value="all">Todos</option><option value="payable">A pagar</option><option value="receivable">A receber</option></select></label>
        <label>Status<select id="billStatusFilter"><option value="all">Todos</option><option value="pending">Pendentes</option><option value="settled">Pagos/recebidos</option><option value="overdue">Vencidos</option><option value="paid">Pagos</option><option value="received">Recebidos</option></select></label>
        <label>Vencimento<select id="billDueFilter"><option value="all">Qualquer data</option><option value="today">Vence hoje</option><option value="3days">Próximos 3 dias</option><option value="7days">Próximos 7 dias</option><option value="overdue">Já vencidas</option></select></label>
        <label>Ordenar<select id="billSort"><option value="date-asc">Data mais próxima</option><option value="date-desc">Data mais distante</option><option value="value-desc">Maior valor</option><option value="value-asc">Menor valor</option><option value="name-asc">Nome A–Z</option><option value="name-desc">Nome Z–A</option><option value="newest">Mais recentes</option><option value="oldest">Mais antigos</option></select></label>
        <label>Data inicial<input id="billStart" type="date" value="${billFilters.start}"></label><label>Data final<input id="billEnd" type="date" value="${billFilters.end}"></label>
        <label>Valor mínimo<input id="billMin" inputmode="decimal" value="${escapeHtml(billFilters.min)}" placeholder="0,00"></label><label>Valor máximo<input id="billMax" inputmode="decimal" value="${escapeHtml(billFilters.max)}" placeholder="0,00"></label>
      </div>
      <div class="bill-filter-actions"><button id="clearBillFilters" class="secondary" type="button">Limpar</button><button id="exportFilteredBills" class="secondary" type="button">Exportar resultados</button><button id="deleteFilteredBills" class="danger-button" type="button">Excluir resultados</button></div>
    </section>`}
  function financeHubModal(tab='bills'){
    if(!canUsePremiumApp()) return paymentModal();
    const allBills=onlyMine(state.bills);
    const bills=applyBillFilters(allBills);
    const cards=onlyMine(state.cards);
    const installments=onlyMine(state.installments);
    openModal(`<h2>Gestão financeira completa</h2>
      <div class="v7-tabs"><button data-v7tab="bills" class="${tab==='bills'?'active':''}">Contas</button><button data-v7tab="cards" class="${tab==='cards'?'active':''}">Cartões</button><button data-v7tab="installments" class="${tab==='installments'?'active':''}">Parcelamentos</button></div>
      <div class="modal-actions"><button id="newPayable" class="primary">+ Conta a pagar</button><button id="newReceivable" class="secondary">+ Conta a receber</button>${tab==='cards'?'<button id="newCard" class="secondary">+ Cartão</button>':''}${tab==='installments'?'<button id="newInstallment" class="secondary">+ Parcelamento</button>':''}</div>
      ${tab==='bills'?billsFilterPanelHtml()+`<div id="billFilterSummary">${billSummaryHtml(bills)}</div>`:''}
      <div id="financeResultList" class="v7-list">${tab==='bills'?renderBillsHtml(bills):tab==='cards'?renderCardsHtml(cards):renderInstallmentsHtml(installments)}</div>`);
    document.querySelectorAll('[data-v7tab]').forEach(b=>b.onclick=()=>financeHubModal(b.dataset.v7tab));
    $('newPayable').onclick=()=>billFormModal('payable'); $('newReceivable').onclick=()=>billFormModal('receivable');
    if($('newCard'))$('newCard').onclick=cardFormModal;
    if($('newInstallment'))$('newInstallment').onclick=installmentFormModal;
    const bindRows=()=>{document.querySelectorAll('[data-bill]').forEach(b=>b.onclick=()=>billDetailsModal(b.dataset.bill));document.querySelectorAll('[data-card]').forEach(b=>b.onclick=()=>cardDetailsModal(b.dataset.card));document.querySelectorAll('[data-installment]').forEach(b=>b.onclick=()=>installmentDetailsModal(b.dataset.installment));};
    bindRows();
    if(tab==='bills'){
      const map={billKindFilter:'kind',billStatusFilter:'status',billDueFilter:'due',billSort:'sort',billStart:'start',billEnd:'end',billMin:'min',billMax:'max'};
      Object.entries(map).forEach(([id,key])=>{const el=$(id);if(el){el.value=billFilters[key];el.oninput=()=>{billFilters[key]=el.value;refreshBillResults()}}});
      $('billSearch').oninput=()=>{billFilters.q=$('billSearch').value;refreshBillResults()};
      $('toggleBillFilters').onclick=()=>document.getElementById('billFilterFields').classList.toggle('collapsed');
      $('clearBillFilters').onclick=()=>{Object.assign(billFilters,{q:'',kind:'all',status:'all',due:'all',start:'',end:'',min:'',max:'',sort:'date-asc'});financeHubModal('bills')};
      $('exportFilteredBills').onclick=()=>exportBillsCsv(applyBillFilters(onlyMine(state.bills)));
      $('deleteFilteredBills').onclick=()=>deleteFilteredBills(applyBillFilters(onlyMine(state.bills)));
    }
    function refreshBillResults(){const results=applyBillFilters(onlyMine(state.bills));$('financeResultList').innerHTML=renderBillsHtml(results);$('billFilterSummary').innerHTML=billSummaryHtml(results);bindRows()}
  }
  function exportBillsCsv(list){if(!list.length)return toast('Nenhum resultado para exportar.');const rows=[['Tipo','Descrição','Categoria','Valor','Vencimento','Status','Observação'],...list.map(x=>[x.kind==='payable'?'Conta a pagar':'Conta a receber',x.description,x.category,Number(x.value||0).toFixed(2).replace('.',','),x.dueDate,statusText(x.status),x.notes||''])];const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='finance-ia-pro-contas-filtradas.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Resultados filtrados exportados.');}
  async function deleteFilteredBills(list){if(!list.length)return toast('Nenhum resultado para excluir.');if(!confirm(`Excluir ${list.length} conta(s) encontradas?`))return;if(!confirm('Esta ação não pode ser desfeita. Confirma novamente?'))return;const ids=new Set(list.map(x=>x.id));state.bills=state.bills.filter(x=>!ids.has(x.id));saveV7Local();persist();if(cloudReady){const updates={};list.forEach(x=>updates[x.id]=null);await cloudDb.ref(`finance/${state.user.id}/bills`).update(updates)}financeHubModal('bills');render();toast(`${list.length} conta(s) excluída(s).`);}
  const renderBillsHtml=list=>list.length?list.map(x=>{const today=new Date();today.setHours(0,0,0,0);const due=new Date(String(x.dueDate||'')+'T12:00:00');const open=!['paid','received'].includes(x.status);const days=Number.isNaN(due.getTime())?999:Math.ceil((due-today)/86400000);const cls=open&&days<0?' bill-overdue':open&&days<=3?' bill-due-soon':'';const alert=open&&days<0?' • Vencida':open&&days===0?' • Vence hoje':open&&days<=3?` • Vence em ${days} dia(s)`:'';return `<button class="record-row${cls}" data-bill="${x.id}"><span>${x.kind==='payable'?'↘':'↗'}</span><div><b>${escapeHtml(x.description)}</b><small>${dateBR(x.dueDate)} • ${statusText(x.status)}${alert}</small></div><strong>${money(x.value)}</strong></button>`}).join(''):'<div class="empty-state">Nenhuma conta cadastrada.</div>';
  const renderCardsHtml=list=>list.length?list.map(x=>`<button class="record-row" data-card="${x.id}"><span>💳</span><div><b>${escapeHtml(x.name)}</b><small>Fecha dia ${x.closingDay} • Vence dia ${x.dueDay}</small></div><strong>${money(x.currentInvoice||0)}</strong></button>`).join(''):'<div class="empty-state">Nenhum cartão cadastrado.</div>';
  const renderInstallmentsHtml=list=>list.length?list.map(x=>`<button class="record-row" data-installment="${x.id}"><span>≡</span><div><b>${escapeHtml(x.description)}</b><small>${x.paid||0}/${x.total} parcelas</small></div><strong>${money(x.installmentValue)}</strong></button>`).join(''):'<div class="empty-state">Nenhum parcelamento cadastrado.</div>';

  function categoryOptions(selected=''){return state.categories.filter(x=>!x.userId||x.userId===state.user?.id).map(x=>`<option ${x.name===selected?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}
  function billFormModal(kind, existing=null){
    openModal(`<h2>${existing?'Editar':kind==='payable'?'Nova conta a pagar':'Nova conta a receber'}</h2><form id="billForm" class="form-grid">
      <label>Descrição<input id="billDescription" value="${escapeHtml(existing?.description||'')}" required></label>
      <label>Valor<input id="billValue" inputmode="decimal" value="${existing?money(existing.value).replace('R$ ',''):''}" required></label>
      <label>Categoria<select id="billCategory">${categoryOptions(existing?.category)}</select></label>
      <label>Vencimento<input id="billDue" type="date" value="${existing?.dueDate||todayISO()}" required></label>
      <label>Repetir<select id="billRepeat"><option value="none">Não repetir</option><option value="monthly" ${existing?.repeat==='monthly'?'selected':''}>Todo mês</option></select></label>
      <label>Observação<textarea id="billNotes" rows="3">${escapeHtml(existing?.notes||'')}</textarea></label>
      <button class="primary">Salvar conta</button></form>`);
    enableLiveMoneyMask($('billValue'));
    $('billForm').onsubmit=async e=>{e.preventDefault();const value=moneyInputValue($('billValue'));if(!value||value<=0)return toast('Informe um valor válido.');const item={id:existing?.id||crypto.randomUUID(),userId:state.user.id,kind,description:$('billDescription').value.trim(),value,category:$('billCategory').value,dueDate:$('billDue').value,repeat:$('billRepeat').value,notes:$('billNotes').value.trim(),status:existing?.status||'pending',createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};state.bills=state.bills.filter(x=>x.id!==item.id);state.bills.push(item);persist();if(cloudReady){const {id,userId,...data}=item;await cloudDb.ref(`finance/${userId}/bills/${id}`).set(data)}closeModal();render();toast('Conta salva com sucesso.');};
  }
  function billDetailsModal(id){const x=state.bills.find(i=>i.id===id);if(!x)return;openModal(`<h2>${escapeHtml(x.description)}</h2><div class="detail-grid"><p><b>Tipo</b><br>${x.kind==='payable'?'Conta a pagar':'Conta a receber'}</p><p><b>Valor</b><br>${money(x.value)}</p><p><b>Vencimento</b><br>${dateBR(x.dueDate)}</p><p><b>Status</b><br>${statusText(x.status)}</p></div><div class="modal-actions"><button id="settleBill" class="primary">${x.kind==='payable'?'Marcar como paga':'Marcar como recebida'}</button><button id="editBill" class="secondary">Editar</button><button id="deleteBill" class="danger-button">Excluir</button></div>`);$('settleBill').onclick=()=>settleBill(x);$('editBill').onclick=()=>billFormModal(x.kind,x);$('deleteBill').onclick=()=>deleteRecord('bills',x.id,()=>financeHubModal('bills'));}
  async function settleBill(x){x.status=x.kind==='payable'?'paid':'received';x.updatedAt=Date.now();const tx={id:crypto.randomUUID(),userId:state.user.id,type:x.kind==='payable'?'expense':'income',description:x.description,value:x.value,category:x.category,date:todayISO(),createdAt:Date.now(),sourceBillId:x.id};state.transactions.push(tx);persist();if(cloudReady){await cloudDb.ref(`finance/${state.user.id}/bills/${x.id}`).update({status:x.status,updatedAt:x.updatedAt});const {id,userId,...data}=tx;await cloudDb.ref(`finance/${state.user.id}/transactions/${id}`).set(data)}closeModal();render();toast('Baixa realizada e lançamento criado.');}

  function cardFormModal(existing=null){openModal(`<h2>${existing?'Editar cartão':'Novo cartão'}</h2><form id="cardForm" class="form-grid"><label>Nome do cartão<input id="cardName" value="${escapeHtml(existing?.name||'')}" required></label><label>Limite<input id="cardLimit" inputmode="decimal" value="${existing?money(existing.limit).replace('R$ ',''):''}" required></label><label>Fatura atual<input id="cardInvoice" inputmode="decimal" value="${existing?money(existing.currentInvoice||0).replace('R$ ',''):'0,00'}"></label><label>Dia do fechamento<input id="cardClosing" type="number" min="1" max="31" value="${existing?.closingDay||10}" required></label><label>Dia do vencimento<input id="cardDue" type="number" min="1" max="31" value="${existing?.dueDay||17}" required></label><button class="primary">Salvar cartão</button></form>`);enableLiveMoneyMask($('cardLimit'));enableLiveMoneyMask($('cardInvoice'));$('cardForm').onsubmit=async e=>{e.preventDefault();const item={id:existing?.id||crypto.randomUUID(),userId:state.user.id,name:$('cardName').value.trim(),limit:moneyInputValue($('cardLimit')),currentInvoice:moneyInputValue($('cardInvoice'))||0,closingDay:Number($('cardClosing').value),dueDay:Number($('cardDue').value),createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};state.cards=state.cards.filter(x=>x.id!==item.id);state.cards.push(item);persist();if(cloudReady){const {id,userId,...data}=item;await cloudDb.ref(`finance/${userId}/cards/${id}`).set(data)}financeHubModal('cards');toast('Cartão salvo.');};}
  function cardDetailsModal(id){const x=state.cards.find(i=>i.id===id);if(!x)return;const available=Math.max(0,(x.limit||0)-(x.currentInvoice||0));openModal(`<h2>${escapeHtml(x.name)}</h2><div class="summary-grid"><article class="summary"><span>Limite</span><strong>${money(x.limit)}</strong></article><article class="summary"><span>Fatura</span><strong>${money(x.currentInvoice||0)}</strong></article><article class="summary"><span>Disponível</span><strong>${money(available)}</strong></article></div><div class="modal-actions"><button id="editCard" class="secondary">Editar</button><button id="deleteCard" class="danger-button">Excluir</button></div>`);$('editCard').onclick=()=>cardFormModal(x);$('deleteCard').onclick=()=>deleteRecord('cards',x.id,()=>financeHubModal('cards'));}

  function installmentFormModal(existing=null){openModal(`<h2>Novo parcelamento</h2><form id="installmentForm" class="form-grid"><label>Descrição<input id="instDescription" value="${escapeHtml(existing?.description||'')}" required></label><label>Valor total<input id="instTotalValue" inputmode="decimal" value="${existing?money(existing.totalValue).replace('R$ ',''):''}" required></label><label>Número de parcelas<input id="instTotal" type="number" min="2" max="120" value="${existing?.total||2}" required></label><label>Parcelas pagas<input id="instPaid" type="number" min="0" value="${existing?.paid||0}"></label><label>Primeiro vencimento<input id="instDue" type="date" value="${existing?.firstDue||todayISO()}" required></label><button class="primary">Salvar parcelamento</button></form>`);enableLiveMoneyMask($('instTotalValue'));$('installmentForm').onsubmit=async e=>{e.preventDefault();const totalValue=moneyInputValue($('instTotalValue')),total=Number($('instTotal').value);const item={id:existing?.id||crypto.randomUUID(),userId:state.user.id,description:$('instDescription').value.trim(),totalValue,total,paid:Number($('instPaid').value||0),installmentValue:roundMoney(totalValue/total),firstDue:$('instDue').value,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};state.installments=state.installments.filter(x=>x.id!==item.id);state.installments.push(item);persist();if(cloudReady){const {id,userId,...data}=item;await cloudDb.ref(`finance/${userId}/installments/${id}`).set(data)}financeHubModal('installments');toast('Parcelamento salvo.');};}
  function installmentDetailsModal(id){const x=state.installments.find(i=>i.id===id);if(!x)return;openModal(`<h2>${escapeHtml(x.description)}</h2><div class="detail-grid"><p><b>Total</b><br>${money(x.totalValue)}</p><p><b>Parcela</b><br>${money(x.installmentValue)}</p><p><b>Progresso</b><br>${x.paid||0} de ${x.total}</p></div><div class="modal-actions"><button id="payInstallment" class="primary">Pagar próxima</button><button id="deleteInstallment" class="danger-button">Excluir</button></div>`);$('payInstallment').onclick=async()=>{if((x.paid||0)>=x.total)return toast('Parcelamento já quitado.');x.paid=(x.paid||0)+1;x.updatedAt=Date.now();const tx={id:crypto.randomUUID(),userId:state.user.id,type:'expense',description:`${x.description} - parcela ${x.paid}/${x.total}`,value:x.installmentValue,category:'Parcelamento',date:todayISO(),createdAt:Date.now()};state.transactions.push(tx);persist();if(cloudReady){await cloudDb.ref(`finance/${state.user.id}/installments/${x.id}`).update({paid:x.paid,updatedAt:x.updatedAt});const {id,userId,...data}=tx;await cloudDb.ref(`finance/${state.user.id}/transactions/${id}`).set(data)}installmentDetailsModal(x.id);render();toast('Parcela registrada.');};$('deleteInstallment').onclick=()=>deleteRecord('installments',x.id,()=>financeHubModal('installments'));}

  async function deleteRecord(type,id,after){if(!confirm('Confirma a exclusão deste registro?'))return;state[type]=state[type].filter(x=>x.id!==id);saveV7Local();if(cloudReady)await cloudDb.ref(`finance/${state.user.id}/${type}/${id}`).remove();persist();after();render();toast('Registro excluído.');}

  function categoriesModal(){const list=state.categories.filter(x=>!x.userId||x.userId===state.user.id);openModal(`<h2>Categorias personalizadas</h2><form id="categoryForm" class="inline-form"><input id="categoryName" placeholder="Nova categoria" required><button class="primary">Adicionar</button></form><div class="chip-list">${list.map(x=>`<span class="category-chip">${escapeHtml(x.name)}${x.userId?`<button data-delete-category="${x.id}">×</button>`:''}</span>`).join('')}</div>`);$('categoryForm').onsubmit=async e=>{e.preventDefault();const name=$('categoryName').value.trim();if(!name)return;const item={id:crypto.randomUUID(),userId:state.user.id,name};state.categories.push(item);persist();if(cloudReady)await cloudDb.ref(`finance/${state.user.id}/categories/${item.id}`).set({name});categoriesModal();};document.querySelectorAll('[data-delete-category]').forEach(b=>b.onclick=()=>deleteRecord('categories',b.dataset.deleteCategory,categoriesModal));}

  function calendarModal(){const items=[...onlyMine(state.bills).map(x=>({...x,label:x.description})),...onlyMine(state.installments).map(x=>({...x,dueDate:x.firstDue,label:x.description}))].sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));openModal(`<h2>Calendário financeiro</h2><div class="calendar-list">${items.length?items.map(x=>`<div class="calendar-row"><time>${dateBR(x.dueDate)}</time><div><b>${escapeHtml(x.label)}</b><small>${x.kind?x.kind==='payable'?'Conta a pagar':'Conta a receber':'Parcelamento'}</small></div><strong>${money(x.value||x.installmentValue||0)}</strong></div>`).join(''):'<div class="empty-state">Nenhum compromisso cadastrado.</div>'}</div>`);}

  function smartAnalysisModal(){const tx=userTx(),income=sumMoney(tx.filter(x=>x.type==='income')),expense=sumMoney(tx.filter(x=>x.type==='expense')),balance=income-expense;const byCat={};tx.filter(x=>x.type==='expense').forEach(x=>byCat[x.category]=(byCat[x.category]||0)+Number(x.value||0));const top=Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,5);const monthlyNeed=centsSum(onlyMine(state.bills).filter(x=>x.kind==='payable'&&x.status!=='paid'));openModal(`<h2>IA Financeira</h2><div class="ai-box">${buildInsight(income,expense,monthlyNeed,centsSum(onlyMine(state.bills).filter(x=>x.kind==='receivable'&&x.status!=='received')))}</div><div class="summary-grid"><article class="summary"><span>Saldo</span><strong>${money(balance)}</strong></article><article class="summary"><span>Comprometido</span><strong>${money(monthlyNeed)}</strong></article></div><h3>Maiores gastos por categoria</h3><div class="report-list">${top.length?top.map(([cat,val])=>`<div><span>${escapeHtml(cat)}</span><strong>${money(val)}</strong></div>`).join(''):'<div class="empty-state">Sem despesas para analisar.</div>'}</div><div class="modal-actions"><button id="exportCsvBtn" class="secondary">Exportar Excel/CSV</button><button id="printReportBtn" class="primary">Gerar PDF</button></div>`);$('exportCsvBtn').onclick=exportCsv;$('printReportBtn').onclick=()=>window.print();}
  function exportCsv(){const rows=[['Tipo','Descrição','Categoria','Valor','Data'],...userTx().map(x=>[x.type==='income'?'Receita':'Despesa',x.description,x.category,Number(x.value).toFixed(2).replace('.',','),x.date])];const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='finance-ia-pro-relatorio.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Relatório CSV gerado.');}

  // Troca a aba Relatórios por relatório real e mantém a IA acessível.
  document.querySelectorAll('.nav').forEach(n=>{
    if(n.dataset.page==='reports') n.onclick=()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));n.classList.add('active');smartAnalysisModal();};
  });

  addDashboardBlocks();
  dashboardV7();
})();
