import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agents, demoMode, PORT, REQUEST_TIMEOUT_MS } from './src/config.js';
import { ensureResult } from './src/game/action-result.js';
import { sanitizeGameContext, sanitizeRoundResults, resolvePlayerTarget } from './src/game/context.js';
import { mockAct } from './src/game/mock.js';
import { buildActionPrompt, buildPostgameFallback, buildPostgamePrompt } from './src/game/prompts.js';
import { callModel } from './src/model-client.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const fallbackTopics = [
  '当AI能够代替多数知识工作后，社会是否应该实行全民基本收入？',
  '公共场所是否应该使用人脸识别来换取更高的安全与效率？',
  '算法推荐造成的信息茧房，应由平台、政府还是用户本人负责？',
];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function rateLimit({ limit = 180, windowMs = 15 * 60 * 1000 } = {}) {
  const windows = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const previous = windows.get(key);
    const record = !previous || now - previous.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : previous;
    record.count += 1;
    windows.set(key, record);

    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(Math.max(0, limit - record.count)));
    if (record.count > limit) return res.status(429).json({ error: '请求太频繁，请稍后再开一局。' });
    next();
  };
}

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
app.use(express.json({ limit: '200kb' }));
app.use('/api', rateLimit());
app.use(express.static(path.join(root, 'public')));

app.get('/api/config', (_req, res) => {
  res.json({
    demoMode,
    agents: agents.map(({ provider, model, enableThinking }) => ({ provider, model, enableThinking })),
  });
});

app.post('/api/topic', async (_req, res) => {
  if (demoMode) return res.json({ topic: randomItem(fallbackTopics), fallbackUsed: true });
  try {
    const prompt = '生成一个适合四人讨论的当代中文社会议题：包含真实价值冲突、没有唯一答案、不依赖即时新闻。35~70字。只输出JSON：{"content":"问题"}';
    const result = await callModel(agents[2], prompt, REQUEST_TIMEOUT_MS);
    const topic = String(result.content || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
    if (!topic) throw new Error('模型未返回议题');
    res.json({ topic, fallbackUsed: false });
  } catch (error) {
    console.error('[topic]', error);
    res.json({ topic: randomItem(fallbackTopics), fallbackUsed: true });
  }
});

app.post('/api/proofread', async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 1200);
  if (!text) return res.status(400).json({ error: '请先输入文字。' });
  if (demoMode) return res.json({ corrected: text, notes: '演示模式未发现需要修改的错别字。' });

  try {
    const prompt = `只校对错别字、漏字、明显语病和标点，不改变观点、语气或事实。只输出JSON：{"content":"修订全文","analysis":"简短说明"}\n\n原文：${text}`;
    const result = await callModel(agents[1], prompt, REQUEST_TIMEOUT_MS);
    res.json({ corrected: result.content || text, notes: result.analysis || '扫描完成。' });
  } catch (error) {
    console.error('[proofread]', error);
    res.status(502).json({ error: 'AI 校对暂时不可用，请稍后再试。' });
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
    const self = publicPlayers.find((player) => player.id === String(selfId));
    if (publicPlayers.length < 2 || !self?.alive) return res.status(400).json({ error: '当前玩家状态无效。' });

    const context = {
      action,
      selfId: self.id,
      players: publicPlayers,
      cycle: [1, 2].includes(Number(cycle)) ? Number(cycle) : 1,
      transcript: publicTranscript,
      targetId: String(targetId || ''),
      agent,
      topic: publicTopic,
    };
    const rawResult = demoMode
      ? mockAct({ agentIndex, ...context })
      : await callModel(agent, buildActionPrompt(context), REQUEST_TIMEOUT_MS);
    res.json(ensureResult(rawResult, context));
  } catch (error) {
    console.error(`[agent ${agentIndex + 1}]`, error);
    res.status(502).json({ error: error.message || '模型调用失败。' });
  }
});

app.post('/api/summary', async (req, res) => {
  const { agentIndex, selfId, humanId, players, transcript = [], roundResults = [], humanWon, topic } = req.body || {};
  if (![0, 1, 2].includes(agentIndex)) return res.status(400).json({ error: '无效的 Agent。' });

  try {
    const agent = agents[agentIndex];
    const { publicPlayers, publicTranscript } = sanitizeGameContext(players, transcript);
    const self = publicPlayers.find((player) => player.id === String(selfId));
    const human = publicPlayers.find((player) => player.id === String(humanId));
    if (!self || !human) return res.status(400).json({ error: '赛局身份信息不完整。' });

    const cleanRounds = sanitizeRoundResults(roundResults, publicPlayers);
    const didHumanWin = typeof humanWon === 'boolean' ? humanWon : human.alive;
    const fallback = () => buildPostgameFallback({
      self,
      human,
      players: publicPlayers,
      roundResults: cleanRounds,
      humanWon: didHumanWin,
    });
    if (demoMode) return res.json({ content: fallback() });

    try {
      const result = await callModel(agent, buildPostgamePrompt({
        self,
        human,
        agent,
        players: publicPlayers,
        transcript: publicTranscript,
        roundResults: cleanRounds,
        humanWon: didHumanWin,
        topic,
      }), REQUEST_TIMEOUT_MS);
      const returnedSelf = resolvePlayerTarget(result.self, publicPlayers);
      res.json({ content: returnedSelf === self.id && result.content ? result.content : fallback() });
    } catch (error) {
      console.error(`[summary model ${agentIndex + 1}]`, error);
      res.json({ content: fallback(), fallbackUsed: true });
    }
  } catch (error) {
    console.error(`[summary ${agentIndex + 1}]`, error);
    res.status(502).json({ error: '赛后总结生成失败。' });
  }
});

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  app.listen(PORT, () => console.log(`谁是人类：http://localhost:${PORT}${demoMode ? '（演示模式）' : ''}`));
}

export { app };
