/*
  FINANCE IA PRO
  1) O aplicativo funciona em modo demonstração usando localStorage.
  2) Para ligar ao Firebase, adicione o SDK do Firebase no index.html,
     cole sua configuração abaixo e substitua as funções de armazenamento.
*/

const CLOUD_CONFIG = window.FINANCE_IA_CONFIG || {};
const CLOUD_ENABLED = Boolean(window.firebase && CLOUD_CONFIG.firebase && CLOUD_CONFIG.firebase.apiKey && !String(CLOUD_CONFIG.firebase.apiKey).includes('COLE'));
const BACKEND_URL = String(CLOUD_CONFIG.backendUrl || '').replace(/\/$/, '');
const OWNER_EMAILS = (CLOUD_CONFIG.ownerEmails || []).map(x=>String(x).trim().toLowerCase());
let cloudAuth=null, cloudDb=null, cloudReady=false, cloudUnsubs=[];
let paymentMonitorTimer=null, paymentMonitorBusy=false, lastAccessUnlockedAt=0;

function initCloud(){
  if(!CLOUD_ENABLED) return false;
  try{
    if(!firebase.apps.length) firebase.initializeApp(CLOUD_CONFIG.firebase);
    cloudAuth=firebase.auth(); cloudDb=firebase.database(); cloudReady=true; return true;
  }catch(e){ console.error('Firebase:',e); return false; }
}
async function apiFetch(path, options={}){
  if(!BACKEND_URL) throw new Error('BACKEND_URL não configurada.');
  const token=cloudAuth?.currentUser ? await cloudAuth.currentUser.getIdToken() : '';
  const response=await fetch(BACKEND_URL+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||'Erro na comunicação com o servidor.');
  return data;
}
function clearCloudListeners(){ cloudUnsubs.forEach(x=>x()); cloudUnsubs=[]; }
function subscribeCloudData(uid){
  clearCloudListeners();
  const bind=(path,cb)=>{const ref=cloudDb.ref(path); const fn=ref.on('value',snap=>cb(snap.val()||{})); cloudUnsubs.push(()=>ref.off('value',fn));};
  bind(`finance/${uid}/transactions`,v=>{
    const remote=Object.entries(v).map(([id,x])=>({id,userId:uid,...x}));
    const local=state.transactions.filter(x=>x.userId===uid);
    // Não apaga lançamentos locais quando o Firebase retorna vazio por regra, atraso ou conexão.
    if(remote.length || !local.length){
      state.transactions=[...state.transactions.filter(x=>x.userId!==uid),...remote];
      localStorage.setItem('fia_transactions',JSON.stringify(state.transactions));
      render();
    }else{
      cloudSaveState().catch(e=>console.error('Falha ao reenviar lançamentos locais:',e));
    }
  });
  bind(`finance/${uid}/goals`,v=>{
    const remote=Object.entries(v).map(([id,x])=>({id,userId:uid,...x}));
    const local=state.goals.filter(x=>x.userId===uid);
    if(remote.length || !local.length){
      state.goals=[...state.goals.filter(x=>x.userId!==uid),...remote];
      localStorage.setItem('fia_goals',JSON.stringify(state.goals));
      render();
    }else{
      cloudSaveState().catch(e=>console.error('Falha ao reenviar metas locais:',e));
    }
  });
  bind(`users/${uid}`,v=>{if(!v||!state.user)return; const wasLocked=accessExpired(); state.user={id:uid,...v}; if(isOwner()) state.user.role='owner'; state.plan=accessPlan(v); localStorage.setItem('fia_user',JSON.stringify(state.user)); localStorage.setItem('fia_plan',state.plan); render(); if(wasLocked&&subscriptionActive()) unlockAfterApprovedPayment();});
  bind('settings/financeIa',v=>{state.settings={...state.settings,...v,premiumPrice:24.90}; localStorage.setItem('fia_settings',JSON.stringify(state.settings));});
  if(isOwner()){
    bind('users',v=>{state.users=Object.entries(v).map(([id,x])=>({id,...x}));localStorage.setItem('fia_users',JSON.stringify(state.users));});
    bind('payments',v=>{state.payments=Object.entries(v).map(([id,x])=>({id,...x}));localStorage.setItem('fia_payments',JSON.stringify(state.payments));});
    bind('adminLogs',v=>{state.adminLogs=Object.entries(v).map(([id,x])=>({id,...x})).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));localStorage.setItem('fia_admin_logs',JSON.stringify(state.adminLogs));});
  }
}
async function cloudSaveState(){
  if(!cloudReady||!state.user?.id) return;
  const uid=state.user.id;
  const tx={}; state.transactions.filter(x=>x.userId===uid).forEach(x=>{const {id,userId,...data}=x;tx[id]=data});
  const goals={}; state.goals.filter(x=>x.userId===uid).forEach(x=>{const {id,userId,...data}=x;goals[id]=data});
  await cloudDb.ref(`finance/${uid}`).update({transactions:tx,goals});
}

const $ = id => document.getElementById(id);
// Dinheiro sempre calculado em centavos para evitar erros de ponto flutuante.
const toCents = value => {
  const number = typeof value === 'string' ? parseBRMoney(value) : Number(value || 0);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) : 0;
};
const fromCents = cents => Number(cents || 0) / 100;
const roundMoney = value => fromCents(toCents(value));
const sumMoney = items => fromCents(items.reduce((total,item)=>total + toCents(item?.value),0));
const money = value => roundMoney(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2});

// Converte valores digitados no padrão brasileiro.
// Exemplos: 7.000 = 7000 | 7.000,50 = 7000.50 | 7000 = 7000
function parseBRMoney(value){
  let raw=String(value ?? '').trim().replace(/\s/g,'').replace(/R\$/gi,'');
  if(!raw) return NaN;
  raw=raw.replace(/[^0-9,.-]/g,'');
  const negative=raw.startsWith('-');
  raw=raw.replace(/-/g,'');
  let normalized;
  if(raw.includes(',')){
    normalized=raw.replace(/\./g,'').replace(',','.');
  }else if(/^\d{1,3}(\.\d{3})+$/.test(raw)){
    normalized=raw.replace(/\./g,'');
  }else{
    normalized=raw;
  }
  const number=Number(normalized);
  return Number.isFinite(number) ? roundMoney(negative ? -number : number) : NaN;
}

function formatMoneyWhileTyping(input){
  // Campo operando sempre em centavos:
  // 1 -> 0,01 | 147 -> 1,47 | 14725 -> 147,25 | 1472500 -> 14.725,00
  const digits=String(input.value || '').replace(/\D/g,'');
  if(!digits){ input.value=''; input.dataset.cents=''; return; }
  const safeDigits=digits.replace(/^0+(?=\d)/,'').slice(0,15) || '0';
  const cents=Number.parseInt(safeDigits,10);
  if(!Number.isSafeInteger(cents)){ input.value=''; input.dataset.cents=''; return; }
  input.dataset.cents=String(cents);
  input.value=(cents/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  try{ input.setSelectionRange(input.value.length,input.value.length); }catch(_e){}
}

function moneyInputValue(input){
  const stored=Number(input?.dataset?.cents);
  if(Number.isSafeInteger(stored) && stored>=0) return fromCents(stored);
  const digits=String(input?.value || '').replace(/\D/g,'');
  return digits ? fromCents(Number.parseInt(digits,10)) : NaN;
}

function normalizeMoneyInput(input){
  if(!String(input.value||'').trim()) return;
  formatMoneyWhileTyping(input);
}

function enableLiveMoneyMask(input){
  input.setAttribute('inputmode','numeric');
  input.setAttribute('autocomplete','off');
  input.addEventListener('input',()=>formatMoneyWhileTyping(input));
  input.addEventListener('paste',()=>setTimeout(()=>formatMoneyWhileTyping(input),0));
  input.addEventListener('focus',()=>{
    if(input.value==='0,00') { input.value=''; input.dataset.cents=''; }
    setTimeout(()=>{ try{input.setSelectionRange(input.value.length,input.value.length);}catch(_e){} },0);
  });
  input.addEventListener('blur',()=>normalizeMoneyInput(input));
  if(String(input.value||'').trim()) formatMoneyWhileTyping(input);
}
const todayISO = () => new Date().toISOString().slice(0,10);
const state = {
  user: JSON.parse(localStorage.getItem('fia_user') || 'null'),
  users: JSON.parse(localStorage.getItem('fia_users') || '[]'),
  transactions: JSON.parse(localStorage.getItem('fia_transactions') || '[]'),
  goals: JSON.parse(localStorage.getItem('fia_goals') || '[]'),
  plan: localStorage.getItem('fia_plan') || 'free',
  notifications: JSON.parse(localStorage.getItem('fia_notifications') || '[]'),
  adminLogs: JSON.parse(localStorage.getItem('fia_admin_logs') || '[]'),
  payments: JSON.parse(localStorage.getItem('fia_payments') || '[]'),
  settings: JSON.parse(localStorage.getItem('fia_settings') || '{"appName":"Finance IA Pro","premiumPrice":24.90,"freeLimit":100,"maintenance":false}'),
  hideBalance:false
};

function persist(){
  localStorage.setItem('fia_user',JSON.stringify(state.user));
  localStorage.setItem('fia_users',JSON.stringify(state.users));
  localStorage.setItem('fia_transactions',JSON.stringify(state.transactions));
  localStorage.setItem('fia_goals',JSON.stringify(state.goals));
  localStorage.setItem('fia_plan',state.plan);
  localStorage.setItem('fia_notifications',JSON.stringify(state.notifications));
  localStorage.setItem('fia_admin_logs',JSON.stringify(state.adminLogs||[]));
  localStorage.setItem('fia_payments',JSON.stringify(state.payments));
  localStorage.setItem('fia_settings',JSON.stringify(state.settings));
  if(cloudReady&&state.user?.id) cloudSaveState().catch(e=>console.error('Sincronização:',e));
}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
let modalLocked=false;
function openModal(html,lock=false){modalLocked=Boolean(lock);$('modal').classList.remove('owner-modal');$('modalContent').innerHTML=html;$('modal').classList.remove('hidden');$('closeModal').classList.toggle('hidden',modalLocked)}
function closeModal(force=false){if(modalLocked&&!force)return;$('modal').classList.add('hidden');$('modal').classList.remove('owner-modal');modalLocked=false;$('closeModal').classList.remove('hidden')}

function rememberPaymentId(id){
  if(!id)return;
  localStorage.setItem('fia_active_payment_id',String(id));
}
function clearRememberedPayment(){localStorage.removeItem('fia_active_payment_id')}
function unlockAfterApprovedPayment(){
  if(!state.user||!subscriptionActive())return;
  clearRememberedPayment();
  stopPaymentMonitor();
  modalLocked=false;
  closeModal(true);
  applyAccessLockUI();
  render();
  const now=Date.now();
  if(now-lastAccessUnlockedAt>5000){
    lastAccessUnlockedAt=now;
    toast('Pagamento aprovado! Acesso liberado por 30 dias.');
  }
}
async function refreshCurrentUserFromFirebase(){
  if(!cloudReady||!cloudAuth?.currentUser)return false;
  const uid=cloudAuth.currentUser.uid;
  const snap=await cloudDb.ref(`users/${uid}`).once('value');
  const v=snap.val();
  if(!v)return false;
  state.user={id:uid,...v};
  if(isOwner())state.user.role='owner';
  state.plan=accessPlan(state.user);
  localStorage.setItem('fia_user',JSON.stringify(state.user));
  localStorage.setItem('fia_plan',state.plan);
  if(subscriptionActive()){unlockAfterApprovedPayment();return true}
  render();
  return false;
}
async function reconcilePaymentAccess(silent=true){
  if(paymentMonitorBusy||!cloudReady||!BACKEND_URL||!cloudAuth?.currentUser||isOwner())return false;
  paymentMonitorBusy=true;
  try{
    const remembered=localStorage.getItem('fia_active_payment_id');
    let result;
    if(remembered){
      try{result=await apiFetch(`/paymentStatus?id=${encodeURIComponent(remembered)}`)}catch(_e){result=null}
    }
    if(!result||!result.payment||String(result.payment.status||'').toLowerCase()!=='approved'){
      result=await apiFetch('/latestPayment');
    }
    const payment=result?.payment||null;
    if(payment?.id)rememberPaymentId(payment.id);
    const status=String(payment?.status||'').toLowerCase();
    const statusEl=$('pixStatus');
    if(statusEl)statusEl.textContent=status||'pending';
    if(status==='approved'){
      await refreshCurrentUserFromFirebase();
      return true;
    }
    if(!silent&&payment)toast(`Pagamento: ${status||'pendente'}. Aguardando confirmação.`);
    return false;
  }catch(e){
    if(!silent)toast(e.message||'Não foi possível verificar o pagamento.');
    return false;
  }finally{paymentMonitorBusy=false}
}
function startPaymentMonitor(){
  stopPaymentMonitor();
  reconcilePaymentAccess(true);
  paymentMonitorTimer=setInterval(()=>reconcilePaymentAccess(true),7000);
}
function stopPaymentMonitor(){if(paymentMonitorTimer){clearInterval(paymentMonitorTimer);paymentMonitorTimer=null}}
function resumePaymentVerification(){
  if(!state.user||isOwner()||subscriptionActive())return;
  startPaymentMonitor();
}
window.addEventListener('focus',resumePaymentVerification);
window.addEventListener('online',resumePaymentVerification);
window.addEventListener('pageshow',resumePaymentVerification);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumePaymentVerification()});
function userTx(){return state.transactions.filter(t=>t.userId===state.user?.id)}
function userGoals(){return state.goals.filter(g=>g.userId===state.user?.id)}

function showApp(){
  if(!cloudReady){
    const freshUsers=JSON.parse(localStorage.getItem('fia_users')||'[]');
    const fresh=freshUsers.find(u=>u.id===state.user?.id);
    if(fresh){state.user=fresh;state.users=freshUsers;state.plan=fresh.plan||'free';}
  }
  if(state.user?.status==='blocked'){state.user=null;persist();showAuth();return toast('Sua conta foi bloqueada pelo administrador.');}
  if(state.settings.maintenance && !isOwner()){$('authScreen').classList.add('hidden');$('appScreen').classList.remove('hidden');$('appScreen').innerHTML=`<div class="system-alert"><h2>Sistema em manutenção</h2><p>${escapeHtml(state.settings.maintenanceMessage||'O administrador está realizando uma atualização. Tente novamente mais tarde.')}</p></div>`;return;}
  state.user.online=true;state.user.lastSeen=Date.now();state.users=state.users.map(u=>u.id===state.user.id?state.user:u);persist();
  $('authScreen').classList.add('hidden');$('appScreen').classList.remove('hidden');
  $('userName').textContent=state.user.name.split(' ')[0];
  $('profileBtn').textContent=state.user.name.charAt(0).toUpperCase();
  render();
  if(!isOwner()&&!subscriptionActive()) startPaymentMonitor();
  setTimeout(checkSubscriptionAccess,250);
}
function showAuth(){$('appScreen').classList.add('hidden');$('authScreen').classList.remove('hidden')}

function render(){
  const tx=userTx();
  const income=sumMoney(tx.filter(t=>t.type==='income'));
  const expense=sumMoney(tx.filter(t=>t.type==='expense'));
  const balance=fromCents(toCents(income)-toCents(expense));
  const max=Math.max(income,expense,1);
  $('balanceValue').textContent=state.hideBalance?'R$ •••••':money(balance);
  $('incomeValue').textContent=state.hideBalance?'R$ •••••':money(income);
  $('expenseValue').textContent=state.hideBalance?'R$ •••••':money(expense);
  $('savingRate').textContent=income>0?Math.max(0,Math.round((balance/income)*100))+'%':'0%';
  $('planName').textContent=isOwner()?'Proprietário':trialActive()?'Teste grátis 24h':subscriptionActive()?'Premium':'Bloqueado';
  $('monthResult').textContent='Resultado: '+money(balance);
  $('incomeBar').style.width=(income/max*100)+'%';
  $('expenseBar').style.width=(expense/max*100)+'%';
  $('monthLabel').textContent=new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  renderTransactions(tx);renderGoals();
  $('premiumBanner').classList.toggle('hidden',state.plan==='premium');
  renderAdminNotifications();
  applyAccessLockUI();
}
function renderTransactions(tx){
  const box=$("transactionsList");
  const list=[...tx].sort((a,b)=>b.createdAt-a.createdAt).slice(0,6);
  if(!list.length){box.className="transactions empty-state";box.textContent="Nenhum lançamento ainda.";return}
  box.className="transactions";
  box.innerHTML=list.map(t=>`<button type="button" class="transaction transaction-clickable" data-transaction-id="${t.id}" aria-label="Abrir lançamento ${escapeHtml(t.description)}"><div class="ico">${t.type==='income'?'↗':'↘'}</div><div class="txt"><b>${escapeHtml(t.description)}</b><small>${escapeHtml(t.category)} • ${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR')}</small></div><strong class="value ${t.type}">${t.type==='income'?'+ ':'- '}${money(t.value)}</strong><span class="item-chevron">›</span></button>`).join('');
  box.querySelectorAll('[data-transaction-id]').forEach(el=>el.onclick=()=>openTransactionDetails(el.dataset.transactionId));
}
function renderGoals(){
  const box=$("goalsList"), goals=userGoals();
  if(!goals.length){box.className="empty-state";box.textContent="Nenhuma meta cadastrada.";return}
  box.className="";box.innerHTML=goals.map(g=>{const p=Math.min(100,Math.round((g.current/g.target)*100)||0);return `<button type="button" class="goal-item goal-clickable" data-goal-id="${g.id}" aria-label="Abrir meta ${escapeHtml(g.name)}"><div class="goal-line"><b>${escapeHtml(g.name)}</b><span>${p}%</span></div><small>${money(g.current)} de ${money(g.target)}</small><div class="goal-progress"><i style="width:${p}%"></i></div><span class="item-hint">Toque para editar ou excluir</span></button>`}).join('');
  box.querySelectorAll('[data-goal-id]').forEach(el=>el.onclick=()=>openGoalDetails(el.dataset.goalId));
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function transactionModal(type){
  if(!canUsePremiumApp()) return paymentModal();
  openModal(`<h2>${type==='income'?'Nova receita':'Nova despesa'}</h2><form id="transactionForm" class="form-grid"><label>Descrição<input id="txDescription" required placeholder="Ex.: Salário, mercado..." /></label><label>Valor<input id="txValue" type="text" inputmode="decimal" required placeholder="Ex.: 7.000,50" /></label><label>Categoria<select id="txCategory"><option>${type==='income'?'Salário':'Alimentação'}</option><option>${type==='income'?'Venda':'Moradia'}</option><option>${type==='income'?'Freelance':'Transporte'}</option><option>${type==='income'?'Outros':'Saúde'}</option><option>Lazer</option><option>Outros</option></select></label><label>Data<input id="txDate" type="date" value="${todayISO()}" required /></label><button class="primary" type="submit">Salvar lançamento</button></form>`);
  const txValueInput=$('txValue');
  enableLiveMoneyMask(txValueInput);
  $('transactionForm').onsubmit=async e=>{
    e.preventDefault();
    if(state.plan!=='premium'&&userTx().length>=Number(state.settings.freeLimit||100)){return toast('Você atingiu o limite do plano gratuito.');}
    const value=moneyInputValue(txValueInput);
    if(!Number.isFinite(value)||value<=0){txValueInput.focus();return toast('Digite um valor válido. Exemplo: 7.000,00');}
    const item={id:crypto.randomUUID(),userId:state.user.id,type,description:$('txDescription').value.trim(),value,category:$('txCategory').value,date:$('txDate').value,createdAt:Date.now()};
    state.transactions.push(item);
    persist();
    try{
      if(cloudReady){
        const {id,userId,...data}=item;
        await cloudDb.ref(`finance/${userId}/transactions/${id}`).set(data);
      }
      closeModal();render();toast(cloudReady?'Lançamento salvo no Firebase!':'Lançamento salvo neste aparelho.');
    }catch(err){
      console.error('Erro ao salvar lançamento no Firebase:',err);
      closeModal();render();toast('Salvo no aparelho, mas o Firebase recusou. Verifique as regras.');
    }
  }
}
function goalModal(){
  if(!canUsePremiumApp()) return paymentModal();
  openModal(`<h2>Nova meta financeira</h2><form id="goalForm" class="form-grid"><label>Nome da meta<input id="goalName" required placeholder="Ex.: Viagem, carro, reserva" /></label><label>Valor desejado<input id="goalTarget" type="text" inputmode="decimal" required placeholder="Ex.: 10.000,00" /></label><label>Valor já guardado<input id="goalCurrent" type="text" inputmode="decimal" value="0,00" /></label><button class="primary" type="submit">Criar meta</button></form>`);
  const targetInput=$('goalTarget'), currentInput=$('goalCurrent');
  enableLiveMoneyMask(targetInput);enableLiveMoneyMask(currentInput);
  $('goalForm').onsubmit=e=>{
    e.preventDefault();
    const target=parseBRMoney(targetInput.value), current=parseBRMoney(currentInput.value||'0');
    if(!Number.isFinite(target)||target<=0)return toast('Digite um valor válido para a meta.');
    if(!Number.isFinite(current)||current<0)return toast('Digite um valor guardado válido.');
    state.goals.push({id:crypto.randomUUID(),userId:state.user.id,name:$('goalName').value.trim(),target,current});persist();closeModal();render();toast('Meta criada!');
  }
}
function ownsItem(item){return Boolean(item&&state.user&&item.userId===state.user.id)}
function transactionCategories(type){
  return type==='income'?['Salário','Venda','Freelance','Lazer','Outros']:['Alimentação','Moradia','Transporte','Saúde','Lazer','Outros'];
}
function categoryOptions(type,selected){return transactionCategories(type).map(c=>`<option ${c===selected?'selected':''}>${c}</option>`).join('')}
function openTransactionDetails(id){
  const item=state.transactions.find(t=>t.id===id);
  if(!ownsItem(item))return toast('Você não tem permissão para acessar este lançamento.');
  openModal(`<h2>Detalhes do lançamento</h2><div class="ai-box"><p><b>${escapeHtml(item.description)}</b></p><p>${item.type==='income'?'Receita':'Despesa'} • ${escapeHtml(item.category)}<br>${new Date(item.date+'T12:00:00').toLocaleDateString('pt-BR')}</p><h3 class="${item.type==='income'?'safe-text':'danger-text'}">${item.type==='income'?'+ ':'- '}${money(item.value)}</h3></div><div class="modal-actions"><button id="editTransactionBtn" class="primary">Editar</button><button id="deleteTransactionBtn" class="danger-button">Excluir</button></div><p class="protection-note">Proteção ativa: somente o dono da conta pode alterar ou excluir este lançamento.</p>`);
  $('editTransactionBtn').onclick=()=>editTransactionModal(id);
  $('deleteTransactionBtn').onclick=()=>protectedDeleteModal('transaction',id,item.description);
}
function editTransactionModal(id){
  const item=state.transactions.find(t=>t.id===id);
  if(!ownsItem(item))return toast('Ação não permitida.');
  openModal(`<h2>Editar lançamento</h2><form id="editTransactionForm" class="form-grid"><label>Tipo<select id="editTxType"><option value="income" ${item.type==='income'?'selected':''}>Receita</option><option value="expense" ${item.type==='expense'?'selected':''}>Despesa</option></select></label><label>Descrição<input id="editTxDescription" required value="${escapeHtml(item.description)}" /></label><label>Valor<input id="editTxValue" type="text" inputmode="decimal" required value="${Number(item.value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}" /></label><label>Categoria<select id="editTxCategory">${categoryOptions(item.type,item.category)}</select></label><label>Data<input id="editTxDate" type="date" value="${item.date}" required /></label><button class="primary" type="submit">Salvar alterações</button></form>`);
  const valueInput=$('editTxValue'),typeInput=$('editTxType'),categoryInput=$('editTxCategory');enableLiveMoneyMask(valueInput);
  typeInput.onchange=()=>categoryInput.innerHTML=categoryOptions(typeInput.value,'');
  $('editTransactionForm').onsubmit=e=>{e.preventDefault();const fresh=state.transactions.find(t=>t.id===id);if(!ownsItem(fresh))return toast('Ação não permitida.');const value=moneyInputValue(valueInput);if(!Number.isFinite(value)||value<=0)return toast('Digite um valor válido.');Object.assign(fresh,{type:typeInput.value,description:$('editTxDescription').value.trim(),value,category:categoryInput.value,date:$('editTxDate').value,updatedAt:Date.now()});persist();closeModal();render();toast('Lançamento atualizado com sucesso!')};
}
function openGoalDetails(id){
  const item=state.goals.find(g=>g.id===id);
  if(!ownsItem(item))return toast('Você não tem permissão para acessar esta meta.');
  const p=Math.min(100,Math.round((item.current/item.target)*100)||0);
  openModal(`<h2>Detalhes da meta</h2><div class="ai-box"><p><b>${escapeHtml(item.name)}</b></p><p>Guardado: ${money(item.current)}<br>Objetivo: ${money(item.target)}</p><div class="goal-progress"><i style="width:${p}%"></i></div><p>${p}% concluído</p></div><div class="modal-actions"><button id="editGoalBtn" class="primary">Editar</button><button id="deleteGoalBtn" class="danger-button">Excluir</button></div><p class="protection-note">Proteção ativa: somente o dono da conta pode alterar ou excluir esta meta.</p>`);
  $('editGoalBtn').onclick=()=>editGoalModal(id);$('deleteGoalBtn').onclick=()=>protectedDeleteModal('goal',id,item.name);
}
function editGoalModal(id){
  const item=state.goals.find(g=>g.id===id);if(!ownsItem(item))return toast('Ação não permitida.');
  openModal(`<h2>Editar meta</h2><form id="editGoalForm" class="form-grid"><label>Nome da meta<input id="editGoalName" required value="${escapeHtml(item.name)}" /></label><label>Valor desejado<input id="editGoalTarget" type="text" inputmode="decimal" required value="${Number(item.target).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}" /></label><label>Valor já guardado<input id="editGoalCurrent" type="text" inputmode="decimal" required value="${Number(item.current).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}" /></label><button class="primary" type="submit">Salvar alterações</button></form>`);
  const target=$('editGoalTarget'),current=$('editGoalCurrent');enableLiveMoneyMask(target);enableLiveMoneyMask(current);
  $('editGoalForm').onsubmit=e=>{e.preventDefault();const fresh=state.goals.find(g=>g.id===id);if(!ownsItem(fresh))return toast('Ação não permitida.');const targetValue=moneyInputValue(target),currentValue=moneyInputValue(current);if(!Number.isFinite(targetValue)||targetValue<=0)return toast('Digite um objetivo válido.');if(!Number.isFinite(currentValue)||currentValue<0)return toast('Digite um valor guardado válido.');Object.assign(fresh,{name:$('editGoalName').value.trim(),target:targetValue,current:currentValue,updatedAt:Date.now()});persist();closeModal();render();toast('Meta atualizada com sucesso!')};
}
function protectedDeleteModal(kind,id,label){
  const item=kind==='transaction'?state.transactions.find(t=>t.id===id):state.goals.find(g=>g.id===id);
  if(!ownsItem(item))return toast('Ação não permitida.');
  openModal(`<h2>Confirmar exclusão</h2><div class="danger-box"><b>Esta ação não pode ser desfeita.</b><p>Você está excluindo: ${escapeHtml(label)}</p></div><form id="protectedDeleteForm" class="form-grid"><label>Digite sua senha<input id="deletePassword" type="password" required autocomplete="current-password" /></label><label>Digite EXCLUIR para confirmar<input id="deleteWord" required autocomplete="off" placeholder="EXCLUIR" /></label><div class="modal-actions"><button type="button" id="cancelDeleteBtn" class="secondary">Cancelar</button><button type="submit" class="danger-button">Excluir definitivamente</button></div></form>`);
  $('cancelDeleteBtn').onclick=closeModal;
  $('protectedDeleteForm').onsubmit=async e=>{
    e.preventDefault();
    const fresh=kind==='transaction'?state.transactions.find(t=>t.id===id):state.goals.find(g=>g.id===id);
    if(!ownsItem(fresh))return toast('Ação não permitida.');
    const password=$('deletePassword').value;
    if($('deleteWord').value.trim().toUpperCase()!=='EXCLUIR')return toast('Digite EXCLUIR para confirmar.');
    const submitBtn=$('protectedDeleteForm').querySelector('button[type="submit"]');
    submitBtn.disabled=true;submitBtn.textContent='Excluindo...';
    try{
      if(cloudReady){
        const user=cloudAuth.currentUser;
        if(!user||!user.email)throw new Error('Sua sessão expirou. Entre novamente.');
        const cred=firebase.auth.EmailAuthProvider.credential(user.email,password);
        await user.reauthenticateWithCredential(cred);
        const path=kind==='transaction'?`finance/${user.uid}/transactions/${id}`:`finance/${user.uid}/goals/${id}`;
        await cloudDb.ref(path).remove();
      }else{
        if(password!==state.user.password)throw new Error('Senha incorreta.');
      }
      if(kind==='transaction')state.transactions=state.transactions.filter(t=>!(t.id===id&&t.userId===state.user.id));
      else state.goals=state.goals.filter(g=>!(g.id===id&&g.userId===state.user.id));
      localStorage.setItem('fia_transactions',JSON.stringify(state.transactions));
      localStorage.setItem('fia_goals',JSON.stringify(state.goals));
      closeModal();render();toast(kind==='transaction'?'Lançamento excluído com sucesso.':'Meta excluída com sucesso.');
    }catch(err){
      console.error('Erro ao excluir:',err);
      const code=err?.code||'';
      const message=(code==='auth/wrong-password'||code==='auth/invalid-credential'||code==='auth/invalid-login-credentials')
        ?'Senha incorreta. Exclusão bloqueada.'
        :(code==='auth/too-many-requests'?'Muitas tentativas. Aguarde um pouco e tente novamente.':(err?.message||'Não foi possível excluir.'));
      toast(message);
      submitBtn.disabled=false;submitBtn.textContent='Excluir definitivamente';
    }
  };
}
function aiModal(){
  if(!canUsePremiumApp()) return paymentModal();
  const tx=userTx(), income=sumMoney(tx.filter(t=>t.type==='income')), expense=sumMoney(tx.filter(t=>t.type==='expense'));
  const catsCents={};tx.filter(t=>t.type==='expense').forEach(t=>catsCents[t.category]=(catsCents[t.category]||0)+toCents(t.value));
  const cats=Object.fromEntries(Object.entries(catsCents).map(([key,cents])=>[key,fromCents(cents)]));
  const top=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
  const analysis=tx.length?`Você registrou ${money(income)} em receitas e ${money(expense)} em despesas. Seu saldo atual é ${money(income-expense)}.${top?` A categoria com maior gasto é ${top[0]}, com ${money(top[1])}.`:''} ${expense>income?'Atenção: suas despesas estão acima das receitas. Tente reduzir gastos não essenciais e definir um limite semanal.':'Seu resultado está positivo. Considere reservar parte do saldo para uma meta ou fundo de emergência.'}`:'Adicione receitas e despesas para que a IA gere uma análise personalizada.';
  openModal(`<h2>✦ IA Financeira</h2><div class="ai-box"><b>Análise automática</b><p>${analysis}</p></div><form id="aiForm" class="form-grid" style="margin-top:14px"><label>Pergunte sobre suas finanças<textarea id="aiQuestion" rows="3" required placeholder="Ex.: Como posso economizar mais?"></textarea></label><button class="primary">Analisar pergunta</button></form><div id="aiAnswer"></div>`);
  $('aiForm').onsubmit=e=>{e.preventDefault();const q=$('aiQuestion').value.toLowerCase();let ans='Comece separando seus gastos em essenciais, importantes e adiáveis. Defina um teto semanal e acompanhe diariamente.';if(q.includes('econom'))ans=`Com base nos dados atuais, tente guardar pelo menos ${money(fromCents(Math.max(0,Math.round(toCents(income)*0.1))))} por mês e reduza primeiro a categoria ${top?.[0]||'de maior gasto'}.`;if(q.includes('gastei')||q.includes('gastando'))ans=`Suas despesas registradas somam ${money(expense)}.${top?` O maior gasto está em ${top[0]} (${money(top[1])}).`:''}`;if(q.includes('saldo'))ans=`Seu saldo calculado é ${money(income-expense)}.`;$('aiAnswer').innerHTML=`<div class="ai-box" style="margin-top:12px"><b>Resposta da IA</b><p>${ans}</p></div>`}
}

function renderAdminNotifications(){
  const target=state.plan==='premium'?'premium':'free';
  const list=state.notifications.filter(n=>n.target==='all'||n.target===target);
  const count=$('notificationCount');
  if(count){count.textContent=list.length;count.classList.toggle('hidden',!list.length)}
}
function notificationsModal(){
  const target=state.plan==='premium'?'premium':'free';
  const list=state.notifications.filter(n=>n.target==='all'||n.target===target).sort((a,b)=>b.createdAt-a.createdAt);
  openModal(`<h2>Notificações</h2>${list.length?list.map(n=>`<div class="ai-box" style="margin-top:10px"><b>${escapeHtml(n.title)}</b><p>${escapeHtml(n.message)}</p><small>${new Date(n.createdAt).toLocaleString('pt-BR')}</small></div>`).join(''):'<div class="empty-state">Nenhuma notificação.</div>'}`)
}

function isOwner(){
  const email=String(state.user?.email||cloudAuth?.currentUser?.email||'').toLowerCase();
  return state.user?.role==='owner' || OWNER_EMAILS.includes(email);
}
function trialEndTime(u=state.user){
  const explicit=u?.trialEndsAt||u?.trialUntil;
  if(explicit)return new Date(explicit).getTime();
  const created=u?.createdAt;
  return created?new Date(created).getTime()+24*60*60*1000:0;
}
function trialActive(u=state.user){
  if(!u||isOwner())return false;
  return trialEndTime(u)>Date.now() && !['active','ativo'].includes(String(u?.subscriptionStatus||u?.status||'').toLowerCase());
}
function subscriptionActive(u=state.user){
  if(isOwner()) return true;
  const status=u?.status==='ativo'||u?.subscriptionStatus==='active';
  const until=u?.expiresAt||u?.subscriptionUntil;
  if(status&&until&&new Date(until).getTime()>Date.now()) return true;
  return trialActive(u);
}
function accessPlan(u=state.user){return isOwner()||subscriptionActive(u)?'premium':'free'}
function canUsePremiumApp(){return subscriptionActive()}
function accessExpired(){return Boolean(state.user&&!isOwner()&&!subscriptionActive())}
function applyAccessLockUI(){
  const app=$('appScreen');
  if(!app)return;
  const locked=accessExpired();
  app.classList.toggle('expired-access',locked);
  app.setAttribute('data-access-locked',locked?'true':'false');
}
function checkSubscriptionAccess(){
  if(!state.user||isOwner()) return;
  applyAccessLockUI();
  if(!subscriptionActive()){ startPaymentMonitor(); paymentModal(true); }
}
function nextDueDate(){const d=new Date();d.setDate(d.getDate()+30);return d.toISOString()}
function paymentReference(){return 'FIA-'+String(state.user?.id||'').slice(0,8).toUpperCase()+'-'+Date.now().toString().slice(-6)}
async function paymentModal(lock=false){
  const price=Number(state.settings.premiumPrice||24.90);
  const showOffer=()=>{
    openModal(`<div class="payment-gate">
      <div class="payment-gate-icon">◆</div>
      <h2>Seu período grátis terminou</h2>
      <p>As 24 horas para conhecer o Finance IA Pro foram encerradas. Para continuar usando receitas, despesas, metas, relatórios e IA financeira, ative o plano mensal.</p>
      <div class="payment-plan-card"><small>PLANO ÚNICO</small><strong>${money(price)}<span>/mês</span></strong><ul><li>✓ Acesso completo ao aplicativo</li><li>✓ Receitas e despesas ilimitadas</li><li>✓ Metas e relatórios financeiros</li><li>✓ Liberação automática após o Pix</li></ul></div>
      <button id="generatePixNow" class="primary payment-main-button">Gerar Pix agora</button>
      <button id="goToLockedProfile" class="secondary payment-profile-button">Ir para meu perfil</button>
      <p class="protection-note">Pagamento seguro por Pix. Após a aprovação, o acesso será liberado por 30 dias.</p>
    </div>`,lock);
    $('generatePixNow').onclick=generatePix;
    $('goToLockedProfile').onclick=()=>{
      modalLocked=false;
      closeModal(true);
      applyAccessLockUI();
      document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page==='profile'));
      profileModal();
    };
  };
  const generatePix=async()=>{
    if(cloudReady&&BACKEND_URL){
      openModal(`<h2>Gerando seu Pix</h2><div class="ai-box"><b>${money(price)} por mês</b><p>Aguarde enquanto criamos uma cobrança Pix segura...</p></div>`,lock);
      try{
        const data=await apiFetch('/createPix',{method:'POST',body:JSON.stringify({planId:'mensal'})});
        const p=data.payment||{}; rememberPaymentId(p.id); startPaymentMonitor(); const qr=p.qrCodeBase64?`<img class="pix-qr" alt="QR Code Pix" src="data:image/png;base64,${p.qrCodeBase64}">`:'';
        openModal(`<h2>Faça o pagamento agora</h2><div class="ai-box"><b>${money(p.amount||price)} por mês</b><p>Pague pelo QR Code ou Pix Copia e Cola. A liberação será automática após a confirmação.</p>${qr}<label>Pix Copia e Cola<textarea id="pixCopy" rows="4" readonly>${escapeHtml(p.qrCode||'')}</textarea></label><p>Status: <b id="pixStatus">${escapeHtml(p.status||'pending')}</b><br>Vencimento da cobrança: ${p.expiresAt?new Date(p.expiresAt).toLocaleString('pt-BR'):'-'}</p></div><div class="modal-actions"><button id="copyPixBtn" class="secondary">Copiar Pix</button><button id="checkPixBtn" class="primary">Verificar pagamento</button></div>${lock?'<p class="protection-note">O aplicativo permanece bloqueado até o pagamento ser aprovado.</p>':''}`,lock);
        $('copyPixBtn').onclick=async()=>{try{await navigator.clipboard.writeText(p.qrCode||'');toast('Pix Copia e Cola copiado.')}catch{toast('Selecione e copie o código Pix.')}};
        $('checkPixBtn').onclick=async()=>{rememberPaymentId(p.id);await reconcilePaymentAccess(false)};
      }catch(e){
        openModal(`<h2>Não foi possível gerar o Pix</h2><div class="danger-box"><p>${escapeHtml(e.message)}</p></div><button id="tryPixAgain" class="primary" style="width:100%;margin-top:12px">Tentar novamente</button><p class="protection-note">Confira o backend, o Mercado Pago, o Firebase e o CPF cadastrado.</p>`,lock);
        $('tryPixAgain').onclick=showOffer;
      }
      return;
    }
    const pix=state.settings.pixKey||'CHAVE_PIX_NAO_CONFIGURADA';
    const ref=paymentReference();
    openModal(`<h2>Pagamento do plano</h2><div class="ai-box"><b>${money(price)} por mês</b><p>Configure Firebase e backend no arquivo <b>config.js</b> para gerar Pix automático.</p><p><b>Chave Pix:</b> ${escapeHtml(pix)}</p><p><b>Referência:</b> ${escapeHtml(ref)}</p></div>`,lock);
  };
  showOffer();
}

function profileModal(){
  const expiry=state.user.expiresAt||state.user.subscriptionUntil;
  const trialUntil=trialEndTime();
  const until=trialActive()&&trialUntil?new Date(trialUntil).toLocaleString('pt-BR'):expiry?new Date(expiry).toLocaleDateString('pt-BR'):'Não ativa';
  const owner=isOwner();
  const locked=accessExpired();
  openModal(`<h2>Meu perfil</h2>
    <div class="profile-card">
      <div class="profile-avatar">${escapeHtml((state.user.name||'U').charAt(0).toUpperCase())}</div>
      <div><b>${escapeHtml(state.user.name||'Usuário')}</b><p>${escapeHtml(state.user.email||'')}</p></div>
    </div>
    <div class="summary-grid profile-summary">
      <article class="summary"><span>Plano</span><strong>${owner?'Proprietário':trialActive()?'Teste grátis 24h':subscriptionActive()?'Premium':'Pagamento necessário'}</strong></article>
      <article class="summary"><span>Validade</span><strong>${owner?'Ilimitada':until}</strong></article>
    </div>
    ${locked?'<div class="expired-profile-notice"><b>Acesso bloqueado</b><p>Seu período grátis terminou. Você pode consultar sua assinatura, gerar o Pix e sair da conta. As outras funções permanecem bloqueadas até a aprovação do pagamento.</p></div>':''}
    <div class="profile-menu">
      <button id="editProfileBtn" class="profile-option ${locked?'locked-option':''}" ${locked?'disabled aria-disabled="true"':''}><span>✎</span><div><b>Editar meus dados</b><small>${locked?'Bloqueado até ativar o plano':'Nome, CPF e informações da conta'}</small></div><i>${locked?'🔒':'›'}</i></button>
      <button id="mySubscriptionBtn" class="profile-option"><span>◆</span><div><b>Minha assinatura</b><small>Pix, vencimento e renovação mensal</small></div><i>›</i></button>
      <button id="myPaymentsBtn" class="profile-option"><span>▤</span><div><b>Meus pagamentos</b><small>Consultar a cobrança Pix mais recente</small></div><i>›</i></button>
      <button id="exportMyDataBtn" class="profile-option ${locked?'locked-option':''}" ${locked?'disabled aria-disabled="true"':''}><span>⇩</span><div><b>Exportar meus dados</b><small>${locked?'Bloqueado até ativar o plano':'Baixar lançamentos e metas em JSON'}</small></div><i>${locked?'🔒':'›'}</i></button>
      <button id="deleteMyAccountBtn" class="profile-option danger-option ${locked?'locked-option':''}" ${locked?'disabled aria-disabled="true"':''}><span>!</span><div><b>Excluir minha conta</b><small>${locked?'Bloqueado até ativar o plano':'Protegido por senha e confirmação'}</small></div><i>${locked?'🔒':'›'}</i></button>
      ${owner?'<button id="ownerCenterBtn" class="profile-option owner-option"><span>⚙</span><div><b>Central do proprietário</b><small>Usuários, Pix, receita e configurações</small></div><i>›</i></button>':''}
    </div>
    ${locked?'<button id="profileGeneratePixBtn" class="primary" style="width:100%;margin-top:14px">Gerar Pix agora</button>':''}
    <button id="logoutBtn" class="secondary" style="width:100%;margin-top:14px">Sair da conta</button>`);
  $('logoutBtn').onclick=async()=>{if(cloudReady)await cloudAuth.signOut();state.user=null;persist();closeModal();showAuth()};
  if(!locked){
    $('editProfileBtn').onclick=editMyProfileModal;
    $('exportMyDataBtn').onclick=exportMyData;
    $('deleteMyAccountBtn').onclick=deleteMyAccountModal;
  }
  $('mySubscriptionBtn').onclick=()=>paymentModal(false);
  $('myPaymentsBtn').onclick=myPaymentsModal;
  if($('profileGeneratePixBtn'))$('profileGeneratePixBtn').onclick=()=>paymentModal(false);
  if(owner)$('ownerCenterBtn').onclick=ownerCenterModal;
}
function editMyProfileModal(){
  openModal(`<h2>Editar meus dados</h2><form id="editProfileForm" class="form-grid"><label>Nome completo<input id="profileNameInput" value="${escapeHtml(state.user.name||'')}" required></label><label>CPF<input id="profileCpfInput" inputmode="numeric" maxlength="14" value="${escapeHtml(state.user.cpf||'')}" required></label><label>E-mail<input value="${escapeHtml(state.user.email||'')}" disabled></label><button class="primary">Salvar alterações</button></form>`);
  $('editProfileForm').onsubmit=async e=>{e.preventDefault();const name=$('profileNameInput').value.trim(),cpf=$('profileCpfInput').value.replace(/\D/g,'');if(name.length<3)return toast('Informe o nome completo.');if(cpf.length!==11)return toast('Informe um CPF com 11 números.');try{if(cloudReady)await cloudDb.ref(`users/${state.user.id}`).update({name,cpf,updatedAt:new Date().toISOString()});state.user={...state.user,name,cpf};persist();closeModal();toast('Perfil atualizado.')}catch(err){toast(err.message)}};
}
async function myPaymentsModal(){
  openModal('<h2>Meus pagamentos</h2><div class="empty-state">Carregando...</div>');
  try{
    let payments=[];
    if(cloudReady){
      try{const r=await apiFetch('/myPayments');payments=Array.isArray(r?.payments)?r.payments:[]}catch(_){const r=await apiFetch('/latestPayment');if(r?.payment)payments=[r.payment]}
    }
    if(!payments.length){
      openModal('<h2>Meus pagamentos</h2><div class="empty-state">Nenhuma cobrança encontrada.</div><button id="newPixProfile" class="primary" style="width:100%;margin-top:12px">Gerar Pix de R$ 24,90</button>');
      $('newPixProfile').onclick=paymentModal;return;
    }
    const now=Date.now();
    const active=payments.find(p=>['pending','in_process','authorized'].includes(String(p.status||'').toLowerCase())&&(!Date.parse(p.expiresAt||p.paymentExpiresAt||'')||Date.parse(p.expiresAt||p.paymentExpiresAt||'')>now));
    const cards=payments.slice(0,8).map(p=>{
      const status=String(p.status||'pending').toLowerCase();
      const expiry=Date.parse(p.expiresAt||p.paymentExpiresAt||'');
      const validPending=['pending','in_process','authorized'].includes(status)&&(!Number.isFinite(expiry)||expiry>now);
      return `<article class="payment-history-card"><div class="payment-history-head"><b>${money(p.amount||24.90)}</b><span class="payment-status status-${escapeHtml(status)}">${escapeHtml(status)}</span></div><p>Criado: ${p.createdAt?new Date(p.createdAt).toLocaleString('pt-BR'):'-'}<br>Vencimento: ${p.expiresAt||p.paymentExpiresAt?new Date(p.expiresAt||p.paymentExpiresAt).toLocaleString('pt-BR'):'-'}</p>${validPending&&p.qrCode?`<label>Pix Copia e Cola<textarea rows="3" readonly id="savedPix_${escapeHtml(String(p.id))}">${escapeHtml(p.qrCode)}</textarea></label><div class="modal-actions"><button class="secondary copy-saved-pix" data-payment-id="${escapeHtml(String(p.id))}">Copiar Pix</button><button class="primary check-saved-pix" data-payment-id="${escapeHtml(String(p.id))}">Verificar pagamento</button></div>`:''}</article>`;
    }).join('');
    openModal(`<h2>Meus pagamentos</h2><div class="payment-history-list">${cards}</div><button id="renewPixProfile" class="primary" style="width:100%;margin-top:12px">${active?'Já existe um Pix válido':'Gerar nova mensalidade'}</button>`);
    $('renewPixProfile').disabled=Boolean(active);
    if(!active)$('renewPixProfile').onclick=paymentModal;
    document.querySelectorAll('.copy-saved-pix').forEach(btn=>btn.onclick=async()=>{const el=$('savedPix_'+btn.dataset.paymentId);try{await navigator.clipboard.writeText(el.value);toast('Pix copiado.')}catch(_){el.select();document.execCommand('copy');toast('Pix copiado.')}});
    document.querySelectorAll('.check-saved-pix').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;btn.textContent='Verificando...';try{const r=await apiFetch('/paymentStatus?id='+encodeURIComponent(btn.dataset.paymentId));const st=String(r?.payment?.status||'');if(st==='approved'){toast('Pagamento aprovado. Acesso liberado.');closeModal();location.reload()}else{toast('Status: '+st);myPaymentsModal()}}catch(e){toast(e.message)}finally{btn.disabled=false;btn.textContent='Verificar pagamento'}});
  }catch(err){openModal(`<h2>Meus pagamentos</h2><div class="danger-box">${escapeHtml(err.message)}</div>`)}
}
function exportMyData(){const uid=state.user.id;const data={app:'Finance IA Pro',exportedAt:new Date().toISOString(),profile:{name:state.user.name,email:state.user.email,cpf:state.user.cpf,plan:state.plan},transactions:state.transactions.filter(x=>x.userId===uid),goals:state.goals.filter(x=>x.userId===uid)};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='meus-dados-finance-ia.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Seus dados foram exportados.');}
function deleteMyAccountModal(){
  openModal(`<h2>Excluir minha conta completa</h2><div class="danger-box"><b>Atenção</b><p>Esta ação apaga o e-mail do Authentication, CPF, telefone, perfil, lançamentos, metas, contas, cartões, pagamentos e todos os demais dados. Não poderá ser desfeita.</p></div><form id="deleteAccountForm" class="form-grid"><label>Senha da conta<input id="deleteAccountPassword" type="password" required autocomplete="current-password"></label><label>Digite EXCLUIR<input id="deleteAccountWord" autocomplete="off" required></label><button id="deleteAccountSubmit" class="danger-button">Excluir conta completa</button></form>`);
  $('deleteAccountForm').onsubmit=async e=>{
    e.preventDefault();
    if($('deleteAccountWord').value.trim().toUpperCase()!=='EXCLUIR')return toast('Digite EXCLUIR corretamente.');
    if(!confirm('Confirma a exclusão completa da sua conta, inclusive e-mail, CPF e login?'))return;
    if(!confirm('CONFIRMAÇÃO FINAL: todos os dados serão apagados e não poderão ser recuperados.'))return;
    const btn=$('deleteAccountSubmit');btn.disabled=true;btn.textContent='Excluindo tudo...';
    try{
      if(cloudReady){
        const user=cloudAuth.currentUser;
        if(!user)throw new Error('Sessão expirada. Entre novamente.');
        const uid=user.uid;
        const cred=firebase.auth.EmailAuthProvider.credential(user.email,$('deleteAccountPassword').value);
        await user.reauthenticateWithCredential(cred);
        let backendDeleted=false;
        let routeError=null;
        if(BACKEND_URL){
          for(const route of ['/account/delete-complete','/account/delete','/account/deleteUser','/api/account/delete','/api/account/delete-complete','/deleteAccount','/delete-my-account']){
            try{await apiFetch(route,{method:'POST',body:JSON.stringify({confirm:'EXCLUIR',uid:user.uid,userId:user.uid,targetUid:user.uid})});backendDeleted=true;break}
            catch(err){routeError=err;if(!/rota|route|not found|404/i.test(String(err.message||'')))throw err}
          }
        }
        // Se o Render ainda estiver com a versão antiga, o próprio usuário consegue
        // apagar seu login diretamente pelo Firebase Authentication.
        if(!backendDeleted){
          const ownPaths=[`finance/${uid}`,`users/${uid}`,`userNotifications/${uid}`,`deviceSessions/${uid}`,`referrals/${uid}`];
          for(const path of ownPaths){try{await cloudDb.ref(path).remove()}catch(_){} }
          try{await user.delete()}catch(err){
            if(routeError) throw new Error('O backend ainda está antigo e o Firebase não permitiu concluir sozinho. Publique a pasta backend-render-v7.9 no Render.');
            throw err;
          }
        }
        try{await cloudAuth.signOut()}catch(_){}
      }else{
        if($('deleteAccountPassword').value!==state.user.password)throw new Error('Senha incorreta.');
        const uid=state.user.id;
        state.users=state.users.filter(x=>x.id!==uid);
        state.transactions=state.transactions.filter(x=>x.userId!==uid);
        state.goals=state.goals.filter(x=>x.userId!==uid);
      }
      state.user=null;state.plan='free';persist();closeModal();showAuth();
      toast('Conta, login, e-mail, CPF e todos os dados foram excluídos.');
    }catch(err){
      btn.disabled=false;btn.textContent='Excluir conta completa';
      toast(err.code==='auth/wrong-password'||err.code==='auth/invalid-credential'?'Senha incorreta.':(err.message||'Não foi possível excluir completamente a conta.'));
    }
  };
}
function upgradeModal(){paymentModal()}
function ownerCenterModal(){
  const premium=state.users.filter(u=>subscriptionActive(u)&&u.role!=='owner').length;
  const pending=state.payments.filter(p=>p.status==='pending').length;
  const income=sumMoney(state.transactions.filter(t=>t.type==='income')),expense=sumMoney(state.transactions.filter(t=>t.type==='expense'));
  openModal(`<h2>Central do proprietário</h2><div class="summary-grid"><article class="summary"><span>Usuários</span><strong>${state.users.length}</strong></article><article class="summary"><span>Premium</span><strong>${premium}</strong></article><article class="summary"><span>Pagamentos pendentes</span><strong>${pending}</strong></article><article class="summary"><span>Receita mensal</span><strong>${money(fromCents(premium*toCents(state.settings.premiumPrice||24.90)))}</strong></article></div><div class="modal-actions"><button id="managePayments" class="primary">Pagamentos</button><button id="manageUsers" class="secondary">Usuários</button><button id="ownerSettings" class="secondary">Configurações</button><button id="ownerBackup" class="secondary">Backup</button></div><div class="ai-box" style="margin-top:12px"><b>Dados financeiros gerenciados</b><p>Receitas: ${money(income)}<br>Despesas: ${money(expense)}<br>Saldo: ${money(income-expense)}</p></div>`);
  $('managePayments').onclick=ownerPaymentsModal;$('manageUsers').onclick=ownerUsersModal;$('ownerSettings').onclick=ownerSettingsModal;$('ownerBackup').onclick=exportOwnerBackup;
}
function ownerPaymentsModal(){
  const list=[...state.payments].sort((a,b)=>b.createdAt-a.createdAt);
  openModal(`<h2>Pagamentos Pix</h2>${list.length?list.map(p=>{const u=state.users.find(x=>x.id===p.userId);return `<div class="ai-box" style="margin-top:10px"><b>${escapeHtml(u?.name||'Usuário removido')}</b><p>${escapeHtml(u?.email||'')}<br>${money(p.amount)} • ${escapeHtml(p.reference)}<br>Status: <b>${p.status}</b></p>${p.status==='pending'?`<div class="modal-actions"><button class="primary" data-approve-pay="${p.id}">Aprovar 30 dias</button><button class="secondary" data-reject-pay="${p.id}">Recusar</button></div>`:''}</div>`}).join(''):'<div class="empty-state">Nenhum pagamento.</div>'}`);
  document.querySelectorAll('[data-approve-pay]').forEach(b=>b.onclick=()=>approvePayment(b.dataset.approvePay));document.querySelectorAll('[data-reject-pay]').forEach(b=>b.onclick=()=>rejectPayment(b.dataset.rejectPay));
}
async function approvePayment(id){const p=state.payments.find(x=>x.id===id);if(!p)return;try{const now=new Date().toISOString(),until=nextDueDate();if(cloudReady){await cloudDb.ref(`payments/${id}`).update({status:'approved',approvedAt:now,updatedAt:now});await cloudDb.ref(`users/${p.userId}`).update({status:'ativo',plan:'premium',subscriptionStatus:'active',subscriptionUntil:until,expiresAt:until,updatedAt:now});}p.status='approved';p.approvedAt=now;p.updatedAt=now;const u=state.users.find(x=>x.id===p.userId);if(u){u.status='ativo';u.plan='premium';u.subscriptionStatus='active';u.subscriptionUntil=until;u.expiresAt=until;u.updatedAt=now}persist();await ownerLog('Pagamento aprovado',`${p.userId||''} • ${money(ownerPaymentValue(p))}`);if($('ownerPanel'))ownerPaymentsPanel();else ownerPaymentsModal();toast('Pagamento aprovado e acesso liberado por 30 dias.')}catch(e){toast(e.message)}}
async function rejectPayment(id){const p=state.payments.find(x=>x.id===id);if(!p)return;try{const now=new Date().toISOString();if(cloudReady){await cloudDb.ref(`payments/${id}`).update({status:'rejected',updatedAt:now});await cloudDb.ref(`users/${p.userId}`).update({subscriptionStatus:'rejected',updatedAt:now});}p.status='rejected';p.updatedAt=now;const u=state.users.find(x=>x.id===p.userId);if(u){u.subscriptionStatus='rejected';u.updatedAt=now}persist();await ownerLog('Pagamento recusado',`${p.userId||''} • ${money(ownerPaymentValue(p))}`);if($('ownerPanel'))ownerPaymentsPanel();else ownerPaymentsModal();toast('Pagamento recusado.')}catch(e){toast(e.message)}}
async function deletePayment(id){const p=state.payments.find(x=>x.id===id);if(!p)return;if(!confirm('Excluir definitivamente este registro de pagamento?'))return;try{if(cloudReady)await cloudDb.ref(`payments/${id}`).remove();state.payments=state.payments.filter(x=>x.id!==id);persist();await ownerLog('Registro de pagamento excluído',`${p.userId||''} • ${id}`);if($('ownerPanel'))ownerPaymentsPanel();else ownerPaymentsModal();toast('Registro de pagamento excluído.')}catch(e){toast(e.message||'Não foi possível excluir o pagamento.')}}
function ownerUsersModal(){
  openModal(`<h2>Controle de usuários</h2><p class="protection-note">Todos os controles administrativos estão dentro do seu perfil.</p>${state.users.length?state.users.map(u=>`<div class="ai-box" style="margin-top:10px"><b>${escapeHtml(u.name||'Sem nome')}</b><p>${escapeHtml(u.email||'')}<br>${u.role==='owner'||OWNER_EMAILS.includes(String(u.email||'').toLowerCase())?'Proprietário':u.status==='blocked'?'Bloqueado':subscriptionActive(u)?'Premium ativo':'Sem assinatura ativa'}</p>${u.role!=='owner'&&!OWNER_EMAILS.includes(String(u.email||'').toLowerCase())?`<div class="modal-actions"><button class="secondary" data-toggle-user="${u.id}">${u.status==='blocked'?'Desbloquear':'Bloquear'}</button><button class="danger-button" data-delete-user="${u.id}">Excluir</button></div>`:''}</div>`).join(''):'<div class="empty-state">Nenhum usuário carregado. Verifique as regras de administrador do Firebase.</div>'}`);
  document.querySelectorAll('[data-toggle-user]').forEach(b=>b.onclick=async()=>{const u=state.users.find(x=>x.id===b.dataset.toggleUser);if(!u)return;try{const status=u.status==='blocked'?'active':'blocked';if(cloudReady)await cloudDb.ref(`users/${u.id}`).update({status,updatedAt:new Date().toISOString()});else{u.status=status;persist()}ownerUsersModal()}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-delete-user]').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir este usuário e todos os dados financeiros dele?'))return;const id=b.dataset.deleteUser;try{if(cloudReady){await cloudDb.ref(`finance/${id}`).remove();await cloudDb.ref(`users/${id}`).remove();}else{state.users=state.users.filter(u=>u.id!==id);state.transactions=state.transactions.filter(t=>t.userId!==id);state.goals=state.goals.filter(g=>g.userId!==id);persist()}ownerUsersModal();toast('Dados do usuário excluídos. A conta do Authentication deve ser removida pelo backend/Admin SDK.')}catch(e){toast(e.message)}});
}
function ownerSettingsModal(){
  openModal(`<h2>Configurações</h2><form id="ownerSettingsForm" class="form-grid"><label>Preço mensal<input id="ownerPrice" value="${Number(state.settings.premiumPrice||24.90).toFixed(2).replace('.',',')}" required></label><label>Chave Pix<input id="ownerPix" value="${escapeHtml(state.settings.pixKey||'')}" required placeholder="CPF, telefone, e-mail ou aleatória"></label><label>E-mail de suporte<input id="ownerSupport" type="email" value="${escapeHtml(state.settings.supportEmail||'')}"></label><label>Modo manutenção<select id="ownerMaintenance"><option value="false">Desativado</option><option value="true" ${state.settings.maintenance?'selected':''}>Ativado</option></select></label><button class="primary">Salvar</button></form>`);
  $('ownerSettingsForm').onsubmit=async e=>{e.preventDefault();const price=parseBRMoney($('ownerPrice').value);if(!Number.isFinite(price)||price<=0)return toast('Preço inválido.');const data={premiumPrice:price,pixKey:$('ownerPix').value.trim(),supportEmail:$('ownerSupport').value.trim(),maintenance:$('ownerMaintenance').value==='true',updatedAt:new Date().toISOString()};try{if(cloudReady)await cloudDb.ref('settings/financeIa').update(data);state.settings={...state.settings,...data};persist();closeModal();toast('Configurações salvas no Firebase.')}catch(err){toast(err.message)}};
}
function exportOwnerBackup(){const data={version:'2.4',exportedAt:new Date().toISOString(),users:state.users,transactions:state.transactions,goals:state.goals,payments:state.payments,notifications:state.notifications,settings:state.settings};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='finance-ia-pro-backup.json';a.click();URL.revokeObjectURL(a.href);toast('Backup exportado.')}
function allTransactionsModal(){
  const tx=userTx().sort((a,b)=>b.createdAt-a.createdAt);
  openModal(`<h2>Todos os lançamentos</h2><p class="protection-note">Toque em um lançamento para editar ou excluir com proteção.</p>${tx.length?'<button id="deleteAllTransactions" class="danger-button delete-all-transactions">Excluir todos os lançamentos</button>':''}<div id="allTransactionsList" class="transactions">${tx.length?tx.map(t=>`<button type="button" class="transaction transaction-clickable" data-all-transaction-id="${t.id}"><div class="ico">${t.type==='income'?'↗':'↘'}</div><div class="txt"><b>${escapeHtml(t.description)}</b><small>${escapeHtml(t.category)} • ${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR')}</small></div><strong class="value ${t.type}">${t.type==='income'?'+ ':'- '}${money(t.value)}</strong><span class="item-chevron">›</span></button>`).join(''):'<div class="empty-state">Nenhum lançamento.</div>'}</div>`);
  document.querySelectorAll('[data-all-transaction-id]').forEach(el=>el.onclick=()=>openTransactionDetails(el.dataset.allTransactionId));
  if($('deleteAllTransactions'))$('deleteAllTransactions').onclick=deleteAllTransactions;
}
async function deleteAllTransactions(){
  const count=userTx().length;if(!count)return toast('Não há lançamentos para excluir.');
  if(!confirm(`Excluir definitivamente todos os ${count} lançamentos?`))return;
  if(!confirm('Esta ação não pode ser desfeita. Confirma novamente?'))return;
  try{const uid=state.user.id;if(cloudReady)await cloudDb.ref(`finance/${uid}/transactions`).remove();state.transactions=state.transactions.filter(t=>t.userId!==uid);localStorage.setItem('fia_transactions',JSON.stringify(state.transactions));persist();render();allTransactionsModal();toast('Todos os lançamentos foram excluídos.')}catch(e){toast(e.message||'Não foi possível excluir os lançamentos.')}}

// Bloqueio total após o vencimento: somente Perfil, pagamento e sair permanecem acessíveis.
document.addEventListener('click',event=>{
  if(!accessExpired())return;
  const insideApp=event.target.closest?.('#appScreen');
  if(!insideApp)return;
  const allowed=event.target.closest?.('#profileBtn, .nav[data-page="profile"]');
  if(allowed)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toast('Acesso vencido. Entre no Perfil para gerar o Pix e liberar o aplicativo.');
},true);

// Eventos

function isValidCPF(value){
  const cpf=String(value||'').replace(/\D/g,'');
  if(cpf.length!==11||/^(\d)\1{10}$/.test(cpf))return false;
  let sum=0;for(let i=0;i<9;i++)sum+=Number(cpf[i])*(10-i);
  let d1=(sum*10)%11;if(d1===10)d1=0;if(d1!==Number(cpf[9]))return false;
  sum=0;for(let i=0;i<10;i++)sum+=Number(cpf[i])*(11-i);
  let d2=(sum*10)%11;if(d2===10)d2=0;return d2===Number(cpf[10]);
}
function firebaseErrorMessage(err){
  const code=String(err?.code||'');
  if(code.includes('email-already-in-use'))return 'Este e-mail já está cadastrado.';
  if(code.includes('invalid-email'))return 'Digite um e-mail válido.';
  if(code.includes('weak-password'))return 'A senha precisa ter pelo menos 6 caracteres.';
  if(code.includes('network-request-failed'))return 'Falha de internet. Tente novamente.';
  return err?.message||'Não foi possível concluir o cadastro.';
}
function maskCPFInput(input){input.addEventListener('input',()=>{let v=input.value.replace(/\D/g,'').slice(0,11);v=v.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');input.value=v})}
function maskPhoneInput(input){input.addEventListener('input',()=>{let v=input.value.replace(/\D/g,'').slice(0,11);if(v.length>10)v=v.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3');else v=v.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3');input.value=v.replace(/-$/,'')})}
maskCPFInput($('registerCpf'));maskPhoneInput($('registerPhone'));

[...document.querySelectorAll('[data-auth-tab]')].forEach(btn=>btn.onclick=()=>{document.querySelectorAll('[data-auth-tab]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');$('loginForm').classList.toggle('hidden',btn.dataset.authTab!=='login');$('registerForm').classList.toggle('hidden',btn.dataset.authTab!=='register')});
$('loginForm').onsubmit=async e=>{e.preventDefault();const email=$('loginEmail').value.trim().toLowerCase(),pass=$('loginPassword').value;try{if(cloudReady){await cloudAuth.signInWithEmailAndPassword(email,pass)}else{const u=state.users.find(x=>x.email===email&&x.password===pass);if(!u)throw new Error('E-mail ou senha incorretos.');state.user=u;persist();showApp()}}catch(err){toast(err.message||'Não foi possível entrar.')}};
$('registerForm').onsubmit=async e=>{
  e.preventDefault();
  const name=$('registerName').value.trim();
  const cpf=String($('registerCpf').value||'').replace(/\D/g,'');
  const phone=String($('registerPhone').value||'').replace(/\D/g,'');
  const email=$('registerEmail').value.trim().toLowerCase();
  const password=$('registerPassword').value;
  const passwordConfirm=$('registerPasswordConfirm').value;
  if(name.split(/\s+/).length<2)return toast('Informe seu nome completo.');
  if(!isValidCPF(cpf))return toast('Informe um CPF válido.');
  if(phone.length<10||phone.length>11)return toast('Informe um telefone válido com DDD.');
  if(password.length<6)return toast('A senha precisa ter pelo menos 6 caracteres.');
  if(password!==passwordConfirm)return toast('As senhas não são iguais.');
  if(!$('registerTerms').checked)return toast('Aceite os termos para continuar.');
  try{
    if(!cloudReady)throw new Error('Não foi possível conectar ao Firebase. Verifique sua internet.');
    const cpfSnap=await cloudDb.ref('cpfIndex/'+cpf).once('value');
    if(cpfSnap.exists())throw new Error('Este CPF já está cadastrado.');
    const cred=await cloudAuth.createUserWithEmailAndPassword(email,password);
    const uid=cred.user.uid;
    const now=new Date().toISOString();
    const owner=OWNER_EMAILS.includes(email);
    const trialEndsAt=new Date(Date.now()+24*60*60*1000).toISOString();
    const profile={name,email,cpf,phone,role:owner?'owner':'client',status:owner?'ativo':'teste',plan:owner?'premium':'mensal',subscriptionStatus:owner?'active':'trial',trialStartedAt:now,trialEndsAt:owner?null:trialEndsAt,createdAt:now,updatedAt:now};
    const updates={};
    updates[`users/${uid}`]=profile;
    updates[`cpfIndex/${cpf}`]=uid;
    updates[`phoneIndex/${phone}`]=uid;
    await cloudDb.ref().update(updates);
    state.user={id:uid,...profile};
    state.plan=owner?'premium':'premium';
    subscribeCloudData(uid);
    showApp();
    toast(owner?'Conta do proprietário conectada.':'Conta criada! Você ganhou 24 horas grátis para conhecer o aplicativo.');
  }catch(err){
    toast(firebaseErrorMessage(err));
  }
};
$('closeModal').onclick=()=>closeModal();$('modal').onclick=e=>{if(e.target===$('modal'))closeModal()};
$('addIncomeBtn').onclick=()=>transactionModal('income');$('addExpenseBtn').onclick=()=>transactionModal('expense');$('goalBtn').onclick=goalModal;$('newGoalLink').onclick=goalModal;$('aiBtn').onclick=aiModal;$('profileBtn').onclick=profileModal;$('upgradeBtn').onclick=upgradeModal;$('viewAllBtn').onclick=allTransactionsModal;
$('toggleBalance').onclick=()=>{state.hideBalance=!state.hideBalance;render()};
$('notificationBtn').onclick=notificationsModal;
$('themeBtn').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('fia_theme',document.body.classList.contains('light')?'light':'dark')};
document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));n.classList.add('active');if(n.dataset.page==='transactions')allTransactionsModal();if(n.dataset.page==='reports')aiModal();if(n.dataset.page==='profile')profileModal()});
if(localStorage.getItem('fia_theme')==='light')document.body.classList.add('light');
window.addEventListener('beforeunload',()=>{if(state.user){state.user.online=false;state.user.lastSeen=Date.now();state.users=state.users.map(u=>u.id===state.user.id?state.user:u);persist();}});
if('serviceWorker' in navigator){
  if(['localhost','127.0.0.1'].includes(location.hostname)){
    navigator.serviceWorker.getRegistrations().then(list=>list.forEach(r=>r.unregister()));
    caches?.keys?.().then(keys=>keys.forEach(k=>caches.delete(k)));
  }else{
    navigator.serviceWorker.register('service-worker.js?v=7.8',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
  }
}
setInterval(()=>{if(state.user&&!isOwner()){state.plan=accessPlan();if(!subscriptionActive())checkSubscriptionAccess();else render();}},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.user&&!isOwner()){state.plan=accessPlan();checkSubscriptionAccess();render();}});

if(initCloud()){
  cloudAuth.onAuthStateChanged(async user=>{
    if(!user){state.user=null;showAuth();return;}
    const snap=await cloudDb.ref(`users/${user.uid}`).once('value');
    const profile=snap.val()||{name:user.email?.split('@')[0]||'Usuário',email:user.email};
    state.user={id:user.uid,...profile};
    if(OWNER_EMAILS.includes(String(user.email||profile.email||'').toLowerCase())){state.user.role='owner';state.user.status='ativo';state.user.plan='premium';try{await cloudDb.ref(`users/${user.uid}`).update({role:'owner',status:'ativo',plan:'premium',updatedAt:new Date().toISOString()});}catch(e){console.warn('Não foi possível gravar papel de proprietário:',e)}}
    state.plan=accessPlan(state.user);
    subscribeCloudData(user.uid); showApp();
  });
}else{state.user?showApp():showAuth();}

/* =========================================================
   CENTRAL DO PROPRIETÁRIO V5.0 — base estável da V4.5
   ========================================================= */
function ownerUserStatus(u){
  if(u.role==='owner'||OWNER_EMAILS.includes(String(u.email||'').toLowerCase())) return 'owner';
  if(u.status==='blocked') return 'blocked';
  if(subscriptionActive(u)) return 'premium';
  if(u.subscriptionStatus==='pending'||u.status==='pendente') return 'pending';
  return 'expired';
}
function ownerDate(value){
  if(!value) return 'Não informado';
  const d=new Date(value); return Number.isNaN(d.getTime())?'Não informado':d.toLocaleString('pt-BR');
}
function ownerIsOnline(u){
  const last=Number(u.lastSeen||0); return u.online===true && (!last || Date.now()-last<5*60*1000);
}
function ownerCreatedWithin(u,days){
  const d=new Date(u.createdAt||0); return !Number.isNaN(d.getTime()) && Date.now()-d.getTime()<=days*86400000;
}
function ownerPaymentValue(p){return Number(p.amount||p.value||state.settings.premiumPrice||24.90)}
function ownerPaid(p){return ['approved','paid','accredited'].includes(String(p.status||'').toLowerCase())}
async function ownerLog(action,details=''){
  const data={action,details,adminId:state.user?.id||'',adminEmail:state.user?.email||'',createdAt:new Date().toISOString()};
  state.adminLogs=state.adminLogs||[]; state.adminLogs.unshift({id:'log_'+Date.now(),...data}); state.adminLogs=state.adminLogs.slice(0,200);
  localStorage.setItem('fia_admin_logs',JSON.stringify(state.adminLogs));
  if(cloudReady) try{await cloudDb.ref('adminLogs').push(data)}catch(e){console.warn(e)}
}
function ownerCenterModal(active='dashboard'){
  const users=state.users||[], payments=state.payments||[];
  const clients=users.filter(u=>ownerUserStatus(u)!=='owner');
  const premium=clients.filter(u=>ownerUserStatus(u)==='premium').length;
  const online=clients.filter(ownerIsOnline).length;
  const pending=payments.filter(p=>String(p.status||'').toLowerCase()==='pending').length;
  const approved=payments.filter(ownerPaid);
  const monthlyRevenue=approved.filter(p=>{const d=new Date(p.approvedAt||p.updatedAt||p.createdAt||0),n=new Date();return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear()}).reduce((s,p)=>s+ownerPaymentValue(p),0);
  const totalRevenue=approved.reduce((s,p)=>s+ownerPaymentValue(p),0);
  const newToday=clients.filter(u=>ownerCreatedWithin(u,1)).length;
  const newMonth=clients.filter(u=>ownerCreatedWithin(u,30)).length;
  openModal(`<div class="owner-shell">
    <header class="owner-header"><div><small>ADMINISTRAÇÃO</small><h2>Central do Proprietário</h2><p>Controle completo do Finance IA Pro</p></div><span class="owner-live"><i></i> Online</span></header>
    <nav class="owner-tabs" aria-label="Menu administrativo">
      <button data-owner-tab="dashboard" class="${active==='dashboard'?'active':''}">⌂<span>Dashboard</span></button>
      <button data-owner-tab="users" class="${active==='users'?'active':''}">♟<span>Usuários</span></button>
      <button data-owner-tab="payments" class="${active==='payments'?'active':''}">◆<span>Pagamentos</span></button>
      <button data-owner-tab="reports" class="${active==='reports'?'active':''}">▥<span>Relatórios</span></button>
      <button data-owner-tab="settings" class="${active==='settings'?'active':''}">⚙<span>Configurações</span></button>
      <button data-owner-tab="backup" class="${active==='backup'?'active':''}">☁<span>Backup</span></button>
    </nav>
    <section id="ownerPanel" class="owner-panel"></section>
  </div>`);
  document.querySelector('.modal-card').classList.add('owner-modal-card');$('modal').classList.add('owner-modal');
  const metrics={clients,premium,online,pending,monthlyRevenue,totalRevenue,newToday,newMonth};
  document.querySelectorAll('[data-owner-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-owner-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');ownerRenderTab(b.dataset.ownerTab,metrics)});
  ownerRenderTab(active,metrics);
}
function ownerRenderTab(tab,m){
  const panel=$('ownerPanel'); if(!panel)return;
  panel.className='owner-panel owner-tab-'+tab;
  panel.scrollTop=0;
  if(tab==='dashboard'){
    const tx=state.transactions||[];const income=sumMoney(tx.filter(t=>t.type==='income'));const expense=sumMoney(tx.filter(t=>t.type==='expense'));
    const expiring=(state.users||[]).filter(u=>{const d=new Date(u.subscriptionUntil||0);return ownerUserStatus(u)==='premium'&&d>Date.now()&&d-Date.now()<=7*86400000}).length;
    panel.innerHTML=`<div class="owner-title-row"><div><h3>Visão geral</h3><p>Dados atualizados do sistema</p></div><button id="ownerRefresh" class="owner-small-btn">↻ Atualizar</button></div>
    <div class="owner-metrics">
      ${ownerMetric('👥','Usuários',m.clients,'Total de clientes')}${ownerMetric('🟢','Online agora',m.online,'Últimos 5 minutos')}
      ${ownerMetric('💎','Premium',m.premium,'Assinaturas ativas')}${ownerMetric('⏳','Pendentes',m.pending,'Aguardando confirmação')}
      ${ownerMetric('💰','Receita mensal',money(m.monthlyRevenue),'Pagamentos aprovados')}${ownerMetric('📈','Receita total',money(m.totalRevenue),'Desde o início')}
      ${ownerMetric('✨','Novos hoje',m.newToday,'Cadastros recentes')}${ownerMetric('📅','Novos no mês',m.newMonth,'Últimos 30 dias')}
    </div>
    <div class="owner-grid-two"><article class="owner-card"><h4>Resumo financeiro dos clientes</h4><div class="owner-fin-row"><span>Receitas registradas</span><b class="safe-text">${money(income)}</b></div><div class="owner-fin-row"><span>Despesas registradas</span><b class="danger-text">${money(expense)}</b></div><div class="owner-fin-row"><span>Saldo consolidado</span><b>${money(income-expense)}</b></div></article>
    <article class="owner-card"><h4>Atenção necessária</h4><div class="owner-alert-row"><span>Pagamentos pendentes</span><b>${m.pending}</b></div><div class="owner-alert-row"><span>Assinaturas vencendo em 7 dias</span><b>${expiring}</b></div><div class="owner-alert-row"><span>Contas bloqueadas</span><b>${(state.users||[]).filter(u=>ownerUserStatus(u)==='blocked').length}</b></div></article></div>
    <article class="owner-card"><div class="owner-title-row"><div><h4>Atalhos administrativos</h4><p>Ações mais usadas</p></div></div><div class="owner-shortcuts"><button data-owner-go="users">👥 Gerenciar usuários</button><button data-owner-go="payments">💳 Ver pagamentos</button><button data-owner-go="settings">🛠 Configurar sistema</button><button data-owner-go="backup">☁ Fazer backup</button></div></article>`;
    $('ownerRefresh').onclick=()=>{toast('Dados atualizados.');ownerCenterModal('dashboard')};
    document.querySelectorAll('[data-owner-go]').forEach(b=>b.onclick=()=>ownerCenterModal(b.dataset.ownerGo));
  }
  if(tab==='users') ownerUsersPanel();
  if(tab==='payments') ownerPaymentsPanel();
  if(tab==='reports') ownerReportsPanel();
  if(tab==='settings') ownerSettingsPanel();
  if(tab==='backup') ownerBackupPanel();
}
function ownerMetric(icon,label,value,hint){return `<article class="owner-metric"><div class="owner-metric-icon">${icon}</div><div><span>${label}</span><strong>${value}</strong><small>${hint}</small></div></article>`}
function ownerUsersPanel(){
  const panel=$('ownerPanel');
  panel.innerHTML=`<div class="owner-title-row"><div><h3>Usuários</h3><p>Pesquise, filtre e gerencie cada conta</p></div><span class="owner-count">${(state.users||[]).length} contas</span></div>
  <div class="owner-toolbar"><input id="ownerUserSearch" placeholder="Pesquisar nome, e-mail, telefone ou CPF"><select id="ownerUserFilter"><option value="all">Todos</option><option value="online">Online</option><option value="premium">Premium</option><option value="pending">Pendentes</option><option value="expired">Vencidos</option><option value="blocked">Bloqueados</option></select></div><div id="ownerUsersList" class="owner-list"></div>`;
  const draw=()=>{const q=$('ownerUserSearch').value.trim().toLowerCase(),filter=$('ownerUserFilter').value;let list=(state.users||[]).filter(u=>ownerUserStatus(u)!=='owner');list=list.filter(u=>{const hay=[u.name,u.email,u.phone,u.cpf].join(' ').toLowerCase();const status=ownerUserStatus(u);return(!q||hay.includes(q))&&(filter==='all'||(filter==='online'?ownerIsOnline(u):status===filter))});$('ownerUsersList').innerHTML=list.length?list.map(u=>ownerUserCard(u)).join(''):'<div class="owner-empty">Nenhum usuário encontrado.</div>';document.querySelectorAll('[data-owner-user]').forEach(b=>b.onclick=()=>ownerUserDetails(b.dataset.ownerUser))};
  $('ownerUserSearch').oninput=draw;$('ownerUserFilter').onchange=draw;draw();
}
function ownerUserCard(u){const status=ownerUserStatus(u),labels={premium:'Premium ativo',pending:'Pagamento pendente',expired:'Assinatura vencida',blocked:'Bloqueado'};return `<button class="owner-user-card" data-owner-user="${u.id}"><div class="owner-user-avatar">${escapeHtml((u.name||'U').charAt(0).toUpperCase())}</div><div class="owner-user-main"><b>${escapeHtml(u.name||'Sem nome')}</b><span>${escapeHtml(u.email||'Sem e-mail')}</span><small>${escapeHtml(u.phone||'Telefone não informado')} • ${u.cpf?escapeHtml(u.cpf):'CPF não informado'}</small></div><div class="owner-user-side"><em class="status-${status}">${labels[status]||status}</em><small>${ownerIsOnline(u)?'🟢 Online':'Último acesso: '+ownerDate(u.lastSeen)}</small><i>›</i></div></button>`}
async function ownerUserDetails(id){
  const u=(state.users||[]).find(x=>x.id===id);if(!u)return;
  let finance={transactions:{},goals:{}};if(cloudReady)try{finance=(await cloudDb.ref(`finance/${id}`).once('value')).val()||finance}catch(e){}
  const tx=Object.values(finance.transactions||{}),income=sumMoney(tx.filter(t=>t.type==='income')),expense=sumMoney(tx.filter(t=>t.type==='expense'));const status=ownerUserStatus(u);
  const toLocalInput=value=>{if(!value)return '';const d=new Date(value);if(Number.isNaN(d.getTime()))return '';const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`};
  const selectedAdminStatus=u.status==='blocked'?'blocked':subscriptionActive(u)?'active':(u.subscriptionStatus==='pending'||u.status==='pendente')?'pending':trialActive(u)?'trial':'expired';
  openModal(`<div class="owner-detail"><button id="ownerBackUsers" class="owner-back">← Voltar</button><div class="profile-card"><div class="profile-avatar">${escapeHtml((u.name||'U').charAt(0).toUpperCase())}</div><div><h2>${escapeHtml(u.name||'Sem nome')}</h2><p>${escapeHtml(u.email||'')}</p></div></div>
  <div class="owner-detail-grid"><div><span>Status</span><b>${status}</b></div><div><span>Plano</span><b>${escapeHtml(u.plan||'Grátis')}</b></div><div><span>CPF</span><b>${escapeHtml(u.cpf||'Não informado')}</b></div><div><span>Telefone</span><b>${escapeHtml(u.phone||'Não informado')}</b></div><div><span>Cadastrado em</span><b>${ownerDate(u.createdAt)}</b></div><div><span>Assinatura até</span><b>${ownerDate(u.subscriptionUntil)}</b></div></div>
  <div class="owner-metrics mini">${ownerMetric('↗','Receitas',money(income),'Dados do cliente')}${ownerMetric('↘','Despesas',money(expense),'Dados do cliente')}${ownerMetric('◎','Saldo',money(income-expense),'Resultado atual')}${ownerMetric('🎯','Metas',Object.keys(finance.goals||{}).length,'Metas cadastradas')}</div>
  <article class="owner-card owner-access-control"><div class="owner-title-row"><div><h4>Controle de acesso</h4><p>Altere plano, status, data e horário manualmente</p></div></div>
    <div class="owner-control-grid">
      <label>Plano<select id="ownerPlanSelect"><option value="free" ${String(u.plan||'').toLowerCase()==='free'?'selected':''}>Free</option><option value="premium" ${String(u.plan||'').toLowerCase()==='premium'?'selected':''}>Premium</option></select></label>
      <label>Status<select id="ownerStatusSelect"><option value="trial" ${selectedAdminStatus==='trial'?'selected':''}>Teste grátis</option><option value="active" ${selectedAdminStatus==='active'?'selected':''}>Ativo</option><option value="pending" ${selectedAdminStatus==='pending'?'selected':''}>Pagamento pendente</option><option value="expired" ${selectedAdminStatus==='expired'?'selected':''}>Vencido</option><option value="blocked" ${selectedAdminStatus==='blocked'?'selected':''}>Bloqueado</option></select></label>
      <label>Teste grátis até<input id="ownerTrialUntil" type="datetime-local" value="${toLocalInput(u.trialEndsAt||u.trialUntil)}"></label>
      <label>Premium válido até<input id="ownerPremiumUntil" type="datetime-local" value="${toLocalInput(u.subscriptionUntil||u.expiresAt)}"></label>
    </div>
    <div class="owner-preset-grid"><button type="button" class="secondary" data-owner-preset="24h">+ 24 horas grátis</button><button type="button" class="secondary" data-owner-preset="7d">Premium 7 dias</button><button type="button" class="secondary" data-owner-preset="30d">Premium 30 dias</button><button type="button" class="secondary" data-owner-preset="90d">Premium 90 dias</button></div>
    <div class="owner-actions-grid"><button id="ownerSaveAccess" class="primary">Salvar plano e status</button><button id="ownerResetUser" class="secondary">Resetar para teste de 24h</button></div>
  </article>
  <div class="owner-actions-grid"><button id="ownerTogglePremium" class="primary">${status==='premium'?'Retirar Premium':'Liberar Premium por 30 dias'}</button><button id="ownerToggleBlock" class="secondary">${status==='blocked'?'Desbloquear conta':'Bloquear conta'}</button><button id="ownerNotifyUser" class="secondary">Enviar notificação</button><button id="ownerDeleteUser" class="danger-button">Excluir conta completa</button></div></div>`);
  document.querySelector('.modal-card').classList.remove('owner-modal-card');
  $('ownerBackUsers').onclick=()=>ownerCenterModal('users');
  const setDateInput=(id,ms)=>{const d=new Date(ms),pad=n=>String(n).padStart(2,'0');$(id).value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`};
  document.querySelectorAll('[data-owner-preset]').forEach(b=>b.onclick=()=>{const now=Date.now(),preset=b.dataset.ownerPreset;if(preset==='24h'){$('ownerPlanSelect').value='free';$('ownerStatusSelect').value='trial';setDateInput('ownerTrialUntil',now+86400000);$('ownerPremiumUntil').value=''}else{const days=Number(preset.replace('d',''));$('ownerPlanSelect').value='premium';$('ownerStatusSelect').value='active';setDateInput('ownerPremiumUntil',now+days*86400000)} });
  $('ownerSaveAccess').onclick=async()=>{try{const plan=$('ownerPlanSelect').value,adminStatus=$('ownerStatusSelect').value,trialValue=$('ownerTrialUntil').value,premiumValue=$('ownerPremiumUntil').value,now=new Date().toISOString();let data={plan,updatedAt:now};if(adminStatus==='trial'){const end=trialValue?new Date(trialValue).toISOString():new Date(Date.now()+86400000).toISOString();data={...data,plan:'free',status:'teste',subscriptionStatus:'trial',trialStartedAt:u.trialStartedAt||now,trialEndsAt:end,subscriptionUntil:null,expiresAt:null}}else if(adminStatus==='active'){const end=premiumValue?new Date(premiumValue).toISOString():new Date(Date.now()+30*86400000).toISOString();data={...data,status:'ativo',subscriptionStatus:'active',subscriptionUntil:end,expiresAt:end}}else if(adminStatus==='pending'){data={...data,status:'pendente',subscriptionStatus:'pending',subscriptionUntil:null,expiresAt:null}}else if(adminStatus==='expired'){data={...data,status:'vencido',subscriptionStatus:'expired',subscriptionUntil:premiumValue?new Date(premiumValue).toISOString():null,expiresAt:null}}else{data={...data,status:'blocked',subscriptionStatus:'blocked'}}if(cloudReady)await cloudDb.ref(`users/${id}`).update(data);Object.assign(u,data);await ownerLog('Acesso do usuário alterado',`${u.email||id} • ${plan} • ${adminStatus}`);toast('Plano, status e validade atualizados.');ownerUserDetails(id)}catch(e){toast(e.message||'Não foi possível atualizar o acesso.')}};
  $('ownerResetUser').onclick=async()=>{if(!confirm('Resetar este cliente e liberar um novo teste de 24 horas?'))return;const now=new Date(),end=new Date(Date.now()+86400000),data={plan:'free',status:'teste',subscriptionStatus:'trial',trialStartedAt:now.toISOString(),trialEndsAt:end.toISOString(),subscriptionUntil:null,expiresAt:null,updatedAt:now.toISOString()};if(cloudReady)await cloudDb.ref(`users/${id}`).update(data);Object.assign(u,data);await ownerLog('Usuário resetado para teste de 24h',u.email||id);toast('Novo teste de 24 horas liberado.');ownerUserDetails(id)};
  $('ownerTogglePremium').onclick=async()=>{const active=status==='premium';const data=active?{plan:'free',status:'vencido',subscriptionStatus:'expired',subscriptionUntil:null,expiresAt:null}:{plan:'premium',status:'ativo',subscriptionStatus:'active',subscriptionUntil:nextDueDate(),expiresAt:nextDueDate()};if(cloudReady)await cloudDb.ref(`users/${id}`).update({...data,updatedAt:new Date().toISOString()});Object.assign(u,data);await ownerLog(active?'Premium removido':'Premium liberado',u.email||id);toast(active?'Premium removido.':'Premium liberado por 30 dias.');ownerUserDetails(id)};
  $('ownerToggleBlock').onclick=async()=>{const blocked=status==='blocked',data=blocked?{status:'vencido',subscriptionStatus:'expired',updatedAt:new Date().toISOString()}:{status:'blocked',subscriptionStatus:'blocked',updatedAt:new Date().toISOString()};if(cloudReady)await cloudDb.ref(`users/${id}`).update(data);Object.assign(u,data);await ownerLog(blocked?'Usuário desbloqueado':'Usuário bloqueado',u.email||id);toast(blocked?'Conta desbloqueada.':'Conta bloqueada.');ownerUserDetails(id)};
  $('ownerNotifyUser').onclick=()=>ownerNotificationComposer(u);
  $('ownerDeleteUser').onclick=async()=>{if(!cloudReady)return toast('A exclusão completa exige conexão com o Firebase.');if(!BACKEND_URL)return toast('Backend não configurado.');if(!confirm(`ATENÇÃO: excluir completamente a conta de ${u.email||u.name||'cliente'}?\n\nIsso apagará login, e-mail do Authentication, CPF, perfil, dados financeiros, notificações e pagamentos vinculados.`))return;if(!confirm('CONFIRMAÇÃO FINAL: esta conta não poderá mais entrar e os dados não poderão ser recuperados.'))return;const btn=$('ownerDeleteUser');btn.disabled=true;btn.textContent='Excluindo conta completa...';try{let deleted=false,lastError=null;for(const route of ['/admin/deleteUser','/admin/delete-user','/admin/users/delete','/admin/users/delete-complete','/api/admin/deleteUser','/api/admin/delete-user','/api/admin/users/delete','/deleteUser','/delete-user-complete']){try{await apiFetch(route,{method:'POST',body:JSON.stringify({uid:id,userId:id,targetUid:id})});deleted=true;break}catch(err){lastError=err;if(!/rota|route|not found|404/i.test(String(err.message||'')))throw err}}if(!deleted)throw lastError||new Error('Rota de exclusão não encontrada. Atualize o backend no Render.');state.users=state.users.filter(x=>x.id!==id);state.transactions=state.transactions.filter(x=>x.userId!==id);state.goals=state.goals.filter(x=>x.userId!==id);state.payments=state.payments.filter(x=>x.userId!==id);persist();toast('Conta, Authentication, e-mail, CPF e todos os dados foram excluídos.');ownerCenterModal('users')}catch(e){btn.disabled=false;btn.textContent='Excluir conta completa';toast(e.message||'Não foi possível excluir completamente a conta.')}};
}
function ownerNotificationComposer(u){openModal(`<button id="notifBack" class="owner-back">← Voltar</button><h2>Enviar notificação</h2><p>Para: <b>${escapeHtml(u.name||u.email||'Usuário')}</b></p><form id="ownerNotifForm" class="form-grid"><label>Título<input id="ownerNotifTitle" value="Aviso do Finance IA Pro" required></label><label>Mensagem<textarea id="ownerNotifMessage" rows="5" required placeholder="Digite a mensagem"></textarea></label><button class="primary">Enviar notificação</button></form>`);$('notifBack').onclick=()=>ownerUserDetails(u.id);$('ownerNotifForm').onsubmit=async e=>{e.preventDefault();const data={title:$('ownerNotifTitle').value.trim(),message:$('ownerNotifMessage').value.trim(),read:false,createdAt:new Date().toISOString()};if(cloudReady)await cloudDb.ref(`userNotifications/${u.id}`).push(data);await ownerLog('Notificação enviada',u.email||u.id);toast('Notificação enviada.');ownerUserDetails(u.id)}}
function ownerPaymentsPanel(){
  const panel=$('ownerPanel');panel.innerHTML=`<div class="owner-title-row"><div><h3>Pagamentos</h3><p>Confirmações Pix e histórico</p></div><button id="ownerExportPayments" class="owner-small-btn">Exportar CSV</button></div><div class="owner-toolbar"><input id="ownerPaymentSearch" placeholder="Pesquisar cliente ou ID"><select id="ownerPaymentFilter"><option value="all">Todos</option><option value="pending">Pendentes</option><option value="approved">Aprovados</option><option value="rejected">Recusados</option></select></div><div id="ownerPaymentsList" class="owner-list"></div>`;
  const draw=()=>{const q=$('ownerPaymentSearch').value.toLowerCase(),f=$('ownerPaymentFilter').value;let list=[...(state.payments||[])].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));list=list.filter(p=>{const u=(state.users||[]).find(x=>x.id===p.userId)||{};return(!q||[p.id,p.userId,u.name,u.email,p.payerEmail].join(' ').toLowerCase().includes(q))&&(f==='all'||String(p.status||'pending').toLowerCase()===f)});$('ownerPaymentsList').innerHTML=list.length?list.map(p=>ownerPaymentCard(p)).join(''):'<div class="owner-empty">Nenhum pagamento encontrado.</div>';document.querySelectorAll('[data-owner-approve]').forEach(b=>b.onclick=()=>approvePayment(b.dataset.ownerApprove));document.querySelectorAll('[data-owner-reject]').forEach(b=>b.onclick=()=>rejectPayment(b.dataset.ownerReject));document.querySelectorAll('[data-owner-delete-payment]').forEach(b=>b.onclick=()=>deletePayment(b.dataset.ownerDeletePayment))};$('ownerPaymentSearch').oninput=draw;$('ownerPaymentFilter').onchange=draw;$('ownerExportPayments').onclick=exportPaymentsCSV;draw();
}
function ownerPaymentCard(p){const u=(state.users||[]).find(x=>x.id===p.userId)||{},status=String(p.status||'pending').toLowerCase();return `<article class="owner-payment-card"><div><b>${escapeHtml(u.name||p.payerName||'Cliente')}</b><span>${escapeHtml(u.email||p.payerEmail||'')}</span><small>ID: ${escapeHtml(p.id||'')} • ${ownerDate(p.createdAt)}</small></div><div class="owner-payment-value"><strong>${money(ownerPaymentValue(p))}</strong><em class="status-${status==='approved'?'premium':status}">${status}</em></div><div class="owner-payment-actions ${status!=='pending'?'single-delete':''}">${status==='pending'?`<button data-owner-approve="${p.id}" class="primary">Aprovar</button><button data-owner-reject="${p.id}" class="danger-button">Recusar</button>`:''}<button data-owner-delete-payment="${p.id}" class="secondary owner-delete-payment">Excluir registro</button></div></article>`}
function exportPaymentsCSV(){const rows=[['ID','Cliente','Email','Valor','Status','Data']];(state.payments||[]).forEach(p=>{const u=(state.users||[]).find(x=>x.id===p.userId)||{};rows.push([p.id,u.name||'',u.email||'',ownerPaymentValue(p),p.status||'',p.createdAt||''])});downloadText('pagamentos-finance-ia.csv',rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\n'),'text/csv;charset=utf-8')}
function ownerReportsPanel(){
  const users=state.users||[],payments=state.payments||[],approved=payments.filter(ownerPaid),total=approved.reduce((s,p)=>s+ownerPaymentValue(p),0);const statuses=['premium','pending','expired','blocked'];
  $('ownerPanel').innerHTML=`<div class="owner-title-row"><div><h3>Relatórios</h3><p>Indicadores para acompanhar o crescimento</p></div><button id="ownerUsersCsv" class="owner-small-btn">Usuários CSV</button></div><div class="owner-metrics">${ownerMetric('👥','Cadastros',users.filter(u=>ownerUserStatus(u)!=='owner').length,'Base total')}${ownerMetric('💎','Conversão Premium',users.length?Math.round(users.filter(u=>ownerUserStatus(u)==='premium').length/Math.max(1,users.filter(u=>ownerUserStatus(u)!=='owner').length)*100)+'%':'0%','Clientes assinantes')}${ownerMetric('💰','Receita acumulada',money(total),'Pagamentos confirmados')}${ownerMetric('🧾','Ticket médio',money(approved.length?total/approved.length:0),'Por pagamento')}</div><article class="owner-card"><h4>Distribuição dos usuários</h4>${statuses.map(s=>{const n=users.filter(u=>ownerUserStatus(u)===s).length,totalClients=Math.max(1,users.filter(u=>ownerUserStatus(u)!=='owner').length);return `<div class="owner-report-line"><span>${s}</span><div><i style="width:${n/totalClients*100}%"></i></div><b>${n}</b></div>`}).join('')}</article><article class="owner-card"><h4>Registro das ações administrativas</h4><div class="owner-log-list">${(state.adminLogs||[]).slice(0,30).map(l=>`<div><b>${escapeHtml(l.action||'Ação')}</b><span>${escapeHtml(l.details||'')}</span><small>${ownerDate(l.createdAt)}</small></div>`).join('')||'<div class="owner-empty">Nenhuma ação registrada nesta sessão.</div>'}</div></article>`;$('ownerUsersCsv').onclick=exportUsersCSV;
}
function exportUsersCSV(){const rows=[['Nome','Email','CPF','Telefone','Status','Plano','Cadastro','Validade']];(state.users||[]).filter(u=>ownerUserStatus(u)!=='owner').forEach(u=>rows.push([u.name||'',u.email||'',u.cpf||'',u.phone||'',ownerUserStatus(u),u.plan||'',u.createdAt||'',u.subscriptionUntil||'']));downloadText('usuarios-finance-ia.csv',rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\n'),'text/csv;charset=utf-8')}
function ownerSettingsPanel(){
  const s=state.settings||{};$('ownerPanel').innerHTML=`<div class="owner-title-row"><div><h3>Configurações</h3><p>Personalize funcionamento e cobrança</p></div></div><form id="ownerSettingsAdvanced" class="owner-settings-form"><div class="owner-grid-two"><label>Nome do aplicativo<input id="setAppName" value="${escapeHtml(s.appName||'Finance IA Pro')}"></label><label>Preço mensal<input id="setPrice" value="${Number(s.premiumPrice||24.90).toFixed(2).replace('.',',')}"></label><label>Chave Pix<input id="setPix" value="${escapeHtml(s.pixKey||'')}"></label><label>E-mail de suporte<input id="setSupport" type="email" value="${escapeHtml(s.supportEmail||'')}"></label></div><label>Mensagem de manutenção<textarea id="setMaintenanceMessage" rows="3">${escapeHtml(s.maintenanceMessage||'Estamos realizando uma atualização. Tente novamente mais tarde.')}</textarea></label><div class="owner-switch-row"><div><b>Modo manutenção</b><small>Bloqueia somente clientes. O proprietário permanece liberado.</small></div><label class="switch"><input id="setMaintenance" type="checkbox" ${s.maintenance?'checked':''}><span></span></label></div><div class="owner-switch-row"><div><b>Novos cadastros</b><small>Permitir criação de novas contas</small></div><label class="switch"><input id="setRegistrations" type="checkbox" ${s.registrationsEnabled!==false?'checked':''}><span></span></label></div><button class="primary">Salvar configurações</button></form>`;
  $('ownerSettingsAdvanced').onsubmit=async e=>{e.preventDefault();const price=parseBRMoney($('setPrice').value);if(!Number.isFinite(price)||price<=0)return toast('Preço inválido.');const data={appName:$('setAppName').value.trim()||'Finance IA Pro',premiumPrice:price,pixKey:$('setPix').value.trim(),supportEmail:$('setSupport').value.trim(),maintenanceMessage:$('setMaintenanceMessage').value.trim(),maintenance:$('setMaintenance').checked,registrationsEnabled:$('setRegistrations').checked,updatedAt:new Date().toISOString()};if(cloudReady)await cloudDb.ref('settings/financeIa').update(data);state.settings={...state.settings,...data};persist();await ownerLog('Configurações atualizadas',data.maintenance?'Manutenção ativada':'Manutenção desativada');toast('Configurações salvas.');ownerCenterModal('settings')}
}
function ownerBackupPanel(){
  $('ownerPanel').innerHTML=`<div class="owner-title-row"><div><h3>Backup e segurança</h3><p>Proteja e exporte os dados do sistema</p></div></div><div class="owner-backup-grid"><article class="owner-card"><div class="owner-big-icon">☁</div><h4>Backup completo JSON</h4><p>Usuários, pagamentos, lançamentos, metas, configurações e registros.</p><button id="ownerBackupJson" class="primary">Baixar backup</button></article><article class="owner-card"><div class="owner-big-icon">⇩</div><h4>Restaurar backup</h4><p>Use somente um arquivo gerado pelo Finance IA Pro.</p><label class="secondary owner-file-label">Selecionar arquivo<input id="ownerRestoreFile" type="file" accept="application/json,.json" hidden></label></article><article class="owner-card"><div class="owner-big-icon">▦</div><h4>Exportar planilhas</h4><p>Baixe usuários e pagamentos em CSV.</p><div class="owner-actions-grid"><button id="backupUsersCsv" class="secondary">Usuários CSV</button><button id="backupPaymentsCsv" class="secondary">Pagamentos CSV</button></div></article><article class="owner-card danger-box"><div class="owner-big-icon">⚠</div><h4>Zona de segurança</h4><p>O proprietário nunca será bloqueado pelo modo manutenção.</p><button id="backupTestMaintenance" class="secondary">Verificar acesso do proprietário</button></article></div>`;
  $('ownerBackupJson').onclick=exportOwnerBackup;$('backupUsersCsv').onclick=exportUsersCSV;$('backupPaymentsCsv').onclick=exportPaymentsCSV;$('backupTestMaintenance').onclick=()=>toast(isOwner()?'Acesso confirmado: proprietário liberado.':'Esta conta não foi reconhecida como proprietária.');$('ownerRestoreFile').onchange=e=>restoreOwnerBackup(e.target.files[0]);
}
async function restoreOwnerBackup(file){if(!file)return;if(!confirm('Restaurar este backup? Dados existentes poderão ser substituídos.'))return;try{const data=JSON.parse(await file.text());if(!data.users||!data.settings)throw new Error('Arquivo de backup inválido.');if(cloudReady){const users={};data.users.forEach(u=>{const{id,...rest}=u;users[id]=rest});const payments={};(data.payments||[]).forEach(p=>{const{id,...rest}=p;payments[id]=rest});await cloudDb.ref().update({users,payments,settings:{financeIa:data.settings}})}state.users=data.users||[];state.payments=data.payments||[];state.transactions=data.transactions||[];state.goals=data.goals||[];state.settings=data.settings||state.settings;persist();await ownerLog('Backup restaurado',file.name);toast('Backup restaurado com sucesso.');ownerCenterModal('backup')}catch(e){toast(e.message||'Não foi possível restaurar.')}}
function downloadText(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function exportOwnerBackup(){const data={version:'5.0',exportedAt:new Date().toISOString(),users:state.users,transactions:state.transactions,goals:state.goals,payments:state.payments,notifications:state.notifications,adminLogs:state.adminLogs||[],settings:state.settings};downloadText('finance-ia-pro-backup-'+todayISO()+'.json',JSON.stringify(data,null,2),'application/json');ownerLog('Backup exportado','JSON completo');toast('Backup completo exportado.')}
