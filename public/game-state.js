export const PLAYER_NAMES = ['NODE-7', 'MIRA', 'KITE', 'NOVA'];

export function createGameState() {
  return {
    config: null,
    players: [],
    humanId: '',
    topic: '',
    cycle: 1,
    transcript: [],
    thoughts: {},
    busy: false,
    feedFilter: 'all',
    humanResolve: null,
    votes: {},
    roundResults: [],
  };
}

export function resetGameState(state, random = Math.random) {
  const seats = shuffle(PLAYER_NAMES, random);
  const humanSeat = Math.floor(random() * seats.length);
  state.players = seats.map((name, index) => ({
    id: `P${index + 1}`,
    name,
    isLocal: index === humanSeat,
    agentIndex: index < humanSeat ? index : index - 1,
    alive: true,
  }));
  state.humanId = state.players[humanSeat].id;
  state.topic = '';
  state.cycle = 1;
  state.transcript = [];
  state.thoughts = Object.fromEntries(state.players.filter((player) => !player.isLocal).map((player) => [player.id, []]));
  state.votes = {};
  state.roundResults = [];
  return state.players[humanSeat];
}

export function resolveVotes(votes, random = Math.random) {
  const tally = {};
  for (const targetId of Object.values(votes)) tally[targetId] = (tally[targetId] || 0) + 1;
  if (!Object.keys(tally).length) throw new Error('没有可结算的投票');
  const maxVotes = Math.max(...Object.values(tally));
  const tiedIds = Object.keys(tally).filter((id) => tally[id] === maxVotes);
  const eliminatedId = tiedIds[Math.floor(random() * tiedIds.length)];
  return { tally, tiedIds, eliminatedId };
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}
