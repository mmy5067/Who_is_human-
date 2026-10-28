import test from 'node:test';
import assert from 'node:assert/strict';

// No paid API calls in tests, even when the developer has a local .env.
process.env.DEMO_MODE = 'true';
const { app } = await import('../server.js');

test('demo HTTP endpoints work without exposing credentials or calling models', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const configResponse = await fetch(`${base}/api/config`);
  assert.equal(configResponse.status, 200);
  assert.equal(configResponse.headers.get('x-content-type-options'), 'nosniff');
  const config = await configResponse.json();
  assert.equal(config.demoMode, true);
  assert.equal(config.agents.length, 3);
  assert.ok(config.agents.every((agent) => typeof agent.model === 'string' && agent.model.length > 0));
  for (const agent of config.agents) {
    assert.deepEqual(Object.keys(agent).sort(), ['enableThinking', 'model', 'provider'].filter((key) => key !== 'model' || agent.model !== undefined).sort());
    assert.equal('apiKey' in agent, false);
    assert.equal('baseURL' in agent, false);
  }
  const topic = await fetch(`${base}/api/topic`, { method: 'POST' }).then((r) => r.json());
  assert.equal(typeof topic.topic, 'string');
  assert.equal(topic.fallbackUsed, true);
  const action = await fetch(`${base}/api/act`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentIndex: 2, action: 'statement', selfId: 'P1', cycle: 1, topic: topic.topic,
      players: [{ id: 'P1', name: 'NOVA', alive: true }, { id: 'P2', name: 'MIRA', alive: true }], transcript: [] }),
  });
  assert.equal(action.status, 200);
  const statement = await action.json();
  assert.equal(typeof statement.content, 'string');
  assert.ok(statement.content.includes(config.agents[2].model));
  assert.doesNotMatch(statement.content, /undefined/);
  const invalidAction = await fetch(`${base}/api/act`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentIndex: 99, action: 'vote' }),
  });
  assert.equal(invalidAction.status, 400);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /谁是人类/);
  const envFile = await fetch(`${base}/.env`);
  assert.equal(envFile.status, 404);
});
