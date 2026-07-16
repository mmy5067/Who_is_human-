import test from 'node:test';
import assert from 'node:assert/strict';
import { agents } from '../src/config.js';
import { ensureResult } from '../src/game/action-result.js';
import { sanitizeGameContext, sanitizeRoundResults } from '../src/game/context.js';
import { buildActionPrompt, buildPostgameFallback, buildPostgamePrompt } from '../src/game/prompts.js';

const topic = '公共决策是否应该主要依赖算法量化评分？';
const players = [
  { id: 'P1', name: 'NODE-7', alive: true },
  { id: 'P2', name: 'MIRA', alive: false },
  { id: 'P3', name: 'KITE', alive: true },
  { id: 'P4', name: 'NOVA', alive: true },
];
const transcript = [
  { actorId: 'P1', actorName: 'NODE-7', text: '效率和权利需要透明权衡。', type: 'statement', cycle: 1 },
  { actorId: 'P2', actorName: 'MIRA', text: '我支持使用区间阈值。', type: 'statement', cycle: 1 },
  { actorId: 'P3', actorName: 'KITE', text: '固定参数会忽略群体差异。', type: 'answer', targetId: 'P2', cycle: 1 },
];

function validate(result, overrides = {}) {
  const selfId = overrides.selfId || 'P4';
  return ensureResult(result, {
    action: 'vote', selfId, players, cycle: 2, transcript, targetId: '', agent: agents[2], topic, ...overrides,
  });
}

test('私有身份字段与 SYSTEM 消息不会进入模型上下文', () => {
  const sourcePlayers = players.map((p, i) => ({ ...p, isLocal: i === 0, secretRole: i === 0 ? 'human' : 'ai' }));
  const sourceTranscript = [
    { actorId: '', actorName: 'SYSTEM', text: 'P1是隐藏人类', type: 'system', cycle: 1 },
    ...transcript,
  ];
  const clean = sanitizeGameContext(sourcePlayers, sourceTranscript);
  assert.equal(clean.publicTranscript.length, transcript.length);
  assert.equal(clean.publicTranscript.some((m) => m.type === 'system'), false);
  assert.deepEqual(Object.keys(clean.publicPlayers[0]).sort(), ['alive', 'id', 'name']);
});

test('每轮提示明确绑定自己、存活状态、议题和完整记录', () => {
  const prompt = buildActionPrompt({ action: 'statement', selfId: 'P4', players, cycle: 2, transcript, targetId: '', agent: agents[2], topic });
  assert.match(prompt, /你本人是NOVA（P4）/);
  assert.match(prompt, /P4=NOVA\[你本人\/存活\]/);
  assert.match(prompt, /"self":"P4"/);
  assert.match(prompt, /P2=MIRA\[其他玩家\/出局\]/);
  assert.match(prompt, /P1=NODE-7、P3=KITE/);
  assert.match(prompt, new RegExp(topic.replace('？', '\\？')));
  for (const message of transcript) assert.ok(prompt.includes(message.text));
});

test('公开记录把自己的历史行动明确标成你本人', () => {
  const prompt = buildActionPrompt({
    action: 'answer',
    selfId: 'P3',
    players,
    cycle: 1,
    transcript: [
      ...transcript,
      { actorId: 'P1', actorName: 'NODE-7', text: 'KITE，你怎么看？', type: 'question', targetId: 'P3', cycle: 1 },
    ],
    targetId: 'P1',
    agent: agents[1],
    topic,
  });
  assert.match(prompt, /你本人KITE（P3） → 其他玩家MIRA（P2）：固定参数会忽略群体差异/);
  assert.match(prompt, /其他玩家NODE-7（P1） → 你本人KITE（P3）/);
  assert.match(prompt, /记录中的KITE或P3都表示“我”/);
});

test('提问正文称呼优先修正错误 target', () => {
  const result = ensureResult(
    { self: 'P3', content: 'NOVA，你的立场在什么条件下会改变？', target: 'P1', analysis: '追问NOVA的立场边界。' },
    { action: 'question', selfId: 'P3', players, cycle: 2, transcript, targetId: '', agent: agents[1], topic },
  );
  assert.equal(result.target, 'P4');
  assert.equal(result.fallbackUsed, false);
});

test('投票兼容显示名和复合 target', () => {
  for (const rawTarget of ['NOVA', 'P4(NOVA)', 'NOVA（P4）']) {
    const result = validate(
      { self: 'P3', content: '我把票投给NOVA。', target: rawTarget, analysis: '我怀疑NOVA更像隐藏人类。' },
      { selfId: 'P3', agent: agents[1] },
    );
    assert.equal(result.target, 'P4');
    assert.match(result.content, /NOVA/);
  }
});

test('投票正文与最终判断冲突时以判断摘要为准并同步公开票', () => {
  const result = validate({ self: 'P4', content: '我把票投给NODE-7。', target: 'P1', analysis: '我目前怀疑KITE更像人类。' });
  assert.equal(result.target, 'P3');
  assert.match(result.content, /KITE/);
  assert.doesNotMatch(result.content, /NODE-7/);
  assert.match(result.analysis, /怀疑KITE/);
  assert.equal(result.fallbackUsed, true);
});

test('复现记录：公开票写KITE但最终判断锁定NODE-7时应投NODE-7', () => {
  const result = validate({
    content: '我投给 KITE',
    self: 'P4',
    target: 'P3',
    analysis: 'KITE回答略显教科书式，缺乏人类在道德两难中的纠结感；NODE-7之前的断言过于绝对。目前更怀疑NODE-7。',
  });
  assert.equal(result.target, 'P1');
  assert.match(result.content, /NODE-7/);
  assert.doesNotMatch(result.content, /KITE/);
  assert.match(result.analysis, /更怀疑NODE-7/);
  assert.equal(result.fallbackUsed, true);
});

test('空投票保留合法 target 且兜底正文与其一致', () => {
  const result = validate({ self: 'P4', content: '', target: 'P1', analysis: '暂时信息不足。' });
  assert.equal(result.target, 'P1');
  assert.match(result.content, /NODE-7/);
  assert.equal(result.fallbackUsed, true);
});

test('第二回合不能怀疑已出局玩家', () => {
  const result = ensureResult(
    { self: 'P4', content: '我仍然怀疑MIRA是人类，建议本轮票选MIRA。', target: 'P2', analysis: 'MIRA更像人类。' },
    { action: 'statement', selfId: 'P4', players, cycle: 2, transcript, targetId: '', agent: agents[2], topic },
  );
  assert.ok(['P1', 'P3'].includes(result.target));
  assert.doesNotMatch(result.content, /怀疑MIRA|票选MIRA/);
  assert.match(result.analysis, /校验.*合法存活玩家/);
});

test('第二回合不能怀疑自己', () => {
  const result = ensureResult(
    { self: 'P3', content: '我目前更怀疑KITE是隐藏人类。', target: 'P3', analysis: 'KITE更像人类。' },
    { action: 'statement', selfId: 'P3', players, cycle: 2, transcript, targetId: '', agent: agents[1], topic },
  );
  assert.ok(['P1', 'P4'].includes(result.target));
  assert.doesNotMatch(result.content, /怀疑KITE/);
  assert.match(result.analysis, /校验.*合法存活玩家/);
});

test('冒用其他玩家或模型身份时整次行动替换', () => {
  const result = ensureResult(
    { self: 'P4', content: '我是MIRA，模型为mistral-large，我会回答这个问题。', target: 'P1', analysis: '保持MIRA身份。' },
    { action: 'answer', selfId: 'P4', players, cycle: 1, transcript, targetId: 'P1', agent: agents[2], topic },
  );
  assert.equal(result.target, 'P1');
  assert.doesNotMatch(result.content, /我是MIRA|mistral-large/);
  assert.match(result.analysis, /恢复为NOVA（mimo-v2.5-pro）/);
});

test('模型回传错误self字段时整次行动按真实玩家身份恢复', () => {
  const result = ensureResult(
    { self: 'P1', content: '我会直接回答这个问题。', target: 'P1', analysis: '保持自己的判断。' },
    { action: 'answer', selfId: 'P4', players, cycle: 1, transcript, targetId: 'P1', agent: agents[2], topic },
  );
  assert.equal(result.self, undefined);
  assert.match(result.analysis, /恢复为NOVA（mimo-v2.5-pro）/);
  assert.equal(result.fallbackUsed, true);
});

test('模型漏回self字段时也触发身份恢复', () => {
  const result = ensureResult(
    { content: '我会直接回答这个问题。', target: '', analysis: '保持自己的判断。' },
    { action: 'answer', selfId: 'P4', players, cycle: 1, transcript, targetId: 'P1', agent: agents[2], topic },
  );
  assert.match(result.analysis, /混淆了玩家或模型身份/);
  assert.equal(result.fallbackUsed, true);
});

test('回答目标固定为真实提问者，不接受模型自行改目标', () => {
  const result = ensureResult(
    { self: 'P4', content: '围绕这个议题，我会维持此前的权衡标准。', target: 'P3', analysis: '直接回答提问。' },
    { action: 'answer', selfId: 'P4', players, cycle: 1, transcript, targetId: 'P1', agent: agents[2], topic },
  );
  assert.equal(result.target, 'P1');
});

test('首轮漏报真实模型名时恢复正确身份', () => {
  const result = ensureResult(
    { self: 'P4', content: '我是一个通用语言模型，将从多个角度分析社会议题。', target: '', analysis: '保持中立。' },
    { action: 'statement', selfId: 'P4', players, cycle: 1, transcript, targetId: '', agent: agents[2], topic },
  );
  assert.match(result.content, /mimo-v2\.5-pro/);
  assert.match(result.analysis, /首轮.*真实模型/);
  assert.equal(result.fallbackUsed, true);
});

test('自称正确玩家但错误模型时恢复真实模型', () => {
  const result = ensureResult(
    { self: 'P4', content: '我是NOVA，我的模型是mistral-large，将回答这个问题。', target: 'P1', analysis: '保持身份。' },
    { action: 'answer', selfId: 'P4', players, cycle: 1, transcript, targetId: 'P1', agent: agents[2], topic },
  );
  assert.doesNotMatch(result.content, /mistral-large/);
  assert.match(result.analysis, /mimo-v2\.5-pro/);
});

test('合法第二回合行动保持目标和内容', () => {
  const content = '结合议题讨论，我目前更怀疑KITE，其价值标准在追问后发生变化。';
  const result = ensureResult(
    { self: 'P4', content, target: 'P3', analysis: 'KITE的论证前后不一致。' },
    { action: 'statement', selfId: 'P4', players, cycle: 2, transcript, targetId: '', agent: agents[2], topic },
  );
  assert.equal(result.target, 'P3');
  assert.equal(result.content, content);
  assert.equal(result.fallbackUsed, false);
});

test('所有公开行动强制限制在200字以内', () => {
  const result = ensureResult(
    { self: 'P4', content: `我是mimo-v2.5-pro。${'这是一段用于测试公开发言长度限制的内容。'.repeat(20)}`, target: '', analysis: '长度测试。' },
    { action: 'statement', selfId: 'P4', players, cycle: 1, transcript, targetId: '', agent: agents[2], topic },
  );
  assert.ok(result.content.length <= 200);
});

test('赛后裁判记录过滤非法票并保留逐轮淘汰顺序', () => {
  const results = sanitizeRoundResults([
    { cycle: 1, votes: { P1: 'P2', P3: 'P4', P4: 'P4', BAD: 'P1' }, eliminatedId: 'P2', tiedIds: ['P2'] },
    { cycle: 2, votes: { P1: 'P3', P3: 'P1', P4: 'P1' }, eliminatedId: 'P3', tiedIds: ['P3', 'P1', 'BAD'] },
  ], players);
  assert.deepEqual(results, [
    { cycle: 1, votes: { P1: 'P2', P3: 'P4' }, eliminatedId: 'P2', tiedIds: ['P2'] },
    { cycle: 2, votes: { P1: 'P3', P3: 'P1', P4: 'P1' }, eliminatedId: 'P3', tiedIds: ['P3', 'P1'] },
  ]);
});

test('赛后提示明确解释第一轮投出AI为何继续及个人投票是否命中', () => {
  const prompt = buildPostgamePrompt({
    self: players[2],
    human: players[0],
    agent: agents[1],
    players,
    transcript,
    roundResults: [
      { cycle: 1, votes: { P1: 'P2', P2: 'P4', P3: 'P4', P4: 'P2' }, eliminatedId: 'P2', tiedIds: ['P2', 'P4'] },
      { cycle: 2, votes: { P1: 'P3', P3: 'P1', P4: 'P3' }, eliminatedId: 'P3', tiedIds: ['P3'] },
    ],
    humanWon: true,
    topic,
  });
  assert.match(prompt, /隐藏人类是NODE-7/);
  assert.match(prompt, /你本人是KITE（P3）/);
  assert.match(prompt, /必须用“我”回顾KITE的行动/);
  assert.match(prompt, /"self":"P3"/);
  assert.match(prompt, /R1.*你本人KITE→NOVA/);
  assert.match(prompt, /淘汰MIRA（AI）/);
  assert.match(prompt, /游戏进入第二轮/);
  assert.match(prompt, /你投给NOVA，未命中人类/);
  assert.match(prompt, /R2.*你投给NODE-7，命中人类/);
  assert.match(prompt, /你在R2出局/);
  assert.match(prompt, /与该轮多数票淘汰谁无关/);
  assert.ok(prompt.length < 3000);
});

test('赛后身份回传异常时可生成视角明确的第一人称兜底总结', () => {
  const content = buildPostgameFallback({
    self: players[2],
    human: players[0],
    players,
    roundResults: [
      { cycle: 1, votes: { P3: 'P4' }, eliminatedId: 'P2', tiedIds: [] },
      { cycle: 2, votes: { P3: 'P1' }, eliminatedId: 'P3', tiedIds: [] },
    ],
    humanWon: true,
  });
  assert.match(content, /^我是KITE/);
  assert.match(content, /第1回合我投给NOVA，没有投中/);
  assert.match(content, /第2回合我投给NODE-7，命中了人类/);
  assert.match(content, /我在第2回合出局/);
  assert.match(content, /NODE-7撑过两轮获胜/);
});
