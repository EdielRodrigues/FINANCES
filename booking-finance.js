(() => {
'use strict';
const MAX=4, KEY='fia_booking_cache_v2', TIMES=['08:00','09:30','11:00','13:30','15:00','16:30','18:00'];
let cursor=new Date(), selected='', items={}, ref=null, listener=null, listFilter='upcoming', searchTerm=''; cursor.setDate(1);
const $=id=>document.getElementById(id), pad=n=>String(n).padStart(2,'0'), iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const uid=()=>state?.user?.id||cloudAuth?.currentUser?.uid||'', phone=v=>String(v||'').replace(/\D/g,'');
const esc=v=>typeof escapeHtml==='function'?escapeHtml(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const path=()=>uid()?`finance/${uid()}/appointments`:'';
const ckey=()=>`${KEY}_${uid()||'guest'}`;
const todayIso=()=>iso(new Date());
const tomorrowIso=()=>{const d=new Date();d.setDate(d.getDate()+1);return iso(d)};
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
function read(){try{return JSON.parse(localStorage.getItem(ckey())||'{}')}catch{return {}}}
function cache(){try{localStorage.setItem(ckey(),JSON.stringify(items))}catch{}}
function activeItems(){return Object.values(items).filter(x=>x.status!=='cancelled')}
function dayItems(date){return activeItems().filter(x=>x.date===date)}
function free(date){return Math.max(0,MAX-dayItems(date).length)}
function bid(){return `AG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,7).toUpperCase()}`}
function listen(){items=read();if(ref&&listener)try{ref.off('value',listener)}catch{};if(!cloudReady||!cloudDb||!path())return;ref=cloudDb.ref(path());listener=ref.on('value',s=>{items=s.val()||{};cache();refreshAll()})}
async function save(x){items[x.id]=x;cache();if(cloudReady&&cloudDb&&path())await cloudDb.ref(`${path()}/${x.id}`).set(x);refreshAll()}
async function del(id){delete items[id];cache();if(cloudReady&&cloudDb&&path())await cloudDb.ref(`${path()}/${id}`).remove();refreshAll()}
function stateDay(date){const d=new Date(date+'T12:00:00'),t=new Date();t.setHours(0,0,0,0);if(d<t)return'unavailable';const f=free(date);return f===0?'full':f===MAX?'free':'partial'}
function statusLabel(s){return ({confirmed:'Confirmado',waiting:'Aguardando',completed:'Concluído',missed:'Faltou',cancelled:'Cancelado'})[s]||'Confirmado'}
function statusClass(s){return `st-${s||'confirmed'}`}
function refreshAll(){renderCal();renderStats();renderList()}
function renderCal(){const el=$('financeBookingCalendar');if(!el)return;const y=cursor.getFullYear(),m=cursor.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0);$('financeBookingMonthTitle').textContent=cursor.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});let h='';for(let i=0;i<first.getDay();i++)h+='<div class="fia-booking-day empty"></div>';for(let d=1;d<=last.getDate();d++){const dt=iso(new Date(y,m,d)),used=dayItems(dt).length,f=free(dt),st=stateDay(dt),dis=st==='full'||st==='unavailable';h+=`<button type="button" class="fia-booking-day ${st}${selected===dt?' selected':''}" data-d="${dt}" ${dis?'disabled':''}><strong>${d}${dayItems(dt).some(x=>x.vip)?" 👑":""}</strong><span>${st==='unavailable'?'Indisponível':st==='full'?'Lotado':`${f} vaga${f===1?'':'s'}`}</span><small>${st==='unavailable'?'—':`${used}/${MAX}`}</small></button>`}el.innerHTML=h;el.querySelectorAll('[data-d]:not([disabled])').forEach(b=>b.onclick=()=>selectDate(b.dataset.d))}
function selectDate(d){selected=d;renderCal();$('financeBookingFormArea').classList.remove('hidden');$('financeBookingSelectedDate').textContent=`Reserva para ${new Date(d+'T12:00:00').toLocaleDateString('pt-BR')}`;const used=new Set(dayItems(d).map(x=>x.time));$('financeBookingTime').innerHTML=TIMES.filter(t=>!used.has(t)).map(t=>`<option>${t}</option>`).join('');$('financeBookingFormArea').scrollIntoView({behavior:'smooth',block:'nearest'})}
function renderStats(){if(!$('bookingStatToday'))return;const all=activeItems(),today=todayIso(),tom=tomorrowIso();const monthPrefix=iso(cursor).slice(0,7);const month=all.filter(x=>(x.date||'').startsWith(monthPrefix));$('bookingStatToday').textContent=all.filter(x=>x.date===today&&x.status!=='completed'&&x.status!=='missed').length;$('bookingStatTomorrow').textContent=all.filter(x=>x.date===tom&&x.status!=='completed'&&x.status!=='missed').length;$('bookingStatMonth').textContent=month.length;$('bookingStatValue').textContent=money(month.reduce((s,x)=>s+Number(x.value||0),0))}
function matchesFilter(x){
  const q=searchTerm.toLowerCase();
  const hay=`${x.clientName||''} ${x.phone||''} ${x.id||''} ${x.service||''} ${x.date||''}`.toLowerCase();
  if(q&&!hay.includes(q))return false;
  const today=todayIso();
  if(listFilter==='today')return x.date===today&&x.status!=='cancelled';
  if(listFilter==='completed')return x.status==='completed';
  if(listFilter==='missed')return x.status==='missed';
  if(listFilter==='cancelled')return x.status==='cancelled';
  if(listFilter==='all')return true;
  return (x.date||'')>=today&&x.status!=='completed'&&x.status!=='missed'&&x.status!=='cancelled';
}
function vipDates(x,f){const base=new Date(x.date+'T12:00:00'),out=[];for(let i=0;i<(f==='monthly'?12:f==='weekly'?52:26);i++){const d=new Date(base);if(f==='monthly'){d.setDate(1);d.setMonth(base.getMonth()+i);d.setDate(Math.min(base.getDate(),new Date(d.getFullYear(),d.getMonth()+1,0).getDate()))}else d.setDate(base.getDate()+i*(f==='weekly'?7:14));out.push(iso(d))}return out}
async function makeVip(id){const x=items[id];if(!x||x.vip||x.status!=='confirmed'||x.date<todayIso())return;const f=({'1':'weekly','2':'biweekly','3':'monthly'})[prompt('VIP: 1 semanal, 2 quinzenal (14 dias), 3 mensal','1')];if(!f)return;const dates=vipDates(x,f);if(!confirm('Confirmar '+dates.length+' reservas VIP por aproximadamente um ano?'))return;const changes={};for(const d of dates){const k=d===x.date?id:id+'-VIP-'+d;changes[k]={...x,id:k,date:d,vip:f,vipGroup:id,updatedAt:Date.now()}}const apply=current=>{current=current||{};if(!current[id]||current[id].vip||current[id].status!=='confirmed')return;for(const d of dates){const used=Object.values(current).filter(a=>a.id!==id&&a.date===d&&a.status!=='cancelled');if(used.length>=MAX||used.some(a=>a.time===x.time))return}return {...current,...changes}};if(cloudReady&&cloudDb&&path()){const result=await cloudDb.ref(path()).transaction(apply);if(!result.committed)return toast('Conflito de vagas ou horários. Nenhuma reserva criada.');items=result.snapshot.val()||{}}else{const next=apply(items);if(!next)return toast('Conflito de vagas ou horários.');items=next}cache();refreshAll();toast('Reservas VIP confirmadas.')}
function renderList(){
  const el=$('financeBookingList');if(!el)return;
  const list=Object.values(items).filter(matchesFilter).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const groups=new Map();Object.values(items).filter(x=>x.vip&&x.date>=todayIso()&&x.status==='confirmed').sort((a,b)=>a.date.localeCompare(b.date)).forEach(x=>{if(!groups.has(x.vipGroup))groups.set(x.vipGroup,x)});const fixed=listFilter==='upcoming'?Array.from(groups.values()).filter(matchesFilter):[];const shown=[...fixed,...list.filter(x=>!fixed.some(v=>v.id===x.id))];
  el.innerHTML=shown.length?shown.map(x=>`
    <article class="fia-booking-record ${statusClass(x.status)}">
      <div class="fia-booking-record-main">
        <div class="fia-booking-record-top">
          <b>${x.vip?"👑 VIP "+({weekly:"semanal",biweekly:"quinzenal",monthly:"mensal"})[x.vip]+" • ":""}${esc(x.clientName)}</b>
          <span class="fia-booking-status ${statusClass(x.status)}">${statusLabel(x.status)}</span>
        </div>
        <span>${new Date(x.date+'T12:00:00').toLocaleDateString('pt-BR')} • ${esc(x.time)}</span>
        <small>ID: ${esc(x.id)}</small>
        <small>📱 ${esc(x.phone)}${x.service?' • '+esc(x.service):''}</small>
        ${Number(x.value||0)>0?`<small>💰 ${money(x.value)}</small>`:''}
        ${x.notes?`<small>📝 ${esc(x.notes)}</small>`:''}
      </div>
      <div class="fia-booking-record-actions">
        ${x.status!=='cancelled'?`<button class="secondary" data-edit="${x.id}">Editar</button>`:''}
        <button class="secondary" data-wa="${x.id}">WhatsApp</button>
        ${!x.vip&&x.status==='confirmed'&&x.date>=todayIso()?`<button class="secondary" data-vip="${x.id}">👑 Agendar VIP</button>`:''}
        ${x.status!=='completed'&&x.status!=='cancelled'?`<button class="success-button" data-status="completed" data-id="${x.id}">Concluir</button>`:''}
        ${x.status!=='cancelled'?`<button class="booking-cancel-button" data-cancel="${x.id}">Cancelar</button>`:''}
        <button class="danger-button booking-delete-button" data-delete="${x.id}">🗑 Excluir</button>
      </div>
    </article>`).join(''):'<div class="empty-state">Nenhum agendamento encontrado.</div>';

  el.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{
    const x=items[b.dataset.cancel];if(!x)return;
    if(!confirm('Cancelar este agendamento? Ele ficará no histórico como cancelado.'))return;
    await save({...x,status:'cancelled',cancelledAt:Date.now(),updatedAt:Date.now()});
    toast('Agendamento cancelado e mantido no histórico.');
  });

  el.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{
    const x=items[b.dataset.delete];if(!x)return;
    if(!confirm(`Excluir definitivamente o agendamento de ${x.clientName||'este cliente'}?`))return;
    if(x.vipGroup&&confirm('Excluir também todas as reservas futuras deste VIP?')){const ids=Object.values(items).filter(a=>a.vipGroup===x.vipGroup&&a.date>=todayIso()).map(a=>a.id);if(!ids.includes(x.id))ids.push(x.id);if(cloudReady&&cloudDb&&path())await cloudDb.ref(path()).update(Object.fromEntries(ids.map(k=>[k,null])));ids.forEach(k=>delete items[k]);cache();refreshAll()}else await del(b.dataset.delete);
    toast('Agendamento excluído definitivamente.');
  });

  el.querySelectorAll('[data-vip]').forEach(b=>b.onclick=()=>makeVip(b.dataset.vip).catch(()=>toast('Erro ao salvar VIP.')));
  el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.edit));
  el.querySelectorAll('[data-wa]').forEach(b=>b.onclick=()=>shareWhatsApp(b.dataset.wa));
  el.querySelectorAll('[data-status]').forEach(b=>b.onclick=async()=>{
    const x=items[b.dataset.id];if(!x)return;
    await save({...x,status:b.dataset.status,updatedAt:Date.now()});
    toast(b.dataset.status==='completed'?'Agendamento concluído.':'Marcado como falta.');
  });
}
function shareWhatsApp(id){
 const x=items[id];if(!x)return;
 const p=phone(x.phone),n=p.length>=12&&p.startsWith('55')?p:'55'+p;
 if(!/^55[0-9]{10,11}$/.test(n))return toast('Telefone inválido.');
 const fmt=d=>new Date(d+'T12:00:00').toLocaleDateString('pt-BR');
 const lines=['*📋 '+(x.status==='cancelled'?'CANCELAMENTO DE AGENDAMENTO':x.status==='completed'?'ATENDIMENTO CONCLUÍDO':'DADOS DO AGENDAMENTO')+'*','',`Olá, ${x.clientName}!`,'━━━━━━━━━━━━━━━━━','*👤 DADOS DO CLIENTE*',`Nome: ${x.clientName}`,`Telefone: ${x.phone}`,'','*📅 DADOS DA RESERVA*',`Data: ${fmt(x.date)}`,`Horário: ${x.time}`];
 if(x.service)lines.push(`Serviço: ${x.service}`);if(Number(x.value)>0)lines.push(`Valor: ${money(x.value)}`);lines.push(`Status: ${statusLabel(x.status)}`,`ID: ${x.id}`);
 if(x.vip){lines.push('', '*👑 CLIENTE VIP*',`Frequência: ${{weekly:'Semanal',biweekly:'Quinzenal (14 dias)',monthly:'Mensal'}[x.vip]}`);const next=Object.values(items).filter(a=>a.vipGroup===x.vipGroup&&a.date>x.date&&a.date>=todayIso()&&['confirmed','waiting'].includes(a.status)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4);if(next.length){lines.push('','*📆 PRÓXIMOS ATENDIMENTOS*');next.forEach(a=>lines.push(`• ${fmt(a.date)} — ${a.time}`))}}
 lines.push('━━━━━━━━━━━━━━━━━','Agradecemos pela preferência!','*FINANCE IA PRO*');
 location.href=`intent://send?phone=${n}&text=${encodeURIComponent(lines.join('\n'))}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end`;
}
function edit(id){const x=items[id];if(!x)return;openModal(`<h2>Editar agendamento</h2><form id="be" class="form-grid"><label>Cliente<input id="ben" value="${esc(x.clientName)}" required></label><label>Telefone<input id="bep" value="${esc(x.phone)}" required></label><label>Data<input id="bed" type="date" value="${x.date}" required></label><label>Horário<input id="bet" type="time" value="${x.time}" required></label><label>Serviço<input id="bes" value="${esc(x.service||'')}"></label><label>Valor<input id="bev" inputmode="decimal" value="${Number(x.value||0).toFixed(2).replace('.',',')}"></label><label>Status<select id="best"><option value="confirmed" ${x.status==='confirmed'?'selected':''}>Confirmado</option><option value="waiting" ${x.status==='waiting'?'selected':''}>Aguardando</option><option value="completed" ${x.status==='completed'?'selected':''}>Concluído</option><option value="missed" ${x.status==='missed'?'selected':''}>Falta anterior</option><option value="cancelled" ${x.status==='cancelled'?'selected':''}>Cancelado</option></select></label><label>Observações<textarea id="beo">${esc(x.notes||'')}</textarea></label><button class="primary">Salvar</button></form>`);if(typeof enableLiveMoneyMask==='function')enableLiveMoneyMask($('bev'));$('be').onsubmit=async e=>{e.preventDefault();const nd=$('bed').value;if(dayItems(nd).filter(i=>i.id!==id).length>=MAX)return toast('Esse dia já possui 4 reservas.');await save({...x,clientName:$('ben').value.trim(),phone:phone($('bep').value),date:nd,time:$('bet').value,service:$('bes').value.trim(),value:typeof moneyInputValue==='function'?(moneyInputValue($('bev'))||0):Number(String($('bev').value).replace(',','.'))||0,status:$('best').value,notes:$('beo').value.trim(),updatedAt:Date.now()});closeModal();openBooking();toast('Agendamento atualizado.')}}
function openBooking(){if(typeof canUsePremiumApp==='function'&&!canUsePremiumApp())return paymentModal();listen();openModal(`<div class="fia-booking-shell"><div class="fia-booking-title"><small>AGENDA FINANCE IA PRO</small><h2>📅 Agendamento / Reserva</h2><p>Agenda profissional com até 4 clientes por dia, calendário inteligente, status, pesquisa e WhatsApp.</p></div><div class="fia-booking-stats"><div><span>Hoje</span><strong id="bookingStatToday">0</strong></div><div><span>Amanhã</span><strong id="bookingStatTomorrow">0</strong></div><div><span>No mês</span><strong id="bookingStatMonth">0</strong></div><div><span>Valor previsto</span><strong id="bookingStatValue">R$ 0,00</strong></div></div><div class="fia-booking-month-nav"><button id="financeBookingPrev">‹</button><strong id="financeBookingMonthTitle"></strong><button id="financeBookingNext">›</button></div><div class="fia-booking-legend"><span><i class="free"></i>4 vagas</span><span><i class="partial"></i>Algumas vagas</span><span><i class="full"></i>Lotado</span><span><i class="unavailable"></i>Indisponível</span></div><div class="fia-booking-week"><span>DOM</span><span>SEG</span><span>TER</span><span>QUA</span><span>QUI</span><span>SEX</span><span>SÁB</span></div><div id="financeBookingCalendar" class="fia-booking-calendar"></div><section id="financeBookingFormArea" class="fia-booking-form-card hidden"><h3 id="financeBookingSelectedDate">Nova reserva</h3><form id="financeBookingForm" class="form-grid"><label>Nome do cliente<input id="financeBookingName" required></label><label>Telefone / WhatsApp<input id="financeBookingPhone" required></label><label>Horário<select id="financeBookingTime" required></select></label><label>Serviço<input id="financeBookingService"></label><label>Valor previsto<input id="financeBookingValue" inputmode="decimal" placeholder="0,00"></label><label>Observações<textarea id="financeBookingNotes"></textarea></label><button class="primary">Confirmar agendamento</button></form></section><section class="fia-booking-list-card"><div class="panel-head fia-booking-list-head"><div><h3>Meus agendamentos</h3><small>Lista sincronizada em tempo real</small></div><span>Firebase + cache local</span></div><div class="fia-booking-tools"><input id="financeBookingSearch" type="search" placeholder="🔎 Nome, telefone, ID ou serviço"><select id="financeBookingFilter"><option value="upcoming">Próximos</option><option value="today">Hoje</option><option value="completed">Concluídos</option><option value="cancelled">Cancelados</option><option value="all">Todos</option></select></div><div id="financeBookingList"></div></section></div>`);cursor=new Date();cursor.setDate(1);selected='';listFilter='upcoming';searchTerm='';$('financeBookingPrev').onclick=()=>{cursor.setMonth(cursor.getMonth()-1);refreshAll()};$('financeBookingNext').onclick=()=>{cursor.setMonth(cursor.getMonth()+1);refreshAll()};$('financeBookingSearch').oninput=e=>{searchTerm=e.target.value.trim();renderList()};$('financeBookingFilter').onchange=e=>{listFilter=e.target.value;renderList()};if(typeof enableLiveMoneyMask==='function')enableLiveMoneyMask($('financeBookingValue'));$('financeBookingForm').onsubmit=async e=>{e.preventDefault();if(!selected)return toast('Escolha uma data.');if(free(selected)<=0)return toast('Dia lotado.');const p=phone($('financeBookingPhone').value),tm=$('financeBookingTime').value;if(p.length<10)return toast('Telefone inválido.');if(dayItems(selected).some(x=>x.time===tm))return toast('Horário já reservado.');const x={id:bid(),userId:uid(),clientName:$('financeBookingName').value.trim(),phone:p,date:selected,time:tm,service:$('financeBookingService').value.trim(),value:typeof moneyInputValue==='function'?(moneyInputValue($('financeBookingValue'))||0):0,notes:$('financeBookingNotes').value.trim(),status:'confirmed',createdAt:Date.now()};await save(x);selected='';$('financeBookingFormArea').classList.add('hidden');e.target.reset();toast(`Agendamento confirmado. ID: ${x.id}`)};refreshAll()}
function bind(){const b=$('bookingBtn');if(b&&!b.dataset.bound){b.dataset.bound='1';b.onclick=openBooking}}
document.addEventListener('DOMContentLoaded',bind);setTimeout(bind,300);window.openFinanceBooking=openBooking;
})();
