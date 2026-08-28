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
  function nextMonthlyDue(dateValue){const base=new Date(`${dateValue||todayISO()}T12:00:00`);const day=base.getDate();const next=new Date(base.getFullYear(),base.getMonth()+1,1,12,0,0);const max=new Date(next.getFullYear(),next.getMonth()+1,0).getDate();next.setDate(Math.min(day,max));return next.toISOString().slice(0,10)}
  async function settleBill(x){const settledStatus=x.kind==='payable'?'paid':'received';const now=Date.now();const tx={id:crypto.randomUUID(),userId:state.user.id,type:x.kind==='payable'?'expense':'income',description:x.description,value:x.value,category:x.category,date:todayISO(),createdAt:now,sourceBillId:x.id};state.transactions.push(tx);let updates={updatedAt:now,lastSettledAt:now,lastSettledStatus:settledStatus};if(x.repeat==='monthly'){x.status='pending';x.dueDate=nextMonthlyDue(x.dueDate);x.lastSettledAt=now;x.lastSettledStatus=settledStatus;x.settledCount=Number(x.settledCount||0)+1;Object.assign(updates,{status:'pending',dueDate:x.dueDate,settledCount:x.settledCount})}else{x.status=settledStatus;updates.status=settledStatus}persist();if(cloudReady){await cloudDb.ref(`finance/${state.user.id}/bills/${x.id}`).update(updates);const {id,userId,...data}=tx;await cloudDb.ref(`finance/${state.user.id}/transactions/${id}`).set(data)}closeModal();render();toast(x.repeat==='monthly'?`Baixa realizada. Próximo vencimento: ${dateBR(x.dueDate)}.`:'Baixa realizada e lançamento criado.');}

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


/* Finance IA Pro v8.1 — atalhos avançados e ferramentas profissionais */
(() => {
  const advancedButtons = [
    ['budgetAdvancedBtn','◫','Orçamento'],['recurringAdvancedBtn','↻','Recorrentes'],
    ['investmentsAdvancedBtn','↗','Investimentos'],['debtsAdvancedBtn','▤','Dívidas'],
    ['assetsAdvancedBtn','◆','Patrimônio'],['alertsAdvancedBtn','⚠','Alertas'],
    ['simulatorAdvancedBtn','∑','Simulador'],['exportAdvancedBtn','⇩','Exportar']
  ];
  const readList=(key)=>{try{return JSON.parse(localStorage.getItem(key)||'[]')}catch{return []}};
  state.budgets=readList('fia_budgets');state.recurring=readList('fia_recurring');state.investments=readList('fia_investments');state.debts=readList('fia_debts');state.assets=readList('fia_assets');
  const save=()=>{for(const k of ['budgets','recurring','investments','debts','assets'])localStorage.setItem('fia_'+k,JSON.stringify(state[k]||[]))};
  const mine=list=>(list||[]).filter(x=>x.userId===state.user?.id);
  function install(){
    const quick=document.querySelector('.quick-actions');if(!quick||document.getElementById('budgetAdvancedBtn'))return;
    quick.insertAdjacentHTML('beforeend',advancedButtons.map(([id,ic,label])=>`<button id="${id}"><span>${ic}</span>${label}</button>`).join(''));
    const on=(id,fn)=>{const e=document.getElementById(id);if(e)e.onclick=fn};
    on('budgetAdvancedBtn',budgetModal);on('recurringAdvancedBtn',recurringModal);on('investmentsAdvancedBtn',investmentsModal);on('debtsAdvancedBtn',debtsModal);on('assetsAdvancedBtn',assetsModal);on('alertsAdvancedBtn',alertsModal);on('simulatorAdvancedBtn',simulatorModal);on('exportAdvancedBtn',exportModal);
  }
  function genericModal(title,type,fields){
    const list=mine(state[type]);
    openModal(`<h2>${title}</h2><form id="advancedGenericForm" class="form-grid">${fields.map(f=>`<label>${f.label}<input id="adv_${f.key}" ${f.type?`type="${f.type}"`:''} ${f.step?`step="${f.step}"`:''} required></label>`).join('')}<button class="primary">Adicionar</button></form><div class="advanced-list">${list.length?list.map(x=>`<article class="advanced-row"><div><b>${escapeHtml(x.name||x.description||x.category||'Registro')}</b><small>${x.value!=null?money(x.value):''}${x.date?' • '+new Date(x.date+'T12:00:00').toLocaleDateString('pt-BR'):''}</small></div><button class="danger-button advanced-remove" data-id="${x.id}" data-type="${type}">Excluir</button></article>`).join(''):'<div class="empty-state">Nenhum registro.</div>'}</div>`);
    $('advancedGenericForm').onsubmit=async e=>{e.preventDefault();const item={id:crypto.randomUUID(),userId:state.user.id,createdAt:Date.now()};for(const f of fields){let v=$('adv_'+f.key).value;if(f.type==='number')v=parseBRMoney(v);item[f.key]=v}state[type].push(item);save();if(cloudReady){const{id,userId,...data}=item;await cloudDb.ref(`finance/${state.user.id}/${type}/${id}`).set(data)}genericModal(title,type,fields);toast('Registro salvo.')};
    document.querySelectorAll('.advanced-remove').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir este registro?'))return;state[type]=state[type].filter(x=>x.id!==b.dataset.id);save();if(cloudReady)await cloudDb.ref(`finance/${state.user.id}/${type}/${b.dataset.id}`).remove();genericModal(title,type,fields)});
  }
  const budgetModal=()=>genericModal('Orçamento por categoria','budgets',[{key:'category',label:'Categoria'},{key:'value',label:'Limite mensal',type:'number',step:'0.01'}]);
  const recurringModal=()=>genericModal('Lançamentos recorrentes','recurring',[{key:'description',label:'Descrição'},{key:'value',label:'Valor',type:'number',step:'0.01'},{key:'date',label:'Próxima data',type:'date'}]);
  const investmentsModal=()=>genericModal('Investimentos','investments',[{key:'name',label:'Investimento'},{key:'value',label:'Valor atual',type:'number',step:'0.01'}]);
  const debtsModal=()=>genericModal('Dívidas e empréstimos','debts',[{key:'name',label:'Descrição'},{key:'value',label:'Saldo devedor',type:'number',step:'0.01'},{key:'date',label:'Próximo vencimento',type:'date'}]);
  const assetsModal=()=>genericModal('Bens e patrimônio','assets',[{key:'name',label:'Bem ou conta'},{key:'value',label:'Valor estimado',type:'number',step:'0.01'}]);
  function alertsModal(){
    const all=(state.bills||[]).filter(x=>x.userId===state.user.id);
    const today=new Date();today.setHours(0,0,0,0);
    const isoToday=today.toISOString().slice(0,10);
    const alertDateBR=value=>{
      if(!value)return '—';
      const d=new Date(String(value)+'T12:00:00');
      return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR');
    };
    const alertMoney=value=>typeof money==='function'?money(Number(value||0)):Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const clientName=x=>String(x.clientName||x.client||x.customerName||x.customer||x.description||'Cliente').trim();

    const info=x=>{
      const due=new Date(String(x.dueDate||'')+'T12:00:00');
      const valid=!Number.isNaN(due.getTime());
      const days=valid?Math.ceil((due-today)/86400000):9999;
      const settled=['paid','received'].includes(x.status);
      let level='future',label='Próxima';
      if(settled){level='settled';label=x.status==='paid'?'Paga':'Recebida'}
      else if(days<0){level='overdue';label=`Vencida há ${Math.abs(days)} dia(s)`}
      else if(days===0){level='today';label='Vence hoje'}
      else if(days<=3){level='urgent';label=`Vence em ${days} dia(s)`}
      else if(days<=7){level='soon';label=`Vence em ${days} dias`}
      return {...x,_days:days,_level:level,_label:label};
    };

    const enriched=all.map(info);
    const open=enriched.filter(x=>!['paid','received'].includes(x.status));
    const overdue=open.filter(x=>x._days<0);
    const dueToday=open.filter(x=>x._days===0);
    const next7=open.filter(x=>x._days>0&&x._days<=7);
    const openTotal=open.reduce((s,x)=>s+Number(x.value||0),0);

    openModal(`
      <div class="alerts-pro-head">
        <small>CENTRAL INTELIGENTE</small>
        <h2>⚠ Central de alertas Pro</h2>
        <p>Acompanhe contas vencidas, vencimentos próximos e faça a baixa sem sair desta tela.</p>
      </div>

      <div class="alerts-pro-stats">
        <article class="danger"><span>Vencidas</span><strong>${overdue.length}</strong><small>${money(overdue.reduce((s,x)=>s+Number(x.value||0),0))}</small></article>
        <article class="today"><span>Vencem hoje</span><strong>${dueToday.length}</strong><small>${money(dueToday.reduce((s,x)=>s+Number(x.value||0),0))}</small></article>
        <article><span>Próx. 7 dias</span><strong>${next7.length}</strong><small>${money(next7.reduce((s,x)=>s+Number(x.value||0),0))}</small></article>
        <article><span>Total em aberto</span><strong>${open.length}</strong><small>${money(openTotal)}</small></article>
      </div>

      <div class="alerts-pro-tools">
        <input id="alertsSearch" type="search" autocomplete="off" placeholder="🔎 Buscar descrição, categoria ou valor">
        <select id="alertsFilter">
          <option value="open">Em aberto</option>
          <option value="overdue">Vencidas</option>
          <option value="today">Hoje</option>
          <option value="7days">Próximos 7 dias</option>
          <option value="payable">A pagar</option>
          <option value="receivable">A receber</option>
          <option value="all">Todos</option>
        </select>
        <select id="alertsSort">
          <option value="date">Vencimento</option>
          <option value="value-desc">Maior valor</option>
          <option value="value-asc">Menor valor</option>
        </select>
      </div>

      <div id="alertsProSummary" class="alerts-pro-summary"></div>
      <div class="alerts-client-list-title">
        <div><b>👥 Lista de clientes / contas</b><small>Toque ou pesquise pelo nome para localizar rapidamente.</small></div>
        <span id="alertsClientCount">0</span>
      </div>
      <div id="alertsProList" class="alerts-pro-list"></div>
    `);

    const renderAlerts=()=>{
      const q=String($('alertsSearch').value||'').trim().toLowerCase();
      const filter=$('alertsFilter').value;
      const sort=$('alertsSort').value;

      let list=enriched.filter(x=>{
        const hay=`${clientName(x)} ${x.description||''} ${x.clientName||''} ${x.client||''} ${x.customerName||''} ${x.customer||''} ${x.category||''} ${x.value||''} ${x.notes||''}`.toLowerCase();
        if(q&&!hay.includes(q))return false;
        if(filter==='open')return !['paid','received'].includes(x.status);
        if(filter==='overdue')return !['paid','received'].includes(x.status)&&x._days<0;
        if(filter==='today')return !['paid','received'].includes(x.status)&&x._days===0;
        if(filter==='7days')return !['paid','received'].includes(x.status)&&x._days>=0&&x._days<=7;
        if(filter==='payable')return x.kind==='payable'&&!['paid','received'].includes(x.status);
        if(filter==='receivable')return x.kind==='receivable'&&!['paid','received'].includes(x.status);
        return true;
      });

      list.sort((a,b)=>{
        if(sort==='value-desc')return Number(b.value||0)-Number(a.value||0);
        if(sort==='value-asc')return Number(a.value||0)-Number(b.value||0);
        return String(a.dueDate||'').localeCompare(String(b.dueDate||''));
      });

      $('alertsProSummary').innerHTML=`<span>${list.length} alerta(s)</span><strong>${alertMoney(list.filter(x=>!['paid','received'].includes(x.status)).reduce((s,x)=>s+Number(x.value||0),0))}</strong>`;
      if($('alertsClientCount'))$('alertsClientCount').textContent=String(list.length);

      $('alertsProList').innerHTML=list.length?list.map(x=>`
        <article class="alert-pro-card ${x._level}">
          <div class="alert-pro-top">
            <div class="alert-pro-icon">${x.kind==='payable'?'↘':'↗'}</div>
            <div class="alert-pro-main">
              <div class="alert-pro-title">
                <b>${escapeHtml(clientName(x))}</b>
                <span class="alert-pro-badge ${x._level}">${escapeHtml(x._label)}</span>
              </div>
              <small>${x.kind==='payable'?'Conta a pagar':'Conta a receber'}${x.category?' • '+escapeHtml(x.category):''}</small>
              <div class="alert-pro-values">
                <strong>${alertMoney(x.value)}</strong>
                <span>📅 ${alertDateBR(x.dueDate)}</span>
              </div>
              ${x.notes?`<p>📝 ${escapeHtml(x.notes)}</p>`:''}
            </div>
          </div>
          <div class="alert-pro-actions">
            <button class="secondary" data-alert-open="${x.id}">Abrir</button>
            ${!['paid','received'].includes(x.status)?`<button class="primary" data-alert-settle="${x.id}">${x.kind==='payable'?'✓ Pagar':'✓ Receber'}</button>`:''}
            <button class="secondary" data-alert-edit="${x.id}">Editar</button>
            <button class="danger-button" data-alert-delete="${x.id}">Excluir</button>
          </div>
        </article>`).join(''):'<div class="empty-state">Nenhum alerta encontrado com esse filtro.</div>';

      document.querySelectorAll('[data-alert-open]').forEach(b=>b.onclick=()=>{
        const x=state.bills.find(i=>i.id===b.dataset.alertOpen);if(!x)return;
        openModal(`<h2>${escapeHtml(clientName(x))}</h2>
          <div class="detail-grid">
            <p><b>Tipo</b><br>${x.kind==='payable'?'Conta a pagar':'Conta a receber'}</p>
            <p><b>Valor</b><br>${alertMoney(x.value)}</p>
            <p><b>Vencimento</b><br>${alertDateBR(x.dueDate)}</p>
            <p><b>Status</b><br>${escapeHtml(x.status||'pending')}</p>
          </div>
          ${x.notes?`<div class="ai-box"><b>Observações</b><p>${escapeHtml(x.notes)}</p></div>`:''}
          <button id="alertBackList" class="secondary">← Voltar para a lista</button>`);
        $('alertBackList').onclick=alertsModal;
      });

      document.querySelectorAll('[data-alert-edit]').forEach(b=>b.onclick=()=>{
        const x=state.bills.find(i=>i.id===b.dataset.alertEdit);if(!x)return;
        openModal(`<h2>Editar ${escapeHtml(clientName(x))}</h2>
          <form id="alertQuickEdit" class="form-grid">
            <label>Nome / descrição<input id="aqeName" value="${escapeHtml(x.description||'')}" required></label>
            <label>Valor<input id="aqeValue" inputmode="decimal" value="${Number(x.value||0).toFixed(2).replace('.',',')}" required></label>
            <label>Vencimento<input id="aqeDate" type="date" value="${x.dueDate||''}" required></label>
            <label>Categoria<input id="aqeCategory" value="${escapeHtml(x.category||'')}"></label>
            <label>Observações<textarea id="aqeNotes">${escapeHtml(x.notes||'')}</textarea></label>
            <button class="primary">Salvar alterações</button>
            <button id="aqeCancel" class="secondary" type="button">Cancelar</button>
          </form>`);
        if(typeof enableLiveMoneyMask==='function')enableLiveMoneyMask($('aqeValue'));
        $('aqeCancel').onclick=alertsModal;
        $('alertQuickEdit').onsubmit=async e=>{
          e.preventDefault();
          const value=typeof moneyInputValue==='function'?(moneyInputValue($('aqeValue'))||0):(Number(String($('aqeValue').value).replace(',','.'))||0);
          x.description=$('aqeName').value.trim();
          x.value=value;x.dueDate=$('aqeDate').value;x.category=$('aqeCategory').value.trim();x.notes=$('aqeNotes').value.trim();x.updatedAt=Date.now();
          save();persist();
          if(cloudReady){const{id,userId,...data}=x;await cloudDb.ref(`finance/${state.user.id}/bills/${id}`).set(data)}
          render();alertsModal();toast('Conta atualizada.');
        };
      });

      document.querySelectorAll('[data-alert-settle]').forEach(b=>b.onclick=async()=>{
        const x=state.bills.find(i=>i.id===b.dataset.alertSettle);if(!x)return;
        const settled=x.kind==='payable'?'paid':'received';
        const tx={id:crypto.randomUUID(),userId:state.user.id,type:x.kind==='payable'?'expense':'income',description:x.description,value:x.value,category:x.category,date:isoToday,createdAt:Date.now(),sourceBillId:x.id};
        state.transactions.push(tx);
        x.status=settled;x.updatedAt=Date.now();x.lastSettledAt=Date.now();
        save();persist();
        if(cloudReady){
          await cloudDb.ref(`finance/${state.user.id}/bills/${x.id}`).update({status:settled,updatedAt:x.updatedAt,lastSettledAt:x.lastSettledAt});
          const{id,userId,...data}=tx;await cloudDb.ref(`finance/${state.user.id}/transactions/${id}`).set(data);
        }
        render();alertsModal();toast(x.kind==='payable'?'Conta marcada como paga.':'Conta marcada como recebida.');
      });

      document.querySelectorAll('[data-alert-delete]').forEach(b=>b.onclick=async()=>{
        const x=state.bills.find(i=>i.id===b.dataset.alertDelete);if(!x)return;
        if(!confirm(`Excluir o alerta/conta "${clientName(x)}"?`))return;
        state.bills=state.bills.filter(i=>i.id!==x.id);
        save();persist();
        if(cloudReady)await cloudDb.ref(`finance/${state.user.id}/bills/${x.id}`).remove();
        render();alertsModal();toast('Conta excluída.');
      });
    };

    $('alertsSearch').oninput=renderAlerts;
    $('alertsFilter').onchange=renderAlerts;
    $('alertsSort').onchange=renderAlerts;
    renderAlerts();
  }
  function simulatorModal(){
    openModal(`
      <div class="sim-pro-head">
        <small>PLANEJAMENTO INTELIGENTE</small>
        <h2>∑ Simulador de meta Pro</h2>
        <p>Descubra quanto guardar, quando alcançará a meta e compare cenários.</p>
      </div>

      <form id="goalSimulator" class="form-grid sim-pro-form">
        <label>Nome da meta<input id="simName" placeholder="Ex.: Viagem, carro, reserva"></label>
        <label>Valor da meta<input id="simTarget" inputmode="decimal" required placeholder="0,00"></label>
        <label>Valor já guardado<input id="simCurrent" inputmode="decimal" value="0,00" required></label>
        <label>Quanto pode guardar por mês<input id="simMonthly" inputmode="decimal" required placeholder="0,00"></label>
        <label>Data desejada <small>(opcional)</small><input id="simDeadline" type="date"></label>
        <label>Rendimento anual estimado <small>(opcional)</small><input id="simRate" inputmode="decimal" placeholder="0,00"></label>
        <button class="primary sim-calc-btn" type="submit">Calcular planejamento</button>
      </form>
      <div id="simResult"></div>
    `);

    ['simTarget','simCurrent','simMonthly'].forEach(id=>{
      const el=$(id);
      if(el && typeof enableLiveMoneyMask==='function') enableLiveMoneyMask(el);
    });

    const parseInputMoney=id=>{
      const el=$(id);
      if(typeof moneyInputValue==='function'){
        const v=moneyInputValue(el);
        if(Number.isFinite(v)) return v;
      }
      return parseBRMoney(el?.value||'0')||0;
    };
    const addMonths=(date,months)=>{const d=new Date(date);d.setMonth(d.getMonth()+months);return d};
    const monthDiff=(from,to)=>to<=from?0:Math.max(1,(to.getFullYear()-from.getFullYear())*12+to.getMonth()-from.getMonth()+(to.getDate()>from.getDate()?1:0));
    const futureValueMonths=(current,monthly,annualRate,months)=>{const r=(annualRate/100)/12;if(!r)return current+monthly*months;return current*Math.pow(1+r,months)+monthly*((Math.pow(1+r,months)-1)/r)};
    const monthsToGoal=(target,current,monthly,annualRate)=>{if(current>=target)return 0;if(monthly<=0)return Infinity;let value=current;const r=(annualRate/100)/12;for(let m=1;m<=1200;m++){value=value*(1+r)+monthly;if(value>=target)return m}return Infinity};
    const monthlyNeededForDeadline=(target,current,annualRate,months)=>{if(months<=0)return Math.max(0,target-current);const r=(annualRate/100)/12;if(!r)return Math.max(0,(target-current)/months);const futureCurrent=current*Math.pow(1+r,months);return Math.max(0,(target-futureCurrent)*r/(Math.pow(1+r,months)-1))};

    $('goalSimulator').onsubmit=e=>{
      e.preventDefault();
      const name=$('simName').value.trim()||'Minha meta';
      const target=parseInputMoney('simTarget'),current=parseInputMoney('simCurrent'),monthly=parseInputMoney('simMonthly');
      const annualRate=Math.max(0,Number(String($('simRate').value||'0').replace(',','.'))||0);
      const deadlineValue=$('simDeadline').value,now=new Date(),remaining=Math.max(0,target-current);

      if(!Number.isFinite(target)||target<=0)return toast('Informe um valor válido para a meta.');
      if(!Number.isFinite(current)||current<0)return toast('Informe um valor guardado válido.');
      if(current>target)return toast('O valor guardado já é maior que a meta.');
      if(!Number.isFinite(monthly)||monthly<=0)return toast('Informe um valor mensal maior que zero.');

      const months=monthsToGoal(target,current,monthly,annualRate);
      const finish=Number.isFinite(months)?addMonths(now,months):null;
      const progress=target>0?Math.min(100,(current/target)*100):0;
      const weekly=monthly*12/52,daily=monthly*12/365;
      const p3=futureValueMonths(current,monthly,annualRate,3),p6=futureValueMonths(current,monthly,annualRate,6),p12=futureValueMonths(current,monthly,annualRate,12);

      let deadlineHtml='';
      if(deadlineValue){
        const deadline=new Date(`${deadlineValue}T12:00:00`);
        const deadlineMonths=monthDiff(now,deadline);
        const needed=monthlyNeededForDeadline(target,current,annualRate,deadlineMonths);
        const diff=needed-monthly,achievable=needed<=monthly+0.01;
        deadlineHtml=`<div class="sim-deadline-card ${achievable?'good':'attention'}"><span>Meta até ${deadline.toLocaleDateString('pt-BR')}</span><strong>${money(needed)}/mês</strong><small>${achievable?`Seu valor atual é suficiente. Margem aproximada: ${money(Math.max(0,-diff))}/mês.`:`Para chegar nessa data, aumente cerca de ${money(diff)}/mês.`}</small></div>`;
      }

      const scenario=factor=>{const value=monthly*factor,m=monthsToGoal(target,current,value,annualRate);return{value,m,date:Number.isFinite(m)?addMonths(now,m):null}};
      const conservative=scenario(.8),normal=scenario(1),accelerated=scenario(1.2);

      $('simResult').innerHTML=`
        <section class="sim-pro-result">
          <div class="sim-progress-card"><div class="sim-progress-top"><div><span>${escapeHtml(name)}</span><strong>${progress.toFixed(1).replace('.',',')}%</strong></div><small>${money(current)} de ${money(target)}</small></div><div class="sim-progress-track"><i style="width:${progress}%"></i></div></div>
          <div class="sim-stat-grid">
            <article><span>Falta guardar</span><strong>${money(remaining)}</strong></article>
            <article><span>Tempo estimado</span><strong>${Number.isFinite(months)?`${months} mês(es)`:'—'}</strong></article>
            <article><span>Conclusão prevista</span><strong>${finish?finish.toLocaleDateString('pt-BR',{month:'short',year:'numeric'}):'—'}</strong></article>
            <article><span>Rendimento usado</span><strong>${annualRate.toFixed(2).replace('.',',')}% a.a.</strong></article>
          </div>
          ${deadlineHtml}
          <div class="sim-section-title"><b>Distribuição do esforço</b><span>equivalência aproximada</span></div>
          <div class="sim-stat-grid"><article><span>Por mês</span><strong>${money(monthly)}</strong></article><article><span>Por semana</span><strong>${money(weekly)}</strong></article><article><span>Por dia</span><strong>${money(daily)}</strong></article><article><span>Em 12 meses</span><strong>${money(p12)}</strong></article></div>
          <div class="sim-section-title"><b>Projeção</b><span>saldo estimado</span></div>
          <div class="sim-projection"><div><span>3 meses</span><strong>${money(p3)}</strong></div><div><span>6 meses</span><strong>${money(p6)}</strong></div><div><span>12 meses</span><strong>${money(p12)}</strong></div></div>
          <div class="sim-section-title"><b>Cenários</b><span>compare ritmos de economia</span></div>
          <div class="sim-scenarios">
            <article><span>Conservador • 80%</span><strong>${money(conservative.value)}/mês</strong><small>${conservative.m} mês(es) • ${conservative.date?conservative.date.toLocaleDateString('pt-BR',{month:'short',year:'numeric'}):'—'}</small></article>
            <article class="selected"><span>Planejado • 100%</span><strong>${money(normal.value)}/mês</strong><small>${normal.m} mês(es) • ${normal.date?normal.date.toLocaleDateString('pt-BR',{month:'short',year:'numeric'}):'—'}</small></article>
            <article><span>Acelerado • 120%</span><strong>${money(accelerated.value)}/mês</strong><small>${accelerated.m} mês(es) • ${accelerated.date?accelerated.date.toLocaleDateString('pt-BR',{month:'short',year:'numeric'}):'—'}</small></article>
          </div>
          <div class="sim-result-actions">
            <button id="simCreateGoal" class="primary" type="button">🎯 Criar meta com estes valores</button>
            <button id="simRecalculate" class="secondary" type="button">↻ Alterar simulação</button>
          </div>
        </section>`;

      $('simCreateGoal').onclick=()=>{
        state.goals.push({
          id:crypto.randomUUID(),
          userId:state.user.id,
          name,target,current,
          createdAt:Date.now(),
          monthlyPlan:monthly,
          targetDate:deadlineValue||null,
          estimatedAnnualRate:annualRate
        });
        persist();
        render();
        toast('Meta criada e salva no Firebase + cache local.');
      };
      $('simRecalculate').onclick=()=>{
        $('simTarget').focus();
        document.querySelector('.sim-pro-form')?.scrollIntoView({behavior:'smooth',block:'start'});
      };
    };
  }
  function exportModal(){openModal(`<h2>Exportação avançada</h2><div class="profile-list"><button id="exportAllFinance" class="profile-option"><span>⇩</span><div><b>Exportar todos os dados</b><small>JSON completo da conta</small></div><i>›</i></button><button id="printFinanceReport" class="profile-option"><span>▥</span><div><b>Relatório para PDF</b><small>Abre a impressão do navegador</small></div><i>›</i></button></div>`);$('exportAllFinance').onclick=()=>{const data={exportedAt:new Date().toISOString(),transactions:userTx(),goals:userGoals(),bills:mine(state.bills),cards:mine(state.cards),installments:mine(state.installments),budgets:mine(state.budgets),recurring:mine(state.recurring),investments:mine(state.investments),debts:mine(state.debts),assets:mine(state.assets)};downloadText('finance-ia-pro-dados-'+todayISO()+'.json',JSON.stringify(data,null,2),'application/json')};$('printFinanceReport').onclick=()=>window.print()}
  const observer=new MutationObserver(install);observer.observe(document.documentElement,{childList:true,subtree:true});setTimeout(install,100);
})();
