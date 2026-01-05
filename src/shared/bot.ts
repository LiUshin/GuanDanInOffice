import { getHandType, compareHands, sortCards, getLogicValue, isConsecutive } from './rules';
import { Rank, Card, Hand, HandType } from './types';

export class Bot {
  cards: Card[];
  level: number;

  constructor(cards: Card[], level: number) {
    this.cards = sortCards(cards, level); // Sorted by logic value desc
    this.level = level;
  }

  decideMove(target: Hand | null): Card[] | null {
    // Safety check: No cards means no move
    if (this.cards.length === 0) {
        console.log('[Bot] No cards left, returning null');
        return null;
    }
    
    if (!target) {
      // Free play - MUST return something (cannot pass on free turn)
      
      // Priority:
      // 1. Straight (5) or Tube (6) or Plate (6) - long hands first
      // 2. Trips with Pair (5)
      // 3. Trips (3)
      // 4. Pair (2)
      // 5. Single (1)
      
      // Try Full House
      const trips = this.getGroups(3);
      if (trips.length > 0) {
          // Find a pair for Full House
          const pair = this.findPairExcluding(trips[0]);
          if (pair) return [...trips[0], ...pair];
          return trips[0]; // Or just Trips
      }
      
      const pairs = this.getGroups(2);
      if (pairs.length > 0) return pairs[0]; // Smallest pair
      
      // Last resort: play smallest single card
      // This handles both 1 card left and multiple different single cards
      return [this.cards[this.cards.length - 1]];
    }

    // Must beat target
    const candidate = this.findBeat(target);
    if (candidate) return candidate;

    // Try Bomb
    // Strategy: Only bomb if target is NOT Bomb/SF/4Kings or is smaller bomb
    // And if we have enough cards? Or aggressively?
    // For MVP: Always try to bomb if possible to win turn.
    const bomb = this.findBomb(target);
    if (bomb) return bomb;

    return null; // Pass
  }

  findBeat(target: Hand): Card[] | null {
      // Iterate from smallest (end of sorted array) to largest
      if (target.type === HandType.Single) {
          for (let i = this.cards.length - 1; i >= 0; i--) {
              const c = this.cards[i];
              if (getLogicValue(c.rank, this.level) > target.value) return [c];
          }
      }
      
      if (target.type === HandType.Pair) {
          const pairs = this.getGroups(2); // Smallest first
          for (const pair of pairs) {
               const val = getLogicValue(pair[0].rank, this.level);
               if (val > target.value) return pair;
          }
      }
      
      if (target.type === HandType.Trips) {
          const trips = this.getGroups(3);
           for (const t of trips) {
               const val = getLogicValue(t[0].rank, this.level);
               if (val > target.value) return t;
          }
      }
      
      if (target.type === HandType.TripsWithPair) {
          const trips = this.getGroups(3);
          for (const t of trips) {
              const tVal = getLogicValue(t[0].rank, this.level);
              if (tVal > target.value) {
                  const pair = this.findPairExcluding(t);
                  if (pair) return [...t, ...pair];
              }
          }
      }
      
      // Basic Straight Logic (5 cards)
      if (target.type === HandType.Straight) {
          // Very simple: Check all 5-card windows in unique ranks
          // Filter non-wilds, unique ranks
          // Complexity high with Level Card wilds.
          // Fallback: Pass on straights unless strict match found?
      }
      
      return null;
  }
  
  findPairExcluding(exclude: Card[]): Card[] | null {
      const excludeIds = exclude.map(c => c.id);
      const available = this.cards.filter(c => !excludeIds.includes(c.id));
      
      // Helper internal
      const getGrps = (cards: Card[]) => {
          const grps: Card[][] = [];
          let cur: Card[] = [];
          for (const c of cards) {
              if (cur.length === 0 || getLogicValue(c.rank, this.level) === getLogicValue(cur[0].rank, this.level)) {
                  cur.push(c);
              } else {
                  if (cur.length >= 2) grps.push(cur.slice(0, 2));
                  cur = [c];
              }
          }
          if (cur.length >= 2) grps.push(cur.slice(0, 2));
          return grps.reverse(); // Smallest
      };
      
      const pairs = getGrps(available);
      if (pairs.length > 0) return pairs[0];
      return null;
  }
  
  findBomb(target?: Hand): Card[] | null {
      // 1. Check 4 Kings
      const sj = this.cards.filter(c => c.rank === Rank.SmallJoker);
      const bj = this.cards.filter(c => c.rank === Rank.BigJoker);
      let kings: Card[] | null = null;
      if (sj.length === 2 && bj.length === 2) {
          kings = [...sj, ...bj];
      }

      // 2. Check Straight Flush (SF)
      // Hard to detect generic SF. 
      // Simplified: Check if we have 5 consecutive same suit.
      // Logic: Group by suit, check consecutive.
      const sfs: { cards: Card[], value: number }[] = [];
      const suits = [0,1,2,3]; // Spades, Hearts, Clubs, Diamonds
      for (const s of suits) {
          const suitCards = this.cards.filter(c => c.suit === s && !c.isWild && c.rank <= Rank.Ace); // Ignore wild/joker for natural SF
          // Sort by rank
          suitCards.sort((a,b) => a.rank - b.rank);
          // Check windows of 5
          for(let i=0; i<=suitCards.length-5; i++) {
              const window = suitCards.slice(i, i+5);
              const ranks = window.map(c => c.rank);
              if (isConsecutive(ranks)) {
                  sfs.push({ cards: window, value: ranks[4] }); // Top value
              }
          }
      }
      // Sort SFs by value ascending
      sfs.sort((a,b) => a.value - b.value);

      // 3. Normal Bombs (4+ cards)
      const bombs = this.getBombs(); // Smallest first

      // Comparison Logic
      if (!target) {
          // Play smallest bomb?
          if (bombs.length > 0) return bombs[0].cards;
          if (sfs.length > 0) return sfs[0].cards;
          if (kings) return kings;
          return null;
      }
      
      // Target exists
      const targetIsBomb = target.type === HandType.Bomb;
      const targetIsSF = target.type === HandType.StraightFlush;
      const targetIsKings = target.type === HandType.FourKings;
      
      // If target is normal hand (not bomb family)
      if (!targetIsBomb && !targetIsSF && !targetIsKings) {
          if (bombs.length > 0) return bombs[0].cards;
          if (sfs.length > 0) return sfs[0].cards;
          if (kings) return kings;
          return null;
      }
      
      // Target is Bomb Family
      if (targetIsKings) return null; // Can't beat 4 Kings
      
      if (targetIsSF) {
          // Can beat with bigger SF or 4 Kings
          const targetVal = target.value;
          const biggerSF = sfs.find(sf => sf.value > targetVal);
          if (biggerSF) return biggerSF.cards;
          if (kings) return kings;
          // Also 6+ bomb beats SF? Rules vary. 
          // Standard: 4 Kings > 6+ Bomb > SF > 5 Bomb > 4 Bomb.
          // Wait: SF is usually just below 4 Kings or below 6 Bomb?
          // Rules: 4 Kings > 6+ > SF > 5 > 4.
          // Or 4 Kings > SF > 6+ ?
          // Default: 4 Kings > 6+ > SF > 5 > 4.
          // Let's assume SF beats 5 Bomb.
          // Find Bomb >= 6
          const bigBomb = bombs.find(b => b.cards.length >= 6);
          if (bigBomb) return bigBomb.cards;
          return null;
      }
      
      if (targetIsBomb) {
          // Compare with target bomb
          // Target count
          const tCount = target.bombCount || 4;
          const tVal = target.value;
          
          // Find bomb with > count OR (== count and > value)
          for (const b of bombs) {
              const bCount = b.cards.length;
              const bVal = b.value;
              if (bCount > tCount) return b.cards;
              if (bCount === tCount && bVal > tVal) return b.cards;
          }
          
          // If 5 bomb or less, SF beats it
          if (tCount <= 5) {
              if (sfs.length > 0) return sfs[0].cards;
          }
          
          if (kings) return kings;
      }
      
      return null;
  }
  
  getGroups(size: number): Card[][] {
      const groups: Card[][] = [];
      let current: Card[] = [];
      for (const card of this.cards) {
          if (current.length === 0 || getLogicValue(card.rank, this.level) === getLogicValue(current[0].rank, this.level)) {
              current.push(card);
          } else {
              if (current.length >= size) groups.push(current.slice(0, size));
              current = [card];
          }
      }
      if (current.length >= size) groups.push(current.slice(0, size));
      return groups.reverse(); // Smallest first
  }
  
  getBombs(): { cards: Card[], value: number }[] {
      const groups = this.getGroups(4);
      return groups.map(g => ({ cards: g, value: getLogicValue(g[0].rank, this.level) }));
  }
}
