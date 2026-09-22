import { Game, rankUnfinishedPlayers } from './src/server/game';
import { Card, GameMode, Rank, Suit } from './src/shared/types';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

assert(rankUnfinishedPlayers([0, 10, 0, 3], [0, 2]).join() === '3,1', '牌少的是三游');
assert(rankUnfinishedPlayers([0, 5, 0, 5], [0, 2]).join() === '3,1', '牌数相同，离二游更近的是三游');

function card(id: string, rank: Rank): Card {
  return { id, suit: Suit.Spades, rank };
}

const io = { to: () => ({ emit: () => undefined }) };
const players = [0, 1, 2, 3].map(i => ({
  id: `p${i}`,
  name: `P${i}`,
  seatIndex: i,
  isBot: false,
}));
const game = new Game(io as any, 'room', players, GameMode.Normal);
game.level = 2;
game.currentPhase = 'Playing' as any;
game.currentTurn = 0;
game.hands = [
  [card('a', Rank.Three)],
  [card('b', Rank.Four)],
  [card('c', Rank.Five)],
  [card('d', Rank.Six)],
];
game.noteDisconnected(0);
game.players[0].isDisconnected = false;
game.handleBotTurn(0);
assert(game.hands[0].length === 1, '重连后不再代打');

game.noteDisconnected(0);
game.handleBotTurn(0);
assert(game.hands[0].length === 0, '断线后系统打出剩余的牌');
assert(game.winners[0] === 0, '代打打完记头游');

const tribute = new Game(io as any, 'room', players.map(p => ({ ...p })), GameMode.Normal);
tribute.level = 2;
tribute.currentPhase = 'Tribute' as any;
tribute.hands = [
  [card('small', Rank.Three), card('big', Rank.Ace)],
  [card('x', Rank.Four)],
  [],
  [],
];
tribute.tributeState = { pendingTributes: [{ from: 0, to: 1 }], pendingReturns: [] };
tribute.prevWinners = [1, 3, 2, 0];
tribute.noteDisconnected(0);
assert(tribute.hands[1].some(c => c.id === 'big'), '断线进贡交最大的牌');
assert(tribute.currentPhase === 'ReturnTribute' || tribute.currentPhase === 'Playing', '进贡交完进入下一阶段');
