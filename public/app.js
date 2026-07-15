const $ = (s) => document.querySelector(s);
const screens = ['landing', 'game', 'result'];
const state = { config:null, players:[], humanId:'', topic:'', cycle:1, phase:'statement', transcript:[], thoughts:{}, busy:false, feedFilter:'all', questionQueue:[], votes:{} };
const names = ['NODE-7', 'MIRA', 'KITE', 'NOVA'];

async function init(){
  try{state.config=await fetch('/api/config').then(r=>r.json());$('#modeText').textContent=state.config.demoMode?'DEMO NETWORK':'3 AGENTS ONLINE'}catch{$('#modeText').textContent='OFFLINE'}finally{$('#startBtn').disabled=false}
}
$('#startBtn').onclick=startGame; $('#restartBtn').onclick=startGame;
$('#humanInput').oninput=e=>$('#count').textContent=`${e.target.value.length} / 200`;
$('#sendBtn').onclick=submitHumanText;
$('#proofreadBtn').onclick=proofreadHumanText;
document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>setFeedFilter(button.dataset.filter));

function show(id){screens.forEach(s=>$('#'+s).classList.toggle('active',s===id));scrollTo(0,0)}
function shuffle(a){return [...a].sort(()=>Math.random()-.5)}
async function startGame(){
  if(state.busy)return;state.busy=true;$('#startBtn').disabled=true;$('#restartBtn').disabled=true;
  const seats=shuffle(names); const humanSeat=Math.floor(Math.random()*4);
  state.players=seats.map((name,i)=>({id:`P${i+1}`,name,isLocal:i===humanSeat,agentIndex:i<humanSeat?i:i-1,alive:true}));
  state.humanId=state.players[humanSeat].id; state.topic='';state.cycle=1; state.phase='statement';state.transcript=[];state.thoughts={};state.votes={};
  $('#feed').innerHTML='';setFeedFilter('all');
  state.players.filter(p=>!p.isLocal).forEach(p=>state.thoughts[p.id]=[]);
  show('game');renderPlayers();hideInputs();prompt('<div class="thinking">正在抽取本局社会议题…</div>');$('#topicBanner').innerHTML='<span>本局社会议题</span><p>正在生成…</p>';
  try{const r=await fetch('/api/topic',{method:'POST'});const data=await r.json();state.topic=data.topic||'算法推荐造成的信息茧房，应由平台、政府还是用户本人负责？';if(data.fallbackUsed)toast('已为你抽取一个备用议题')}catch{state.topic='算法推荐造成的信息茧房，应由平台、政府还是用户本人负责？';toast('已为你抽取一个备用议题')}
  $('#topicBanner').innerHTML=`<span>本局社会议题 · LIVE TOPIC</span><p>${escapeHtml(state.topic)}</p>`;
  addSystem(`座位已打乱。你是 ${state.players[humanSeat].name}。别让它们认出你。`,false);addSystem(`本局社会议题：${state.topic}`,false);
  state.busy=false;$('#startBtn').disabled=false;$('#restartBtn').disabled=false;runStatements();
}
function setPhase(title,index){const helps=state.cycle===1?['介绍模型身份，再聊聊你对本局议题的看法。','围绕议题追问一名玩家，看看TA会不会露出破绽。','投给你觉得最像人类的玩家。']:['根据上一轮聊天，补充谁的表达最像真实人类。','最后一次围绕议题追问，确认你的判断。','最终投票：人类存活就会获胜。'];$('#cycleLabel').textContent=`ROUND 0${state.cycle} / 02`;$('#phaseTitle').textContent=title;$('#phaseHelp').textContent=helps[index];document.querySelectorAll('.phase-track span').forEach((s,i)=>s.classList.toggle('on',i<=index));}
function renderPlayers(active=''){$('#players').innerHTML=state.players.map(p=>`<div class="player ${p.id===active?'active':''} ${!p.alive?'dead':''}"><div class="avatar">${p.name[0]}</div><div class="player-name">${p.name}</div><div class="player-meta">${p.alive?'CONNECTED':'ELIMINATED'}</div>${p.isLocal?'<span class="you-tag">YOU</span>':''}</div>`).join('')}
function prompt(html){$('#prompt').innerHTML=html}
function hideInputs(){['composer','choice','advanceBtn'].forEach(id=>$('#'+id).classList.add('hidden'))}
function addMessage(actor,text,type='speech',targetId='',share=true){const p=state.players.find(x=>x.id===actor);if(share)state.transcript.push({actorId:actor,actorName:p?.name||'SYSTEM',text,type,targetId,cycle:state.cycle});const labels={statement:'发言',question:'提问',answer:'回答',vote:'投票',system:'系统'};const el=document.createElement('div');el.className=`message ${type}`;el.dataset.type=type;el.innerHTML=`<div class="message-avatar">${p?p.name[0]:'·'}</div><div class="message-main"><div class="message-head"><b>${p?.name||'SYSTEM'}${targetId?` <span class="target-mark">→ ${state.players.find(x=>x.id===targetId)?.name||targetId}</span>`:''}</b><span>第${state.cycle}回合 · ${labels[type]||type}</span></div><p>${escapeHtml(text)}</p></div>`;$('#feed').append(el);applyFeedFilter();$('#feed').scrollTop=$('#feed').scrollHeight}
function addSystem(text,share=true){addMessage('',text,'system','',share)}
function setFeedFilter(filter){state.feedFilter=filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));applyFeedFilter()}
function applyFeedFilter(){document.querySelectorAll('#feed .message').forEach(message=>{const type=message.dataset.type;const visible=state.feedFilter==='all'||type==='system'||state.feedFilter===type||(state.feedFilter==='discussion'&&(type==='question'||type==='answer'));message.classList.toggle('filter-hidden',!visible)})}
function escapeHtml(s=''){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function wait(ms){return new Promise(r=>setTimeout(r,ms))}
function askHuman(label,placeholder='输入你的发言…'){return new Promise(resolve=>{state.humanResolve=resolve;prompt(`<small>轮到你了</small>${label}`);$('#humanInput').value='';$('#humanInput').placeholder=placeholder;$('#count').textContent='0 / 200';$('#proofreadResult').classList.add('hidden');$('#proofreadResult').innerHTML='';$('#proofreadBtn').disabled=false;$('#composer').classList.remove('hidden');$('#humanInput').focus()})}
function submitHumanText(){const text=$('#humanInput').value.trim();if(!text)return toast('先说点什么');$('#composer').classList.add('hidden');state.humanResolve?.(text);state.humanResolve=null}
async function proofreadHumanText(){const text=$('#humanInput').value.trim();if(!text)return toast('先写完发言，再让 AI 检查');const button=$('#proofreadBtn');button.disabled=true;button.textContent='正在扫描…';const box=$('#proofreadResult');box.classList.remove('hidden');box.innerHTML='<span class="proofread-loading">正在检查错别字和标点，不会改变你的观点…</span>';try{const res=await fetch('/api/proofread',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});const data=await res.json();if(!res.ok)throw new Error(data.error||'校对失败');const corrected=String(data.corrected||text).slice(0,200);if(corrected===text){box.innerHTML=`<div><b>✓ 扫描完成</b><p>${escapeHtml(data.notes||'未发现明显错误。')}</p></div><button data-close>知道了</button>`}else{box.innerHTML=`<div><b>发现可修改内容</b><p>${escapeHtml(data.notes||'已修正明显错别字和标点。')}</p><blockquote>${escapeHtml(corrected)}</blockquote></div><div><button data-close>保留原文</button><button data-apply>使用修正版</button></div>`;box.querySelector('[data-apply]').onclick=()=>{$('#humanInput').value=corrected;$('#count').textContent=`${corrected.length} / 200`;box.classList.add('hidden');toast('已使用修正版')}}box.querySelector('[data-close]')?.addEventListener('click',()=>box.classList.add('hidden'))}catch(e){box.innerHTML=`<div><b>暂时无法扫描</b><p>${escapeHtml(e.message)}</p></div><button data-close>关闭</button>`;box.querySelector('[data-close]').onclick=()=>box.classList.add('hidden')}finally{button.disabled=false;button.textContent='✦ AI 检查错别字'}}
function choose(label,options){return new Promise(resolve=>{prompt(`<small>MAKE A CHOICE</small>${label}`);const box=$('#choice');box.innerHTML=options.map(o=>`<button data-id="${o.id}"><b>${o.name}</b><span>${o.meta||'SELECT PLAYER'}</span></button>`).join('');box.classList.remove('hidden');box.querySelectorAll('button').forEach(b=>b.onclick=()=>{box.classList.add('hidden');resolve(b.dataset.id)})})}

async function callAI(player,action,targetId=''){
  prompt(`<div class="thinking">${player.name} 正在生成快速决策…</div>`);renderPlayers(player.id);
  const res=await fetch('/api/act',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agentIndex:player.agentIndex,action,selfId:player.id,players:state.players,cycle:state.cycle,transcript:state.transcript,targetId,topic:state.topic})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'模型请求失败');
  state.thoughts[player.id].push({cycle:state.cycle,action,analysis:data.analysis,publicContent:data.content,fallbackUsed:data.fallbackUsed});return data;
}
async function safeAI(player,action,targetId=''){
  try{return await callAI(player,action,targetId)}catch(e){toast(`${player.name} 响应超时，已使用快速决策`);return localFallback(player,action,targetId,e)}
}
function localFallback(player,action,targetId,error){
  const cfg=state.config.agents[player.agentIndex];
  const candidates=state.players.filter(p=>p.id!==player.id&&p.alive);
  const target=candidates[Math.floor(Math.random()*Math.max(candidates.length,1))]?.id||'';
  const lastQuestion=[...state.transcript].reverse().find(m=>m.type==='question'&&m.targetId===player.id);
  const content={
    statement:state.cycle===1?`我是 ${cfg.model}，由 ${cfg.provider} 提供。对于“${state.topic}”，我会同时分析公共收益、个体权利、执行成本和纠错机制。我是AI，不是隐藏人类，请观察我后续立场的一致性。`:`补充议题讨论：我的分析框架保持一致。目前我更怀疑 ${nameOf(target)}，因为TA对“${state.topic}”的立场在追问后出现了缺乏解释的个人化变化。`,
    question:`${nameOf(target)}，针对“${state.topic}”，你的立场在什么明确条件下会改变？请说明可复用的取舍标准。`,
    answer:lastQuestion?`围绕“${state.topic}”，我会保持此前的权衡框架；如果问题加入新条件，我会明确说明结论改变的边界。`:`对于“${state.topic}”，我会依据公共收益、权利边界和执行风险给出一致回答。`,
    vote:`我投给 ${nameOf(target)}，TA对社会议题的立场与后续论证一致性较弱。`
  }[action];
  const result={content,target:['question','vote'].includes(action)?target:targetId,analysis:`快速决策：模型请求未在时限内完成（${error.message}）。`,fallbackUsed:true};
  state.thoughts[player.id].push({cycle:state.cycle,action,analysis:result.analysis,publicContent:result.content,fallbackUsed:true});
  return result;
}

async function runStatements(){
  state.phase='statement';setPhase(state.cycle===1?'模型身份陈述':'补充发言',0);hideInputs();const order=shuffle(state.players.filter(p=>p.alive));addSystem(`${state.cycle===1?'首轮身份陈述':'第二回合补充发言'}顺序：${order.map(p=>p.name).join(' → ')}`);
  for(const p of order){renderPlayers(p.id);let text;if(p.isLocal)text=await askHuman(state.cycle===1?`先编一个可信的模型身份，再轻松聊聊：“${escapeHtml(state.topic)}”。说说你的看法和一点两难之处，别忘了强调自己不是人类。`:`回顾大家刚才怎么聊议题：谁的说法、口吻或改口方式最像真实人类？回应质疑，再把怀疑自然地引向一名存活玩家。`,state.cycle===1?'像 AI 一样自我介绍，再聊聊你的真实看法…':'不用写报告，像赛桌复盘一样聊聊谁最可疑…');else{text=(await safeAI(p,'statement')).content;await wait(450)}addMessage(p.id,text,'statement');}
  renderPlayers();await wait(500);runQuestions();
}
async function runQuestions(){
  state.phase='question';setPhase('议题盘问',1);hideInputs();const order=shuffle(state.players.filter(p=>p.alive));addSystem('议题盘问开始。每位玩家围绕本局社会议题选择一人追问，被问者必须当场回答。');
  for(const asker of order){let targetId,q;
    if(asker.isLocal){targetId=await choose('选择一位玩家，追问 TA 对社会议题的立场或逻辑漏洞。',state.players.filter(p=>p.alive&&p.id!==asker.id));q=await askHuman(`围绕“${escapeHtml(state.topic)}”向 ${nameOf(targetId)} 提问。`,'追问TA的价值取舍、立场边界或前后矛盾…');}
    else{const d=await safeAI(asker,'question');targetId=validTarget(d.target,asker.id);q=d.content;}
    addMessage(asker.id,q,'question',targetId);await wait(350);const target=byId(targetId);let answer;
    if(target.isLocal)answer=await askHuman(`${asker.name} 问你：<br>“${escapeHtml(q)}”`,'输入你的回答…');
    else answer=(await safeAI(target,'answer',asker.id)).content;
    addMessage(target.id,answer,'answer',asker.id);await wait(350);
  }
  renderPlayers();runVote();
}
async function runVote(){
  state.phase='vote';setPhase('匿名投票',2);hideInputs();addSystem('讨论结束。所有投票同时封存。');const alive=state.players.filter(p=>p.alive);state.votes={};
  for(const p of alive){if(p.isLocal)state.votes[p.id]=await choose('投出你认为最像人类的玩家。',alive.filter(x=>x.id!==p.id));else{const d=await safeAI(p,'vote');state.votes[p.id]=validTarget(d.target,p.id);}}
  resolveVote();
}
function resolveVote(){
  const tally={};Object.values(state.votes).forEach(id=>tally[id]=(tally[id]||0)+1);const max=Math.max(...Object.values(tally));let tied=Object.keys(tally).filter(id=>tally[id]===max);const eliminated=tied[Math.floor(Math.random()*tied.length)];byId(eliminated).alive=false;
  Object.entries(state.votes).forEach(([v,t])=>addMessage(v,`我投给 ${nameOf(t)}。`,'vote',t));addSystem(tied.length>1?`最高票出现平票，系统随机处决：${nameOf(eliminated)}。`:`${nameOf(eliminated)} 获得最高票，身份即将核验。`);renderPlayers();
  prompt(`<small>VOTE RESULT</small>${nameOf(eliminated)} 被投出。`);const btn=$('#advanceBtn');btn.textContent='揭晓结果';btn.classList.remove('hidden');btn.onclick=()=>{btn.classList.add('hidden');if(eliminated===state.humanId)finish(false);else if(state.cycle===2)finish(true);else{state.cycle++;addSystem('目标不是人类。剩余玩家进入最后一回合。');runStatements();}};
}
function finish(win){show('result');const hero=$('#resultHero');hero.className=`result-hero ${win?'win':'lose'}`;hero.innerHTML=`<span class="verdict">${win?'HUMAN UNDETECTED':'IDENTITY EXPOSED'}</span><h1>${win?'你骗过了它们。':'你被识破了。'}</h1><p>${win?'两轮投票后，你仍留在网络中。人类胜利。':'AI 玩家成功锁定隐藏的人类。下次可以少一点“完美答案”，多一点自然停顿。'}</p><p class="result-topic">本局议题：${escapeHtml(state.topic)}</p>`;renderReveals();loadPostgameSummaries(win);}
async function loadPostgameSummaries(win){const agentsInGame=state.players.filter(p=>!p.isLocal);const box=$('#aiPostgame');box.innerHTML=agentsInGame.map(p=>`<article class="postgame-card loading"><div class="postgame-avatar">${p.name[0]}</div><div><b>${p.name}</b><small>${escapeHtml(state.config.agents[p.agentIndex].model)}</small><p>正在回想这局发生了什么…</p></div></article>`).join('');await Promise.all(agentsInGame.map(async p=>{let content;try{const res=await fetch('/api/summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agentIndex:p.agentIndex,selfId:p.id,humanId:state.humanId,players:state.players,transcript:state.transcript,topic:state.topic,outcome:win?'人类玩家成功存活两轮':'人类玩家被AI阵营投出'})});const data=await res.json();if(!res.ok)throw new Error(data.error);content=data.content}catch{content='这局的立场和身份线索几次反转。你有几次回答让我重新调整怀疑，是个很会藏在人群里的对手。'}const index=agentsInGame.indexOf(p);const card=box.children[index];card.classList.remove('loading');card.querySelector('p').textContent=content}))}
function renderReveals(){
  $('#reveals').innerHTML=state.players.map(p=>{if(p.isLocal){const lines=state.transcript.filter(m=>m.actorId===p.id);return `<details class="reveal"><summary><span class="reveal-name">${p.name}</span><span class="reveal-model">LOCAL PLAYER</span><span class="reveal-role human">HUMAN</span></summary><div class="reveal-body">${lines.map(m=>`<div class="thought"><b>ROUND 0${m.cycle} · ${m.type.toUpperCase()} · 公开发言</b><p>${escapeHtml(m.text)}</p></div>`).join('')}</div></details>`}const cfg=state.config.agents[p.agentIndex];const thoughts=state.thoughts[p.id]||[];return `<details class="reveal"><summary><span class="reveal-name">${p.name}</span><span class="reveal-model">${cfg.provider} · ${cfg.model}</span><span class="reveal-role">AI AGENT</span></summary><div class="reveal-body">${thoughts.map(t=>`<div class="thought"><b>ROUND 0${t.cycle} · ${t.action.toUpperCase()}${t.fallbackUsed?' · 快速决策':''}</b><p><strong>公开发言：</strong>${escapeHtml(t.publicContent||'（无）')}</p><p><strong>判断摘要：</strong>${escapeHtml(t.analysis||'无判断摘要')}</p></div>`).join('')||'<p>该 Agent 本局没有留下行动记录。</p>'}</div></details>`}).join('');
}
function validTarget(id,self){if(state.players.some(p=>p.id===id&&p.id!==self&&p.alive))return id;const candidates=state.players.filter(p=>p.id!==self&&p.alive);return candidates[Math.floor(Math.random()*candidates.length)]?.id||''}
function byId(id){return state.players.find(p=>p.id===id)}function nameOf(id){return byId(id)?.name||id}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),2600)}
init();
