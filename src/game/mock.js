export function mockAct({ agentIndex, action, selfId, players, cycle, transcript, targetId, topic }) {
  const others = players.filter((player) => player.id !== selfId && player.alive);
  const suspect = others[(agentIndex + cycle) % Math.max(others.length, 1)] || others[0];
  const lastQuestion = [...transcript].reverse().find((message) => message.type === 'question' && message.targetId === selfId);
  const suspectName = suspect?.name || '另一位玩家';

  const content = {
    statement: cycle === 1
      ? [
        `我是 ecnu-max。对“${topic}”，我会同时权衡公共收益、个体权利和执行成本。我是AI，不是隐藏人类。`,
        `我是 qwen3.7-plus。分析“${topic}”时，我会区分原则、现实约束和副作用。我确实是AI。`,
        `我是 mimo-v2.5-pro。对“${topic}”，我关注权利边界、责任主体与纠错机制。我是AI。`,
      ][agentIndex]
      : `我目前更怀疑${suspectName}。TA在追问后的取舍标准出现了缺乏解释的变化，更像临场维护立场的人类。`,
    question: `${suspectName}，针对“${topic}”，你的立场在什么条件下会改变？`,
    answer: lastQuestion
      ? `我的核心取舍没有改变；如果加入新条件，我会明确说明结论变化的边界。`
      : `我会依据公共收益、权利边界和执行风险保持一致回答。`,
    vote: `我投给${suspectName}。TA的表达有几处像是在主动管理“自然感”。`,
  }[action];

  return {
    self: selfId,
    content,
    target: ['question', 'vote'].includes(action) || (action === 'statement' && cycle > 1) ? suspect?.id || '' : targetId || '',
    analysis: `演示判断：${suspectName}的措辞更具即时性，因此提高怀疑权重。`,
  };
}
