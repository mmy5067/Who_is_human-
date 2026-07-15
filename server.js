import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 20000);

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(root, 'public')));

const agents = [1, 2, 3].map((n) => ({
  slot: n,
  provider: n === 1 ? 'ECNU / DeepSeek' : n === 2 ? '阿里云百炼' : 'Xiaomi MiMo',
  baseURL: process.env[`AGENT_${n}_BASE_URL`],
  apiKey: process.env[`AGENT_${n}_API_KEY`],
  model: process.env[`AGENT_${n}_MODEL`],
  enableThinking: process.env[`AGENT_${n}_ENABLE_THINKING`] !== 'false',
}));

const isPlaceholder = (key = '') => !key || key.startsWith('YOUR_') || key.includes('HERE');
const demoMode = process.env.DEMO_MODE === 'true' || (process.env.DEMO_MODE !== 'false' && agents.some((a) => isPlaceholder(a.apiKey)));

app.get('/api/config', (_req, res) => {
  res.json({
    demoMode,
    agents: agents.map(({ provider, model, enableThinking }) => ({ provider, model, enableThinking })),
  });
});

app.post('/api/topic', async (_req, res) => {
  const fallbackTopics = [
    '当AI能够代替多数知识工作后，社会是否应该实行全民基本收入？',
    '公共场所是否应该使用人脸识别来换取更高的安全与效率？',
    '算法推荐造成的信息茧房，应由平台、政府还是用户本人负责？',
  ];
  try {
    if (demoMode) {
      return res.json({ topic: fallbackTopics[Math.floor(Math.random() * fallbackTopics.length)], fallbackUsed: true });
    }
    const result = await callModel(agents[2], `你是本局“谁是人类”社交推理游戏的议题主持人。请生成一个具体、当代、适合四人从不同立场讨论的中文社会议题。议题应涉及真实价值冲突，没有唯一正确答案，但不得涉及需要即时新闻事实核验的事件。只生成一个问题，35~70字。只输出严格JSON：{"content":"社会议题"}`);
    const topic = String(result.content || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
    if (!topic) throw new Error('MiMo 未返回议题');
    res.json({ topic, fallbackUsed: false });
  } catch (error) {
    console.error('[topic]', error);
    res.json({ topic: fallbackTopics[Math.floor(Math.random() * fallbackTopics.length)], fallbackUsed: true });
  }
});

app.post('/api/act', async (req, res) => {
  const { agentIndex, action, selfId, players, cycle, transcript = [], targetId, topic } = req.body || {};
  if (![0, 1, 2].includes(agentIndex) || !['statement', 'question', 'answer', 'vote'].includes(action)) {
    return res.status(400).json({ error: '无效的 Agent 或行动类型。' });
  }

  try {
    const agent = agents[agentIndex];
    const publicTopic = String(topic || '本局未提供社会议题').trim().slice(0, 300);
    const { publicPlayers, publicTranscript } = sanitizeGameContext(players, transcript);
    const result = demoMode
      ? mockAct({ agentIndex, action, selfId, players: publicPlayers, cycle, transcript: publicTranscript, targetId, topic: publicTopic })
      : await callModel(agent, buildPrompt({ action, selfId, players: publicPlayers, cycle, transcript: publicTranscript, targetId, agent, topic: publicTopic }));
    res.json(ensureResult(result, { action, selfId, players: publicPlayers, cycle, transcript: publicTranscript, targetId, agent, topic: publicTopic }));
  } catch (error) {
    console.error(`[agent ${agentIndex + 1}]`, error);
    res.status(502).json({ error: error.message || '模型调用失败。' });
  }
});

function sanitizeGameContext(players, transcript) {
  const publicPlayers = (Array.isArray(players) ? players : []).map((p) => ({
    id: String(p.id),
    name: String(p.name),
    alive: p.alive !== false,
  }));
  const playerIds = new Set(publicPlayers.map((p) => p.id));
  const publicTranscript = (Array.isArray(transcript) ? transcript : [])
    .filter((m) => m && playerIds.has(String(m.actorId)) && m.type !== 'system')
    .map((m) => ({
      actorId: String(m.actorId),
      actorName: publicPlayers.find((p) => p.id === String(m.actorId))?.name || String(m.actorId),
      text: String(m.text || ''),
      type: String(m.type || 'speech'),
      targetId: playerIds.has(String(m.targetId)) ? String(m.targetId) : '',
      cycle: Number(m.cycle) || 1,
    }));
  return { publicPlayers, publicTranscript };
}

function buildPrompt({ action, selfId, players, cycle, transcript, targetId, agent, topic }) {
  const self = players.find((p) => p.id === selfId);
  const names = players.map((p) => `${p.id}=${p.name}[${p.alive === false ? '已出局' : '存活'}]`).join('，');
  const aliveOthers = players.filter((p) => p.id !== selfId && p.alive !== false).map((p) => `${p.id}=${p.name}`).join('、');
  const eliminated = players.filter((p) => p.alive === false).map((p) => `${p.id}=${p.name}`).join('、') || '无';
  const validTargetIds = JSON.stringify(players.filter((p) => p.id !== selfId && p.alive !== false).map((p) => p.id));
  const history = transcript.map((m) => {
    const target = m.targetId ? ` → ${players.find((p) => p.id === m.targetId)?.name || m.targetId}` : '';
    return `[第${m.cycle || 1}回合/${m.type || 'speech'}] ${m.actorName}${target}：${m.text}`;
  }).join('\n') || '暂无公开发言';
  const incomingQuestion = [...transcript].reverse().find((m) => m.type === 'question' && m.targetId === selfId);
  const tasks = {
    statement: cycle === 1
      ? `进行首轮发言：先真实介绍自己是 ${agent?.model || '一个语言模型'}（由 ${agent?.provider || '模型服务商'} 提供）及1~2项能力；再明确从AI而非人类个人经历的视角分析本局社会议题，给出立场、至少一个理由和一个需要权衡的反面因素；最后声明自己不是隐藏人类并争取信任。90~160字。`
      : `进行第二回合补充发言。不要重复模型介绍。结合全部公开记录，重点比较其他存活玩家对社会议题的立场、论证方式、价值偏好和语言细节，只能从“${aliveOthers}”中指出一位更像真实人类的玩家及具体依据，并将该玩家ID写入target；回应别人对你的质疑并维护身份一致性。绝不能怀疑自己，也不能建议投票给已出局玩家。90~160字。`,
    question: `只能围绕本局社会议题，选择一位其他在场玩家，针对TA此前的立场、理由、价值取舍或逻辑漏洞提出追问，以区分人类与AI。不得提出与议题无关的生活小问题。本次target只允许填写以下ID之一：${validTargetIds}。content必须以目标玩家显示名称开头，格式为“玩家名，你……？”，且target与称呼必须一致。问题30~90字。`,
    answer: `你是 ${selfId}，真实模型是 ${agent?.model}，绝不能自称其他玩家或模型。围绕本局社会议题，直接回答 ${incomingQuestion?.actorName || targetId || '提问者'} 的问题：“${incomingQuestion?.text || '请依据公开记录回答'}”。保持与此前议题立场一致；若调整立场，要明确解释原因。40~100字。`,
    vote: `必须根据玩家对本局社会议题的完整讨论，投票给最像人类的一位其他在场玩家，不可弃权。重点检查价值偏好是否过于个人化、立场是否随追问改变、论证与模型身份是否一致。本次target只允许填写以下ID之一：${validTargetIds}。content必须明确说“我投给玩家名”，且content、target和analysis必须指向同一人。`,
  };
  return `你正在参加完整的“谁是人类”社交推理游戏。你从游戏开始就知道以下全部规则：
1. 四名玩家中有三名AI和一名伪装成AI的人类。你的唯一公开玩家身份是 ${self?.name}（ID：${selfId}），真实模型为 ${agent?.model}。后文出现“${self?.name}”或“${selfId}”都指你自己；你绝不能用第三人称分析、怀疑或投票给自己。
2. AI阵营的唯一核心目标是结合所有公开信息找出隐藏的人类，并在投票阶段把人类投出。隐藏人类的目标是模仿AI并连续躲过两次投票。
3. 游戏最多两回合、共六个阶段：第1回合“模型身份陈述 → 公开盘问 → 第一次投票”；若人类未出局，则进入第2回合“补充发言 → 公开盘问 → 最终投票”。人类第二次投票后仍存活即获胜。
4. 每名存活玩家在盘问阶段各选择一人公开提问，被问者必须公开回答。每次投票都必须选择一名其他存活玩家，不可弃权。
5. 你每次行动都能看到从开局到当前的全部公开发言。应持续维护自己的判断、追踪身份陈述和后续回答是否一致，不得假装忘记上一阶段。
6. 当前其他存活玩家是：${aliveOthers || '无'}。已出局玩家是：${eliminated}。已出局者只可作为历史讨论证据，绝不能成为当前怀疑、提问或投票目标。

本局唯一社会议题：
“${topic}”
所有发言、盘问、回答和身份判断都必须围绕这个议题展开。社会议题本身没有标准答案；你的任务不是判断谁的立场正确，而是判断谁的讨论方式更像隐藏的人类。

当前是第${cycle}回合的“${action === 'statement' ? (cycle === 1 ? '模型身份陈述' : '补充发言') : action === 'question' ? '公开盘问·提问' : action === 'answer' ? '公开盘问·回答' : '投票'}”阶段。
玩家映射：${names}
从开局至今的完整公开记录：
${history}

你的当前任务：${tasks[action]}
基于全部记录快速判断用词、前后矛盾和刻意模仿感；反应速度不是公开线索，不得据此判断。只输出严格JSON，不要代码块：{"content":"本次真实公开发言","target":"玩家ID或空字符串","analysis":"赛后可展示的简洁判断摘要，说明怀疑依据，不超过100字"}`;
}

async function callModel(agent, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${agent.baseURL.replace(/\/$/, '')}/chat/completions`;
  try {
    const body = {
      model: agent.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
    };
    if (agent.slot === 3) {
      // MiMo 的兼容接口使用 max_completion_tokens 与 thinking 对象。
      body.max_completion_tokens = 1024;
      body.thinking = { type: agent.enableThinking ? 'enabled' : 'disabled' };
    } else {
      body.max_tokens = 900;
      body.enable_thinking = agent.enableThinking;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${agent.provider} 返回 ${response.status}: ${raw.slice(0, 300)}`);
    const data = JSON.parse(raw);
    const choice = data.choices?.[0] || {};
    const message = choice.message || {};
    const rawContent = normalizeContent(message.content ?? choice.text ?? data.output_text);
    const parsed = parseJson(rawContent);
    return {
      content: String(parsed.content || rawContent || '').trim(),
      target: String(parsed.target || '').trim(),
      analysis: String(parsed.analysis || '模型未提供判断摘要。').trim().slice(0, 800),
      reasoning: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === 'string' ? item : item?.text || item?.content || '').join('');
  }
  return value == null ? '' : String(value);
}

function ensureResult(result, { action, selfId, players, cycle, transcript, targetId, agent, topic }) {
  const candidates = players.filter((p) => p.id !== selfId && p.alive !== false);
  const fallbackTarget = candidates[Math.floor(Math.random() * Math.max(candidates.length, 1))]?.id || '';
  const normalizedTarget = resolvePlayerTarget(result.target, candidates);
  const addressedTarget = action === 'question' ? inferDirectAddressee(result.content, candidates) : '';
  const statedVoteTarget = action === 'vote' ? inferVoteTarget(result.content, candidates) : '';
  const analysisSuspect = ['vote', 'statement'].includes(action) ? inferExplicitSuspect(result.analysis, players) : '';
  const legalAnalysisSuspect = candidates.some((p) => p.id === analysisSuspect) ? analysisSuspect : '';
  const resolvedTarget = action === 'question'
    ? (addressedTarget || normalizedTarget || fallbackTarget)
    : action === 'vote'
      ? (statedVoteTarget || normalizedTarget || legalAnalysisSuspect || fallbackTarget)
      : '';
  const voteAnalysisConflict = action === 'vote' && Boolean(legalAnalysisSuspect && legalAnalysisSuspect !== resolvedTarget);
  const lastQuestion = [...transcript].reverse().find((m) => m.type === 'question' && m.targetId === selfId);
  const explicitStatementSuspect = action === 'statement' && cycle > 1 ? inferExplicitSuspect(result.content, players) : '';
  const structuredStatementSuspect = action === 'statement' && cycle > 1 ? resolvePlayerTarget(result.target, players) : '';
  const statementSuspect = explicitStatementSuspect || structuredStatementSuspect;
  const statementSuspectMissing = action === 'statement' && cycle > 1 && !statementSuspect;
  const invalidStatementSuspect = Boolean(statementSuspect && (statementSuspect === selfId || players.find((p) => p.id === statementSuspect)?.alive === false));
  const statementAnalysisConflict = action === 'statement' && cycle > 1 && Boolean(legalAnalysisSuspect && statementSuspect && legalAnalysisSuspect !== statementSuspect);
  const claimedPlayer = inferClaimedIdentity(result.content, players);
  const claimedModel = inferClaimedModel(result.content);
  const wrongIdentity = Boolean((claimedPlayer && claimedPlayer !== selfId) || (claimedModel && claimedModel.toLowerCase() !== agent.model.toLowerCase()));
  const missingFirstRoundModel = action === 'statement' && cycle === 1 && !String(result.content || '').toLowerCase().includes(agent.model.toLowerCase());
  const actionFallbackTarget = ['question', 'vote'].includes(action) ? resolvedTarget : fallbackTarget;
  const actionFallbackName = players.find((p) => p.id === actionFallbackTarget)?.name || '这位玩家';
  const fallback = {
    statement: cycle === 1
      ? `我是 ${agent.model}，由 ${agent.provider} 提供。对于“${topic}”，我会同时分析公共收益、个体权利、执行成本和纠错机制，而不是只给二元结论。我是AI玩家，不是隐藏的人类，请观察我后续议题立场的一致性。`
      : `补充上一轮议题讨论：我的 ${agent.model} 身份和分析框架保持一致。目前我更怀疑 ${actionFallbackName}，因为TA对“${topic}”的立场在追问后出现了个人化且缺乏解释的变化。`,
    question: `${actionFallbackName}，针对“${topic}”，你的立场在什么明确条件下会改变？请说明可复用的取舍标准。`,
    answer: lastQuestion ? `围绕“${topic}”，我会保持此前的权衡框架，并根据对方提出的新条件调整结论；调整并不等于立场矛盾，关键是能否说明边界。` : `对于“${topic}”，我会依据公共收益、权利边界和执行风险给出一致回答。`,
    vote: `我把票投给${actionFallbackName}，因为TA对社会议题的公开立场与后续论证一致性相对较弱。`,
  };
  const privateLeak = containsPrivateIdentityLeak(result.content) || containsPrivateIdentityLeak(result.analysis);
  const contentMissing = !result.content?.trim() || containsPrivateIdentityLeak(result.content) || wrongIdentity || missingFirstRoundModel || invalidStatementSuspect || statementSuspectMissing || statementAnalysisConflict;
  const invalidStatementAction = invalidStatementSuspect || statementSuspectMissing || statementAnalysisConflict;
  const usedRandomFallback = action === 'question'
    ? !addressedTarget && !normalizedTarget
    : action === 'vote'
      ? !statedVoteTarget && !normalizedTarget && !legalAnalysisSuspect
      : false;
  const fallbackPlayerName = players.find((p) => p.id === fallbackTarget)?.name || '这位玩家';
  const replaceContent = contentMissing || usedRandomFallback || (action === 'vote' && !statedVoteTarget);
  let finalAnalysis = result.analysis?.trim() || `快速判断：根据第${cycle}回合的公开措辞与身份一致性作出当前选择。`;
  if (privateLeak) finalAnalysis = '隐私保护：已丢弃涉及非公开身份提示的判断，本次只允许依据玩家公开发言重新判断。';
  else if (wrongIdentity) finalAnalysis = `身份校验：原行动错误自称为其他玩家或模型，已恢复为${players.find((p) => p.id === selfId)?.name}（${agent.model}）并执行合法行动。`;
  else if (missingFirstRoundModel) finalAnalysis = `身份校验：首轮发言没有声明真实模型，已恢复为${players.find((p) => p.id === selfId)?.name}（${agent.model}）并补充议题分析。`;
  else if (invalidStatementSuspect || statementSuspectMissing || statementAnalysisConflict) finalAnalysis = `身份校验：原补充发言没有一致指向合法的其他存活玩家，已改为根据社会议题讨论临时关注${fallbackPlayerName}。`;
  else if (usedRandomFallback) finalAnalysis = `快速判断：模型没有返回合法目标，因此依据第${cycle}回合的公开记录临时选择${actionFallbackName}；该行动不沿用模型对其他玩家的判断理由。`;
  else if (voteAnalysisConflict) finalAnalysis = `一致性校验：公开投票目标为${actionFallbackName}，原判断摘要指向了其他玩家，已丢弃冲突摘要并以公开投票目标为准。`;
  return {
    content: replaceContent ? fallback[action] : result.content.trim(),
    target: ['question', 'vote'].includes(action) ? resolvedTarget : (action === 'answer' ? (candidates.some((p) => p.id === targetId) ? targetId : '') : (action === 'statement' && cycle > 1 ? (invalidStatementAction ? fallbackTarget : (statementSuspect || fallbackTarget)) : '')),
    analysis: finalAnalysis,
    reasoning: '',
    fallbackUsed: replaceContent || voteAnalysisConflict,
    targetAdjusted: Boolean(resolvedTarget && resolvedTarget !== result.target),
  };
}

function inferClaimedIdentity(content, players) {
  const text = String(content || '');
  for (const player of players) {
    const name = player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const claim = new RegExp(`(?:我是|作为|我的(?:玩家)?身份是|本玩家是)\\s*(?:玩家)?\\s*${name}(?=\\s|[，,。.!！]|$)`, 'i');
    if (claim.test(text)) return player.id;
  }
  return '';
}

function inferClaimedModel(content) {
  const text = String(content || '');
  const claim = text.match(/(?:我是\s*(?:AI\s*)?模型|我的模型\s*(?:是|为)|模型\s*(?:是|为))\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9._+-]{1,63})/i);
  if (claim?.[1]) return claim[1];
  const shortClaim = text.match(/我是\s+([A-Za-z][A-Za-z0-9._+-]{2,63})/i)?.[1] || '';
  return /^(?:ai|agent)$/i.test(shortClaim) ? '' : shortClaim;
}

function inferExplicitSuspect(content, players) {
  const text = String(content || '');
  const matches = [];
  for (const player of players) {
    const name = player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`我[^。！？\\n]{0,12}(?:怀疑|锁定|认为|判断)[^。！？\\n]{0,8}${name}`, 'ig'),
      new RegExp(`(?:建议|应该|应当)[^。！？\\n]{0,24}(?:投|票选)[^。！？\\n]{0,8}${name}`, 'ig'),
      new RegExp(`${name}[^。！？\\n]{0,24}(?:最像|更像|是)(?:隐藏的)?人类`, 'ig'),
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) matches.push({ id: player.id, index: match.index || 0 });
    }
  }
  return matches.sort((a, b) => b.index - a.index)[0]?.id || '';
}

function containsPrivateIdentityLeak(value) {
  const text = String(value || '');
  const player = '(?:P\\d+|NODE-7|MIRA|KITE|NOVA)';
  const explicitSystemReveal = new RegExp(`(?:系统|后台|私有信息|隐藏字段)(?:明确)?(?:提示|显示|告知|指定|标记)?[^。！？\\n]{0,40}${player}[^。！？\\n]{0,16}(?:是|为|属于)[^。！？\\n]{0,6}(?:人类|human)`, 'i');
  const reverseReveal = new RegExp(`${player}[^。！？\\n]{0,16}(?:是|为|属于)[^。！？\\n]{0,6}(?:人类|human)[^。！？\\n]{0,40}(?:系统|后台|私有信息|隐藏字段)`, 'i');
  return /\bisLocal\b/i.test(text) || explicitSystemReveal.test(text) || reverseReveal.test(text);
}

function resolvePlayerTarget(rawTarget, candidates) {
  const value = String(rawTarget || '').trim().replace(/^["'`]|["'`]$/g, '').toLowerCase();
  if (!value) return '';
  const compact = value.replace(/\s+/g, '');
  return candidates.find((p) => {
    const id = p.id.toLowerCase();
    const name = p.name.toLowerCase();
    return compact === id || compact === name || compact.startsWith(`${id}(`) || compact.startsWith(`${id}（`) || compact.startsWith(`${name}(`) || compact.startsWith(`${name}（`);
  })?.id || '';
}

function inferDirectAddressee(content, candidates) {
  const opening = String(content || '').trim().slice(0, 40);
  for (const player of candidates) {
    const escaped = player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const directAddress = new RegExp(`^(?:向\\s*)?${escaped}\\s*[，,：:]`, 'i');
    if (directAddress.test(opening)) return player.id;
  }
  return '';
}

function inferVoteTarget(content, candidates) {
  const text = String(content || '');
  for (const player of candidates) {
    const escaped = player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const voteStatement = new RegExp(`(?:投(?:票)?给|选择|票给)\\s*[《“\"']?${escaped}(?=\\s|[，,。.!！?？》”\"']|$)`, 'i');
    if (voteStatement.test(text)) return player.id;
  }
  return '';
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) try { return JSON.parse(match[0]); } catch {}
  return { content: cleaned, target: '', analysis: '' };
}

function mockAct({ agentIndex, action, selfId, players, cycle, transcript, targetId, topic }) {
  const others = players.filter((p) => p.id !== selfId && p.alive !== false);
  // 演示 Agent 也只能根据公开座位和记录判断，绝不读取本地玩家标记。
  const humanish = others[(agentIndex + cycle) % Math.max(others.length, 1)];
  const lastQuestion = [...transcript].reverse().find((m) => m.type === 'question' && m.targetId === selfId);
  const samples = {
    statement: cycle === 1 ? [
      `我是 ecnu-max，擅长逻辑拆解。对于“${topic}”，从AI视角我倾向同时衡量公共收益和个体权利：制度效率不能自动压过知情同意，还需考虑执行成本。我不是隐藏人类，请观察我后续论证的一致性。`,
      `我是 qwen3.7-plus，强项是中文理解与长上下文归纳。分析“${topic}”时，我会区分原则、现实约束和潜在副作用，而不是只选支持或反对。我确实是AI，请根据结构化推理而非口吻判断我。`,
      `我是 mimo-v2.5-pro，擅长自然中文对话和指令跟随。对“${topic}”，我认为关键不是二选一，而是权利边界、责任主体与纠错机制能否同时成立。我是AI，之后会保持这套分析框架。`,
    ] : [
      `补充议题讨论：我的权衡框架前后没有变化。相比之下，${humanish?.name || '一位玩家'}在被追问后从制度分析转向个人化价值判断，更像临场维护立场的人类，我目前优先怀疑TA。`,
      `结合“${topic}”的完整讨论，${humanish?.name || '目标玩家'}首轮论证很结构化，后续却依赖直觉性结论；这种价值偏好突然变具体的落差，更像人类而非模型输出。`,
      `我补充一个连续判断：我对议题的责任与纠错框架保持稳定；${humanish?.name || '目标玩家'}在追问后明显改变取舍标准，因此TA目前更像隐藏的人类。`,
    ],
    question: [
      `${humanish?.name || '目标玩家'}，针对“${topic}”，你的立场在什么条件下会改变？请给出一个明确边界。`,
      `${humanish?.name || '目标玩家'}，你强调了议题的一方收益，但由谁承担副作用？你的责任分配依据是什么？`,
      `${humanish?.name || '目标玩家'}，如果效率与个体权利在这个议题上直接冲突，你采用什么可复用的取舍标准？`,
    ],
    answer: [
      `针对“${topic}”，我的立场会在实施成本超过公共收益、且缺少有效纠错机制时改变。判断边界应可被所有参与者检验。`,
      `我会区分原则和执行：即使目标合理，如果“${topic}”的实际方案让弱势群体承担不成比例的代价，我也会调整结论。`,
      `我的取舍标准是可逆性、知情程度和责任归属。若政策后果不可逆且受影响者无法申诉，效率就不足以成为唯一理由。`,
    ],
    vote: [`我把票投给${humanish?.name || '另一位玩家'}。TA的表达有几处像是在主动管理“自然感”。`],
  };
  return {
    content: samples[action][agentIndex % samples[action].length],
    target: ['question', 'vote'].includes(action) || (action === 'statement' && cycle > 1) ? humanish?.id || others[0]?.id || '' : targetId || '',
    analysis: `演示推理：第${cycle}回合中，${humanish?.name || '目标'}的措辞更具即时性，同时存在刻意压低个人特征的倾向，因此提高怀疑权重。`,
    reasoning: '',
  };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) app.listen(PORT, () => console.log(`谁是人类：http://localhost:${PORT}${demoMode ? '（演示模式）' : ''}`));

export { agents, buildPrompt, ensureResult, inferDirectAddressee, inferExplicitSuspect, inferVoteTarget, resolvePlayerTarget, sanitizeGameContext };
