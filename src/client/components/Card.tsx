import React from 'react';
import { Card as CardType, Suit, Rank } from '../../shared/types';

interface Props {
  card: CardType;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  isHighlighted?: boolean;
  hint?: boolean;
}

const suits = { [Suit.Spades]: '♠', [Suit.Hearts]: '♥', [Suit.Clubs]: '♣', [Suit.Diamonds]: '♦', [Suit.Joker]: '' };
const suitNames = { [Suit.Spades]: '黑桃', [Suit.Hearts]: '红心', [Suit.Clubs]: '梅花', [Suit.Diamonds]: '方块', [Suit.Joker]: '' };
const rankLabel = (rank: Rank) => ({ [Rank.Jack]: 'J', [Rank.Queen]: 'Q', [Rank.King]: 'K', [Rank.Ace]: 'A', [Rank.SmallJoker]: '小王', [Rank.BigJoker]: '大王' }[rank] ?? String(rank));

export const Card: React.FC<Props> = ({ card, selected = false, onClick, small, isHighlighted, hint }) => {
  const isRed = card.suit === Suit.Hearts || card.suit === Suit.Diamonds || card.rank === Rank.BigJoker;
  const isJoker = card.suit === Suit.Joker;
  const label = `${suitNames[card.suit]}${rankLabel(card.rank)}${card.isWild ? '，万能牌' : card.isLevelCard ? '，级牌' : ''}${hint ? '，可用于进贡或还贡' : ''}`;
  const className = ['game-card', isRed ? 'game-card--red' : '', small ? 'game-card--small' : '', selected ? 'is-selected' : '', isHighlighted ? 'is-new' : '', hint ? 'is-hint' : ''].filter(Boolean).join(' ');
  const content = <>
    <span className="game-card__rank" aria-hidden="true">{rankLabel(card.rank)}{!isJoker && <span className="game-card__corner-suit">{suits[card.suit]}</span>}</span>
    {!isJoker && <><span className="game-card__watermark" aria-hidden="true">{suits[card.suit]}</span><span className="game-card__suit" aria-hidden="true">{suits[card.suit]}</span></>}
    {card.isLevelCard && <span className="game-card__level" aria-hidden="true">{card.isWild ? '癞' : '级'}</span>}
    {selected && <span className="game-card__selected" aria-hidden="true">✓</span>}
  </>;
  return onClick ? (
    <button type="button" className={className} aria-label={label} aria-pressed={selected} onClick={onClick} title={label}>{content}</button>
  ) : <div className={className} role="img" aria-label={label}>{content}</div>;
};
