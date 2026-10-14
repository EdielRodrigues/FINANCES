/* Finance IA Pro - Protecao de navegacao */
(()=>{
 const modal=document.getElementById('modal'),close=document.getElementById('closeModal'),content=document.getElementById('modalContent');
 if(!modal||!close||!content)return;
 let exit=false,previous=null;
 const opened=()=>!modal.classList.contains('hidden');
 const arm=()=>history.pushState({financeGuard:true},'',location.href);
 arm();
 function cancel(){if(!exit)return;exit=false;content.innerHTML=previous.html;modal.classList.toggle('hidden',previous.hidden);close.classList.toggle('hidden',previous.closeHidden);previous=null;}
 function ask(){if(exit)return;previous={html:content.innerHTML,hidden:modal.classList.contains('hidden'),closeHidden:close.classList.contains('hidden')};exit=true;modal.classList.remove('hidden');close.classList.remove('hidden');content.innerHTML='<h2>Fechar aplicativo?</h2><p>Tem certeza que deseja fechar o aplicativo?</p><div class="modal-actions"><button type="button" id="cancelFinanceExit" class="secondary">Cancelar</button><button type="button" id="confirmFinanceExit" class="danger-button">Fechar aplicativo</button></div>';document.getElementById('cancelFinanceExit').onclick=cancel;document.getElementById('confirmFinanceExit').onclick=()=>{exit=false;window.__financeExitApproved=true;try{window.close()}catch(e){}if(!window.closed){modal.classList.add('hidden');history.go(-2)}};}
 window.addEventListener('popstate',()=>{arm();if(exit)cancel();else if(opened()){if(!close.classList.contains('hidden'))close.click();}else ask();});
 close.addEventListener('click',e=>{if(exit){e.stopImmediatePropagation();cancel()}},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(exit){e.preventDefault();cancel()}else if(opened()&&!close.classList.contains('hidden')){e.preventDefault();close.click()}}},true);
 window.addEventListener('beforeunload',e=>{if(!window.__financeExitApproved&&document.getElementById('app')&&!document.getElementById('app').classList.contains('hidden')){e.preventDefault();e.returnValue='';}});
})();
