import { Card, Rank, Suit } from './types';

export function createDeck(): Card[] {
  const cards: Card[] = [];
  const suits = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds];
  const ranks = [
    Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven,
    Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King, Rank.Ace
  ];

  // Two decks
  for (let i = 0; i < 2; i++) {
    // Standard cards
    for (const suit of suits) {
      for (const rank of ranks) {
        cards.push({
          suit,
          rank,
          id: `${suit}-${rank}-${i}`
        });
      }
    }
    // Jokers
    cards.push({ suit: Suit.Joker, rank: Rank.SmallJoker, id: `joker-small-${i}` });
    cards.push({ suit: Suit.Joker, rank: Rank.BigJoker, id: `joker-big-${i}` });
  }

  return cards;
}

export function shuffleDeck(cards: Card[]): Card[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// Helper to update card properties based on current game level
export function updateCardProperties(cards: Card[], currentLevel: number): Card[] {
  return cards.map(card => {
    const isLevelCard = card.rank === currentLevel;
    const isWild = isLevelCard && card.suit === Suit.Hearts;
    return { ...card, isLevelCard, isWild };
  });
}
