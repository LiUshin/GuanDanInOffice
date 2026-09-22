import { arrangeHand } from './src/shared/arrange';
import { compareHands, getHandType } from './src/shared/rules';
import { Card, HandType, Rank, Suit } from './src/shared/types';

function card(id: string, suit: Suit, rank: Rank, level: number): Card {
  const isLevelCard = rank === level;
  return {
    id,
    suit,
    rank,
    isLevelCard,
    isWild: isLevelCard && suit === Suit.Hearts,
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

const level = 10;
const sf = getHandType([
  card('hj', Suit.Hearts, Rank.Jack, level),
  card('hq', Suit.Hearts, Rank.Queen, level),
  card('hk', Suit.Hearts, Rank.King, level),
  card('ha', Suit.Hearts, Rank.Ace, level),
  card('h10', Suit.Hearts, Rank.Ten, level),
], level);
assert(sf?.type === HandType.StraightFlush && sf.value === 14, `JQKA+红心级牌 = 同花顺14, got ${sf?.type} ${sf?.value}`);

const bomb6 = { type: HandType.Bomb, cards: [], value: 8, bombCount: 6 };
const sfHand = { type: HandType.StraightFlush, cards: [], value: 10, bombCount: 5 };
assert(compareHands(sfHand, bomb6) > 0, '同花顺大于6炸');

const hand = [
  card('s10', Suit.Spades, Rank.Ten, level),
  card('c10', Suit.Clubs, Rank.Ten, level),
  card('d10', Suit.Diamonds, Rank.Ten, level),
  card('s10b', Suit.Spades, Rank.Ten, level),
  card('hj', Suit.Hearts, Rank.Jack, level),
  card('hq', Suit.Hearts, Rank.Queen, level),
  card('hk', Suit.Hearts, Rank.King, level),
  card('ha', Suit.Hearts, Rank.Ace, level),
  card('h10', Suit.Hearts, Rank.Ten, level),
  card('s8', Suit.Spades, Rank.Eight, level),
  card('c8', Suit.Clubs, Rank.Eight, level),
  card('d8', Suit.Diamonds, Rank.Eight, level),
  card('s9', Suit.Spades, Rank.Nine, level),
  card('c9', Suit.Clubs, Rank.Nine, level),
  card('d9', Suit.Diamonds, Rank.Nine, level),
  card('s2', Suit.Spades, Rank.Two, level),
  card('c2', Suit.Clubs, Rank.Two, level),
  card('s3', Suit.Spades, Rank.Three, level),
  card('d3', Suit.Diamonds, Rank.Three, level),
  card('c4', Suit.Clubs, Rank.Four, level),
  card('d4', Suit.Diamonds, Rank.Four, level),
];

const groups = arrangeHand(hand, level);
const labels = groups.map(g => `${g.label}:${g.cards.map(c => c.id).join(',')}`);
console.log(labels.join(' | '));
const ids = groups.flatMap(g => g.cards.map(c => c.id));
assert(ids.length === hand.length, `牌数一致 ${ids.length} vs ${hand.length}`);
assert(new Set(ids).size === ids.length, '没有重复牌');
assert(groups.some(g => g.type === HandType.StraightFlush), '理出同花顺');
assert(groups.some(g => g.label === '4炸'), '4张10是炸弹，红心10让给同花顺');
assert(groups.some(g => g.label === '钢板'), '333444 理成钢板');
assert(groups.some(g => g.label === '三连对'), '556677 理成三连对');
assert(groups[0].type === HandType.StraightFlush, '同花顺排在炸弹左边');

const tubeBeforeBomb = groups.findIndex(g => g.type === HandType.StraightFlush);
const bombAt = groups.findIndex(g => g.type === HandType.Bomb);
assert(tubeBeforeBomb < bombAt, '同花顺在炸弹前');
