export enum Suit {
  Spades = 0, 
  Hearts = 1, 
  Clubs = 2,  
  Diamonds = 3, 
  Joker = 4   
}

export enum Rank {
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
  Ten = 10,
  Jack = 11,
  Queen = 12,
  King = 13,
  Ace = 14,
  SmallJoker = 15,
  BigJoker = 16
}

export interface Card {
  suit: Suit;
  rank: Rank;
  id: string; 
  isLevelCard?: boolean; 
  isWild?: boolean; 
}

export enum HandType {
  Single = 'Single',
  Pair = 'Pair',
  Trips = 'Trips',
  TripsWithPair = 'TripsWithPair',
  Straight = 'Straight',
  Tube = 'Tube', 
  Plate = 'Plate', 
  Bomb = 'Bomb', 
  StraightFlush = 'StraightFlush',
  FourKings = 'FourKings'
}

export interface Hand {
  type: HandType;
  cards: Card[];
  value: number; 
  bombCount?: number;
}
