import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoomManager, ServerSnapshot } from '../src/server/room';
import { SnapshotStore } from '../src/server/persistence';
import { GamePhase } from '../src/server/game';
import { GameMode, Rank, Suit } from '../src/shared/types';

class Socket {
  listeners = new Map<string, Function[]>();
  messages: { event: string; data: any }[] = [];
  rooms = new Set<string>();
  constructor(public id: string) {}
  on(event: string, fn: Function) { this.listeners.set(event, [...(this.listeners.get(event) || []), fn]); }
  off(event: string, fn: Function) { this.listeners.set(event, (this.listeners.get(event) || []).filter(f => f !== fn)); }
  removeAllListeners(event: string) { this.listeners.delete(event); }
  emit(event: string, data: any) { this.messages.push({ event, data }); }
  join(room: string) { this.rooms.add(room); }
  leave(room: string) { this.rooms.delete(room); }
  receive(event: string, data?: any) { for (const fn of this.listeners.get(event) || []) fn(data); }
  last(event: string) { return this.messages.filter(m => m.event === event).slice(-1)[0]?.data; }
}
function setup(t: any) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guandan-game-recovery-'));
  const store = new SnapshotStore<ServerSnapshot>(path.join(directory, 'rooms.json'));
  const sockets: Socket[] = [];
  const io = { to: (room: string) => ({ emit: (event: string, data: any) => sockets.filter(s => s.rooms.has(room)).forEach(s => s.emit(event, data)) }) };
  const managers: RoomManager[] = [];
  const manager = () => { const value = new RoomManager(io as any, store); managers.push(value); return value; };
  const room = (m: RoomManager): any => (m as any).rooms.get('room');
  const join = (m: RoomManager, name: string) => {
    const socket = new Socket(`${name}-${sockets.length}`); sockets.push(socket);
    m.joinRoom(socket as any, name, 'room'); return socket;
  };
  t.after(() => {
    managers.forEach(m => (m as any).rooms.forEach((r: any) => r.match?.forceEndMatch()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, manager, room, join };
}
const card = (id: string, rank: Rank = Rank.Three) => ({ id, rank, suit: Suit.Spades });

test('snapshot allowlists runtime resources and restores a frozen bot turn', async t => {
  const f = setup(t); const original = f.manager(); const host = f.join(original, 'Alice'); host.receive('start');
  const game = f.room(original).match.currentGame;
  game.currentTurn = 1; game.broadcastGameState();
  const before = f.store.load()!;
  assert.ok(!JSON.stringify(before).includes('socket'));
  assert.ok(!JSON.stringify(before).includes('Timeout'));
  f.room(original).match.forceEndMatch();
  const restored = f.manager(); const recovered = f.room(restored).match.currentGame;
  assert.deepEqual(recovered.snapshot(), before.rooms[0].match!.currentGame);
  await new Promise(r => setTimeout(r, 900));
  assert.deepEqual(recovered.snapshot(), before.rooms[0].match!.currentGame, 'no human has returned: no bot timer runs');
  const replacement = f.join(restored, 'Alice');
  assert.equal(replacement.last('gameState').hands[1], recovered.hands[1].length);
  recovered.handleBotTurn(1);
  assert.deepEqual(recovered.snapshot(), before.rooms[0].match!.currentGame, 'rejoin grace also blocks automation');
  recovered.resumeAfterRestart();
  recovered.handleBotTurn(1);
  assert.notDeepEqual(recovered.hands, before.rooms[0].match!.currentGame!.hands);
});

test('partial tribute and return state survives without transferring cards twice', t => {
  for (const phase of [GamePhase.Tribute, GamePhase.ReturnTribute]) {
    const f = setup(t); const original = f.manager();
    const players = [0, 1, 2, 3].map(i => f.join(original, `P${i}`)); players[0].receive('start');
    const match = f.room(original).match; const game = match.currentGame;
    game.currentPhase = phase; game.prevWinners = [0, 2, 1, 3];
    match.lastWinners = [0, 2, 1, 3];
    game.hands = [[card('a'), card('paid', Rank.Ace)], [card('b')], [card('c')], [card('d')]];
    game.tributeState = phase === GamePhase.Tribute
      ? { pendingTributes: [{ from: 3, to: 0, card: card('paid', Rank.Ace) }, { from: 1, to: 2 }], pendingReturns: [] }
      : { pendingTributes: [], pendingReturns: [{ from: 0, to: 3 }, { from: 2, to: 1, card: card('returned') }], nextStartPlayer: 3 };
    game.broadcastGameState();
    const expected = f.store.load()!.rooms[0].match!.currentGame;
    match.forceEndMatch();
    const restored = f.manager(); const recovered = f.room(restored).match.currentGame;
    assert.deepEqual(recovered.snapshot(), expected);
    const socket = f.join(restored, 'P0');
    assert.deepEqual(socket.last('gameState').tributeState, expected!.tributeState);
    assert.deepEqual(recovered.hands, expected!.hands);
  }
});

test('Score restores post-score levels exactly once and starts one next round', async t => {
  const f = setup(t); const original = f.manager();
  [0, 1, 2, 3].forEach(i => f.join(original, `P${i}`));
  const room = f.room(original); room.startGame();
  const match = room.match; const game = match.currentGame;
  game.winners = [0, 2, 1, 3]; game.endGame();
  assert.equal(match.teamLevels[0], 5);
  const expected = f.store.load()!.rooms[0].match!;
  match.forceEndMatch();
  const restored = f.manager(); const recovered = f.room(restored).match;
  assert.deepEqual(recovered.snapshot(), expected);
  assert.equal(recovered.currentGame.currentPhase, GamePhase.Score);
  // Rebind directly to use a short test grace period without starting the default one.
  const returning = new Socket('returned');
  recovered.players[0].socket = returning;
  recovered.players[0].isDisconnected = false;
  recovered.resumeAfterRestart(5);
  await new Promise(r => setTimeout(r, 25));
  assert.equal(recovered.teamLevels[0], 5);
  assert.equal(recovered.currentGame.currentRound, 2);
  assert.equal(recovered.currentGame.prevWinners.length, 4);
});

test('malformed or unsupported state does not get replaced by an empty server', t => {
  const f = setup(t);
  for (const value of [false, 0, '', [], { version: 999, rooms: [] }, { version: 1, rooms: [{ id: 'bad' }] }]) {
    f.store.save(value as any);
    assert.throws(() => f.manager());
    assert.deepEqual(f.store.load(), value);
  }
});

test('finished match and explicit lobby leave are durable and do not resurrect', t => {
  const f = setup(t); const original = f.manager(); const host = f.join(original, 'Alice'); host.receive('start');
  const match = f.room(original).match;
  match.matchWinner = 0; match.broadcastMatchEnd(0);
  assert.equal(f.store.load()!.rooms[0].match, null);
  host.receive('leaveRoom');
  assert.deepEqual(f.store.load()!.rooms, []);
  assert.deepEqual(f.manager().getRoomList(), []);
});

test('finishing a recovered round preserves the restart grace instead of starting a second timer', async t => {
  const f = setup(t); const original = f.manager();
  [0, 1, 2, 3].forEach(i => f.join(original, `P${i}`));
  f.room(original).startGame(); f.room(original).match.forceEndMatch();
  const restored = f.manager(); const match = f.room(restored).match;
  const returning = new Socket('returning');
  match.players[0].socket = returning; match.players[0].isDisconnected = false;
  match.resumeAfterRestart(50);
  const game = match.currentGame;
  game.winners = [0, 2, 1, 3]; game.endGame();
  assert.equal(match.nextGameTimer, null, 'ordinary 3-second timer must not shorten recovery grace');
  assert.equal(match.currentGame, game);
  await new Promise(r => setTimeout(r, 80));
  assert.notEqual(match.currentGame, game);
  assert.equal(match.currentGame.currentRound, 2);
  assert.equal(match.teamLevels[0], 5);
});

test('leaving before restart grace expires keeps the game frozen until another human returns', async t => {
  const f = setup(t); const original = f.manager(); const host = f.join(original, 'Alice'); host.receive('start');
  f.room(original).match.forceEndMatch();
  const restored = f.manager(); const match = f.room(restored).match;
  const game = match.currentGame; const before = structuredClone(game.snapshot());
  match.resumeAfterRestart(5);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(match.recovered, true);
  game.handleBotTurn(0);
  assert.deepEqual(game.snapshot(), before);
  assert.equal(match.recoveryTimer, null, 'a later returning human must be able to arm a fresh grace');
});

test('finishing the whole restored match cancels its recovery timer and removes durable game state', t => {
  const f = setup(t); const original = f.manager(); const host = f.join(original, 'Alice'); host.receive('start');
  f.room(original).match.forceEndMatch();
  const restored = f.manager(); f.join(restored, 'Alice');
  const match = f.room(restored).match;
  assert.ok(match.recoveryTimer);
  match.matchWinner = 0; match.broadcastMatchEnd(0);
  assert.equal(match.recoveryTimer, null);
  assert.equal(match.nextGameTimer, null);
  assert.equal(f.store.load()!.rooms[0].match, null);
});

test('storage failure does not acknowledge leave or broadcast unsaved game state', t => {
  const f = setup(t); const manager = f.manager(); const host = f.join(manager, 'Alice'); host.receive('start');
  const saved = f.store.load();
  const states = host.messages.filter(m => m.event === 'gameState').length;
  f.store.save = () => { throw new Error('simulated disk unavailable'); };
  assert.throws(() => f.room(manager).match.currentGame.broadcastGameState(), /disk unavailable/);
  assert.equal(host.messages.filter(m => m.event === 'gameState').length, states);
  assert.throws(() => host.receive('leaveRoom'), /disk unavailable/);
  assert.equal(host.last('leftRoom'), undefined);
  assert.equal(host.messages.filter(m => m.event === 'leftRoom').length, 0);
  assert.deepEqual(f.store.load(), saved);
});
