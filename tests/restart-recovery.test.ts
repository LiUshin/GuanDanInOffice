/**
 * Black-box recovery tests. Build first, then run with:
 * node --require ts-node/register --test tests/restart-recovery.test.ts
 *
 * Every crash is a real SIGKILL while the players are still connected. These
 * tests deliberately do not import Room, Match, or Game or fake their timers.
 */
import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test, TestContext } from 'node:test';
import { io, Socket } from 'socket.io-client';
import { Card, GameMode, HistoryEntry, SkillCard, SkillCardType } from '../src/shared/types';

const root = path.resolve(__dirname, '..');
const entrypoint = path.join(root, 'dist/server/index.js');
const timeout = 6000;

interface GameState {
  phase: string;
  currentTurn: number;
  hands: (Card[] | number)[];
  lastHand: { playerIndex: number; hand: { cards: Card[] } } | null;
  history: HistoryEntry[];
  mySkillCards: SkillCard[];
  skipNextTurn: boolean[];
  gameMode: GameMode;
  [key: string]: any;
}

class Client {
  readonly socket: Socket;
  readonly messages: { event: string; data: any }[] = [];

  constructor(url: string) {
    this.socket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'], timeout });
    this.socket.onAny((event, data) => this.messages.push({ event, data }));
  }

  async connect() {
    const connected = this.wait('connect');
    this.socket.connect();
    await connected;
  }

  wait<T = any>(event: string, predicate: (value: T) => boolean = () => true): Promise<T> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off(event, listener);
        this.socket.off('error', failed);
        this.socket.off('connect_error', failed);
      };
      const listener = (value: T) => {
        if (!predicate(value)) return;
        cleanup();
        resolve(value);
      };
      const failed = (error: unknown) => {
        cleanup();
        reject(new Error(`Socket failed while awaiting ${event}: ${String(error)}`));
      };
      const timer = setTimeout(() => failed(`timed out after ${timeout} ms`), timeout);
      this.socket.on(event, listener);
      this.socket.on('error', failed);
      this.socket.on('connect_error', failed);
    });
  }

  latest<T = any>(event: string): T {
    const messages = this.messages.filter(message => message.event === event);
    assert.ok(messages.length, `expected a ${event} event`);
    return messages[messages.length - 1].data;
  }

  async roomList() {
    const response = this.wait<any[]>('roomList');
    this.socket.emit('getRoomList');
    return response;
  }
}

async function freePort(): Promise<number> {
  const reservation = net.createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const connection = net.createConnection({ port, host: '127.0.0.1' });
    const finish = (open: boolean) => {
      connection.destroy();
      resolve(open);
    };
    connection.once('connect', () => finish(true));
    connection.once('error', () => finish(false));
    connection.setTimeout(200, () => finish(false));
  });
}

class ServerFixture {
  readonly directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guandan-restart-'));
  readonly filename = path.join(this.directory, 'rooms.json');
  readonly clients: Client[] = [];
  child: ChildProcess | undefined;
  exited: Promise<void> | undefined;
  logs = '';
  port = 0;

  constructor(context: TestContext) {
    context.after(async () => {
      // Kill first: disconnecting clients would mutate the snapshot under test.
      if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill('SIGKILL');
      }
      await this.exited;
      this.clients.forEach(client => client.socket.disconnect());
      fs.rmSync(this.directory, { recursive: true, force: true });
    });
  }

  async launch() {
    assert.ok(fs.existsSync(entrypoint), 'Run npm run build before the restart tests');
    assert.ok(!this.child || this.child.exitCode !== null || this.child.signalCode !== null, 'previous server is still running');
    this.port = await freePort();
    this.logs = '';
    const child = spawn(process.execPath, [entrypoint], {
      cwd: root,
      env: { ...process.env, PORT: String(this.port), GUANDAN_DATA_DIR: this.directory },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.child = child;
    this.exited = new Promise(resolve => {
      child.once('close', () => resolve());
      child.once('error', error => { this.logs += String(error); resolve(); });
    });
    const capture = (chunk: Buffer) => { this.logs = (this.logs + chunk.toString()).slice(-12000); };
    child.stdout!.on('data', capture);
    child.stderr!.on('data', capture);
  }

  async start() {
    await this.launch();
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.child!.exitCode !== null || this.child!.signalCode !== null) {
        throw new Error(`Server exited during startup:\n${this.logs}`);
      }
      if (await portIsOpen(this.port)) return;
      await delay(25);
    }
    throw new Error(`Server never listened on its port:\n${this.logs}`);
  }

  async client() {
    const client = new Client(`http://127.0.0.1:${this.port}`);
    this.clients.push(client);
    await client.connect();
    return client;
  }

  async crash(connected: Client[] = []) {
    connected.forEach(client => assert.equal(client.socket.connected, true, 'players must remain connected until SIGKILL'));
    assert.ok(this.child?.kill('SIGKILL'));
    await this.exited;
    assert.equal(this.child!.signalCode, 'SIGKILL', 'restart must not rely on the graceful shutdown hook');
    // Only clean up the old clients after the server process has died.
    this.clients.forEach(client => client.socket.disconnect());
  }

  snapshot() { return JSON.parse(fs.readFileSync(this.filename, 'utf8')); }
}

async function join(client: Client, name: string, roomId: string, restoredGame = false) {
  const start = client.messages.length;
  const room = client.wait('roomState');
  const game = restoredGame ? client.wait<GameState>('gameState') : undefined;
  client.socket.emit('joinRoom', { playerName: name, roomId });
  await room;
  if (game) {
    await game;
    const events = client.messages.slice(start).map(message => message.event);
    assert.ok(events.indexOf('roomState') < events.indexOf('gameState'), 'seat identity must arrive before the private hand');
  }
}

function seats(room: any) {
  return room.players.map((player: any) => player && ({
    name: player.name, seatIndex: player.seatIndex, isHost: !!player.isHost, isBot: !!player.isBot
  }));
}

function states(clients: Client[]) { return clients.map(client => client.latest<GameState>('gameState')); }

function assertPrivateStates(values: GameState[]) {
  values.forEach((state, seat) => {
    assert.equal(state.hands.length, 4);
    state.hands.forEach((hand, owner) => {
      if (owner === seat) assert.ok(Array.isArray(hand), `seat ${seat} must receive its own cards`);
      else {
        assert.equal(typeof hand, 'number', `seat ${seat} must not receive seat ${owner}'s cards`);
        assert.equal(hand, (values[owner].hands[owner] as Card[]).length);
      }
    });
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'skillCards'), false, 'other players skill cards must remain private');
  });
}

async function action(clients: Client[], seat: number, event: string, data?: unknown) {
  const historyLength = clients[seat].latest<GameState>('gameState').history.length;
  const updates = clients.map(client => client.wait<GameState>('gameState', state => state.history.length > historyLength));
  clients[seat].socket.emit(event, data);
  const result = await Promise.all(updates);
  assertPrivateStates(result);
  return result;
}

async function rejoinAll(fixture: ServerFixture, roomId: string, names: string[], game: boolean, graceCheck = false) {
  const clients: Client[] = [];
  // Reconnect out of seat order, with the host last. Identity cannot depend on
  // connection order, and a returning guest must not acquire host privileges.
  for (const seat of [3, 1, 2, 0]) {
    clients[seat] = await fixture.client();
    await join(clients[seat], names[seat], roomId, game);
    if (graceCheck && seat === 3) {
      const before = fixture.snapshot().rooms[0].match.currentGame;
      await delay(1100); // Longer than the 800 ms auto-play delay, within grace.
      assert.deepEqual(fixture.snapshot().rooms[0].match.currentGame, before, 'a single reconnect must not immediately trigger disconnected players');
    }
  }
  return clients;
}

for (const mode of [GameMode.Normal, GameMode.Skill]) {
  test(`${mode}: SIGKILL restores exact private state, subsequent actions, and durable removal`, { timeout: 35000 }, async context => {
    const fixture = new ServerFixture(context);
    const roomId = `restart-${mode}`;
    const names = ['Alice', 'Bob', 'Carol', 'David'];
    await fixture.start();
    let players: Client[] = [];
    for (const name of names) {
      const player = await fixture.client();
      players.push(player);
      await join(player, name, roomId);
    }
    if (mode === GameMode.Skill) {
      const changed = players[0].wait('roomState', state => state.gameMode === mode);
      players[0].socket.emit('setGameMode', mode);
      await changed;
    }
    const originalSeats = seats(players[0].latest('roomState'));
    assert.equal(originalSeats.filter((player: any) => player.isBot).length, 0);
    const dealt = players.map(player => player.wait<GameState>('gameState', state => state.phase === 'Playing'));
    players[0].socket.emit('start');
    assertPrivateStates(await Promise.all(dealt));

    if (mode === GameMode.Skill) {
      const available = players[0].latest<GameState>('gameState').mySkillCards;
      assert.equal(available.length, 2);
      const skill = available.find(card => card.type === SkillCardType.Skip) || available[0];
      const targeted = [SkillCardType.Skip, SkillCardType.Steal, SkillCardType.Discard].includes(skill.type);
      await action(players, 0, 'useSkill', { skillId: skill.id, ...(targeted ? { targetSeat: 3 } : {}) });
      assert.equal(players[0].latest<GameState>('gameState').mySkillCards.length, 1);
      if (skill.type === SkillCardType.Skip) assert.equal(players[0].latest<GameState>('gameState').skipNextTurn[3], true);
    }
    const card = (players[0].latest<GameState>('gameState').hands[0] as Card[])[0];
    await action(players, 0, 'playHand', { cards: [card] });
    await action(players, 1, 'pass');
    const before = states(players);
    assert.equal(before[0].currentTurn, 2);
    assert.equal(before[0].lastHand!.hand.cards[0].id, card.id);
    assert.ok(before[0].history.some(entry => entry.type === 'Pass'));
    assert.equal(before[0].history.some(entry => entry.type === 'SkillUse'), mode === GameMode.Skill);
    const storedGame = fixture.snapshot().rooms[0].match.currentGame;
    assert.deepEqual(storedGame.hands, before.map((state, seat) => state.hands[seat]));
    assert.deepEqual(storedGame.history, before[0].history);

    await fixture.crash(players);
    await fixture.start();
    const observer = await fixture.client();
    const listing = await observer.roomList();
    assert.equal(listing[0].playerCount, 4);
    assert.equal(listing[0].inGame, true);
    assert.equal(listing[0].hostName, names[0]);
    if (mode === GameMode.Normal) {
      await delay(1100);
      assert.deepEqual(fixture.snapshot().rooms[0].match.currentGame, storedGame, 'recovered game must remain frozen with no humans rejoined');
    }
    players = await rejoinAll(fixture, roomId, names, true, mode === GameMode.Normal);
    assertPrivateStates(states(players));
    assert.deepEqual(states(players), before, 'all hands, skills, history, turn, and public state must survive byte-for-byte');
    assert.deepEqual(seats(players[0].latest('roomState')), originalSeats);
    assert.ok(players[0].latest<any>('roomState').players.every((player: any) => !player.isDisconnected));

    // Continue the interrupted trick, then prove that fresh history IDs and
    // actions survive another abrupt restart rather than reverting to boot.
    const advanced = await action(players, 2, 'pass');
    assert.notDeepEqual(advanced[0].history, before[0].history);
    assert.equal(new Set(advanced[0].history.map(entry => entry.id)).size, advanced[0].history.length);
    await fixture.crash(players);
    await fixture.start();
    players = await rejoinAll(fixture, roomId, names, true);
    assertPrivateStates(states(players));
    assert.deepEqual(states(players), advanced);

    const ended = players.map(player => player.wait('gameTerminated'));
    players[0].socket.emit('forceEndGame');
    await Promise.all(ended);
    await players[0].roomList(); // Ordered round trip after forceEndGame.
    assert.equal(fixture.snapshot().rooms[0].match, null);
    await fixture.crash(players);
    await fixture.start();
    players = await rejoinAll(fixture, roomId, names, false);
    assert.equal((await players[0].roomList())[0].inGame, false);
    for (const player of players) {
      await player.roomList(); // Flush events sent during that player's join.
      assert.equal(player.messages.some(message => message.event === 'gameState'), false, 'ended games must not be resurrected');
    }
    for (const player of players) {
      const left = player.wait('leftRoom');
      player.socket.emit('leaveRoom');
      await left;
    }
    assert.deepEqual(await players[0].roomList(), []);
    assert.deepEqual(fixture.snapshot().rooms, []);
    await fixture.crash(players);
    await fixture.start();
    assert.deepEqual(await (await fixture.client()).roomList(), [], 'deleted rooms must remain absent after another crash');
  });
}

test('waiting rooms retain mode, switched seats, and host after SIGKILL, but clear readiness', { timeout: 20000 }, async context => {
  const fixture = new ServerFixture(context);
  await fixture.start();
  const host = await fixture.client();
  await join(host, 'Host', 'lobby');
  const moved = host.wait('roomState', state => state.players[2]?.name === 'Host');
  host.socket.emit('switchSeat', 2);
  await moved;
  const mode = host.wait('roomState', state => state.gameMode === GameMode.Skill);
  host.socket.emit('setGameMode', GameMode.Skill);
  await mode;
  const guest = await fixture.client();
  await join(guest, 'Guest', 'lobby');
  const ready = host.wait('roomState', state => state.players[2]?.isReady);
  host.socket.emit('ready');
  const prior = await ready;
  assert.equal(prior.players[0].name, 'Guest');
  await fixture.crash([host, guest]);
  await fixture.start();
  const guestAgain = await fixture.client();
  const listing = await guestAgain.roomList();
  assert.equal(listing[0].hostName, 'Host');
  assert.equal(listing[0].gameMode, GameMode.Skill);
  assert.equal(listing[0].inGame, false);
  await join(guestAgain, 'Guest', 'lobby');
  const hostAgain = await fixture.client();
  await join(hostAgain, 'Host', 'lobby');
  const restored = hostAgain.latest<any>('roomState');
  assert.deepEqual(seats(restored), seats(prior));
  assert.ok(restored.players.filter(Boolean).every((player: any) => !player.isReady && !player.isDisconnected));
  await hostAgain.roomList();
  assert.equal(hostAgain.messages.some(message => message.event === 'gameState'), false);
  assert.equal(fixture.snapshot().rooms[0].match, null);
});

for (const [description, contents] of [
  ['malformed JSON', '{"private-player-name": invalid'],
  ['null JSON', 'null\n'],
  ['unsupported schema version', '{"version":999,"rooms":[]}\n'],
  ['invalid room structure', '{"version":1,"rooms":[{"id":"broken"}]}\n']
] as const) {
  test(`startup rejects ${description} without overwriting the saved file`, { timeout: 10000 }, async context => {
    const fixture = new ServerFixture(context);
    fs.writeFileSync(fixture.filename, contents);
    await fixture.launch();
    let timer: NodeJS.Timeout;
    try {
      await Promise.race([
        fixture.exited,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Invalid snapshot did not stop startup:\n${fixture.logs}`)), timeout); })
      ]);
    } finally {
      clearTimeout(timer!);
    }
    assert.notEqual(fixture.child!.exitCode, 0, 'invalid data must fail startup rather than silently reset');
    assert.equal(fixture.child!.signalCode, null, 'server should report failure itself');
    assert.match(fixture.logs, /snapshot/i, 'startup failure must identify the snapshot problem');
    assert.equal(fs.readFileSync(fixture.filename, 'utf8'), contents);
    assert.deepEqual(fs.readdirSync(fixture.directory), ['rooms.json']);
    assert.equal(await portIsOpen(fixture.port), false, 'invalid-state server must not accept clients');
    assert.equal(fixture.logs.includes('private-player-name'), false, 'errors must not dump saved player data');
  });
}
