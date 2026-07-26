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
  bind(`finance/${uid}/transactions`,v=>{state.transactions=Object.entries(v).map(([id,x])=>({id,userId:uid,...x})); localStorage.setItem('fia_transactions',JSON.stringify(state.transactions)); render();});
  bind(`finance/${uid}/goals`,v=>{state.goals=Object.entries(v).map(([id,x])=>({id,userId:uid,...x})); localStorage.setItem('fia_goals',JSON.stringify(state.goals)); render();});
  bind(`users/${uid}`,v=>{if(!v||!state.user)return; state.user={id:uid,...v}; if(isOwner()) state.user.role='owner'; state.plan=isOwner()?'premium':(v.status==='ativo'?'premium':(v.plan||'free')); localStorage.setItem('fia_user',JSON.stringify(state.user)); localStorage.setItem('fia_plan',state.plan); render();});
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
const money = value => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

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
  return Number.isFinite(number) ? (negative ? -number : number) : NaN;
}

function formatMoneyWhileTyping(input){
  let raw=String(input.value || '').replace(/R\$/gi,'').replace(/\s/g,'');
  raw=raw.replace(/[^0-9,]/g,'');

  const commaIndex=raw.indexOf(',');
  let integerPart=commaIndex >= 0 ? raw.slice(0,commaIndex) : raw;
  let decimalPart=commaIndex >= 0 ? raw.slice(commaIndex+1) : '';

  integerPart=integerPart.replace(/\D/g,'').replace(/^0+(?=\d)/,'');
  if(!integerPart) integerPart='0';
  integerPart=integerPart.replace(/\B(?=(\d{3})+(?!\d))/g,'.');

  decimalPart=decimalPart.replace(/\D/g,'').slice(0,2);
  input.value=commaIndex >= 0 ? integerPart+','+decimalPart : integerPart;
}

function normalizeMoneyInput(input){
  const value=parseBRMoney(input.value);
  if(Number.isFinite(value)){
    input.value=value.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
}

function enableLiveMoneyMask(input){
  input.addEventListener('input',()=>formatMoneyWhileTyping(input));
  input.addEventListener('focus',()=>{
    if(input.value==='0,00') input.value='';
  });
  input.addEventListener('blur',()=>{
    if(input.value.trim()) normalizeMoneyInput(input);
  });
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
function openModal(html){$('modalContent').innerHTML=html;$('modal').classList.remove('hidden')}
function closeModal(){$('modal').classList.add('hidden')}
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
  setTimeout(checkSubscriptionAccess,250);
}
function showAuth(){$('appScreen').classList.add('hidden');$('authScreen').classList.remove('hidden')}

function render(){
  const tx=userTx();
  const income=tx.filter(t=>t.type==='income').reduce((a,b)=>a+b.value,0);
  const expense=tx.filter(t=>t.type==='expense').reduce((a,b)=>a+b.value,0);
  const balance=income-expense;
  const max=Math.max(income,expense,1);
  $('balanceValue').textContent=state.hideBalance?'R$ •••••':money(balance);
  $('incomeValue').textContent=state.hideBalance?'R$ •••••':money(income);
  $('expenseValue').textContent=state.hideBalance?'R$ •••••':money(expense);
  $('savingRate').textContent=income>0?Math.max(0,Math.round((balance/income)*100))+'%':'0%';
  $('planName').textContent=state.plan==='premium'?'Premium':'Grátis';
  $('monthResult').textContent='Resultado: '+money(balance);
  $('incomeBar').style.width=(income/max*100)+'%';
  $('expenseBar').style.width=(expense/max*100)+'%';
  $('monthLabel').textContent=new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  renderTransactions(tx);renderGoals();
  $('premiumBanner').classList.toggle('hidden',state.plan==='premium');
  renderAdminNotifications();
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
  openModal(`<h2>${type==='income'?'Nova receita':'Nova despesa'}</h2><form id="transactionForm" class="form-grid"><label>Descrição<input id="txDescription" required placeholder="Ex.: Salário, mercado..." /></label><label>Valor<input id="txValue" type="text" inputmode="decimal" required placeholder="Ex.: 7.000,00" /></label><label>Categoria<select id="txCategory"><option>${type==='income'?'Salário':'Alimentação'}</option><option>${type==='income'?'Venda':'Moradia'}</option><option>${type==='income'?'Freelance':'Transporte'}</option><option>${type==='income'?'Outros':'Saúde'}</option><option>Lazer</option><option>Outros</option></select></label><label>Data<input id="txDate" type="date" value="${todayISO()}" required /></label><button class="primary" type="submit">Salvar lançamento</button></form>`);
  const txValueInput=$('txValue');
  enableLiveMoneyMask(txValueInput);
  $('transactionForm').onsubmit=e=>{
    e.preventDefault();
    if(state.plan!=='premium'&&userTx().length>=Number(state.settings.freeLimit||100)){return toast('Você atingiu o limite do plano gratuito.');}
    const value=parseBRMoney(txValueInput.value);
    if(!Number.isFinite(value)||value<=0){txValueInput.focus();return toast('Digite um valor válido. Exemplo: 7.000,00');}
    state.transactions.push({id:crypto.randomUUID(),userId:state.user.id,type,description:$('txDescription').value.trim(),value,category:$('txCategory').value,date:$('txDate').value,createdAt:Date.now()});
    persist();closeModal();render();toast('Lançamento salvo com sucesso!');
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
  $('editTransactionForm').onsubmit=e=>{e.preventDefault();const fresh=state.transactions.find(t=>t.id===id);if(!ownsItem(fresh))return toast('Ação não permitida.');const value=parseBRMoney(valueInput.value);if(!Number.isFinite(value)||value<=0)return toast('Digite um valor válido.');Object.assign(fresh,{type:typeInput.value,description:$('editTxDescription').value.trim(),value,category:categoryInput.value,date:$('editTxDate').value,updatedAt:Date.now()});persist();closeModal();render();toast('Lançamento atualizado com sucesso!')};
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
  $('editGoalForm').onsubmit=e=>{e.preventDefault();const fresh=state.goals.find(g=>g.id===id);if(!ownsItem(fresh))return toast('Ação não permitida.');const targetValue=parseBRMoney(target.value),currentValue=parseBRMoney(current.value);if(!Number.isFinite(targetValue)||targetValue<=0)return toast('Digite um objetivo válido.');if(!Number.isFinite(currentValue)||currentValue<0)return toast('Digite um valor guardado válido.');Object.assign(fresh,{name:$('editGoalName').value.trim(),target:targetValue,current:currentValue,updatedAt:Date.now()});persist();closeModal();render();toast('Meta atualizada com sucesso!')};
}
function protectedDeleteModal(kind,id,label){
  const item=kind==='transaction'?state.transactions.find(t=>t.id===id):state.goals.find(g=>g.id===id);
  if(!ownsItem(item))return toast('Ação não permitida.');
  openModal(`<h2>Confirmar exclusão</h2><div class="danger-box"><b>Esta ação não pode ser desfeita.</b><p>Você está excluindo: ${escapeHtml(label)}</p></div><form id="protectedDeleteForm" class="form-grid"><label>Digite sua senha<input id="deletePassword" type="password" required autocomplete="current-password" /></label><label>Digite EXCLUIR para confirmar<input id="deleteWord" required autocomplete="off" placeholder="EXCLUIR" /></label><div class="modal-actions"><button type="button" id="cancelDeleteBtn" class="secondary">Cancelar</button><button type="submit" class="danger-button">Excluir definitivamente</button></div></form>`);
  $('cancelDeleteBtn').onclick=closeModal;
  $('protectedDeleteForm').onsubmit=e=>{e.preventDefault();const fresh=kind==='transaction'?state.transactions.find(t=>t.id===id):state.goals.find(g=>g.id===id);if(!ownsItem(fresh))return toast('Ação não permitida.');if($('deletePassword').value!==state.user.password)return toast('Senha incorreta. Exclusão bloqueada.');if($('deleteWord').value.trim().toUpperCase()!=='EXCLUIR')return toast('Digite EXCLUIR para confirmar.');if(kind==='transaction')state.transactions=state.transactions.filter(t=>!(t.id===id&&t.userId===state.user.id));else state.goals=state.goals.filter(g=>!(g.id===id&&g.userId===state.user.id));persist();closeModal();render();toast(kind==='transaction'?'Lançamento excluído.':'Meta excluída.');};
}
function aiModal(){
  if(!canUsePremiumApp()) return paymentModal();
  const tx=userTx(), income=tx.filter(t=>t.type==='income').reduce((a,b)=>a+b.value,0), expense=tx.filter(t=>t.type==='expense').reduce((a,b)=>a+b.value,0);
  const cats={};tx.filter(t=>t.type==='expense').forEach(t=>cats[t.category]=(cats[t.category]||0)+t.value);
  const top=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
  const analysis=tx.length?`Você registrou ${money(income)} em receitas e ${money(expense)} em despesas. Seu saldo atual é ${money(income-expense)}.${top?` A categoria com maior gasto é ${top[0]}, com ${money(top[1])}.`:''} ${expense>income?'Atenção: suas despesas estão acima das receitas. Tente reduzir gastos não essenciais e definir um limite semanal.':'Seu resultado está positivo. Considere reservar parte do saldo para uma meta ou fundo de emergência.'}`:'Adicione receitas e despesas para que a IA gere uma análise personalizada.';
  openModal(`<h2>✦ IA Financeira</h2><div class="ai-box"><b>Análise automática</b><p>${analysis}</p></div><form id="aiForm" class="form-grid" style="margin-top:14px"><label>Pergunte sobre suas finanças<textarea id="aiQuestion" rows="3" required placeholder="Ex.: Como posso economizar mais?"></textarea></label><button class="primary">Analisar pergunta</button></form><div id="aiAnswer"></div>`);
  $('aiForm').onsubmit=e=>{e.preventDefault();const q=$('aiQuestion').value.toLowerCase();let ans='Comece separando seus gastos em essenciais, importantes e adiáveis. Defina um teto semanal e acompanhe diariamente.';if(q.includes('econom'))ans=`Com base nos dados atuais, tente guardar pelo menos ${money(Math.max(0,income*0.1))} por mês e reduza primeiro a categoria ${top?.[0]||'de maior gasto'}.`;if(q.includes('gastei')||q.includes('gastando'))ans=`Suas despesas registradas somam ${money(expense)}.${top?` O maior gasto está em ${top[0]} (${money(top[1])}).`:''}`;if(q.includes('saldo'))ans=`Seu saldo calculado é ${money(income-expense)}.`;$('aiAnswer').innerHTML=`<div class="ai-box" style="margin-top:12px"><b>Resposta da IA</b><p>${ans}</p></div>`}
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
function subscriptionActive(u=state.user){
  if(isOwner()) return true;
  const status=u?.status==='ativo'||u?.subscriptionStatus==='active';
  const until=u?.expiresAt||u?.subscriptionUntil;
  if(!status||!until) return false;
  return new Date(until).getTime()>Date.now();
}
function canUsePremiumApp(){return subscriptionActive()}
function checkSubscriptionAccess(){
  if(!state.user||isOwner()) return;
  if(!subscriptionActive()) paymentModal(true);
}
function nextDueDate(){const d=new Date();d.setDate(d.getDate()+30);return d.toISOString()}
function paymentReference(){return 'FIA-'+String(state.user?.id||'').slice(0,8).toUpperCase()+'-'+Date.now().toString().slice(-6)}
async function paymentModal(lock=false){
  if(cloudReady&&BACKEND_URL){
    openModal(`<h2>Assinatura mensal</h2><div class="ai-box"><b>${money(24.90)} por mês</b><p>Gerando cobrança Pix segura...</p></div>`);
    try{
      const data=await apiFetch('/createPix',{method:'POST',body:JSON.stringify({planId:'mensal'})});
      const p=data.payment||{}; const qr=p.qrCodeBase64?`<img class="pix-qr" alt="QR Code Pix" src="data:image/png;base64,${p.qrCodeBase64}">`:'';
      openModal(`<h2>Assinatura mensal</h2><div class="ai-box"><b>${money(p.amount||24.90)} por mês</b><p>Pague pelo QR Code ou Pix Copia e Cola. A liberação será automática após o webhook confirmar.</p>${qr}<label>Pix Copia e Cola<textarea id="pixCopy" rows="4" readonly>${escapeHtml(p.qrCode||'')}</textarea></label><p>Status: <b id="pixStatus">${escapeHtml(p.status||'pending')}</b><br>Vencimento da cobrança: ${p.expiresAt?new Date(p.expiresAt).toLocaleString('pt-BR'):'-'}</p></div><div class="modal-actions"><button id="copyPixBtn" class="secondary">Copiar Pix</button><button id="checkPixBtn" class="primary">Verificar pagamento</button></div>${lock?'<p class="protection-note">O acesso Premium será liberado automaticamente por 30 dias.</p>':''}`);
      $('copyPixBtn').onclick=async()=>{try{await navigator.clipboard.writeText(p.qrCode||'');toast('Pix Copia e Cola copiado.')}catch{toast('Selecione e copie o código Pix.')}};
      $('checkPixBtn').onclick=async()=>{try{const r=await apiFetch(`/paymentStatus?id=${encodeURIComponent(p.id)}`);$('pixStatus').textContent=r.payment?.status||r.status||'pending';if((r.payment?.status||r.status)==='approved'){toast('Pagamento aprovado! Premium liberado.');closeModal();}}catch(e){toast(e.message)}};
    }catch(e){openModal(`<h2>Não foi possível gerar o Pix</h2><div class="danger-box"><p>${escapeHtml(e.message)}</p></div><p class="protection-note">Confira o endereço do backend, as credenciais do Mercado Pago, o Firebase e o CPF cadastrado.</p>`)}
    return;
  }
  const price=Number(state.settings.premiumPrice||24.90), pix=state.settings.pixKey||'CHAVE_PIX_NAO_CONFIGURADA';
  const ref=paymentReference();
  openModal(`<h2>Modo demonstração</h2><div class="ai-box"><b>${money(price)} por mês</b><p>Configure Firebase e backend no arquivo <b>config.js</b> para gerar Pix automático.</p><p><b>Chave Pix:</b> ${escapeHtml(pix)}</p><p><b>Referência:</b> ${escapeHtml(ref)}</p></div>`);
}
function profileModal(){
  const expiry=state.user.expiresAt||state.user.subscriptionUntil;
  const until=expiry?new Date(expiry).toLocaleDateString('pt-BR'):'Não ativa';
  const owner=isOwner();
  openModal(`<h2>Meu perfil</h2>
    <div class="profile-card">
      <div class="profile-avatar">${escapeHtml((state.user.name||'U').charAt(0).toUpperCase())}</div>
      <div><b>${escapeHtml(state.user.name||'Usuário')}</b><p>${escapeHtml(state.user.email||'')}</p></div>
    </div>
    <div class="summary-grid profile-summary">
      <article class="summary"><span>Plano</span><strong>${owner?'Proprietário':subscriptionActive()?'Premium':'Pendente'}</strong></article>
      <article class="summary"><span>Validade</span><strong>${owner?'Ilimitada':until}</strong></article>
    </div>
    <div class="profile-menu">
      <button id="editProfileBtn" class="profile-option"><span>✎</span><div><b>Editar meus dados</b><small>Nome, CPF e informações da conta</small></div><i>›</i></button>
      <button id="mySubscriptionBtn" class="profile-option"><span>◆</span><div><b>Minha assinatura</b><small>Pix, vencimento e renovação mensal</small></div><i>›</i></button>
      <button id="myPaymentsBtn" class="profile-option"><span>▤</span><div><b>Meus pagamentos</b><small>Consultar a cobrança Pix mais recente</small></div><i>›</i></button>
      <button id="exportMyDataBtn" class="profile-option"><span>⇩</span><div><b>Exportar meus dados</b><small>Baixar lançamentos e metas em JSON</small></div><i>›</i></button>
      <button id="deleteMyAccountBtn" class="profile-option danger-option"><span>!</span><div><b>Excluir minha conta</b><small>Protegido por senha e confirmação</small></div><i>›</i></button>
      ${owner?'<button id="ownerCenterBtn" class="profile-option owner-option"><span>⚙</span><div><b>Central do proprietário</b><small>Usuários, Pix, receita e configurações</small></div><i>›</i></button>':''}
    </div>
    <button id="logoutBtn" class="secondary" style="width:100%;margin-top:14px">Sair da conta</button>`);
  $('logoutBtn').onclick=async()=>{if(cloudReady)await cloudAuth.signOut();state.user=null;persist();closeModal();showAuth()};
  $('editProfileBtn').onclick=editMyProfileModal;
  $('mySubscriptionBtn').onclick=paymentModal;
  $('myPaymentsBtn').onclick=myPaymentsModal;
  $('exportMyDataBtn').onclick=exportMyData;
  $('deleteMyAccountBtn').onclick=deleteMyAccountModal;
  if(owner)$('ownerCenterBtn').onclick=ownerCenterModal;
}
function editMyProfileModal(){
  openModal(`<h2>Editar meus dados</h2><form id="editProfileForm" class="form-grid"><label>Nome completo<input id="profileNameInput" value="${escapeHtml(state.user.name||'')}" required></label><label>CPF<input id="profileCpfInput" inputmode="numeric" maxlength="14" value="${escapeHtml(state.user.cpf||'')}" required></label><label>E-mail<input value="${escapeHtml(state.user.email||'')}" disabled></label><button class="primary">Salvar alterações</button></form>`);
  $('editProfileForm').onsubmit=async e=>{e.preventDefault();const name=$('profileNameInput').value.trim(),cpf=$('profileCpfInput').value.replace(/\D/g,'');if(name.length<3)return toast('Informe o nome completo.');if(cpf.length!==11)return toast('Informe um CPF com 11 números.');try{if(cloudReady)await cloudDb.ref(`users/${state.user.id}`).update({name,cpf,updatedAt:new Date().toISOString()});state.user={...state.user,name,cpf};persist();closeModal();toast('Perfil atualizado.')}catch(err){toast(err.message)}};
}
async function myPaymentsModal(){
  openModal('<h2>Meus pagamentos</h2><div class="empty-state">Carregando...</div>');
  try{const r=cloudReady?await apiFetch('/latestPayment'):null;const p=r?.payment;if(!p){openModal('<h2>Meus pagamentos</h2><div class="empty-state">Nenhuma cobrança encontrada.</div><button id="newPixProfile" class="primary" style="width:100%;margin-top:12px">Gerar Pix de R$ 24,90</button>');$('newPixProfile').onclick=paymentModal;return;}openModal(`<h2>Meus pagamentos</h2><div class="ai-box"><b>${money(p.amount||24.90)}</b><p>Status: <b>${escapeHtml(p.status||'pending')}</b><br>Criado: ${p.createdAt?new Date(p.createdAt).toLocaleString('pt-BR'):'-'}<br>Vencimento: ${p.expiresAt?new Date(p.expiresAt).toLocaleString('pt-BR'):'-'}</p></div><button id="renewPixProfile" class="primary" style="width:100%;margin-top:12px">Gerar nova mensalidade</button>`);$('renewPixProfile').onclick=paymentModal;}catch(err){openModal(`<h2>Meus pagamentos</h2><div class="danger-box">${escapeHtml(err.message)}</div>`)}
}
function exportMyData(){const uid=state.user.id;const data={app:'Finance IA Pro',exportedAt:new Date().toISOString(),profile:{name:state.user.name,email:state.user.email,cpf:state.user.cpf,plan:state.plan},transactions:state.transactions.filter(x=>x.userId===uid),goals:state.goals.filter(x=>x.userId===uid)};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='meus-dados-finance-ia.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Seus dados foram exportados.');}
function deleteMyAccountModal(){
  openModal(`<h2>Excluir minha conta</h2><div class="danger-box"><b>Atenção</b><p>Esta ação apaga seu perfil, lançamentos e metas. Não poderá ser desfeita.</p></div><form id="deleteAccountForm" class="form-grid"><label>Senha da conta<input id="deleteAccountPassword" type="password" required></label><label>Digite EXCLUIR<input id="deleteAccountWord" autocomplete="off" required></label><button class="danger-button">Excluir definitivamente</button></form>`);
  $('deleteAccountForm').onsubmit=async e=>{e.preventDefault();if($('deleteAccountWord').value.trim().toUpperCase()!=='EXCLUIR')return toast('Digite EXCLUIR corretamente.');if(!confirm('Confirma a exclusão definitiva da sua conta?'))return;try{if(cloudReady){const user=cloudAuth.currentUser;const cred=firebase.auth.EmailAuthProvider.credential(user.email,$('deleteAccountPassword').value);await user.reauthenticateWithCredential(cred);await cloudDb.ref(`finance/${user.uid}`).remove();await cloudDb.ref(`users/${user.uid}`).remove();await user.delete();}else{if($('deleteAccountPassword').value!==state.user.password)throw new Error('Senha incorreta.');const uid=state.user.id;state.users=state.users.filter(x=>x.id!==uid);state.transactions=state.transactions.filter(x=>x.userId!==uid);state.goals=state.goals.filter(x=>x.userId!==uid);state.user=null;persist();}closeModal();showAuth();toast('Conta excluída com segurança.')}catch(err){toast(err.code==='auth/wrong-password'?'Senha incorreta.':(err.message||'Não foi possível excluir.'))}};
}
function upgradeModal(){paymentModal()}
function ownerCenterModal(){
  const premium=state.users.filter(u=>subscriptionActive(u)&&u.role!=='owner').length;
  const pending=state.payments.filter(p=>p.status==='pending').length;
  const income=state.transactions.filter(t=>t.type==='income').reduce((a,b)=>a+Number(b.value||0),0),expense=state.transactions.filter(t=>t.type==='expense').reduce((a,b)=>a+Number(b.value||0),0);
  openModal(`<h2>Central do proprietário</h2><div class="summary-grid"><article class="summary"><span>Usuários</span><strong>${state.users.length}</strong></article><article class="summary"><span>Premium</span><strong>${premium}</strong></article><article class="summary"><span>Pagamentos pendentes</span><strong>${pending}</strong></article><article class="summary"><span>Receita mensal</span><strong>${money(premium*Number(state.settings.premiumPrice||24.90))}</strong></article></div><div class="modal-actions"><button id="managePayments" class="primary">Pagamentos</button><button id="manageUsers" class="secondary">Usuários</button><button id="ownerSettings" class="secondary">Configurações</button><button id="ownerBackup" class="secondary">Backup</button></div><div class="ai-box" style="margin-top:12px"><b>Dados financeiros gerenciados</b><p>Receitas: ${money(income)}<br>Despesas: ${money(expense)}<br>Saldo: ${money(income-expense)}</p></div>`);
  $('managePayments').onclick=ownerPaymentsModal;$('manageUsers').onclick=ownerUsersModal;$('ownerSettings').onclick=ownerSettingsModal;$('ownerBackup').onclick=exportOwnerBackup;
}
function ownerPaymentsModal(){
  const list=[...state.payments].sort((a,b)=>b.createdAt-a.createdAt);
  openModal(`<h2>Pagamentos Pix</h2>${list.length?list.map(p=>{const u=state.users.find(x=>x.id===p.userId);return `<div class="ai-box" style="margin-top:10px"><b>${escapeHtml(u?.name||'Usuário removido')}</b><p>${escapeHtml(u?.email||'')}<br>${money(p.amount)} • ${escapeHtml(p.reference)}<br>Status: <b>${p.status}</b></p>${p.status==='pending'?`<div class="modal-actions"><button class="primary" data-approve-pay="${p.id}">Aprovar 30 dias</button><button class="secondary" data-reject-pay="${p.id}">Recusar</button></div>`:''}</div>`}).join(''):'<div class="empty-state">Nenhum pagamento.</div>'}`);
  document.querySelectorAll('[data-approve-pay]').forEach(b=>b.onclick=()=>approvePayment(b.dataset.approvePay));document.querySelectorAll('[data-reject-pay]').forEach(b=>b.onclick=()=>rejectPayment(b.dataset.rejectPay));
}
async function approvePayment(id){const p=state.payments.find(x=>x.id===id);if(!p)return;try{if(cloudReady){await cloudDb.ref(`payments/${id}`).update({status:'approved',approvedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});await cloudDb.ref(`users/${p.userId}`).update({status:'ativo',plan:'premium',subscriptionStatus:'active',subscriptionUntil:nextDueDate(),updatedAt:new Date().toISOString()});}else{const u=state.users.find(x=>x.id===p.userId);p.status='approved';if(u){u.plan='premium';u.subscriptionStatus='active';u.subscriptionUntil=nextDueDate()}persist();}ownerPaymentsModal();toast('Pagamento aprovado e acesso liberado por 30 dias.')}catch(e){toast(e.message)}}
async function rejectPayment(id){const p=state.payments.find(x=>x.id===id);if(!p)return;try{if(cloudReady){await cloudDb.ref(`payments/${id}`).update({status:'rejected',updatedAt:new Date().toISOString()});await cloudDb.ref(`users/${p.userId}`).update({subscriptionStatus:'rejected',updatedAt:new Date().toISOString()});}else{p.status='rejected';persist();}ownerPaymentsModal();toast('Pagamento recusado.')}catch(e){toast(e.message)}}
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
  openModal(`<h2>Todos os lançamentos</h2><p class="protection-note">Toque em um lançamento para editar ou excluir com proteção.</p><div id="allTransactionsList" class="transactions">${tx.length?tx.map(t=>`<button type="button" class="transaction transaction-clickable" data-all-transaction-id="${t.id}"><div class="ico">${t.type==='income'?'↗':'↘'}</div><div class="txt"><b>${escapeHtml(t.description)}</b><small>${escapeHtml(t.category)} • ${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR')}</small></div><strong class="value ${t.type}">${t.type==='income'?'+ ':'- '}${money(t.value)}</strong><span class="item-chevron">›</span></button>`).join(''):'<div class="empty-state">Nenhum lançamento.</div>'}</div>`);
  document.querySelectorAll('[data-all-transaction-id]').forEach(el=>el.onclick=()=>openTransactionDetails(el.dataset.allTransactionId));
}

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
    const profile={name,email,cpf,phone,role:owner?'owner':'client',status:owner?'ativo':'pendente',plan:owner?'premium':'mensal',subscriptionStatus:owner?'active':'pending',createdAt:now,updatedAt:now};
    const updates={};
    updates[`users/${uid}`]=profile;
    updates[`cpfIndex/${cpf}`]=uid;
    updates[`phoneIndex/${phone}`]=uid;
    await cloudDb.ref().update(updates);
    state.user={id:uid,...profile};
    state.plan=owner?'premium':'free';
    subscribeCloudData(uid);
    showApp();
    toast(owner?'Conta do proprietário conectada.':'Conta criada. Gerando cobrança Pix...');
    if(!owner)setTimeout(()=>paymentModal(true),700);
  }catch(err){
    toast(firebaseErrorMessage(err));
  }
};
$('closeModal').onclick=closeModal;$('modal').onclick=e=>{if(e.target===$('modal'))closeModal()};
$('addIncomeBtn').onclick=()=>transactionModal('income');$('addExpenseBtn').onclick=()=>transactionModal('expense');$('goalBtn').onclick=goalModal;$('newGoalLink').onclick=goalModal;$('aiBtn').onclick=aiModal;$('profileBtn').onclick=profileModal;$('upgradeBtn').onclick=upgradeModal;$('viewAllBtn').onclick=allTransactionsModal;
$('toggleBalance').onclick=()=>{state.hideBalance=!state.hideBalance;render()};
$('notificationBtn').onclick=notificationsModal;
$('themeBtn').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('fia_theme',document.body.classList.contains('light')?'light':'dark')};
document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));n.classList.add('active');if(n.dataset.page==='transactions')allTransactionsModal();if(n.dataset.page==='reports')aiModal();if(n.dataset.page==='profile')profileModal()});
if(localStorage.getItem('fia_theme')==='light')document.body.classList.add('light');
window.addEventListener('beforeunload',()=>{if(state.user){state.user.online=false;state.user.lastSeen=Date.now();state.users=state.users.map(u=>u.id===state.user.id?state.user:u);persist();}});
if('serviceWorker' in navigator)navigator.serviceWorker.register('service-worker.js').catch(()=>{});
if(initCloud()){
  cloudAuth.onAuthStateChanged(async user=>{
    if(!user){state.user=null;showAuth();return;}
    const snap=await cloudDb.ref(`users/${user.uid}`).once('value');
    const profile=snap.val()||{name:user.email?.split('@')[0]||'Usuário',email:user.email};
    state.user={id:user.uid,...profile};
    if(OWNER_EMAILS.includes(String(user.email||profile.email||'').toLowerCase())){state.user.role='owner';state.user.status='ativo';state.user.plan='premium';try{await cloudDb.ref(`users/${user.uid}`).update({role:'owner',status:'ativo',plan:'premium',updatedAt:new Date().toISOString()});}catch(e){console.warn('Não foi possível gravar papel de proprietário:',e)}}
    state.plan=isOwner()?'premium':(profile.status==='ativo'?'premium':(profile.plan||'free'));
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
  document.querySelector('.modal-card').classList.add('owner-modal-card');
  const metrics={clients,premium,online,pending,monthlyRevenue,totalRevenue,newToday,newMonth};
  document.querySelectorAll('[data-owner-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-owner-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');ownerRenderTab(b.dataset.ownerTab,metrics)});
  ownerRenderTab(active,metrics);
}
function ownerRenderTab(tab,m){
  const panel=$('ownerPanel'); if(!panel)return;
  if(tab==='dashboard'){
    const tx=state.transactions||[];const income=tx.filter(t=>t.type==='income').reduce((a,b)=>a+Number(b.value||0),0);const expense=tx.filter(t=>t.type==='expense').reduce((a,b)=>a+Number(b.value||0),0);
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
  const tx=Object.values(finance.transactions||{}),income=tx.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.value||0),0),expense=tx.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.value||0),0);const status=ownerUserStatus(u);
  openModal(`<div class="owner-detail"><button id="ownerBackUsers" class="owner-back">← Voltar</button><div class="profile-card"><div class="profile-avatar">${escapeHtml((u.name||'U').charAt(0).toUpperCase())}</div><div><h2>${escapeHtml(u.name||'Sem nome')}</h2><p>${escapeHtml(u.email||'')}</p></div></div>
  <div class="owner-detail-grid"><div><span>Status</span><b>${status}</b></div><div><span>Plano</span><b>${escapeHtml(u.plan||'Grátis')}</b></div><div><span>CPF</span><b>${escapeHtml(u.cpf||'Não informado')}</b></div><div><span>Telefone</span><b>${escapeHtml(u.phone||'Não informado')}</b></div><div><span>Cadastrado em</span><b>${ownerDate(u.createdAt)}</b></div><div><span>Assinatura até</span><b>${ownerDate(u.subscriptionUntil)}</b></div></div>
  <div class="owner-metrics mini">${ownerMetric('↗','Receitas',money(income),'Dados do cliente')}${ownerMetric('↘','Despesas',money(expense),'Dados do cliente')}${ownerMetric('◎','Saldo',money(income-expense),'Resultado atual')}${ownerMetric('🎯','Metas',Object.keys(finance.goals||{}).length,'Metas cadastradas')}</div>
  <div class="owner-actions-grid"><button id="ownerTogglePremium" class="primary">${status==='premium'?'Retirar Premium':'Liberar Premium por 30 dias'}</button><button id="ownerToggleBlock" class="secondary">${status==='blocked'?'Desbloquear conta':'Bloquear conta'}</button><button id="ownerNotifyUser" class="secondary">Enviar notificação</button><button id="ownerDeleteUser" class="danger-button">Excluir dados</button></div></div>`);
  document.querySelector('.modal-card').classList.remove('owner-modal-card');
  $('ownerBackUsers').onclick=()=>ownerCenterModal('users');
  $('ownerTogglePremium').onclick=async()=>{const active=status==='premium';const data=active?{plan:'free',status:'vencido',subscriptionStatus:'expired',subscriptionUntil:null}:{plan:'premium',status:'ativo',subscriptionStatus:'active',subscriptionUntil:nextDueDate()};if(cloudReady)await cloudDb.ref(`users/${id}`).update({...data,updatedAt:new Date().toISOString()});Object.assign(u,data);await ownerLog(active?'Premium removido':'Premium liberado',u.email||id);toast(active?'Premium removido.':'Premium liberado por 30 dias.');ownerUserDetails(id)};
  $('ownerToggleBlock').onclick=async()=>{const blocked=status==='blocked',data={status:blocked?'ativo':'blocked',updatedAt:new Date().toISOString()};if(cloudReady)await cloudDb.ref(`users/${id}`).update(data);Object.assign(u,data);await ownerLog(blocked?'Usuário desbloqueado':'Usuário bloqueado',u.email||id);toast(blocked?'Conta desbloqueada.':'Conta bloqueada.');ownerUserDetails(id)};
  $('ownerNotifyUser').onclick=()=>ownerNotificationComposer(u);
  $('ownerDeleteUser').onclick=async()=>{if(!confirm('ATENÇÃO: excluir os dados financeiros e o perfil deste usuário?'))return;if(!confirm('Confirme novamente. Esta ação não pode ser desfeita.'))return;if(cloudReady){await cloudDb.ref(`finance/${id}`).remove();await cloudDb.ref(`users/${id}`).remove()}state.users=state.users.filter(x=>x.id!==id);await ownerLog('Dados de usuário excluídos',u.email||id);toast('Dados excluídos.');ownerCenterModal('users')};
}
function ownerNotificationComposer(u){openModal(`<button id="notifBack" class="owner-back">← Voltar</button><h2>Enviar notificação</h2><p>Para: <b>${escapeHtml(u.name||u.email||'Usuário')}</b></p><form id="ownerNotifForm" class="form-grid"><label>Título<input id="ownerNotifTitle" value="Aviso do Finance IA Pro" required></label><label>Mensagem<textarea id="ownerNotifMessage" rows="5" required placeholder="Digite a mensagem"></textarea></label><button class="primary">Enviar notificação</button></form>`);$('notifBack').onclick=()=>ownerUserDetails(u.id);$('ownerNotifForm').onsubmit=async e=>{e.preventDefault();const data={title:$('ownerNotifTitle').value.trim(),message:$('ownerNotifMessage').value.trim(),read:false,createdAt:new Date().toISOString()};if(cloudReady)await cloudDb.ref(`userNotifications/${u.id}`).push(data);await ownerLog('Notificação enviada',u.email||u.id);toast('Notificação enviada.');ownerUserDetails(u.id)}}
function ownerPaymentsPanel(){
  const panel=$('ownerPanel');panel.innerHTML=`<div class="owner-title-row"><div><h3>Pagamentos</h3><p>Confirmações Pix e histórico</p></div><button id="ownerExportPayments" class="owner-small-btn">Exportar CSV</button></div><div class="owner-toolbar"><input id="ownerPaymentSearch" placeholder="Pesquisar cliente ou ID"><select id="ownerPaymentFilter"><option value="all">Todos</option><option value="pending">Pendentes</option><option value="approved">Aprovados</option><option value="rejected">Recusados</option></select></div><div id="ownerPaymentsList" class="owner-list"></div>`;
  const draw=()=>{const q=$('ownerPaymentSearch').value.toLowerCase(),f=$('ownerPaymentFilter').value;let list=[...(state.payments||[])].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));list=list.filter(p=>{const u=(state.users||[]).find(x=>x.id===p.userId)||{};return(!q||[p.id,p.userId,u.name,u.email,p.payerEmail].join(' ').toLowerCase().includes(q))&&(f==='all'||String(p.status||'pending').toLowerCase()===f)});$('ownerPaymentsList').innerHTML=list.length?list.map(p=>ownerPaymentCard(p)).join(''):'<div class="owner-empty">Nenhum pagamento encontrado.</div>';document.querySelectorAll('[data-owner-approve]').forEach(b=>b.onclick=()=>approvePayment(b.dataset.ownerApprove));document.querySelectorAll('[data-owner-reject]').forEach(b=>b.onclick=()=>rejectPayment(b.dataset.ownerReject))};$('ownerPaymentSearch').oninput=draw;$('ownerPaymentFilter').onchange=draw;$('ownerExportPayments').onclick=exportPaymentsCSV;draw();
}
function ownerPaymentCard(p){const u=(state.users||[]).find(x=>x.id===p.userId)||{},status=String(p.status||'pending').toLowerCase();return `<article class="owner-payment-card"><div><b>${escapeHtml(u.name||p.payerName||'Cliente')}</b><span>${escapeHtml(u.email||p.payerEmail||'')}</span><small>ID: ${escapeHtml(p.id||'')} • ${ownerDate(p.createdAt)}</small></div><div class="owner-payment-value"><strong>${money(ownerPaymentValue(p))}</strong><em class="status-${status==='approved'?'premium':status}">${status}</em></div>${status==='pending'?`<div class="owner-payment-actions"><button data-owner-approve="${p.id}" class="primary">Aprovar</button><button data-owner-reject="${p.id}" class="danger-button">Recusar</button></div>`:''}</article>`}
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
