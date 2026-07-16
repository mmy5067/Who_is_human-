const MAX_PLAYERS = 4;
const MAX_TRANSCRIPT_ITEMS = 100;

export function sanitizeGameContext(players, transcript) {
  const publicPlayers = (Array.isArray(players) ? players : [])
    .slice(0, MAX_PLAYERS)
    .map((player) => ({
      id: String(player?.id || '').slice(0, 24),
      name: String(player?.name || '').slice(0, 48),
      alive: player?.alive !== false,
    }))
    .filter((player) => player.id && player.name);

  const playerById = new Map(publicPlayers.map((player) => [player.id, player]));
  const publicTranscript = (Array.isArray(transcript) ? transcript : [])
    .slice(-MAX_TRANSCRIPT_ITEMS)
    .filter((message) => message && message.type !== 'system' && playerById.has(String(message.actorId)))
    .map((message) => ({
      actorId: String(message.actorId),
      actorName: playerById.get(String(message.actorId)).name,
      text: String(message.text || '').slice(0, 1200),
      type: String(message.type || 'speech').slice(0, 24),
      targetId: playerById.has(String(message.targetId)) ? String(message.targetId) : '',
      cycle: [1, 2].includes(Number(message.cycle)) ? Number(message.cycle) : 1,
    }));

  return { publicPlayers, publicTranscript };
}

export function sanitizeRoundResults(roundResults, players) {
  const playerIds = new Set(players.map((player) => player.id));
  const seenCycles = new Set();

  return (Array.isArray(roundResults) ? roundResults : [])
    .slice(0, 2)
    .flatMap((round) => {
      const cycle = Number(round?.cycle);
      const eliminatedId = String(round?.eliminatedId || '');
      if (![1, 2].includes(cycle) || seenCycles.has(cycle) || !playerIds.has(eliminatedId)) return [];
      seenCycles.add(cycle);

      const votes = Object.fromEntries(
        Object.entries(round?.votes || {})
          .map(([voterId, targetId]) => [String(voterId), String(targetId)])
          .filter(([voterId, targetId]) => playerIds.has(voterId) && playerIds.has(targetId) && voterId !== targetId),
      );
      const tiedIds = [...new Set((Array.isArray(round?.tiedIds) ? round.tiedIds : [])
        .map(String)
        .filter((id) => playerIds.has(id)))];

      return [{ cycle, votes, eliminatedId, tiedIds }];
    })
    .sort((left, right) => left.cycle - right.cycle);
}

export function resolvePlayerTarget(rawTarget, candidates) {
  const value = String(rawTarget || '').trim().replace(/^["'`]|["'`]$/g, '').toLowerCase();
  if (!value) return '';
  const compact = value.replace(/\s+/g, '');

  return candidates.find((player) => {
    const id = player.id.toLowerCase();
    const name = player.name.toLowerCase();
    return compact === id
      || compact === name
      || compact.startsWith(`${id}(`)
      || compact.startsWith(`${id}（`)
      || compact.startsWith(`${name}(`)
      || compact.startsWith(`${name}（`);
  })?.id || '';
}

export function playerName(players, id, fallback = id) {
  return players.find((player) => player.id === id)?.name || fallback;
}
