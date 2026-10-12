/** Run with: npx ts-node test-room-lifecycle.ts. No server or browser required. */
import assert from 'node:assert/strict';
import { RoomManager } from './src/server/room';
import { Card, GameMode, Rank, SkillCardType, Suit } from './src/shared/types';

type Listener = (...args: any[]) => void;
class FakeSocket {
  rooms = new Set<string>();
  listeners = new Map<string, Listener[]>();
  sent: { event: string; data: any }[] = [];
  constructor(public id: string, private io: FakeIO) { io.sockets.push(this); }
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
  }
  off(event: string, listener: Listener) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter(value => value !== listener));
  }
  removeAllListeners(event: string) { this.listeners.delete(event); }
  emit(event: string, data?: any) { this.sent.push({ event, data }); }
  join(room: string) { this.rooms.add(room); }
  leave(room: string) { this.rooms.delete(room); }
  receive(event: string, data?: any) { [...(this.listeners.get(event) || [])].forEach(listener => listener(data)); }
  count(event: string) { return this.sent.filter(message => message.event === event).length; }
  last(event: string) { const messages = this.sent.filter(message => message.event === event); return messages[messages.length - 1]?.data; }
}
class FakeIO {
  sockets: FakeSocket[] = [];
  to(room: string) {
    return { emit: (event: string, data?: any) => this.sockets.filter(socket => socket.rooms.has(room)).forEach(socket => socket.emit(event, data)) };
  }
}
function fixture() {
  const io = new FakeIO();
  const manager = new RoomManager(io as any);
  return {
    io,
    manager,
    socket: (id: string) => new FakeSocket(id, io),
    join: (socket: FakeSocket, name: unknown, room: unknown = 'test') => manager.joinRoom(socket as any, name, room),
    room: (id = 'test'): any => (manager as any).rooms.get(id),
    destroy: () => (manager as any).rooms.forEach((room: any) => room.match?.forceEndMatch())
  };
}
function card(id: string, rank = Rank.Three): Card { return { id, suit: Suit.Spades, rank }; }
let passed = 0;
function test(name: string, run: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture();
  const log = console.log;
  try {
    console.log = () => undefined;
    run(f);
    passed++;
  } finally {
    f.destroy();
    console.log = log;
  }
  console.log(`ok ${name}`);
}

test('join validates and trims identities before creating a room', f => {
  const socket = f.socket('alice');
  for (const name of [undefined, null, {}, 42, '', '   ', 'x'.repeat(11)]) {
    f.join(socket, name);
    assert.equal(f.manager.getRoomList().length, 0);
  }
  f.join(socket, 'Alice', {});
  f.join(socket, 'Alice', 'r'.repeat(41));
  assert.equal(f.manager.getRoomList().length, 0);
  f.join(socket, ' Alice ', ' office ');
  assert.equal(f.room('office').players[0].name, 'Alice');
  assert.equal(socket.last('roomState').roomId, 'office');
});

test('blank room name retains the default room', f => {
  const socket = f.socket('alice');
  f.join(socket, 'Alice', '   ');
  assert.equal(socket.last('roomState').roomId, 'default');
});

test('rejected room switch keeps the player in the original room', f => {
  const socket = f.socket('alice');
  f.join(socket, 'Alice', 'original');
  for (let i = 0; i < 4; i++) f.join(f.socket(`full-${i}`), `Guest${i}`, 'full');
  f.join(socket, 'Alice', 'full');
  assert.equal(socket.last('error'), '房间已满');
  assert.ok(f.room('original').hasSocket(socket));
  assert.ok(socket.rooms.has('original'));
  assert.equal(socket.count('leftRoom'), 0);
  f.join(socket, 'x'.repeat(11), 'invalid');
  assert.ok(f.room('original').hasSocket(socket));
});

test('active duplicate names are rejected, including trimmed names', f => {
  const first = f.socket('first');
  const second = f.socket('second');
  f.join(first, 'Alice');
  f.join(second, ' Alice ');
  assert.equal(second.last('error'), '这个名字已经在房间里');
  assert.equal(second.count('roomState'), 0);
  assert.equal(f.room().players.filter(Boolean).length, 1);
});

test('seat, mode and chat validation preserve room state', f => {
  const socket = f.socket('alice');
  f.join(socket, 'Alice');
  const room = f.room();
  for (const seat of [undefined, null, {}, -1, 4, 1.5, NaN, '1']) socket.receive('switchSeat', seat);
  assert.equal(room.getSeat(socket), 0);
  socket.receive('switchSeat', 2);
  assert.equal(room.getSeat(socket), 2);
  assert.equal(room.players[2].isHost, true);
  socket.receive('setGameMode', 'bad-mode');
  assert.equal(room.gameMode, GameMode.Normal);
  socket.receive('setGameMode', GameMode.Skill);
  assert.equal(room.gameMode, GameMode.Skill);
  for (const text of [undefined, {}, 42, '', '  ', 'x'.repeat(201)]) socket.receive('chatMessage', text);
  assert.equal(socket.count('chatMessage'), 0);
  socket.receive('chatMessage', '  hello  ');
  assert.equal(socket.last('chatMessage').text, 'hello');
  socket.receive('chatMessage', 'x'.repeat(200));
  assert.equal(socket.count('chatMessage'), 2);
});

test('leaving a live game isolates state, actions and listener cleanup across rooms', f => {
  const socket = f.socket('alice');
  f.join(socket, 'Alice', 'A');
  socket.receive('start');
  const oldGame = f.room('A').match.currentGame;
  oldGame.hands[0] = [card('old-a'), card('old-b')];
  const staleListener = socket.listeners.get('playHand')![0];
  socket.receive('leaveRoom');
  assert.equal(oldGame.players[0].socket, undefined);
  assert.equal(oldGame.players[0].isDisconnected, true);
  assert.equal(socket.listeners.get('playHand')?.length, 0);
  f.join(socket, 'Alice', 'B');
  socket.receive('start');
  const newGame = f.room('B').match.currentGame;
  newGame.hands[0] = [card('new-a'), card('new-b')];
  const states = socket.count('gameState');
  oldGame.broadcastGameState();
  assert.equal(socket.count('gameState'), states, 'old room must not deliver private hands');
  staleListener({ cards: [card('old-a')] });
  assert.equal(oldGame.hands[0].length, 2, 'detached handler must not control old seat');
  oldGame.destroy();
  assert.equal(socket.listeners.get('playHand')?.length, 1, 'old cleanup must keep new game handler');
  socket.receive('playHand', { cards: [card('new-a')] });
  assert.equal(newGame.hands[0].length, 1);
});

test('reconnect restores same seat and complete state while old socket stays inert', f => {
  const original = f.socket('old-id');
  f.join(original, 'Alice');
  original.receive('start');
  const room = f.room();
  const game = room.match.currentGame;
  game.hands[0] = [card('a'), card('b')];
  const staleListener = original.listeners.get('playHand')![0];
  f.manager.handleDisconnect(original as any);
  const replacement = f.socket('new-id');
  f.join(replacement, 'Alice');
  assert.equal(room.getSeat(replacement), 0);
  assert.equal(room.players[0].isHost, true);
  assert.equal(room.players.filter(Boolean).length, 4);
  assert.equal(replacement.sent[0].event, 'roomState');
  assert.equal(replacement.sent[1].event, 'gameState');
  assert.equal(replacement.last('gameState').hands[0].length, 2);
  game.handleBotTurn(0);
  staleListener({ cards: [card('a')] });
  assert.equal(game.hands[0].length, 2, 'reconnect cancels automated and stale socket control');
  replacement.receive('playHand', { cards: [card('a')] });
  assert.equal(game.hands[0].length, 1);
});

test('malformed game payloads and invalid skill targets do not crash or mutate hands', f => {
  const socket = f.socket('alice');
  f.join(socket, 'Alice');
  socket.receive('setGameMode', GameMode.Skill);
  socket.receive('start');
  const game = f.room().match.currentGame;
  game.hands[0] = [card('a'), card('b')];
  game.skillCards[0] = [{ id: 'test-steal', type: SkillCardType.Steal }];
  for (const value of [undefined, null, 'text', {}, { cards: {} }, [null], [{}]]) {
    assert.doesNotThrow(() => socket.receive('playHand', value));
    assert.doesNotThrow(() => socket.receive('tribute', value));
    assert.doesNotThrow(() => socket.receive('returnTribute', value));
    assert.doesNotThrow(() => socket.receive('useSkill', value));
  }
  for (const targetSeat of [-1, 4, 1.5, NaN, '1', {}]) {
    assert.doesNotThrow(() => socket.receive('useSkill', { skillId: 'test-steal', targetSeat }));
  }
  assert.equal(game.hands[0].length, 2);
  assert.equal(game.skillCards[0].length, 1);
});

test('finished matches release listeners and all-ready players can start again', f => {
  const sockets = [0, 1, 2, 3].map(i => f.socket(`p${i}`));
  sockets.forEach((socket, i) => f.join(socket, `Player${i}`));
  sockets[0].receive('start');
  const room = f.room();
  const firstMatch = room.match;
  firstMatch.matchWinner = 0;
  firstMatch.broadcastMatchEnd(0);
  assert.equal(room.match, null);
  sockets.forEach(socket => {
    assert.equal(socket.listeners.get('playHand')?.length, 0);
    socket.receive('ready');
  });
  assert.ok(room.match);
  assert.notEqual(room.match, firstMatch);
  sockets.forEach(socket => assert.equal(socket.listeners.get('playHand')?.length, 1));
});

test('match-ending skill does not overwrite matchOver with a stale Score state', f => {
  const socket = f.socket('alice');
  f.join(socket, 'Alice');
  socket.receive('setGameMode', GameMode.Skill);
  socket.receive('start');
  const match = f.room().match;
  const game = match.currentGame;
  match.teamLevels[0] = 14;
  match.consecutiveWins[0] = 1;
  game.winners = [0];
  game.currentTurn = 1;
  game.hands = [[], [card('b')], [card('c')], [card('d')]];
  game.skillCards[1] = [{ id: 'last-card', type: SkillCardType.Discard }];
  game.handleUseSkill(1, 'last-card', 2);
  assert.equal(f.room().match, null);
  const matchOver = socket.sent.findIndex(message => message.event === 'matchOver');
  assert.ok(matchOver >= 0);
  assert.ok(!socket.sent.slice(matchOver + 1).some(message => message.event === 'gameState'));
});

console.log(`${passed} room lifecycle regressions passed.`);
