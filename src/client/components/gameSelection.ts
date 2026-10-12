import { Card, Hand, Rank } from '../../shared/types';
import { compareHands, getHandDescription, getHandType, getLogicValue } from '../../shared/rules';

/** Match the server's canonical hand validation; alternate wild-card interpretations are advisory. */
export function evaluateSelection(cards: Card[], level: number, target: Hand | null) {
  if (cards.length === 0) return { hand: null, canPlay: false, message: '点击手牌选择，或试试「提示」' };
  const hand = getHandType(cards, level);
  if (!hand) return { hand: null, canPlay: false, message: '这些牌还不能组成有效牌型' };
  const description = getHandDescription(hand, level);
  if (target && compareHands(hand, target) <= 0) {
    return { hand, canPlay: false, message: `${description} · 压不过桌面牌，请换一组` };
  }
  return { hand, canPlay: true, message: `${description} · 可以出牌` };
}

/** Include ties and the server's smallest-card fallback when no ordinary return is available. */
export function getTributeEligibleIds(cards: Card[], level: number, phase: string): Set<string> {
  if (!cards.length || (phase !== 'Tribute' && phase !== 'ReturnTribute')) return new Set();
  if (phase === 'ReturnTribute') {
    const legal = cards.filter(card => card.rank <= Rank.Ten && card.rank !== level);
    if (legal.length) return new Set(legal.map(card => card.id));
  }
  const values = cards.map(card => getLogicValue(card.rank, level));
  const required = phase === 'Tribute' ? Math.max(...values) : Math.min(...values);
  return new Set(cards.filter(card => getLogicValue(card.rank, level) === required).map(card => card.id));
}
