import React from 'react';
import { Card as CardType, Suit, Rank } from '../../shared/types';

interface Props {
  card: CardType;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  isHighlighted?: boolean;  // For new card highlight animation
}

const getSuitSymbol = (suit: Suit) => {
  switch (suit) {
    case Suit.Spades: return '♠';
    case Suit.Hearts: return '♥';
    case Suit.Clubs: return '♣';
    case Suit.Diamonds: return '♦';
    case Suit.Joker: return 'J'; // Special handling
  }
};

const getRankLabel = (rank: Rank) => {
  switch (rank) {
    case Rank.Two: return '2';
    case Rank.Three: return '3';
    case Rank.Four: return '4';
    case Rank.Five: return '5';
    case Rank.Six: return '6';
    case Rank.Seven: return '7';
    case Rank.Eight: return '8';
    case Rank.Nine: return '9';
    case Rank.Ten: return '10';
    case Rank.Jack: return 'J';
    case Rank.Queen: return 'Q';
    case Rank.King: return 'K';
    case Rank.Ace: return 'A';
    case Rank.SmallJoker: return 'Small Joker';
    case Rank.BigJoker: return 'Big Joker';
  }
};

export const Card: React.FC<Props> = ({ card, selected, onClick, small, isHighlighted }) => {
  const isRed = card.suit === Suit.Hearts || card.suit === Suit.Diamonds || card.rank === Rank.BigJoker;
  const isJoker = card.suit === Suit.Joker;
  
  const baseClasses = "relative bg-white rounded shadow-md border border-gray-300 flex flex-col justify-between select-none cursor-pointer transition-transform";
  const sizeClasses = small 
    ? "w-8 h-12 text-xs p-1" 
    : "w-16 h-24 text-base p-2 hover:-translate-y-2";
  const selectClasses = selected ? "ring-2 ring-blue-500 -translate-y-4" : "";
  const colorClass = isRed ? "text-red-600" : "text-black";
  // Highlight animation for new cards - glowing green border with pulse
  const highlightClasses = isHighlighted 
    ? "ring-4 ring-green-400 shadow-[0_0_15px_rgba(74,222,128,0.7)] animate-pulse" 
    : "";

  if (isJoker) {
     return (
        <div 
          className={`${baseClasses} ${sizeClasses} ${selectClasses} ${highlightClasses} ${colorClass}`}
          onClick={onClick}
        >
           <div className="text-center w-full h-full flex items-center justify-center font-bold writing-vertical">
               {card.rank === Rank.SmallJoker ? '小王' : '大王'}
           </div>
        </div>
     );
  }

  return (
    <div 
      className={`${baseClasses} ${sizeClasses} ${selectClasses} ${highlightClasses} ${colorClass}`}
      onClick={onClick}
    >
      <div className="font-bold text-left leading-none">{getRankLabel(card.rank)}</div>
      <div className="absolute inset-0 flex items-center justify-center text-2xl opacity-20 pointer-events-none">
          {getSuitSymbol(card.suit)}
      </div>
      <div className="text-right leading-none self-end">{getSuitSymbol(card.suit)}</div>
      
      {card.isLevelCard && (
          <div className="absolute top-0 right-0 w-2 h-2 bg-yellow-400 rounded-full"></div>
      )}
    </div>
  );
};
