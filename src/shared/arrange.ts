import { Card, HandType, Rank, Suit } from './types';
import { getHandType, getLogicValue, sortCards } from './rules';

/** 一手牌里理出来的一组。只包含 getHandType 能认的组合。 */
export interface CardGroup {
  id: string;
  type: HandType | 'Singles';
  label: string;
  cards: Card[];
  /** 同类型之间的比较值，越大越靠左。 */
  strength: number;
}

const TYPE_ORDER: Record<string, number> = {
  [HandType.FourKings]: 0,
  [HandType.StraightFlush]: 1,
  [HandType.Bomb]: 2,
  [HandType.Plate]: 3,
  [HandType.Tube]: 4,
  [HandType.Straight]: 5,
  [HandType.TripsWithPair]: 6,
  [HandType.Trips]: 7,
  [HandType.Pair]: 8,
  Singles: 9,
};

interface RankWindow {
  ranks: number[];
  value: number;
}

/** 顺子 / 同花顺的 5 张窗口。A2345 最小，10JQKA 最大。 */
function fiveRankWindows(): RankWindow[] {
  const windows: RankWindow[] = [{ ranks: [Rank.Ace, Rank.Two, Rank.Three, Rank.Four, Rank.Five], value: 5 }];
  for (let start = Rank.Two; start <= Rank.Ten; start++) {
    const ranks = [0, 1, 2, 3, 4].map(i => start + i);
    windows.push({ ranks, value: ranks[4] });
  }
  return windows.sort((a, b) => b.value - a.value);
}

function isWildCard(card: Card, level: number): boolean {
  return card.isWild === true || (card.rank === level && card.suit === Suit.Hearts);
}

function removeCards(pool: Card[], taken: Card[]): Card[] {
  const ids = new Set(taken.map(c => c.id));
  return pool.filter(c => !ids.has(c.id));
}

function seqOrder(ranks: number[], value: number): number[] {
  if (value === 5 && ranks.includes(Rank.Ace) && ranks.includes(Rank.Two)) {
    return [Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Ace];
  }
  return [...ranks].sort((a, b) => a - b);
}

function orderByWindow(cards: Card[], window: RankWindow): Card[] {
  const order = seqOrder(window.ranks, window.value);
  const used = new Set<string>();
  const result: Card[] = [];
  for (const rank of order) {
    const natural = cards.find(c => !used.has(c.id) && !c.isWild && c.rank === rank);
    if (natural) {
      result.push(natural);
      used.add(natural.id);
      continue;
    }
    const wild = cards.find(c => !used.has(c.id) && c.isWild);
    if (wild) {
      result.push(wild);
      used.add(wild.id);
    }
  }
  cards.forEach(c => {
    if (!used.has(c.id)) result.push(c);
  });
  return result;
}

let groupSeq = 0;

function makeGroup(type: CardGroup['type'], label: string, cards: Card[], strength: number): CardGroup {
  groupSeq += 1;
  return { id: `${type}-${groupSeq}`, type, label, cards, strength };
}

function cardsByRank(cards: Card[], suit?: Suit): Map<number, Card[]> {
  const map = new Map<number, Card[]>();
  cards.forEach(c => {
    if (c.rank > Rank.Ace) return;
    if (suit !== undefined && c.suit !== suit) return;
    const list = map.get(c.rank) ?? [];
    list.push(c);
    map.set(c.rank, list);
  });
  return map;
}

function takeWindow(byRank: Map<number, Card[]>, window: RankWindow): Card[] | null {
  const picked: Card[] = [];
  for (const rank of window.ranks) {
    const list = byRank.get(rank);
    if (!list || list.length === 0) return null;
    picked.push(list[0]);
  }
  return picked;
}

/**
 * 把一手牌分成可打的组。
 * 从左到右：天王炸、同花顺、炸弹（张数多的在前）、钢板、三连对、顺子、三带二、三张、对子、单张。
 * 同花顺优先于炸弹占牌。红心级牌只去补服务端认得出的牌型。
 */
export function arrangeHand(cards: Card[], level: number): CardGroup[] {
  groupSeq = 0;
  let pool: Card[] = cards.map(c => ({
    ...c,
    isWild: isWildCard(c, level),
    isLevelCard: c.rank === level,
  }));
  const groups: CardGroup[] = [];
  const windows = fiveRankWindows();

  const pushIfValid = (picked: Card[], orderWindow?: RankWindow) => {
    const hand = getHandType(picked, level);
    if (!hand) return false;
    const ordered = orderWindow ? orderByWindow(picked, orderWindow) : sortCards(picked, level);
    const label = labelFor(hand.type, ordered.length);
    groups.push(makeGroup(hand.type, label, ordered, hand.type === HandType.Bomb ? (hand.bombCount ?? ordered.length) * 100 + hand.value : hand.value));
    pool = removeCards(pool, picked);
    return true;
  };

  const smallJokers = pool.filter(c => c.rank === Rank.SmallJoker).slice(0, 2);
  const bigJokers = pool.filter(c => c.rank === Rank.BigJoker).slice(0, 2);
  if (smallJokers.length === 2 && bigJokers.length === 2) {
    pushIfValid([...smallJokers, ...bigJokers]);
  }

  const natural = () => pool.filter(c => !c.isWild);

  let guard = 0;
  while (guard++ < 12) {
    let best: { cards: Card[]; window: RankWindow } | null = null;
    for (const suit of [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]) {
      const byRank = cardsByRank(natural().filter(c => c.suit === suit));
      for (const window of windows) {
        const picked = takeWindow(byRank, window);
        if (!picked) continue;
        if (!best || window.value > best.window.value) best = { cards: picked, window };
      }
    }
    if (!best || !pushIfValid(best.cards, best.window)) break;
  }

  const bombs = new Map<number, Card[]>();
  natural().forEach(c => {
    if (c.rank > Rank.Ace) return;
    const value = getLogicValue(c.rank, level);
    const list = bombs.get(value) ?? [];
    list.push(c);
    bombs.set(value, list);
  });
  const bombEntries = [...bombs.entries()].filter(([, list]) => list.length >= 4)
    .sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  bombEntries.forEach(([, list]) => pushIfValid(list));

  guard = 0;
  while (guard++ < 8) {
    const byRank = cardsByRank(pool.filter(c => !c.isWild));
    let best: { cards: Card[]; value: number } | null = null;
    for (let high = Rank.Three; high <= Rank.Ace; high++) {
      const lowCards = byRank.get(high - 1);
      const highCards = byRank.get(high);
      if (!lowCards || !highCards || lowCards.length < 3 || highCards.length < 3) continue;
      const picked = [...lowCards.slice(0, 3), ...highCards.slice(0, 3)];
      if (!best || high > best.value) best = { cards: picked, value: high };
    }
    if (!best || !pushIfValid(best.cards)) break;
  }

  guard = 0;
  while (guard++ < 8) {
    const byRank = cardsByRank(pool.filter(c => !c.isWild));
    let best: { cards: Card[]; value: number } | null = null;
    const considerTube = (ranks: number[], value: number) => {
      const lists = ranks.map(r => byRank.get(r));
      if (lists.some(list => !list || list.length < 2)) return;
      const picked = lists.flatMap(list => list!.slice(0, 2));
      if (!best || value > best.value) best = { cards: picked, value };
    };
    for (let start = Rank.Two; start <= Rank.Queen; start++) {
      considerTube([start, start + 1, start + 2], start + 2);
    }
    considerTube([Rank.Ace, Rank.Two, Rank.Three], 3);
    if (!best || !pushIfValid(best.cards)) break;
  }

  guard = 0;
  while (guard++ < 8) {
    const byRank = cardsByRank(pool.filter(c => !c.isWild));
    let best: { cards: Card[]; window: RankWindow } | null = null;
    for (const window of windows) {
      const picked = takeWindow(byRank, window);
      if (!picked) continue;
      if (!best || window.value > best.window.value) best = { cards: picked, window };
    }
    if (!best || !pushIfValid(best.cards, best.window)) break;
  }

  const wilds = pool.filter(c => c.isWild);
  wilds.forEach(wild => {
    if (!pool.some(c => c.id === wild.id)) return;
    type Candidate = { score: number; cards: Card[]; window?: RankWindow; replaceGroup?: number };
    let best: Candidate | null = null;
    const consider = (candidate: Candidate) => {
      if (!getHandType(candidate.cards, level)) return;
      if (!best || candidate.score > best.score) best = candidate;
    };

    for (const suit of [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]) {
      const byRank = cardsByRank(pool.filter(c => !c.isWild && c.suit === suit));
      windows.forEach(window => {
        const have = window.ranks.filter(r => (byRank.get(r)?.length ?? 0) > 0);
        const miss = window.ranks.filter(r => (byRank.get(r)?.length ?? 0) === 0);
        if (have.length === 4 && miss.length === 1) {
          const picked = have.map(r => byRank.get(r)![0]);
          consider({ score: 100000 + window.value, cards: [...picked, wild], window });
        }
      });
    }

    groups.forEach((group, index) => {
      if (group.type !== HandType.Bomb) return;
      const cards = [...group.cards, wild];
      const hand = getHandType(cards, level);
      if (hand?.type === HandType.Bomb) {
        consider({
          score: 80000 + (hand.bombCount ?? cards.length) * 100 + hand.value,
          cards,
          replaceGroup: index,
        });
      }
    });

    const byValue = new Map<number, Card[]>();
    pool.filter(c => !c.isWild && c.rank <= Rank.Ace).forEach(c => {
      const value = getLogicValue(c.rank, level);
      const list = byValue.get(value) ?? [];
      list.push(c);
      byValue.set(value, list);
    });
    byValue.forEach((list, value) => {
      if (list.length === 3) consider({ score: 70000 + value, cards: [...list, wild] });
      if (list.length === 2) consider({ score: 10000 + value, cards: [...list, wild] });
      if (list.length === 1) consider({ score: 5000 + value, cards: [...list, wild] });
    });

    const anyRank = cardsByRank(pool.filter(c => !c.isWild));
    windows.forEach(window => {
      const have = window.ranks.filter(r => (anyRank.get(r)?.length ?? 0) > 0);
      const miss = window.ranks.filter(r => (anyRank.get(r)?.length ?? 0) === 0);
      if (have.length === 4 && miss.length === 1) {
        const picked = have.map(r => anyRank.get(r)![0]);
        const suited = new Set(picked.map(c => c.suit)).size === 1;
        consider({
          score: (suited ? 100000 : 40000) + window.value,
          cards: [...picked, wild],
          window,
        });
      }
    });

    if (!best) return;
    const hand = getHandType(best.cards, level)!;
    const ordered = best.window ? orderByWindow(best.cards, best.window) : sortCards(best.cards, level);
    const label = labelFor(hand.type, ordered.length);
    const strength = hand.type === HandType.Bomb ? (hand.bombCount ?? ordered.length) * 100 + hand.value : hand.value;
    if (best.replaceGroup !== undefined) {
      groups[best.replaceGroup] = makeGroup(hand.type, label, ordered, strength);
    } else {
      groups.push(makeGroup(hand.type, label, ordered, strength));
    }
    pool = removeCards(pool, best.cards.filter(c => c.id === wild.id || pool.some(p => p.id === c.id)));
  });

  groups.push(...bucketRemainder(pool, level));

  return groups.sort((a, b) => {
    const typeDiff = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
    if (typeDiff !== 0) return typeDiff;
    if (a.type === HandType.Bomb && b.type === HandType.Bomb) {
      if (a.cards.length !== b.cards.length) return b.cards.length - a.cards.length;
    }
    return b.strength - a.strength;
  });
}

function labelFor(type: HandType, count: number): string {
  switch (type) {
    case HandType.FourKings: return '天王炸';
    case HandType.StraightFlush: return '同花顺';
    case HandType.Bomb: return `${count}炸`;
    case HandType.Plate: return '钢板';
    case HandType.Tube: return '三连对';
    case HandType.Straight: return '顺子';
    case HandType.TripsWithPair: return '三带二';
    case HandType.Trips: return '三张';
    case HandType.Pair: return '对子';
    default: return '单张';
  }
}

function bucketRemainder(pool: Card[], level: number): CardGroup[] {
  const byValue = new Map<number, Card[]>();
  pool.forEach(c => {
    const value = getLogicValue(c.rank, level);
    const list = byValue.get(value) ?? [];
    list.push(c);
    byValue.set(value, list);
  });

  const trips: CardGroup[] = [];
  const pairs: CardGroup[] = [];
  const singles: Card[] = [];

  byValue.forEach((list, value) => {
    const sorted = sortCards(list, level);
    if (value > 19) {
      let index = 0;
      while (index + 1 < sorted.length) {
        const two = sorted.slice(index, index + 2);
        if (getHandType(two, level)?.type !== HandType.Pair) break;
        pairs.push(makeGroup(HandType.Pair, '对子', two, value));
        index += 2;
      }
      singles.push(...sorted.slice(index));
      return;
    }
    if (sorted.length >= 3) {
      const three = sorted.slice(0, 3);
      if (getHandType(three, level)?.type === HandType.Trips) {
        trips.push(makeGroup(HandType.Trips, '三张', three, value));
        singles.push(...sorted.slice(3));
        return;
      }
    }
    if (sorted.length === 2 && getHandType(sorted, level)?.type === HandType.Pair) {
      pairs.push(makeGroup(HandType.Pair, '对子', sorted, value));
      return;
    }
    singles.push(...sorted);
  });

  trips.sort((a, b) => b.strength - a.strength);
  pairs.sort((a, b) => a.strength - b.strength);
  const fullHouses: CardGroup[] = [];
  const usedPairs = new Set<string>();
  const keptTrips: CardGroup[] = [];
  trips.forEach(trip => {
    const pair = pairs.find(p => !usedPairs.has(p.id) && getHandType([...trip.cards, ...p.cards], level)?.type === HandType.TripsWithPair);
    if (!pair) {
      keptTrips.push(trip);
      return;
    }
    usedPairs.add(pair.id);
    const cards = [...trip.cards, ...pair.cards];
    fullHouses.push(makeGroup(HandType.TripsWithPair, '三带二', cards, trip.strength));
  });
  const keptPairs = pairs.filter(p => !usedPairs.has(p.id));
  const result = [...fullHouses, ...keptTrips, ...keptPairs];
  if (singles.length > 0) {
    result.push(makeGroup('Singles', '单张', sortCards(singles, level), 0));
  }
  return result;
}
