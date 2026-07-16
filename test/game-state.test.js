import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, resetGameState, resolveVotes, shuffle } from '../public/game-state.js';

function sequenceRandom(values) {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

test('新游戏重置所有跨局状态并生成一名本地玩家', () => {
  const state = createGameState();
  state.topic = '旧议题';
  state.transcript.push({ text: '旧记录' });
  state.roundResults.push({ cycle: 1 });

  const human = resetGameState(state, sequenceRandom([0.1, 0.2, 0.3, 0.4]));
  assert.equal(state.players.length, 4);
  assert.equal(state.players.filter((player) => player.isLocal).length, 1);
  assert.equal(human.id, state.humanId);
  assert.equal(state.topic, '');
  assert.deepEqual(state.transcript, []);
  assert.deepEqual(state.roundResults, []);
  assert.equal(Object.keys(state.thoughts).length, 3);
});

test('计票返回票数、全部平票候选和最终淘汰者', () => {
  const result = resolveVotes({ P1: 'P2', P2: 'P1', P3: 'P2', P4: 'P1' }, () => 0.99);
  assert.deepEqual(result.tally, { P2: 2, P1: 2 });
  assert.deepEqual(result.tiedIds, ['P2', 'P1']);
  assert.equal(result.eliminatedId, 'P1');
});

test('空票仓不能进入结算', () => {
  assert.throws(() => resolveVotes({}), /没有可结算的投票/);
});

test('Fisher-Yates 洗牌可通过注入随机源稳定测试', () => {
  assert.deepEqual(shuffle(['A', 'B', 'C'], sequenceRandom([0, 0])), ['B', 'C', 'A']);
});
