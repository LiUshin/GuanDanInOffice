import type { ServerSnapshot } from './room';
import { GamePhase } from './game';
import { GameMode, HandType, HistoryEventType, SkillCardType, Suit, Rank } from '../shared/types';

type Data = Record<string, unknown>;

const invalid = () => new Error('Invalid snapshot data.');

function check(condition: unknown): asserts condition {
  if (!condition) throw invalid();
}

/** Only JSON records are accepted; executable properties and prototype keys are not data. */
function record(value: unknown, allowed?: readonly string[]): Data {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null);
  for (const key of Reflect.ownKeys(value)) {
    check(typeof key === 'string');
    check(key !== '__proto__' && key !== 'constructor' && key !== 'prototype');
    check(!allowed || allowed.includes(key));
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    check(descriptor.enumerable && 'value' in descriptor);
  }
  return value as Data;
}

function array(value: unknown, length?: number): unknown[] {
  check(Array.isArray(value));
  check(length === undefined || value.length === length);
  return value;
}

function text(value: unknown, maxLength?: number): asserts value is string {
  check(typeof value === 'string' && value.length > 0);
  check(maxLength === undefined || value.length <= maxLength);
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max);
}

function optionalBoolean(value: unknown) {
  check(value === undefined || typeof value === 'boolean');
}

function member(value: unknown, choices: readonly unknown[]) {
  check(choices.includes(value));
}

function seat(value: unknown): asserts value is number { integer(value, 0, 3); }
function team(value: unknown): asserts value is number { integer(value, 0, 1); }
function level(value: unknown): asserts value is number { integer(value, 2, 14); }

function seats(value: unknown): number[] {
  const values = array(value);
  check(values.length <= 4);
  values.forEach(seat);
  check(new Set(values).size === values.length);
  return values as number[];
}

function teamValues(value: unknown, validate: (value: unknown) => void): Data {
  const values = record(value, ['0', '1']);
  validate(values[0]);
  validate(values[1]);
  return values;
}

function card(value: unknown): Data {
  const data = record(value, ['id', 'suit', 'rank', 'isLevelCard', 'isWild']);
  text(data.id);
  integer(data.suit, Suit.Spades, Suit.Joker);
  integer(data.rank, Rank.Two, Rank.BigJoker);
  check((data.suit === Suit.Joker) === (data.rank >= Rank.SmallJoker));
  optionalBoolean(data.isLevelCard);
  optionalBoolean(data.isWild);
  return data;
}

function cards(value: unknown, seen = new Set<string>()): Data[] {
  return array(value).map(item => {
    const data = card(item);
    check(!seen.has(data.id as string));
    seen.add(data.id as string);
    return data;
  });
}

function hand(value: unknown): Data {
  const data = record(value, ['type', 'cards', 'value', 'bombCount']);
  member(data.type, Object.values(HandType));
  const held = cards(data.cards);
  integer(data.value, 2, 999);
  const sizes: Partial<Record<HandType, number>> = {
    [HandType.Single]: 1, [HandType.Pair]: 2, [HandType.Trips]: 3,
    [HandType.TripsWithPair]: 5, [HandType.Straight]: 5, [HandType.Tube]: 6,
    [HandType.Plate]: 6, [HandType.StraightFlush]: 5, [HandType.FourKings]: 4
  };
  if (data.type === HandType.Bomb) check(held.length >= 4);
  else check(held.length === sizes[data.type as HandType]);
  if (data.type === HandType.FourKings) check(data.value === 999);
  else check(data.value <= 21);
  if (data.type === HandType.Bomb || data.type === HandType.StraightFlush) {
    check(data.bombCount === held.length);
  } else if (data.bombCount !== undefined) integer(data.bombCount, 1);
  return data;
}

function seatMap(value: unknown, validate: (value: unknown) => void) {
  const data = record(value, ['0', '1', '2', '3']);
  Object.values(data).forEach(validate);
}

/** History details are extensible, but must still be finite, acyclic, data-only JSON. */
function json(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  check(depth <= 64);
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { check(Number.isFinite(value)); return; }
  check(value !== null && typeof value === 'object' && !ancestors.has(value));
  ancestors.add(value);
  const children = Array.isArray(value) ? value : Object.values(record(value));
  for (const child of children) json(child, ancestors, depth + 1);
  ancestors.delete(value);
}

function history(value: unknown, counter: unknown) {
  const entries = array(value);
  integer(counter, entries.length);
  const ids = new Set<string>();
  for (const entry of entries) {
    const data = record(entry, ['id', 'timestamp', 'type', 'playerIndex', 'playerName', 'message', 'details']);
    text(data.id);
    check(!ids.has(data.id));
    ids.add(data.id);
    integer(data.timestamp, 0);
    member(data.type, Object.values(HistoryEventType));
    if (data.playerIndex !== undefined) seat(data.playerIndex);
    if (data.playerName !== undefined) text(data.playerName);
    check(typeof data.message === 'string');
    json(data.details);
    if (!data.details || typeof data.details !== 'object' || Array.isArray(data.details)) continue;
    const details = record(data.details);
    // Check known fields without treating future, data-only descriptive fields as runtime state.
    if (details.card !== undefined) card(details.card);
    if (details.cards !== undefined) cards(details.cards);
    if (details.to !== undefined) seat(details.to);
    if (details.targetSeat !== undefined) seat(details.targetSeat);
    if (details.skillType !== undefined) member(details.skillType, Object.values(SkillCardType));
    if (details.handType !== undefined) member(details.handType, Object.values(HandType));
    if (details.level !== undefined) level(details.level);
    if (details.activeTeam !== undefined) team(details.activeTeam);
    if (details.round !== undefined) integer(details.round, 1);
    if (details.position !== undefined) integer(details.position, 1, 4);
    if (details.winners !== undefined) seats(details.winners);
    if (details.cardsCount !== undefined) {
      integer(details.cardsCount, 1);
      if (Array.isArray(details.cards)) check(details.cardsCount === details.cards.length);
    }
    if (details.resultType !== undefined) check(typeof details.resultType === 'string');
  }
}

function tribute(value: unknown, phase: unknown) {
  const data = record(value, ['pendingTributes', 'pendingReturns', 'nextStartPlayer']);
  const tributes = array(data.pendingTributes);
  const returns = array(data.pendingReturns);
  if (data.nextStartPlayer !== undefined) seat(data.nextStartPlayer);
  for (const pending of [tributes, returns]) {
    check(pending.length <= 2);
    const from = new Set<number>();
    const to = new Set<number>();
    for (const entry of pending) {
      const transfer = record(entry, ['from', 'to', 'card']);
      seat(transfer.from);
      seat(transfer.to);
      check(transfer.from !== transfer.to && !from.has(transfer.from) && !to.has(transfer.to));
      from.add(transfer.from);
      to.add(transfer.to);
      if (transfer.card !== undefined) card(transfer.card);
    }
  }
  if (phase === GamePhase.Tribute) check(tributes.length > 0 && returns.length === 0);
  else if (phase === GamePhase.ReturnTribute) check(returns.length > 0 && tributes.length === 0);
  else check(tributes.length === 0 && returns.length === 0);
}

function game(value: unknown, mode: unknown): Data {
  const data = record(value, [
    'level', 'currentPhase', 'hands', 'currentTurn', 'lastHand', 'passCount',
    'roundActions', 'winners', 'tributeState', 'teamLevels', 'activeTeam', 'prevWinners',
    'gameMode', 'skillCards', 'skipNextTurn', 'newCardIds', 'history', 'historyIdCounter', 'currentRound'
  ]);
  level(data.level);
  // Waiting/Dealing are synchronous setup states and have no recovery path.
  member(data.currentPhase, [GamePhase.Tribute, GamePhase.ReturnTribute, GamePhase.Playing, GamePhase.Score]);
  check(data.gameMode === mode);
  seat(data.currentTurn);
  integer(data.passCount, 0, 4);
  team(data.activeTeam);
  const levels = teamValues(data.teamLevels, level);
  check(data.level === levels[data.activeTeam]);
  integer(data.currentRound, 1);
  const seenCards = new Set<string>();
  for (const held of array(data.hands, 4)) cards(held, seenCards);
  if (data.lastHand !== null) {
    const last = record(data.lastHand, ['playerIndex', 'hand']);
    seat(last.playerIndex);
    hand(last.hand);
  }
  seatMap(data.roundActions, value => {
    const action = record(value, ['type', 'cards', 'hand']);
    member(action.type, ['play', 'pass']);
    if (action.cards !== undefined) cards(action.cards);
    if (action.hand !== undefined) hand(action.hand);
    if (action.type === 'play') {
      check(Array.isArray(action.cards) && action.cards.length > 0 && action.hand !== undefined);
      const played = (action.hand as Data).cards as Data[];
      const shown = action.cards as Data[];
      check(played.length === shown.length && played.every((c, i) => c.id === shown[i].id));
    } else check(action.cards === undefined && action.hand === undefined);
  });
  const winners = seats(data.winners);
  seats(data.prevWinners);
  if (data.currentPhase === GamePhase.Score) check(winners.length === 4);
  // Partial finish order is normal while a round is still in progress. Do not
  // require all winners' hands to be empty: double-down ranks unfinished players.
  tribute(data.tributeState, data.currentPhase);
  const skillIds = new Set<string>();
  for (const held of array(data.skillCards, 4)) {
    for (const value of array(held)) {
      const skill = record(value, ['id', 'type']);
      text(skill.id);
      member(skill.type, Object.values(SkillCardType));
      check(!skillIds.has(skill.id));
      skillIds.add(skill.id);
    }
  }
  for (const flag of array(data.skipNextTurn, 4)) check(typeof flag === 'boolean');
  seatMap(data.newCardIds, value => { for (const id of array(value)) text(id); });
  history(data.history, data.historyIdCounter);
  return data;
}

function sameSeats(a: unknown, b: unknown): boolean {
  return (a as number[]).length === (b as number[]).length &&
    (a as number[]).every((value, index) => value === (b as number[])[index]);
}

function match(value: unknown, mode: unknown) {
  const data = record(value, ['teamLevels', 'activeTeam', 'consecutiveWins', 'lastWinners', 'roundNumber', 'currentGame']);
  const levels = teamValues(data.teamLevels, level);
  team(data.activeTeam);
  const streaks = teamValues(data.consecutiveWins, value => integer(value, 0, 1));
  check(!(streaks[0] && streaks[1]));
  for (const t of [0, 1]) {
    if (streaks[t]) check(levels[t] === 14 && data.activeTeam === t);
  }
  seats(data.lastWinners);
  integer(data.roundNumber, 1);
  const current = game(data.currentGame, mode);
  check(current.currentRound === data.roundNumber);
  const gameLevels = current.teamLevels as Data;
  if (current.currentPhase === GamePhase.Score) {
    // Match progression is checkpointed before Score is broadcast. The game
    // deliberately keeps the pre-score levels that were used to interpret cards.
    const winners = current.winners as number[];
    const winningTeam = winners[0] % 2;
    const increase = winners[1] % 2 === winningTeam ? 3 : winners[2] % 2 === winningTeam ? 2 : 1;
    check(data.activeTeam === winningTeam && sameSeats(data.lastWinners, winners));
    check(levels[winningTeam] === Math.min(14, (gameLevels[winningTeam] as number) + increase));
    check(levels[1 - winningTeam] === gameLevels[1 - winningTeam]);
    check(streaks[winningTeam] === (levels[winningTeam] === 14 ? 1 : 0));
    check(streaks[1 - winningTeam] === 0);
  } else {
    check(data.activeTeam === current.activeTeam);
    check(levels[0] === gameLevels[0] && levels[1] === gameLevels[1]);
    check(sameSeats(data.lastWinners, current.prevWinners));
  }
}

/** Validate the complete file before RoomManager creates or mutates any live rooms. */
export function validateSnapshot(value: unknown): asserts value is ServerSnapshot {
  const data = record(value, ['version', 'rooms']);
  if (data.version !== 1) throw new Error('Unsupported snapshot version.');
  const roomIds = new Set<string>();
  for (const value of array(data.rooms)) {
    const room = record(value, ['id', 'gameMode', 'players', 'match']);
    text(room.id, 40);
    check(room.id.trim() === room.id && !roomIds.has(room.id));
    roomIds.add(room.id);
    member(room.gameMode, Object.values(GameMode));
    const players = array(room.players, 4);
    const ids = new Set<string>();
    const humanNames = new Set<string>();
    let hosts = 0;
    for (let index = 0; index < players.length; index++) {
      if (players[index] === null) continue;
      const player = record(players[index], ['id', 'name', 'seatIndex', 'isReady', 'isBot', 'isDisconnected', 'isHost']);
      text(player.id);
      text(player.name, 10);
      check(player.name.trim() === player.name);
      check(player.seatIndex === index && typeof player.isReady === 'boolean');
      optionalBoolean(player.isBot);
      optionalBoolean(player.isDisconnected);
      optionalBoolean(player.isHost);
      check(!ids.has(player.id));
      ids.add(player.id);
      if (!player.isBot) {
        check(!humanNames.has(player.name));
        humanNames.add(player.name);
      }
      if (player.isHost) hosts++;
    }
    check(ids.size > 0 && hosts <= 1);
    if (room.match !== null) {
      check(players.every(player => player !== null));
      match(room.match, room.gameMode);
    }
  }
}
