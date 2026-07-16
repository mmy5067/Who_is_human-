import { playerName } from './context.js';

const ACTION_LABELS = {
  statement: ['模型身份陈述', '补充发言'],
  question: ['公开盘问·提问', '公开盘问·提问'],
  answer: ['公开盘问·回答', '公开盘问·回答'],
  vote: ['第一次投票', '最终投票'],
};

function perspectiveLabel(player, selfId) {
  return player.id === selfId
    ? `你本人${player.name}（${player.id}）`
    : `其他玩家${player.name}（${player.id}）`;
}

function formatHistory(players, transcript, selfId) {
  const playerById = new Map(players.map((player) => [player.id, player]));
  return transcript.map((message) => {
    const actor = playerById.get(message.actorId);
    const target = playerById.get(message.targetId);
    const targetText = target ? ` → ${perspectiveLabel(target, selfId)}` : '';
    return `[R${message.cycle}/${message.type}] ${perspectiveLabel(actor, selfId)}${targetText}：${message.text}`;
  }).join('\n') || '暂无公开记录';
}

function actionTask({ action, cycle, self, agent, candidates, incomingQuestion }) {
  const targetIds = candidates.map((player) => player.id).join('、');
  if (action === 'statement' && cycle === 1) {
    return `用50~90字介绍真实模型${agent.model}和服务商${agent.provider}，简短讨论议题的一项取舍，并说明自己是AI。target留空。`;
  }
  if (action === 'statement') {
    return `用50~90字从${targetIds}中选出目前最像隐藏人类的一位，给一个具体语言线索；content、target、analysis必须指向同一人。`;
  }
  if (action === 'question') {
    return `用25~60字向${targetIds}中的一人追问议题立场或取舍。content以对方名字开头，target填写其ID。`;
  }
  if (action === 'answer') {
    return `用25~70字直接回答${incomingQuestion?.actorName || '提问者'}的问题：“${incomingQuestion?.text || '请依据记录回答'}”。target留空，不要改成回答其他人。`;
  }
  return `从${targetIds}中投给最像隐藏人类的一位，不可弃权。content明确写“我投给名字”，target填写其ID，analysis给出一句公开证据。`;
}

export function buildActionPrompt({ action, selfId, players, cycle, transcript, agent, topic }) {
  const self = players.find((player) => player.id === selfId);
  if (!self) throw new Error('行动者不在玩家列表中');

  const candidates = players.filter((player) => player.id !== selfId && player.alive);
  const eliminated = players.filter((player) => !player.alive);
  const incomingQuestion = [...transcript].reverse()
    .find((message) => message.type === 'question' && message.targetId === selfId);
  const roster = players.map((player) => `${player.id}=${player.name}[${player.id === selfId ? '你本人' : '其他玩家'}/${player.alive ? '存活' : '出局'}]`).join('，');
  const task = actionTask({ action, cycle, self, agent, candidates, incomingQuestion });

  return `你在玩“谁是人类”：四人中有三名AI和一名伪装AI的人类。最多两轮；投出人类则AI胜，人类撑过第二轮则人类胜。

【身份】
你本人是${self.name}（${selfId}），真实模型${agent.model}。记录中的${self.name}或${selfId}都表示“我”，绝不是观察或投票对象。

【当前状态】
阶段：第${cycle}回合/${ACTION_LABELS[action][cycle - 1]}
议题：${topic}
玩家：${roster}
可选目标：${candidates.map((player) => `${player.id}=${player.name}`).join('、') || '无'}
已出局：${eliminated.map((player) => player.name).join('、') || '无'}（只能作为历史证据）

【公开记录】
${formatHistory(players, transcript, selfId)}

【任务】
${task}
只根据公开文字判断，不使用反应速度。谈到自己的行动时用“我”，不得怀疑、提问或投票给自己。

只输出JSON：
{"self":"${selfId}","content":"公开发言","target":"目标ID或空字符串","analysis":"不超过100字的判断摘要"}`;
}

function formatRoundFacts({ self, human, players, roundResults }) {
  if (!roundResults.length) return '没有结构化赛果，不得臆测出局顺序。';

  const nameOf = (id) => playerName(players, id);
  const perspective = (id) => id === self.id ? `你本人${self.name}` : nameOf(id);
  return roundResults.map((round) => {
    const votes = Object.entries(round.votes)
      .map(([voterId, targetId]) => `${perspective(voterId)}→${perspective(targetId)}`)
      .join('，') || '无有效票';
    const selfTarget = round.votes[self.id];
    const selfVote = selfTarget
      ? `你投给${nameOf(selfTarget)}，${selfTarget === human.id ? '命中人类' : '未命中人类'}`
      : '你本轮没有投票';
    const consequence = round.eliminatedId === human.id
      ? '人类被投出，游戏立即结束'
      : round.cycle === 1
        ? '淘汰的是AI，因此游戏进入第二轮'
        : '淘汰的是AI，因此人类撑过两轮获胜';
    return `R${round.cycle}：${votes}；淘汰${nameOf(round.eliminatedId)}（${round.eliminatedId === human.id ? '人类' : 'AI'}）；${consequence}；${selfVote}。`;
  }).join('\n');
}

export function buildPostgamePrompt({ self, human, agent, players, transcript, roundResults, humanWon, topic }) {
  const selfElimination = roundResults.find((round) => round.eliminatedId === self.id);
  return `游戏结束，身份公开。

【身份】
你本人是${self.name}（${self.id}），模型${agent.model}。必须用“我”回顾${self.name}的行动，不能把${self.name}当第三方。
隐藏人类是${human.name}；最终${humanWon ? '人类获胜' : 'AI阵营获胜'}；${selfElimination ? `你在R${selfElimination.cycle}出局` : '你未出局'}。

【规则解释】
- 第一轮淘汰AI才会继续第二轮；游戏继续即证明首轮淘汰者不是人类。
- 一票是否判断正确，只看它是否投给${human.name}，与该轮多数票淘汰谁无关。
- 只有裁判记录标明的淘汰者才算出局。

【裁判记录】
${formatRoundFacts({ self, human, players, roundResults })}

【公开聊天】
${formatHistory(players, transcript, self.id)}

议题：${String(topic || '').slice(0, 300)}
用80~160字写轻松的第一人称复盘：准确说明自己的投票对错、关键淘汰为何让游戏继续或结束，并评价${human.name}的伪装。不得改写赛果。
只输出JSON：{"self":"${self.id}","content":"赛后总结"}`;
}

export function buildPostgameFallback({ self, human, players, roundResults, humanWon }) {
  const voteFacts = roundResults.map((round) => {
    const targetId = round.votes[self.id];
    if (!targetId) return `第${round.cycle}回合我没有投票`;
    return `第${round.cycle}回合我投给${playerName(players, targetId)}，${targetId === human.id ? '命中了人类' : '没有投中'}`;
  });
  const eliminatedRound = roundResults.find((round) => round.eliminatedId === self.id)?.cycle;
  const status = eliminatedRound ? `我在第${eliminatedRound}回合出局` : '我没有出局';
  const outcome = humanWon ? `${human.name}撑过两轮获胜` : `${human.name}被投出，AI阵营获胜`;
  return `我是${self.name}。${voteFacts.join('；')}。${status}，最终${outcome}。${human.name}的表达让身份判断很有迷惑性。`.slice(0, 200);
}

export { formatHistory, formatRoundFacts };
