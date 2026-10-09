import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card as CardType, HandType, Rank, Suit } from '../../shared/types';
import { getHandType } from '../../shared/rules';
import { Card } from './Card';
import { evaluateSelection, getTributeEligibleIds } from './gameSelection';

let nextId = 0;
const card = (rank: Rank, suit = Suit.Spades, isWild = false): CardType => ({ id: `test-${nextId++}`, rank, suit, isWild });
const hand = (ranks: Rank[]) => ranks.map(rank => card(rank));

test('empty and invalid selections are explained without enabling play', () => {
  assert.equal(evaluateSelection([], 2, null).canPlay, false);
  const invalid = evaluateSelection(hand([Rank.Three, Rank.Four]), 2, null);
  assert.equal(invalid.hand, null);
  assert.match(invalid.message, /有效牌型/);
});

test('a valid lead is playable and reports its type', () => {
  const selection = evaluateSelection(hand([Rank.Three, Rank.Three]), 2, null);
  assert.equal(selection.canPlay, true);
  assert.equal(selection.hand?.type, HandType.Pair);
  assert.match(selection.message, /对子/);
});

test('lower, equal, and mismatched hands cannot beat the target', () => {
  const target = getHandType(hand([Rank.Seven, Rank.Seven]), 2)!;
  for (const cards of [hand([Rank.Six, Rank.Six]), hand([Rank.Seven, Rank.Seven]), hand([Rank.Ace])]) {
    const selection = evaluateSelection(cards, 2, target);
    assert.equal(selection.canPlay, false);
    assert.match(selection.message, /压不过/);
  }
});

test('higher matching hands and bombs can beat the target', () => {
  const target = getHandType(hand([Rank.Seven, Rank.Seven]), 2)!;
  assert.equal(evaluateSelection(hand([Rank.Eight, Rank.Eight]), 2, target).canPlay, true);
  assert.equal(evaluateSelection(hand([Rank.Three, Rank.Three, Rank.Three, Rank.Three]), 2, target).canPlay, true);
});

test('wild-card selection uses the same canonical interpretation as the server', () => {
  const cards = [card(Rank.Two, Suit.Hearts, true), card(Rank.Nine)];
  const result = evaluateSelection(cards, 2, null);
  assert.deepEqual(result.hand, getHandType(cards, 2));
  assert.equal(result.canPlay, true);
});

test('tribute highlights all tied largest cards, including jokers', () => {
  const cards = [card(Rank.Ace), card(Rank.Two), card(Rank.BigJoker, Suit.Joker), card(Rank.BigJoker, Suit.Joker)];
  assert.deepEqual([...getTributeEligibleIds(cards, 2, 'Tribute')], cards.slice(2).map(value => value.id));
});

test('return tribute allows ordinary cards through ten and excludes level cards', () => {
  const cards = hand([Rank.Three, Rank.Ten, Rank.Seven, Rank.Jack, Rank.SmallJoker]);
  assert.deepEqual([...getTributeEligibleIds(cards, Rank.Seven, 'ReturnTribute')], cards.slice(0, 2).map(value => value.id));
});

test('return tribute falls back to all tied lowest logical cards', () => {
  const cards = hand([Rank.Jack, Rank.Queen, Rank.Queen, Rank.Ace, Rank.BigJoker]);
  assert.deepEqual([...getTributeEligibleIds(cards, Rank.Jack, 'ReturnTribute')], [cards[1].id, cards[2].id]);
});

test('empty hands and ordinary play have no tribute highlights', () => {
  assert.equal(getTributeEligibleIds([], 2, 'Tribute').size, 0);
  assert.equal(getTributeEligibleIds(hand([Rank.Ten]), 2, 'Playing').size, 0);
});

test('interactive cards are keyboard buttons with an announced selection state', () => {
  const markup = renderToStaticMarkup(React.createElement(Card, { card: card(Rank.Two, Suit.Hearts, true), selected: true, onClick() {} }));
  assert.match(markup, /<button/);
  assert.match(markup, /type="button"/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /aria-label="红心2，万能牌"/);
});

test('display-only table cards are not interactive', () => {
  const markup = renderToStaticMarkup(React.createElement(Card, { card: card(Rank.BigJoker, Suit.Joker) }));
  assert.doesNotMatch(markup, /<button/);
  assert.match(markup, /role="img"/);
  assert.match(markup, /aria-label="大王"/);
});
