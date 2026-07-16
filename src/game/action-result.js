import { playerName, resolvePlayerTarget } from './context.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function limitPublicContent(value, maxLength = 200) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const sentenceEnd = Math.max(clipped.lastIndexOf('。'), clipped.lastIndexOf('！'), clipped.lastIndexOf('？'));
  return sentenceEnd >= Math.floor(maxLength * 0.6)
    ? clipped.slice(0, sentenceEnd + 1)
    : `${clipped.slice(0, maxLength - 1)}…`;
}

export function inferDirectAddressee(content, candidates) {
  const opening = String(content || '').trim().slice(0, 40);
  return candidates.find((player) => new RegExp(`^(?:向\\s*)?${escapeRegex(player.name)}\\s*[，,：:]`, 'i').test(opening))?.id || '';
}

export function inferVoteTarget(content, candidates) {
  const text = String(content || '');
  return candidates.find((player) => {
    const pattern = new RegExp(`(?:投(?:票)?给|选择|票给)\\s*[《“"']?${escapeRegex(player.name)}(?=\\s|[，,。.!！?？》”"']|$)`, 'i');
    return pattern.test(text);
  })?.id || '';
}

export function inferExplicitSuspect(content, players) {
  const text = String(content || '');
  const matches = [];

  for (const player of players) {
    const name = escapeRegex(player.name);
    const patterns = [
      new RegExp(`我[^。！？\\n]{0,12}(?:怀疑|锁定|认为|判断)[^。！？\\n]{0,8}${name}`, 'ig'),
      new RegExp(`(?:目前|当前|最终|现阶段|综合来看)[^。！？\\n]{0,12}(?:更?怀疑|优先怀疑|锁定|认为|判断)[^。！？\\n]{0,8}${name}`, 'ig'),
      new RegExp(`(?:建议|应该|应当)[^。！？\\n]{0,24}(?:投|票选)[^。！？\\n]{0,8}${name}`, 'ig'),
      new RegExp(`${name}[^。！？\\n]{0,24}(?:最像|更像|是)(?:隐藏的)?人类`, 'ig'),
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) matches.push({ id: player.id, index: match.index || 0 });
    }
  }
  return matches.sort((left, right) => right.index - left.index)[0]?.id || '';
}

function inferClaimedIdentity(content, players) {
  const text = String(content || '');
  return players.find((player) => {
    const pattern = new RegExp(`(?:我是|作为|我的(?:玩家)?身份是|本玩家是)\\s*(?:玩家)?\\s*${escapeRegex(player.name)}(?=\\s|[，,。.!！]|$)`, 'i');
    return pattern.test(text);
  })?.id || '';
}

function inferClaimedModel(content) {
  const text = String(content || '');
  const explicit = text.match(/(?:我是\s*(?:AI\s*)?模型|我的模型\s*(?:是|为)|模型\s*(?:是|为))\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9._+-]{1,63})/i)?.[1];
  if (explicit) return explicit;
  const short = text.match(/我是\s+([A-Za-z][A-Za-z0-9._+-]{2,63})/i)?.[1] || '';
  return /^(?:ai|agent)$/i.test(short) ? '' : short;
}

function containsPrivateIdentityLeak(value) {
  const text = String(value || '');
  const player = '(?:P\\d+|NODE-7|MIRA|KITE|NOVA)';
  const systemReveal = new RegExp(`(?:系统|后台|私有信息|隐藏字段)(?:明确)?(?:提示|显示|告知|指定|标记)?[^。！？\\n]{0,40}${player}[^。！？\\n]{0,16}(?:是|为|属于)[^。！？\\n]{0,6}(?:人类|human)`, 'i');
  const reverseReveal = new RegExp(`${player}[^。！？\\n]{0,16}(?:是|为|属于)[^。！？\\n]{0,6}(?:人类|human)[^。！？\\n]{0,40}(?:系统|后台|私有信息|隐藏字段)`, 'i');
  return /\bisLocal\b/i.test(text) || systemReveal.test(text) || reverseReveal.test(text);
}

function inspectIdentity(result, { selfId, players, agent, action, cycle }) {
  const declaredSelf = String(result.self || '').trim();
  const resolvedSelf = declaredSelf ? resolvePlayerTarget(declaredSelf, players) : '';
  const claimedPlayer = inferClaimedIdentity(result.content, players);
  const claimedModel = inferClaimedModel(result.content);
  return {
    wrong: Boolean(
      resolvedSelf !== selfId
      || (claimedPlayer && claimedPlayer !== selfId)
      || (claimedModel && claimedModel.toLowerCase() !== agent.model.toLowerCase())
    ),
    missingModel: action === 'statement'
      && cycle === 1
      && !String(result.content || '').toLowerCase().includes(agent.model.toLowerCase()),
  };
}

function buildFallbacks({ actionTargetName, agent, lastQuestion, topic }) {
  return {
    statement: {
      first: `我是 ${agent.model}，由 ${agent.provider} 提供。对“${topic}”，我会权衡公共收益、个体权利和执行风险。我是AI玩家，不是隐藏人类。`,
      later: `目前我更怀疑${actionTargetName}。TA在“${topic}”的讨论中出现了缺乏解释的立场变化，更像在临场维护个人判断。`,
    },
    question: `${actionTargetName}，针对“${topic}”，你的立场在什么明确条件下会改变？`,
    answer: lastQuestion
      ? `我的核心取舍没有改变；如果问题加入新条件，我会说明结论变化的边界。`
      : `我会依据公共收益、权利边界和执行风险保持一致回答。`,
    vote: `我投给${actionTargetName}。TA的公开立场与后续论证一致性相对较弱。`,
  };
}

function resolveActionTarget({ action, result, candidates, players }) {
  const structured = resolvePlayerTarget(result.target, candidates);
  if (action === 'question') {
    const addressed = inferDirectAddressee(result.content, candidates);
    return { target: addressed || structured, explicit: addressed, structured };
  }
  if (action === 'vote') {
    const stated = inferVoteTarget(result.content, candidates);
    const analysis = resolvePlayerTarget(inferExplicitSuspect(result.analysis, players), candidates);
    return { target: analysis || structured || stated, explicit: stated, structured, analysis };
  }
  return { target: '' };
}

export function ensureResult(result, context) {
  const { action, selfId, players, cycle, transcript, targetId, agent, topic } = context;
  const self = players.find((player) => player.id === selfId);
  const candidates = players.filter((player) => player.id !== selfId && player.alive);
  const fallbackTarget = candidates[0]?.id || '';
  const targetInfo = resolveActionTarget({ action, result, candidates, players });
  const resolvedTarget = targetInfo.target || fallbackTarget;
  const actionTargetName = playerName(players, resolvedTarget, '这位玩家');
  const lastQuestion = [...transcript].reverse().find((message) => message.type === 'question' && message.targetId === selfId);
  const fallbacks = buildFallbacks({ actionTargetName, agent, lastQuestion, topic });

  const identity = inspectIdentity(result, { selfId, players, agent, action, cycle });
  const privateLeak = containsPrivateIdentityLeak(result.content) || containsPrivateIdentityLeak(result.analysis);
  const analysisSuspect = resolvePlayerTarget(inferExplicitSuspect(result.analysis, players), candidates);

  const statementTarget = cycle > 1 && action === 'statement'
    ? inferExplicitSuspect(result.content, players) || resolvePlayerTarget(result.target, players)
    : '';
  const invalidStatement = action === 'statement' && cycle > 1 && (
    !statementTarget
    || statementTarget === selfId
    || players.find((player) => player.id === statementTarget)?.alive === false
    || (analysisSuspect && analysisSuspect !== statementTarget)
  );

  const missingTarget = ['question', 'vote'].includes(action) && !targetInfo.target;
  const voteConflict = action === 'vote' && Boolean(
    (targetInfo.explicit && targetInfo.explicit !== resolvedTarget)
    || (targetInfo.structured && targetInfo.structured !== resolvedTarget)
  );
  const invalidContent = !String(result.content || '').trim()
    || privateLeak
    || identity.wrong
    || identity.missingModel
    || invalidStatement
    || missingTarget
    || (action === 'vote' && (!targetInfo.explicit || voteConflict));

  let analysis = String(result.analysis || '').trim()
    || `根据第${cycle}回合的公开措辞与前后一致性作出当前选择。`;
  if (privateLeak) {
    analysis = '隐私保护：已丢弃涉及非公开身份信息的内容。';
  } else if (identity.wrong) {
    analysis = `身份校验：原行动混淆了玩家或模型身份，已恢复为${self.name}（${agent.model}）。`;
  } else if (identity.missingModel) {
    analysis = `身份校验：首轮漏报真实模型，已恢复为${self.name}（${agent.model}）。`;
  } else if (invalidStatement) {
    analysis = `行动校验：补充发言未一致指向合法存活玩家，已改为关注${actionTargetName}。`;
  } else if (missingTarget) {
    analysis = `行动校验：模型未返回合法目标，已选择${actionTargetName}。`;
  }

  const fallbackContent = action === 'statement'
    ? (cycle === 1 ? fallbacks.statement.first : fallbacks.statement.later)
    : fallbacks[action];
  const finalTarget = action === 'answer'
    ? (candidates.some((player) => player.id === targetId) ? targetId : '')
    : action === 'statement'
      ? (cycle > 1 ? (invalidStatement ? fallbackTarget : statementTarget) : '')
      : resolvedTarget;

  return {
    content: limitPublicContent(invalidContent ? fallbackContent : result.content),
    target: finalTarget,
    analysis,
    reasoning: '',
    fallbackUsed: invalidContent || voteConflict,
    targetAdjusted: Boolean(finalTarget && finalTarget !== result.target),
  };
}
