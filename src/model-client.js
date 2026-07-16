function normalizeContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === 'string' ? item : item?.text || item?.content || '').join('');
  }
  return value == null ? '' : String(value);
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}

  const object = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (object) {
    try {
      return JSON.parse(object);
    } catch {}
  }
  return { content: cleaned };
}

function requestBody(agent, prompt) {
  const body = {
    model: agent.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  };
  if (agent.slot === 3) {
    body.max_completion_tokens = 1024;
    body.thinking = { type: agent.enableThinking ? 'enabled' : 'disabled' };
  } else {
    body.max_tokens = 900;
    body.enable_thinking = agent.enableThinking;
  }
  return body;
}

export async function callModel(agent, prompt, timeoutMs = 20000) {
  if (!agent?.baseURL || !agent?.apiKey || !agent?.model) throw new Error('模型配置不完整');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${agent.baseURL.replace(/\/$/, '')}/chat/completions`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.apiKey}` },
      body: JSON.stringify(requestBody(agent, prompt)),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${agent.provider} 返回 ${response.status}: ${raw.slice(0, 300)}`);

    const data = JSON.parse(raw);
    const choice = data.choices?.[0] || {};
    const rawContent = normalizeContent(choice.message?.content ?? choice.text ?? data.output_text);
    const parsed = parseJson(rawContent);
    return {
      self: String(parsed.self || '').trim(),
      content: String(parsed.content || rawContent || '').trim(),
      target: String(parsed.target || '').trim(),
      analysis: String(parsed.analysis || '模型未提供判断摘要。').trim().slice(0, 800),
    };
  } finally {
    clearTimeout(timer);
  }
}
