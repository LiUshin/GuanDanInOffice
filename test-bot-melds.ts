import { Rank, Suit, Card, HandType } from './src/shared/types';
import { updateCardProperties } from './src/shared/deck';
import { Bot } from './src/shared/bot';
import { getHandType } from './src/shared/rules';

function cards(spec: [Rank, Suit][], level = 2): Card[] {
  return updateCardProperties(spec.map(([rank, suit], index) => ({
    rank,
    suit,
    id: `c${index}-${rank}-${suit}`,
  })), level);
}

function lead(spec: [Rank, Suit][]) {
  const hand = cards(spec);
  const move = new Bot(hand, 2).decideMove(null);
  if (!move) throw new Error('bot passed on a free lead');
  return getHandType(move, 2);
}

const straight = lead([
  [Rank.Six, Suit.Spades],
  [Rank.Seven, Suit.Hearts],
  [Rank.Eight, Suit.Clubs],
  [Rank.Nine, Suit.Diamonds],
  [Rank.Ten, Suit.Spades],
  [Rank.King, Suit.Hearts],
]);
if (straight?.type !== HandType.Straight) throw new Error(`expected straight, got ${straight?.type}`);

const tube = lead([
  [Rank.Three, Suit.Spades], [Rank.Three, Suit.Hearts],
  [Rank.Four, Suit.Clubs], [Rank.Four, Suit.Diamonds],
  [Rank.Five, Suit.Spades], [Rank.Five, Suit.Hearts],
  [Rank.King, Suit.Clubs],
]);
if (tube?.type !== HandType.Tube) throw new Error(`expected tube, got ${tube?.type}`);

const plate = lead([
  [Rank.Eight, Suit.Spades], [Rank.Eight, Suit.Hearts], [Rank.Eight, Suit.Clubs],
  [Rank.Nine, Suit.Diamonds], [Rank.Nine, Suit.Spades], [Rank.Nine, Suit.Hearts],
  [Rank.King, Suit.Diamonds],
]);
if (plate?.type !== HandType.Plate) throw new Error(`expected plate, got ${plate?.type}`);

const onlyBomb = lead([
  [Rank.Seven, Suit.Spades], [Rank.Seven, Suit.Hearts],
  [Rank.Seven, Suit.Clubs], [Rank.Seven, Suit.Diamonds],
]);
if (onlyBomb?.type !== HandType.Bomb || onlyBomb.cards.length !== 4) {
  throw new Error(`expected a 4-bomb, got ${onlyBomb?.type} x${onlyBomb?.cards.length}`);
}

const higher = cards([
  [Rank.Six, Suit.Spades], [Rank.Seven, Suit.Hearts], [Rank.Eight, Suit.Clubs],
  [Rank.Nine, Suit.Diamonds], [Rank.Ten, Suit.Spades],
]);
const target = getHandType(cards([
  [Rank.Three, Suit.Spades], [Rank.Four, Suit.Hearts], [Rank.Five, Suit.Clubs],
  [Rank.Six, Suit.Diamonds], [Rank.Seven, Suit.Spades],
]), 2);
const beat = new Bot(higher, 2).decideMove(target);
const beatType = beat && getHandType(beat, 2);
if (beatType?.type !== HandType.Straight || beatType.value <= (target?.value ?? 99)) {
  throw new Error(`expected a higher straight, got ${beatType?.type} ${beatType?.value}`);
}

console.log('bot meld tests passed');
