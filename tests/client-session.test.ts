import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Socket } from 'socket.io-client';
import { socket as defaultSocket } from '../src/client/socket';
import { useGame, GameState } from '../src/client/useGame';
import { GameMode } from '../src/shared/types';
import { browserStorage, NAME_KEY, parseSession, readStorage, roomFromUrl, roomInviteUrl, SESSION_KEY, writeStorage } from '../src/client/session';

defaultSocket.disconnect();

class TestSocket {
  connected = true;
  id = 'first';
  listeners = new Map<string, Set<(...args: any[]) => void>>();
  sent: { event: string; payload: any }[] = [];
  on(event: string, listener: (...args: any[]) => void) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event)!.add(listener); return this; }
  off(event: string, listener: (...args: any[]) => void) { this.listeners.get(event)?.delete(listener); return this; }
  emit(event: string, payload: any) { this.sent.push({ event, payload }); return this; }
  connect() { return this; }
  receive(event: string, payload?: unknown) { this.listeners.get(event)?.forEach(listener => listener(payload)); }
}
const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
let current: ReturnType<typeof useGame>;
let socket: TestSocket;
let root: Root;
function Harness() { current = useGame(socket as unknown as Socket); return null; }
const room = (id = 'office') => ({ roomId: id, gameMode: GameMode.Normal, players: [{ id: socket.id, name: 'Alice', seatIndex: 0, isReady: false, isHost: true }, null, null, null] });
const game: GameState = { phase: 'Playing', level: 2, currentTurn: 0, hands: [[], 27, 27, 27], lastHand: null, winners: [] };
async function join() { await act(async () => current.actions.joinRoom('Alice', 'office')); await act(async () => socket.receive('roomState', room())); }

beforeEach(async () => {
  dom.window.localStorage.clear(); dom.window.sessionStorage.clear(); dom.window.history.replaceState(null, '', '/');
  socket = new TestSocket();
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); });
after(() => { defaultSocket.disconnect(); dom.window.close(); });

async function mount(strict = false) { await act(async () => root.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Harness)) : React.createElement(Harness))); }

test('session parser rejects corrupt/oversized values and storage failures are optional', () => {
  assert.equal(parseSession('not-json'), null);
  assert.equal(parseSession(JSON.stringify({ playerName: 42, roomId: 'office' })), null);
  assert.equal(parseSession(JSON.stringify({ playerName: 'x'.repeat(11), roomId: 'office' })), null);
  assert.deepEqual(parseSession(JSON.stringify({ playerName: ' Alice ', roomId: ' office ' })), { playerName: 'Alice', roomId: 'office' });
  assert.equal(readStorage({ getItem() { throw new Error('blocked'); } }, SESSION_KEY), null);
  assert.doesNotThrow(() => writeStorage({ setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }, SESSION_KEY, 'value'));
});
test('room invitations preserve origin/path and encode room identifiers', () => {
  assert.equal(roomInviteUrl('http://localhost/game?x=1#old', '中文 & room'), 'http://localhost/game?x=1&room=%E4%B8%AD%E6%96%87+%26+room');
  assert.equal(roomFromUrl('http://localhost/?room=%E5%8A%9E%E5%85%AC'), '办公');
});
test('room list action stays stable across results, preventing request/render loops', async () => {
  await mount();
  const fetch = current.actions.fetchRoomList;
  await act(async () => fetch());
  await act(async () => socket.receive('roomList', []));
  assert.equal(current.actions.fetchRoomList, fetch);
  assert.equal(socket.sent.filter(message => message.event === 'getRoomList').length, 1);
  assert.equal(current.roomListLoaded, true);
});
test('reconnect rejoins same identity, blocks offline moves, and restores authoritative hand', async () => {
  await mount(); await join();
  await act(async () => socket.receive('gameState', game));
  await act(async () => { socket.connected = false; socket.receive('disconnect'); });
  const sentBefore = socket.sent.length;
  await act(async () => { current.actions.passTurn(); current.actions.startGame(); current.actions.leaveRoom(); });
  assert.equal(socket.sent.length, sentBefore);
  await act(async () => { socket.id = 'new'; socket.connected = true; socket.receive('connect'); });
  assert.deepEqual(socket.sent[socket.sent.length - 1], { event: 'joinRoom', payload: { playerName: 'Alice', roomId: 'office' } });
  assert.equal(current.gameState, null);
  assert.equal(current.joining, true);
  await act(async () => { socket.receive('roomState', room()); socket.receive('gameState', game); });
  assert.equal(current.gameState?.phase, 'Playing'); assert.equal(current.mySeat, 0); assert.equal(current.joining, false);
});
test('same-room reconnect after a server restart or offline match end returns to waiting room', async () => {
  await mount(); await join(); await act(async () => socket.receive('gameState', game));
  await act(async () => { socket.connected = false; socket.receive('disconnect'); });
  await act(async () => { socket.connected = true; socket.receive('connect'); socket.receive('roomState', room()); });
  assert.equal(current.inRoom, true); assert.equal(current.gameState, null); assert.equal(current.joining, false);
});
test('leave clears session/chat, ignores late game events and permits a clean new room', async () => {
  await mount(); await join();
  await act(async () => socket.receive('chatMessage', { sender: 'Alice', text: 'hello', time: '', seatIndex: 0 }));
  await act(async () => socket.receive('leftRoom'));
  assert.equal(readStorage(browserStorage('sessionStorage'), SESSION_KEY), null);
  assert.equal(current.chatMessages.length, 0);
  await act(async () => socket.receive('gameState', game));
  assert.equal(current.gameState, null);
  await act(async () => { current.actions.joinRoom('Alice', 'another'); socket.receive('roomState', room('another')); });
  assert.equal(current.roomState?.roomId, 'another'); assert.equal(current.chatMessages.length, 0);
});
test('saved session restores only the matching invite room, including StrictMode', async () => {
  dom.window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ playerName: 'Alice', roomId: 'office' }));
  await mount(true);
  assert.equal(socket.sent.filter(message => message.event === 'joinRoom').length, 1);
  await act(async () => socket.receive('roomState', room()));
  assert.equal(current.inRoom, true); assert.equal(current.joining, false);
});
test('opening a different invite does not hijack a previously saved room', async () => {
  dom.window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ playerName: 'Alice', roomId: 'office' }));
  dom.window.history.replaceState(null, '', '/?room=another');
  await mount();
  assert.equal(socket.sent.filter(message => message.event === 'joinRoom').length, 0);
});
test('join errors release pending state and allow a corrected retry', async () => {
  await mount(); await act(async () => current.actions.joinRoom('Alice', 'office'));
  await act(async () => socket.receive('error', '这个名字已经在房间里'));
  assert.equal(current.joining, false); assert.equal(current.inRoom, false);
  await act(async () => current.actions.joinRoom('Bob', 'office'));
  assert.equal(socket.sent[socket.sent.length - 1]?.payload.playerName, 'Bob');
});
test('chat retains only current room latest 100 messages', async () => {
  await mount(); await join();
  await act(async () => { for (let i = 0; i < 105; i++) socket.receive('chatMessage', { sender: 'Alice', text: String(i), time: '', seatIndex: 0 }); });
  assert.equal(current.chatMessages.length, 100); assert.equal(current.chatMessages[0].text, '5');
});


test('StrictMode pending restore keeps a timeout and permits retry when the server never answers', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  dom.window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ playerName: 'Alice', roomId: 'office' }));
  await mount(true);
  assert.equal(current.joining, true);
  await act(async () => context.mock.timers.tick(8001));
  assert.equal(current.joining, false);
  assert.match(current.error!, /超时/);
  await act(async () => current.actions.joinRoom('Alice', 'office'));
  assert.equal(socket.sent.filter(message => message.event === 'joinRoom').length, 2);
});
