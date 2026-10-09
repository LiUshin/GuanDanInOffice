import assert from 'node:assert/strict';
import { test, TestContext } from 'node:test';
import type { Server } from 'socket.io';
import { Match } from '../src/server/match';
import { GamePhase } from '../src/server/game';
import type { Player, ServerSnapshot } from '../src/server/room';
import { validateSnapshot } from '../src/server/snapshotValidation';
import { GameMode, Rank, SkillCardType } from '../src/shared/types';
import { getLargestCard, sortCards } from '../src/shared/rules';

const io = { to: () => ({ emit() {} }) } as unknown as Server;
const players = (): Player[] => [0, 1, 2, 3].map(seatIndex => ({
  id: `id-${seatIndex}`, name: `P${seatIndex}`, seatIndex,
  isReady: true, isHost: seatIndex === 0
}));

function createMatch(context: TestContext, mode = GameMode.Normal) {
  context.mock.method(console, 'log', () => {});
  const match = new Match(io, 'test', players(), mode);
  context.after(() => match.forceEndMatch());
  match.startMatch();
  return match;
}

function snapshot(match: Match): ServerSnapshot {
  // Exercise the on-disk representation, including omitted optional fields.
  return JSON.parse(JSON.stringify({ version: 1, rooms: [{
    id: 'test', gameMode: match.gameMode, players: match.players, match: match.snapshot()
  }] }));
}

function accepts(value: unknown) {
  assert.doesNotThrow(() => validateSnapshot(value));
}

function rejects(value: unknown) {
  assert.throws(() => validateSnapshot(value), /snapshot/i);
}

test('empty snapshots and occupied waiting rooms are valid', () => {
  accepts({ version: 1, rooms: [] });
  accepts({ version: 1, rooms: [{
    id: 'waiting', gameMode: GameMode.Normal,
    players: [players()[0], null, null, null], match: null
  }] });
});

test('malformed and falsy roots fail instead of being mistaken for missing state', () => {
  for (const value of [null, undefined, false, 0, '', [], {}, { version: 1 },
    { version: 1, rooms: null }, { version: 1, rooms: [{}] }]) rejects(value);
  for (const version of [undefined, null, false, 0, 2, '1']) {
    assert.throws(() => validateSnapshot({ version, rooms: [] }), /Unsupported snapshot version/);
  }
});

for (const mode of [GameMode.Normal, GameMode.Skill]) {
  test(`${mode} snapshots retain live play and partial finish orders`, context => {
    const match = createMatch(context, mode);
    accepts(snapshot(match));
    const game = match.currentGame!;
    assert.equal(game.handlePlayHand(0, [game.hands[0][0]]), true);
    accepts(snapshot(match));
    game.handlePass(1);
    accepts(snapshot(match));
    // Partial winners are ordinary mid-round state; they are not four-seat rosters.
    const partial = snapshot(match);
    partial.rooms[0].match!.currentGame!.winners = [0];
    accepts(partial);
    partial.rooms[0].match!.currentGame!.winners = [0, 1];
    accepts(partial);
  });

  test(`${mode} validates real Score, Tribute and ReturnTribute checkpoints`, context => {
    const match = createMatch(context, mode);
    const game = match.currentGame!;
    // A double-down deliberately ranks two players who still hold cards.
    game.hands[0] = [];
    game.hands[2] = [];
    game.winners = [0, 2, 1, 3];
    game.endGame();
    assert.equal(game.currentPhase, GamePhase.Score);
    assert.equal(match.teamLevels[0], 5);
    assert.equal(game.teamLevels[0], 2);
    accepts(snapshot(match));

    // Deterministic shuffle splits the big jokers across teams, preventing the
    // legitimate random anti-tribute shortcut from making this test flaky.
    const random = context.mock.method(Math, 'random', () => 0.5);
    match.startNextGame();
    random.mock.restore();
    const next = match.currentGame!;
    assert.equal(next.currentPhase, GamePhase.Tribute);
    assert.equal(next.currentRound, 2);
    assert.equal(next.level, 5);
    accepts(snapshot(match));
    for (const transfer of [...next.tributeState.pendingTributes]) {
      next.handleTribute(transfer.from, [getLargestCard(next.hands[transfer.from], next.level)]);
      accepts(snapshot(match));
    }
    assert.equal(next.currentPhase, GamePhase.ReturnTribute);
    for (const transfer of [...next.tributeState.pendingReturns]) {
      const held = next.hands[transfer.from];
      const legal = held.filter(card => card.rank <= Rank.Ten && card.rank !== next.level);
      const pool = sortCards(legal.length ? legal : held, next.level);
      next.handleReturnTribute(transfer.from, [pool[pool.length - 1]]);
      accepts(snapshot(match));
    }
    assert.equal(next.currentPhase, GamePhase.Playing);
    assert.equal(next.tributeState.pendingReturns.length, 0);
  });
}

test('skill-generated cards may have arbitrary IDs and hands may exceed deck sizes', context => {
  const match = createMatch(context, GameMode.Skill);
  const game = match.currentGame!;
  let seed = 123456;
  context.mock.method(Math, 'random', () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  });
  for (let index = 0; index < 60; index++) {
    assert.equal(game.applySkillEffect(SkillCardType.DrawTwo, 0), true);
  }
  assert.ok(game.hands[0].length > 108);
  game.hands[0][0].id = 'a generated card outside the original deck';
  accepts(snapshot(match));
});

test('humans and auto-filled bots may legitimately share a nickname', context => {
  const saved = snapshot(createMatch(context));
  saved.rooms[0].players[0]!.name = 'Bot 1';
  saved.rooms[0].players[1]!.name = 'Bot 1';
  saved.rooms[0].players[1]!.isBot = true;
  accepts(saved);
});

test('malformed nested state and unknown executable fields are rejected', context => {
  const original = snapshot(createMatch(context));
  const mutations: Array<[string, (value: any) => void]> = [
    ['four hands', s => s.rooms[0].match.currentGame.hands.pop()],
    ['held card IDs', s => s.rooms[0].match.currentGame.hands[1].push(s.rooms[0].match.currentGame.hands[0][0])],
    ['joker suit/rank', s => Object.assign(s.rooms[0].match.currentGame.hands[0][0], { suit: 4, rank: 2 })],
    ['card flags', s => { s.rooms[0].match.currentGame.hands[0][0].isWild = 'yes'; }],
    ['turn', s => { s.rooms[0].match.currentGame.currentTurn = 4; }],
    ['phase', s => { s.rooms[0].match.currentGame.currentPhase = 'sleep'; }],
    ['unrecoverable waiting phase', s => { s.rooms[0].match.currentGame.currentPhase = GamePhase.Waiting; }],
    ['unrecoverable dealing phase', s => { s.rooms[0].match.currentGame.currentPhase = GamePhase.Dealing; }],
    ['skills', s => { s.rooms[0].match.currentGame.skillCards[0] = [{ id: 's', type: 'hack' }]; }],
    ['skill seat count', s => s.rooms[0].match.currentGame.skillCards.pop()],
    ['skip seat count', s => s.rooms[0].match.currentGame.skipNextTurn.pop()],
    ['seat map', s => { s.rooms[0].match.currentGame.newCardIds = { 4: ['x'] }; }],
    ['timestamp', s => { s.rooms[0].match.currentGame.history[0].timestamp = -1; }],
    ['history counter', s => { s.rooms[0].match.currentGame.historyIdCounter = 0; }],
    ['history card', s => { s.rooms[0].match.currentGame.history[0].details = { card: { id: 'bad', suit: 100, rank: 3 } }; }],
    ['winner duplicates', s => { s.rooms[0].match.currentGame.winners = [0, 0]; }],
    ['round mismatch', s => s.rooms[0].match.roundNumber++],
    ['banker mismatch', s => { s.rooms[0].match.activeTeam = 1; }],
    ['level range', s => { s.rooms[0].match.teamLevels[0] = 15; }],
    ['streak without A', s => { s.rooms[0].match.consecutiveWins[0] = 1; }],
    ['seat index', s => { s.rooms[0].players[0].seatIndex = 2; }],
    ['player IDs', s => { s.rooms[0].players[1].id = s.rooms[0].players[0].id; }],
    ['missing player', s => { s.rooms[0].players[1] = null; }],
    ['player roster size', s => s.rooms[0].players.pop()],
    ['host duplicates', s => { s.rooms[0].players[1].isHost = true; }],
    ['room mode mismatch', s => { s.rooms[0].gameMode = GameMode.Skill; }],
    ['room IDs', s => s.rooms.push(s.rooms[0])],
    ['empty room ID', s => { s.rooms[0].id = ''; }],
    ['missing game', s => { s.rooms[0].match.currentGame = null; }],
    ['runtime callback', s => { s.rooms[0].match.currentGame.onStateChange = 'x'; }],
    ['socket', s => { s.rooms[0].players[0].socket = { secret: 'x' }; }],
    ['out-of-phase tribute', s => { s.rooms[0].match.currentGame.tributeState.pendingTributes = [{ from: 0, to: 1 }]; }],
    ['self tribute', s => {
      s.rooms[0].match.currentGame.currentPhase = GamePhase.Tribute;
      s.rooms[0].match.currentGame.tributeState.pendingTributes = [{ from: 0, to: 0 }];
    }]
  ];
  for (const [label, mutate] of mutations) {
    const changed = JSON.parse(JSON.stringify(original));
    mutate(changed);
    assert.throws(() => validateSnapshot(changed), /snapshot/i, label);
  }
});

test('Score checkpoints require the already-applied match progression', context => {
  const match = createMatch(context);
  match.currentGame!.winners = [0, 2, 1, 3];
  match.currentGame!.endGame();
  const saved = snapshot(match);
  accepts(saved);
  saved.rooms[0].match!.teamLevels[0] = 2;
  rejects(saved);
  const badWinners = snapshot(match);
  badWinners.rooms[0].match!.lastWinners = [1, 0, 2, 3];
  rejects(badWinners);
  const partial = snapshot(match);
  partial.rooms[0].match!.currentGame!.winners = [0, 2];
  rejects(partial);
});

test('history cannot introduce non-data values, prototype keys, or expose saved contents in errors', context => {
  const original = snapshot(createMatch(context));
  const dangerous = JSON.parse('{"__proto__":{"private-player-secret":true}}');
  const circular: { self?: unknown } = {};
  circular.self = circular;
  for (const details of [dangerous, circular, { callback() {} }, { value: Infinity }, { value: BigInt(1) }]) {
    const saved = JSON.parse(JSON.stringify(original));
    saved.rooms[0].match.currentGame.history[0].details = details;
    assert.throws(() => validateSnapshot(saved), error => {
      assert.equal((error as Error).message, 'Invalid snapshot data.');
      assert.ok(!(error as Error).message.includes('private-player-secret'));
      return true;
    });
  }
});
