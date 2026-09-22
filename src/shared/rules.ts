import { Card, Hand, HandType, HandInterpretation, Rank, Suit } from './types';

// Get logical value for sorting/comparison
// Level cards are higher than Ace but lower than Jokers
export function getLogicValue(rank: Rank, level: number): number {
  if (rank === Rank.SmallJoker) return 20;
  if (rank === Rank.BigJoker) return 21;
  if (rank === level) return 19; // Level card
  
  // A is highest standard card
  if (rank === Rank.Ace) return 14;
  return rank;
}

/** 级牌显示：2–10 用数字，11–14 用 J/Q/K/A。 */
export function formatLevelRank(level: number): string {
  if (level === Rank.Jack) return 'J';
  if (level === Rank.Queen) return 'Q';
  if (level === Rank.King) return 'K';
  if (level === Rank.Ace) return 'A';
  return String(level);
}

export function sortCards(cards: Card[], level: number): Card[] {
  return [...cards].sort((a, b) => {
    const valA = getLogicValue(a.rank, level);
    const valB = getLogicValue(b.rank, level);
    if (valA !== valB) return valB - valA; // Descending
    return b.suit - a.suit;
  });
}

/** 非癞子点数能否被若干张癞子补成顺子。返回最大顶张；A2345 的顶张是 5。 */
export function bestStraightValue(ranks: number[], wildCount: number): number | null {
  const set = new Set(ranks);
  let best: number | null = null;
  const windows: { ranks: number[]; value: number }[] = [
    { ranks: [Rank.Ace, Rank.Two, Rank.Three, Rank.Four, Rank.Five], value: 5 },
  ];
  for (let start = Rank.Two; start <= Rank.Ten; start++) {
    const seq = [0, 1, 2, 3, 4].map(i => start + i);
    windows.push({ ranks: seq, value: seq[4] });
  }
  windows.forEach(window => {
    const missing = window.ranks.filter(rank => !set.has(rank)).length;
    const outside = [...set].filter(rank => !window.ranks.includes(rank)).length;
    if (outside === 0 && missing <= wildCount && (best === null || window.value > best)) {
      best = window.value;
    }
  });
  return best;
}

// Check if cards are consecutive
export function isConsecutive(values: number[]): boolean {
    if (values.length < 2) return false;
    const sorted = [...values].sort((a, b) => a - b);
    
    // Special Case: A-2-3-4-5
    if (sorted[sorted.length-1] === 14 && sorted[0] === 2) {
        if (sorted.length === 5 && sorted[0]===2 && sorted[1]===3 && sorted[2]===4 && sorted[3]===5) return true;
    }
    
    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i+1] !== sorted[i] + 1) return false;
    }
    return true;
}

// Main function to analyze hand
export function getHandType(cards: Card[], level: number): Hand | null {
  if (cards.length === 0) return null;

  const sortedCards = sortCards(cards, level);
  const len = cards.length;
  
  const wildCount = cards.filter(c => c.isWild).length;
  const nonWilds = cards.filter(c => !c.isWild);
  
  // Counts map for non-wilds (using Logic Value)
  const counts = new Map<number, number>();
  nonWilds.forEach(c => {
    const v = getLogicValue(c.rank, level);
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  const uniqueValues = Array.from(counts.keys()).sort((a, b) => b - a); // Descending
  const maxCount = Math.max(...Array.from(counts.values()), 0);

  // 1. Four Kings (Sky Bomb)
  if (len === 4) {
    const smallJokers = cards.filter(c => c.rank === Rank.SmallJoker).length;
    const bigJokers = cards.filter(c => c.rank === Rank.BigJoker).length;
    if (smallJokers === 2 && bigJokers === 2) {
      return { type: HandType.FourKings, cards, value: 999 };
    }
  }

  // 2. Single
  if (len === 1) {
      const val = cards[0].isWild ? 19 : getLogicValue(cards[0].rank, level); 
      return { type: HandType.Single, cards, value: val };
  }

  // 3. Pair
  if (len === 2) {
      if (wildCount === 2) return { type: HandType.Pair, cards, value: 19 }; 
      if (wildCount === 1) {
          if (nonWilds[0].rank > Rank.Ace) return null; 
          return { type: HandType.Pair, cards, value: uniqueValues[0] };
      }
      if (uniqueValues.length === 1) {
          return { type: HandType.Pair, cards, value: uniqueValues[0] };
      }
  }

  // 4. Trips
  if (len === 3) {
      if (wildCount === 3) return { type: HandType.Trips, cards, value: 19 };
      if (uniqueValues.length === 1 && (counts.get(uniqueValues[0])! + wildCount === 3)) {
           if (uniqueValues[0] > 19) return null;
           return { type: HandType.Trips, cards, value: uniqueValues[0] };
      }
  }

  // 5. Trips with Pair (Full House)
  if (len === 5) {
      if (maxCount + wildCount === 5) {
          return { type: HandType.Bomb, cards, value: uniqueValues[0] || 19, bombCount: 5 };
      }
      
      for (const tVal of uniqueValues) {
          if (tVal > 19) continue; 
          const tCount = counts.get(tVal)!;
          const wildsForTrips = Math.max(0, 3 - tCount);
          
          if (wildCount >= wildsForTrips) {
              const remWilds = wildCount - wildsForTrips;
              const otherVals = uniqueValues.filter(v => v !== tVal);
              
              if (otherVals.length === 0) continue;
              if (otherVals.length === 1) {
                  const pVal = otherVals[0];
                  if (pVal > 19) continue;
                  const pCount = counts.get(pVal)!;
                  if (pCount + remWilds >= 2) {
                      return { type: HandType.TripsWithPair, cards, value: tVal };
                  }
              }
          }
      }
  }
  
  // 6. Straight (5 cards). 癞子补在 A 下面（例如 JQKA + 癞子 = 10JQKA）也算。
  if (len === 5 && !nonWilds.some(c => c.rank > Rank.Ace)) {
      const ranks = nonWilds.map(c => c.rank).filter(r => r <= Rank.Ace);
      if (new Set(ranks).size === ranks.length) {
          const value = bestStraightValue(ranks, wildCount);
          if (value !== null) {
              const sameSuit = nonWilds.length === 0 || new Set(nonWilds.map(c => c.suit)).size === 1;
              if (sameSuit) {
                  return { type: HandType.StraightFlush, cards, value, bombCount: 5 };
              }
              return { type: HandType.Straight, cards, value };
          }
      }
  }
  
  // 7. Bomb (4+ cards)
  if (len >= 4) {
      if (maxCount + wildCount === len) {
         if (uniqueValues.length <= 1) { 
             const val = uniqueValues[0] || 19;
             if (val <= 19) { 
                 return { type: HandType.Bomb, cards, value: val, bombCount: len };
             }
         }
      }
  }

  // 8. Tube (6 cards) - Simplified (Natural)
  if (len === 6 && wildCount === 0) {
      const s = [...cards].sort((a,b) => a.rank - b.rank);
      if (s[0].rank === s[1].rank && s[2].rank === s[3].rank && s[4].rank === s[5].rank) {
          if (s[2].rank === s[0].rank + 1 && s[4].rank === s[2].rank + 1) {
               return { type: HandType.Tube, cards, value: s[4].rank }; 
          }
          if (s[4].rank === 14 && s[0].rank === 2 && s[2].rank === 3) {
              return { type: HandType.Tube, cards, value: 3 }; 
          }
      }
      
      // Plate (Natural)
      if (s[0].rank === s[1].rank && s[1].rank === s[2].rank && 
          s[3].rank === s[4].rank && s[4].rank === s[5].rank) {
           if (s[3].rank === s[0].rank + 1) {
               return { type: HandType.Plate, cards, value: s[3].rank };
           }
      }
  }
  
  return null;
}

export function compareHands(handA: Hand, handB: Hand): number {
    if (handA.type === HandType.FourKings) return 1;
    if (handB.type === HandType.FourKings) return -1;
    
    const isBombA = handA.type === HandType.Bomb || handA.type === HandType.StraightFlush;
    const isBombB = handB.type === HandType.Bomb || handB.type === HandType.StraightFlush;
    
    // Special Case: Bomb beats normal hands
    if (isBombA && !isBombB) return 1;
    if (!isBombA && isBombB) return -1;
    
    // Both Bombs (or SF). 四大天王已在上面处理。
    // 同花顺大于任意张数的普通炸弹；同花顺之间、炸弹之间再比点数。
    if (isBombA && isBombB) {
        const aIsSF = handA.type === HandType.StraightFlush;
        const bIsSF = handB.type === HandType.StraightFlush;
        if (aIsSF && bIsSF) return handA.value - handB.value;
        if (aIsSF) return 1;
        if (bIsSF) return -1;
        const countA = handA.bombCount ?? 0;
        const countB = handB.bombCount ?? 0;
        if (countA !== countB) return countA - countB;
        return handA.value - handB.value;
    }
    
    // Normal Hands Comparison
    if (handA.type !== handB.type) return 0; // Different types cannot compare (unless bombs)
    if (handA.cards.length !== handB.cards.length) return 0;
    
    return handA.value - handB.value;
}

export function getLargestCard(cards: Card[], level: number): Card {
    const sorted = sortCards(cards, level);
    return sorted[0]; 
}

/**
 * Generate human-readable description for a hand type
 */
export function getHandDescription(hand: Hand, level: number): string {
    const typeNames: { [key in HandType]: string } = {
        [HandType.Single]: '单张',
        [HandType.Pair]: '对子',
        [HandType.Trips]: '三张',
        [HandType.TripsWithPair]: '三带二',
        [HandType.Straight]: '顺子',
        [HandType.Tube]: '三连对',
        [HandType.Plate]: '钢板',
        [HandType.Bomb]: '炸弹',
        [HandType.StraightFlush]: '同花顺',
        [HandType.FourKings]: '天王炸'
    };
    
    let desc = typeNames[hand.type] || hand.type;
    
    // Add value information for clarity
    if (hand.type === HandType.Bomb) {
        desc += ` (${hand.bombCount}张)`;
    }
    
    return desc;
}

/**
 * Get all possible hand type interpretations for cards with wild cards
 * Returns multiple interpretations if wild cards can form different valid hands
 */
export function getAllPossibleHandTypes(cards: Card[], level: number): Hand[] {
    if (cards.length === 0) return [];
    
    const wilds = cards.filter(c => c.isWild);
    const nonWilds = cards.filter(c => !c.isWild);
    
    // If no wilds, just return the single interpretation
    if (wilds.length === 0) {
        const hand = getHandType(cards, level);
        return hand ? [hand] : [];
    }
    
    const results: Hand[] = [];
    const len = cards.length;
    
    // Try different interpretations based on card count and wild count
    
    // 1. Single (1 card)
    if (len === 1) {
        // Wild as level card
        results.push({ type: HandType.Single, cards, value: 19 });
        return results;
    }
    
    // 2. Pair (2 cards)
    if (len === 2) {
        if (wilds.length === 2) {
            // Two wilds = pair of level cards
            results.push({ type: HandType.Pair, cards, value: 19 });
        } else if (wilds.length === 1) {
            // One wild + one normal = pair of that normal card
            const normalValue = getLogicValue(nonWilds[0].rank, level);
            if (normalValue <= 19) {
                results.push({ type: HandType.Pair, cards, value: normalValue });
            }
        } else {
            // No wilds, check if natural pair
            const hand = getHandType(cards, level);
            if (hand) results.push(hand);
        }
        return results;
    }
    
    // 3. Trips (3 cards)
    if (len === 3) {
        if (wilds.length === 3) {
            results.push({ type: HandType.Trips, cards, value: 19 });
        } else if (wilds.length >= 1) {
            // Wilds + normals = trips of the normal card value
            const normalValues = nonWilds.map(c => getLogicValue(c.rank, level));
            const uniqueValues = Array.from(new Set(normalValues));
            if (uniqueValues.length === 1 && uniqueValues[0] <= 19) {
                results.push({ type: HandType.Trips, cards, value: uniqueValues[0] });
            }
        } else {
            const hand = getHandType(cards, level);
            if (hand) results.push(hand);
        }
        return results;
    }
    
    // 4. For longer hands (4+), we need more complex logic
    // Let's use the existing getHandType as a starting point
    const defaultHand = getHandType(cards, level);
    if (defaultHand) {
        results.push(defaultHand);
    }
    
    // TODO: Add more sophisticated wild card interpretation for:
    // - Straights with wilds (wilds can be any card in the sequence)
    // - Tubes/Plates with wilds
    // - Bombs with wilds
    // - Straight Flushes with wilds
    
    // For now, we'll keep it simple and only return the default interpretation
    // This can be expanded later for more complex scenarios
    
    return results;
}
