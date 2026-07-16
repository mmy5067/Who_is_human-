import { createGameState, resetGameState, resolveVotes, shuffle } from './game-state.js';

const $ = (selector) => document.querySelector(selector);
const screens = ['landing', 'game', 'result'];
const state = createGameState();
const fallbackTopic = '算法推荐造成的信息茧房，应由平台、政府还是用户本人负责？';

bindEvents();
init();

function bindEvents() {
  $('#startBtn').onclick = startGame;
  $('#restartBtn').onclick = startGame;
  $('#sendBtn').onclick = submitHumanText;
  $('#proofreadBtn').onclick = proofreadHumanText;
  $('#humanInput').oninput = (event) => {
    $('#count').textContent = `${event.target.value.length} / 200`;
  };
  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.onclick = () => setFeedFilter(button.dataset.filter);
  });
}

async function init() {
  try {
    state.config = await fetchJson('/api/config');
    $('#modeText').textContent = state.config.demoMode ? 'DEMO NETWORK' : '3 AGENTS ONLINE';
    $('#startBtn').disabled = false;
  } catch {
    $('#modeText').textContent = 'OFFLINE';
    $('#startBtn').disabled = true;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function postJson(url, body) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function startGame() {
  if (state.busy) return;
  setBusy(true);

  const humanPlayer = resetGameState(state);
  $('#feed').innerHTML = '';
  setFeedFilter('all');
  showScreen('game');
  renderPlayers();
  hideInputs();
  setPrompt('<div class="thinking">正在抽取本局社会议题…</div>');
  $('#topicBanner').innerHTML = '<span>本局社会议题</span><p>正在生成…</p>';

  try {
    const data = await fetchJson('/api/topic', { method: 'POST' });
    state.topic = data.topic || fallbackTopic;
    if (data.fallbackUsed) toast('已为你抽取一个备用议题');
  } catch {
    state.topic = fallbackTopic;
    toast('已为你抽取一个备用议题');
  }

  $('#topicBanner').innerHTML = `<span>本局社会议题 · LIVE TOPIC</span><p>${escapeHtml(state.topic)}</p>`;
  addSystem(`座位已打乱。你是 ${humanPlayer.name}。别让它们认出你。`, false);
  addSystem(`本局社会议题：${state.topic}`, false);
  setBusy(false);
  runStatements();
}

function setBusy(busy) {
  state.busy = busy;
  $('#startBtn').disabled = busy;
  $('#restartBtn').disabled = busy;
}

function showScreen(id) {
  screens.forEach((screen) => $(`#${screen}`).classList.toggle('active', screen === id));
  scrollTo(0, 0);
}

function setPhase(title, index) {
  const helps = state.cycle === 1
    ? ['介绍模型身份，再聊聊你对本局议题的看法。', '围绕议题追问一名玩家，看看TA会不会露出破绽。', '投给你觉得最像人类的玩家。']
    : ['根据上一轮聊天，补充谁的表达最像真实人类。', '最后一次围绕议题追问，确认你的判断。', '最终投票：人类存活就会获胜。'];
  $('#cycleLabel').textContent = `ROUND 0${state.cycle} / 02`;
  $('#phaseTitle').textContent = title;
  $('#phaseHelp').textContent = helps[index];
  document.querySelectorAll('.phase-track span').forEach((step, stepIndex) => {
    step.classList.toggle('on', stepIndex <= index);
  });
}

function renderPlayers(activeId = '') {
  $('#players').innerHTML = state.players.map((player) => `
    <div class="player ${player.id === activeId ? 'active' : ''} ${player.alive ? '' : 'dead'}">
      <div class="avatar">${player.name[0]}</div>
      <div class="player-name">${player.name}</div>
      <div class="player-meta">${player.alive ? 'CONNECTED' : 'ELIMINATED'}</div>
      ${player.isLocal ? '<span class="you-tag">YOU</span>' : ''}
    </div>
  `).join('');
}

function setPrompt(html) {
  $('#prompt').innerHTML = html;
}

function hideInputs() {
  ['composer', 'choice', 'advanceBtn'].forEach((id) => $(`#${id}`).classList.add('hidden'));
}

function addMessage(actorId, text, type = 'speech', targetId = '', share = true) {
  const player = byId(actorId);
  if (share) {
    state.transcript.push({
      actorId,
      actorName: player?.name || 'SYSTEM',
      text,
      type,
      targetId,
      cycle: state.cycle,
    });
  }

  const labels = { statement: '发言', question: '提问', answer: '回答', vote: '投票', system: '系统' };
  const targetName = targetId ? nameOf(targetId) : '';
  const element = document.createElement('div');
  element.className = `message ${type}`;
  element.dataset.type = type;
  element.innerHTML = `
    <div class="message-avatar">${player ? player.name[0] : '·'}</div>
    <div class="message-main">
      <div class="message-head">
        <b>${player?.name || 'SYSTEM'}${targetName ? ` <span class="target-mark">→ ${targetName}</span>` : ''}</b>
        <span>第${state.cycle}回合 · ${labels[type] || type}</span>
      </div>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
  $('#feed').append(element);
  applyFeedFilter();
  $('#feed').scrollTop = $('#feed').scrollHeight;
}

function addSystem(text, share = true) {
  addMessage('', text, 'system', '', share);
}

function setFeedFilter(filter) {
  state.feedFilter = filter;
  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === filter);
  });
  applyFeedFilter();
}

function applyFeedFilter() {
  document.querySelectorAll('#feed .message').forEach((message) => {
    const type = message.dataset.type;
    const visible = state.feedFilter === 'all'
      || type === 'system'
      || state.feedFilter === type
      || (state.feedFilter === 'discussion' && ['question', 'answer'].includes(type));
    message.classList.toggle('filter-hidden', !visible);
  });
}

function askHuman(label, placeholder = '输入你的发言…') {
  return new Promise((resolve) => {
    state.humanResolve = resolve;
    setPrompt(`<small>轮到你了</small>${label}`);
    $('#humanInput').value = '';
    $('#humanInput').placeholder = placeholder;
    $('#count').textContent = '0 / 200';
    $('#proofreadResult').classList.add('hidden');
    $('#proofreadResult').innerHTML = '';
    $('#proofreadBtn').disabled = false;
    $('#composer').classList.remove('hidden');
    $('#humanInput').focus();
  });
}

function submitHumanText() {
  const text = $('#humanInput').value.trim();
  if (!text) return toast('先说点什么');
  $('#composer').classList.add('hidden');
  state.humanResolve?.(text);
  state.humanResolve = null;
}

async function proofreadHumanText() {
  const text = $('#humanInput').value.trim();
  if (!text) return toast('先写完发言，再让 AI 检查');

  const button = $('#proofreadBtn');
  const box = $('#proofreadResult');
  button.disabled = true;
  button.textContent = '正在扫描…';
  box.classList.remove('hidden');
  box.innerHTML = '<span class="proofread-loading">正在检查错别字和标点，不会改变你的观点…</span>';

  try {
    const data = await postJson('/api/proofread', { text });
    const corrected = String(data.corrected || text).slice(0, 200);
    if (corrected === text) {
      box.innerHTML = `<div><b>✓ 扫描完成</b><p>${escapeHtml(data.notes || '未发现明显错误。')}</p></div><button data-close>知道了</button>`;
    } else {
      box.innerHTML = `
        <div><b>发现可修改内容</b><p>${escapeHtml(data.notes || '已修正明显错别字和标点。')}</p><blockquote>${escapeHtml(corrected)}</blockquote></div>
        <div><button data-close>保留原文</button><button data-apply>使用修正版</button></div>
      `;
      box.querySelector('[data-apply]').onclick = () => {
        $('#humanInput').value = corrected;
        $('#count').textContent = `${corrected.length} / 200`;
        box.classList.add('hidden');
        toast('已使用修正版');
      };
    }
  } catch (error) {
    box.innerHTML = `<div><b>暂时无法扫描</b><p>${escapeHtml(error.message)}</p></div><button data-close>关闭</button>`;
  } finally {
    box.querySelector('[data-close]')?.addEventListener('click', () => box.classList.add('hidden'));
    button.disabled = false;
    button.textContent = '✦ AI 检查错别字';
  }
}

function choose(label, options) {
  return new Promise((resolve) => {
    setPrompt(`<small>MAKE A CHOICE</small>${label}`);
    const box = $('#choice');
    box.innerHTML = options.map((option) => `
      <button data-id="${option.id}">
        <b>${option.name}</b><span>${option.meta || 'SELECT PLAYER'}</span>
      </button>
    `).join('');
    box.classList.remove('hidden');
    box.querySelectorAll('button').forEach((button) => {
      button.onclick = () => {
        box.classList.add('hidden');
        resolve(button.dataset.id);
      };
    });
  });
}

async function callAI(player, action, targetId = '') {
  setPrompt(`<div class="thinking">${player.name} 正在生成快速决策…</div>`);
  renderPlayers(player.id);
  const data = await postJson('/api/act', {
    agentIndex: player.agentIndex,
    action,
    selfId: player.id,
    players: state.players,
    cycle: state.cycle,
    transcript: state.transcript,
    targetId,
    topic: state.topic,
  });
  recordThought(player, action, data);
  return data;
}

async function safeAI(player, action, targetId = '') {
  try {
    return await callAI(player, action, targetId);
  } catch (error) {
    toast(`${player.name} 响应失败，已使用快速决策`);
    return localFallback(player, action, targetId, error);
  }
}

function recordThought(player, action, result) {
  state.thoughts[player.id].push({
    cycle: state.cycle,
    action,
    analysis: result.analysis,
    publicContent: result.content,
    fallbackUsed: result.fallbackUsed,
  });
}

function localFallback(player, action, targetId, error) {
  const config = state.config.agents[player.agentIndex];
  const candidates = state.players.filter((candidate) => candidate.id !== player.id && candidate.alive);
  const target = candidates[0]?.id || '';
  const hasQuestion = state.transcript.some((message) => message.type === 'question' && message.targetId === player.id);
  const content = {
    statement: state.cycle === 1
      ? `我是 ${config.model}，由 ${config.provider} 提供。对“${state.topic}”，我会权衡公共收益、个体权利和执行风险。我是AI，不是隐藏人类。`
      : `目前我更怀疑${nameOf(target)}。TA在追问后的取舍标准出现了缺乏解释的变化。`,
    question: `${nameOf(target)}，针对“${state.topic}”，你的立场在什么条件下会改变？`,
    answer: hasQuestion ? '我的核心取舍没有改变；如果加入新条件，我会说明结论变化的边界。' : '我会保持此前的权衡标准。',
    vote: `我投给${nameOf(target)}。TA的公开立场与后续论证一致性较弱。`,
  }[action];
  const result = {
    content,
    target: ['question', 'vote'].includes(action) ? target : targetId,
    analysis: `快速决策：模型请求失败（${error.message}）。`,
    fallbackUsed: true,
  };
  recordThought(player, action, result);
  return result;
}

async function runStatements() {
  setPhase(state.cycle === 1 ? '模型身份陈述' : '补充发言', 0);
  hideInputs();
  const order = shuffle(state.players.filter((player) => player.alive));
  addSystem(`${state.cycle === 1 ? '首轮身份陈述' : '第二回合补充发言'}顺序：${order.map((player) => player.name).join(' → ')}`);

  for (const player of order) {
    renderPlayers(player.id);
    let text;
    if (player.isLocal) {
      const label = state.cycle === 1
        ? `先编一个可信的模型身份，再轻松聊聊：“${escapeHtml(state.topic)}”。说说你的看法和一点两难之处，别忘了强调自己不是人类。`
        : '回顾大家怎样讨论议题：谁的说法、口吻或改口方式最像真实人类？把怀疑自然地引向一名存活玩家。';
      const placeholder = state.cycle === 1 ? '像 AI 一样自我介绍，再聊聊你的真实看法…' : '像赛桌复盘一样聊聊谁最可疑…';
      text = await askHuman(label, placeholder);
    } else {
      text = (await safeAI(player, 'statement')).content;
      await wait(450);
    }
    addMessage(player.id, text, 'statement');
  }

  renderPlayers();
  await wait(500);
  runQuestions();
}

async function runQuestions() {
  setPhase('议题盘问', 1);
  hideInputs();
  const order = shuffle(state.players.filter((player) => player.alive));
  addSystem('议题盘问开始。每位玩家围绕本局社会议题选择一人追问，被问者必须当场回答。');

  for (const asker of order) {
    let targetId;
    let question;
    if (asker.isLocal) {
      targetId = await choose('选择一位玩家，追问 TA 对社会议题的立场或逻辑漏洞。', state.players.filter((player) => player.alive && player.id !== asker.id));
      question = await askHuman(`围绕“${escapeHtml(state.topic)}”向 ${nameOf(targetId)} 提问。`, '追问TA的价值取舍、立场边界或前后矛盾…');
    } else {
      const result = await safeAI(asker, 'question');
      targetId = validTarget(result.target, asker.id);
      question = result.content;
    }

    addMessage(asker.id, question, 'question', targetId);
    await wait(350);

    const target = byId(targetId);
    const answer = target.isLocal
      ? await askHuman(`${asker.name} 问你：<br>“${escapeHtml(question)}”`, '输入你的回答…')
      : (await safeAI(target, 'answer', asker.id)).content;
    addMessage(target.id, answer, 'answer', asker.id);
    await wait(350);
  }

  renderPlayers();
  runVote();
}

async function runVote() {
  setPhase('匿名投票', 2);
  hideInputs();
  addSystem('讨论结束。所有投票同时封存。');
  const alive = state.players.filter((player) => player.alive);
  state.votes = {};

  for (const player of alive) {
    state.votes[player.id] = player.isLocal
      ? await choose('投出你认为最像人类的玩家。', alive.filter((candidate) => candidate.id !== player.id))
      : validTarget((await safeAI(player, 'vote')).target, player.id);
  }
  resolveVote();
}

function resolveVote() {
  const { tiedIds, eliminatedId } = resolveVotes(state.votes);
  byId(eliminatedId).alive = false;
  state.roundResults.push({ cycle: state.cycle, votes: { ...state.votes }, eliminatedId, tiedIds });

  Object.entries(state.votes).forEach(([voterId, targetId]) => {
    addMessage(voterId, `我投给 ${nameOf(targetId)}。`, 'vote', targetId);
  });
  addSystem(tiedIds.length > 1
    ? `最高票出现平票，系统随机处决：${nameOf(eliminatedId)}。`
    : `${nameOf(eliminatedId)} 获得最高票，身份即将核验。`);
  renderPlayers();

  setPrompt(`<small>VOTE RESULT</small>${nameOf(eliminatedId)} 被投出。`);
  const button = $('#advanceBtn');
  button.textContent = '揭晓结果';
  button.classList.remove('hidden');
  button.onclick = () => {
    button.classList.add('hidden');
    if (eliminatedId === state.humanId) return finish(false);
    if (state.cycle === 2) return finish(true);
    state.cycle += 1;
    addSystem('目标不是人类。剩余玩家进入最后一回合。');
    runStatements();
  };
}

function finish(humanWon) {
  showScreen('result');
  const hero = $('#resultHero');
  hero.className = `result-hero ${humanWon ? 'win' : 'lose'}`;
  hero.innerHTML = `
    <span class="verdict">${humanWon ? 'HUMAN UNDETECTED' : 'IDENTITY EXPOSED'}</span>
    <h1>${humanWon ? '你骗过了它们。' : '你被识破了。'}</h1>
    <p>${humanWon ? '两轮投票后，你仍留在网络中。人类胜利。' : 'AI 玩家成功锁定隐藏的人类。'}</p>
    <p class="result-topic">本局议题：${escapeHtml(state.topic)}</p>
  `;
  renderReveals();
  loadPostgameSummaries(humanWon);
}

async function loadPostgameSummaries(humanWon) {
  const agents = state.players.filter((player) => !player.isLocal);
  const box = $('#aiPostgame');
  box.innerHTML = agents.map((player) => `
    <article class="postgame-card loading">
      <div class="postgame-avatar">${player.name[0]}</div>
      <div><b>${player.name}</b><small>${escapeHtml(state.config.agents[player.agentIndex].model)}</small><p>正在回想这局发生了什么…</p></div>
    </article>
  `).join('');

  await Promise.all(agents.map(async (player, index) => {
    let content = '这局的身份线索几次反转，人类玩家的伪装很有迷惑性。';
    try {
      const data = await postJson('/api/summary', {
        agentIndex: player.agentIndex,
        selfId: player.id,
        humanId: state.humanId,
        players: state.players,
        transcript: state.transcript,
        roundResults: state.roundResults,
        humanWon,
        topic: state.topic,
      });
      content = data.content;
    } catch {}
    const card = box.children[index];
    card.classList.remove('loading');
    card.querySelector('p').textContent = content;
  }));
}

function renderReveals() {
  $('#reveals').innerHTML = state.players.map((player) => {
    if (player.isLocal) {
      const lines = state.transcript.filter((message) => message.actorId === player.id);
      return `
        <details class="reveal">
          <summary><span class="reveal-name">${player.name}</span><span class="reveal-model">LOCAL PLAYER</span><span class="reveal-role human">HUMAN</span></summary>
          <div class="reveal-body">${lines.map((message) => `<div class="thought"><b>ROUND 0${message.cycle} · ${message.type.toUpperCase()} · 公开发言</b><p>${escapeHtml(message.text)}</p></div>`).join('')}</div>
        </details>
      `;
    }

    const config = state.config.agents[player.agentIndex];
    const thoughts = state.thoughts[player.id] || [];
    return `
      <details class="reveal">
        <summary><span class="reveal-name">${player.name}</span><span class="reveal-model">${config.provider} · ${config.model}</span><span class="reveal-role">AI AGENT</span></summary>
        <div class="reveal-body">${thoughts.map((thought) => `
          <div class="thought">
            <b>ROUND 0${thought.cycle} · ${thought.action.toUpperCase()}${thought.fallbackUsed ? ' · 快速决策' : ''}</b>
            <p><strong>公开发言：</strong>${escapeHtml(thought.publicContent || '（无）')}</p>
            <p><strong>判断摘要：</strong>${escapeHtml(thought.analysis || '无判断摘要')}</p>
          </div>
        `).join('') || '<p>该 Agent 本局没有留下行动记录。</p>'}</div>
      </details>
    `;
  }).join('');
}

function validTarget(id, selfId) {
  if (state.players.some((player) => player.id === id && player.id !== selfId && player.alive)) return id;
  return state.players.find((player) => player.id !== selfId && player.alive)?.id || '';
}

function byId(id) {
  return state.players.find((player) => player.id === id);
}

function nameOf(id) {
  return byId(id)?.name || id;
}

function escapeHtml(value = '') {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('show');
  setTimeout(() => $('#toast').classList.remove('show'), 2600);
}
