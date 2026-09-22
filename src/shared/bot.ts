import { getHandType, getLogicValue } from './rules';
import { Rank, Card, Hand, HandType } from './types';

/**
 * 机器人出牌。
 * 炸弹（4 张及以上同点）和四大天王不会拆开。
 * 自由出牌会走顺子、三连对、钢板；跟牌时同类型能压就压，否则再考虑炸弹。
 */
export class Bot {
  cards: Card[];
  level: number;

  constructor(cards: Card[], level: number) {
    this.cards = [...cards].sort((a, b) => {
      const diff = getLogicValue(b.rank, level) - getLogicValue(a.rank, level);
      return diff !== 0 ? diff : b.suit - a.suit;
    });
    this.level = level;
  }

  decideMove(target: Hand | null, rejected: Set<string> = new Set()): Card[] | null {
    if (this.cards.length === 0) return null;
    for (const move of this.listMoves(target)) {
      const key = move.map(card => card.id).sort().join(',');
      if (!rejected.has(key)) return move;
    }
    return null;
  }

  /** 按优先顺序给出可出的牌，供被服务端拒绝后换下一手。 */
  listMoves(target: Hand | null): Card[][] {
    if (!target) {
      const ordinary = [
        ...this.collectStraights(),
        ...this.collectTubes(),
        ...this.collectPlates(),
        ...this.collectFullHouses(),
        ...this.collectTrips(),
        ...this.collectPairs(),
        ...this.collectSingles(),
      ];
      if (ordinary.length > 0) return ordinary;
      return this.listBombs(null);
    }

    return [
      ...this.beatSameType(target),
      ...this.listBombs(target),
    ];
  }

  private bombOnlyIds(): Set<string> {
    const ids = new Set<string>();
    for (const group of this.valueGroups()) {
      if (group.length >= 4) group.forEach(card => ids.add(card.id));
    }
    const small = this.cards.filter(card => card.rank === Rank.SmallJoker);
    const big = this.cards.filter(card => card.rank === Rank.BigJoker);
    if (small.length === 2 && big.length === 2) {
      [...small, ...big].forEach(card => ids.add(card.id));
    }
    return ids;
  }

  private reservedIds(): Set<string> {
    const ids = this.bombOnlyIds();
    for (const cards of this.naturalStraightFlushes(ids)) {
      cards.forEach(card => ids.add(card.id));
    }
    return ids;
  }

  /** 不拆炸弹的前提下，找出天然同花顺，避免把它们拆成单张。 */
  private naturalStraightFlushes(blocked: Set<string>): Card[][] {
    const found: Card[][] = [];
    for (const window of this.straightWindows()) {
      const picked: Card[] = [];
      let suit: number | null = null;
      let possible = true;
      for (const rank of window.ranks) {
        const card = this.cards.find(candidate =>
          !candidate.isWild &&
          candidate.rank === rank &&
          !blocked.has(candidate.id) &&
          !picked.some(owned => owned.id === candidate.id) &&
          (suit === null || candidate.suit === suit)
        );
        if (!card) {
          possible = false;
          break;
        }
        suit = card.suit;
        picked.push(card);
      }
      if (!possible) continue;
      const hand = getHandType(picked, this.level);
      if (hand?.type === HandType.StraightFlush) found.push(picked);
    }
    return found;
  }

  private valueGroups(): Card[][] {
    const groups: Card[][] = [];
    let current: Card[] = [];
    for (const card of this.cards) {
      if (current.length === 0 || getLogicValue(card.rank, this.level) === getLogicValue(current[0].rank, this.level)) {
        current.push(card);
      } else {
        groups.push(current);
        current = [card];
      }
    }
    if (current.length > 0) groups.push(current);
    return groups;
  }

  private exactGroups(size: number): Card[][] {
    return this.valueGroups().filter(group => group.length === size).reverse();
  }

  private collectSingles(): Card[][] {
    const reserved = this.reservedIds();
    return this.cards
      .filter(card => !reserved.has(card.id))
      .sort((a, b) => getLogicValue(a.rank, this.level) - getLogicValue(b.rank, this.level))
      .map(card => [card]);
  }

  private collectPairs(): Card[][] {
    return this.exactGroups(2).map(group => group.slice(0, 2));
  }

  private collectTrips(): Card[][] {
    return this.exactGroups(3).map(group => group.slice(0, 3));
  }

  private collectFullHouses(): Card[][] {
    const trips = this.exactGroups(3);
    const pairs = this.exactGroups(2);
    const houses: Card[][] = [];
    for (const trip of trips) {
      const pair = pairs.find(candidate => candidate.every(card => !trip.some(owned => owned.id === card.id)));
      if (pair) houses.push([...trip, ...pair]);
    }
    return houses;
  }

  private straightWindows(): { ranks: number[]; value: number }[] {
    const windows = [{ ranks: [Rank.Ace, Rank.Two, Rank.Three, Rank.Four, Rank.Five], value: 5 }];
    for (let start = Rank.Two; start <= Rank.Ten; start++) {
      const ranks = [0, 1, 2, 3, 4].map(offset => start + offset);
      windows.push({ ranks, value: ranks[4] });
    }
    return windows;
  }

  private collectStraights(minValue = 0): Card[][] {
    const reserved = this.reservedIds();
    const wilds = this.cards.filter(card => card.isWild && !reserved.has(card.id));
    const found: { cards: Card[]; value: number }[] = [];
    for (const window of this.straightWindows()) {
      if (window.value <= minValue) continue;
      const picked: Card[] = [];
      let wildsUsed = 0;
      let possible = true;
      for (const rank of window.ranks) {
        const card = this.cards.find(candidate =>
          !candidate.isWild &&
          candidate.rank === rank &&
          candidate.rank <= Rank.Ace &&
          !reserved.has(candidate.id) &&
          !picked.some(owned => owned.id === candidate.id)
        );
        if (card) {
          picked.push(card);
        } else if (wildsUsed < wilds.length) {
          picked.push(wilds[wildsUsed]);
          wildsUsed++;
        } else {
          possible = false;
          break;
        }
      }
      if (!possible) continue;
      const hand = getHandType(picked, this.level);
      if (hand?.type === HandType.Straight && hand.value > minValue) {
        found.push({ cards: picked, value: hand.value });
      }
    }
    found.sort((a, b) => a.value - b.value);
    return found.map(item => item.cards);
  }

  private collectTubes(minValue = 0): Card[][] {
    const reserved = this.reservedIds();
    const windows: { ranks: number[]; value: number }[] = [
      { ranks: [Rank.Ace, Rank.Two, Rank.Three], value: 3 },
    ];
    for (let start = Rank.Two; start <= Rank.Queen; start++) {
      windows.push({ ranks: [start, start + 1, start + 2], value: start + 2 });
    }
    const found: { cards: Card[]; value: number }[] = [];
    for (const window of windows) {
      if (window.value <= minValue) continue;
      const picked: Card[] = [];
      let possible = true;
      for (const rank of window.ranks) {
        const avail = this.cards.filter(card =>
          !card.isWild && card.rank === rank && !reserved.has(card.id) && !picked.some(owned => owned.id === card.id)
        );
        if (avail.length < 2) {
          possible = false;
          break;
        }
        picked.push(avail[0], avail[1]);
      }
      if (!possible) continue;
      const hand = getHandType(picked, this.level);
      if (hand?.type === HandType.Tube && hand.value > minValue) {
        found.push({ cards: picked, value: hand.value });
      }
    }
    found.sort((a, b) => a.value - b.value);
    return found.map(item => item.cards);
  }

  private collectPlates(minValue = 0): Card[][] {
    const reserved = this.reservedIds();
    const found: { cards: Card[]; value: number }[] = [];
    for (let start = Rank.Two; start <= Rank.King; start++) {
      const ranks = [start, start + 1];
      const value = start + 1;
      if (value <= minValue) continue;
      const picked: Card[] = [];
      let possible = true;
      for (const rank of ranks) {
        const avail = this.cards.filter(card =>
          !card.isWild && card.rank === rank && !reserved.has(card.id) && !picked.some(owned => owned.id === card.id)
        );
        if (avail.length < 3) {
          possible = false;
          break;
        }
        picked.push(avail[0], avail[1], avail[2]);
      }
      if (!possible) continue;
      const hand = getHandType(picked, this.level);
      if (hand?.type === HandType.Plate && hand.value > minValue) {
        found.push({ cards: picked, value: hand.value });
      }
    }
    found.sort((a, b) => a.value - b.value);
    return found.map(item => item.cards);
  }

  private beatSameType(target: Hand): Card[][] {
    if (target.type === HandType.Single) {
      return this.collectSingles().filter(cards => getLogicValue(cards[0].rank, this.level) > target.value);
    }
    if (target.type === HandType.Pair) {
      return this.collectPairs().filter(cards => getLogicValue(cards[0].rank, this.level) > target.value);
    }
    if (target.type === HandType.Trips) {
      return this.collectTrips().filter(cards => getLogicValue(cards[0].rank, this.level) > target.value);
    }
    if (target.type === HandType.TripsWithPair) {
      return this.collectFullHouses().filter(cards => {
        const hand = getHandType(cards, this.level);
        return hand?.type === HandType.TripsWithPair && hand.value > target.value;
      });
    }
    if (target.type === HandType.Straight) return this.collectStraights(target.value);
    if (target.type === HandType.Tube) return this.collectTubes(target.value);
    if (target.type === HandType.Plate) return this.collectPlates(target.value);
    return [];
  }

  /** 能压过 target 的炸弹、同花顺、四大天王。没有 target 时给出最小的一手炸弹，用来收尾。 */
  private listBombs(target: Hand | null): Card[][] {
    const bombs = this.valueGroups()
      .filter(group => group.length >= 4)
      .map(group => ({ cards: group, value: getLogicValue(group[0].rank, this.level) }))
      .sort((a, b) => a.cards.length - b.cards.length || a.value - b.value);

    const straightFlushes = this.naturalStraightFlushes(this.bombOnlyIds())
      .map(cards => ({ cards, value: getHandType(cards, this.level)?.value ?? 0 }))
      .sort((a, b) => a.value - b.value);

    const small = this.cards.filter(card => card.rank === Rank.SmallJoker);
    const big = this.cards.filter(card => card.rank === Rank.BigJoker);
    const kings = small.length === 2 && big.length === 2 ? [...small, ...big] : null;

    if (!target || (target.type !== HandType.Bomb && target.type !== HandType.StraightFlush && target.type !== HandType.FourKings)) {
      return [
        ...bombs.map(bomb => bomb.cards),
        ...straightFlushes.map(item => item.cards),
        ...(kings ? [kings] : []),
      ];
    }
    if (target.type === HandType.FourKings) return [];
    if (target.type === HandType.StraightFlush) {
      return [
        ...straightFlushes.filter(item => item.value > target.value).map(item => item.cards),
        ...(kings ? [kings] : []),
      ];
    }
    const count = target.bombCount || 4;
    return [
      ...bombs
        .filter(bomb => bomb.cards.length > count || (bomb.cards.length === count && bomb.value > target.value))
        .map(bomb => bomb.cards),
      ...straightFlushes.map(item => item.cards),
      ...(kings ? [kings] : []),
    ];
  }
}
