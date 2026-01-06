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

// Hand interpretation with wild card usage
export interface HandInterpretation {
  hand: Hand;
  description: string; // Human-readable description of how wilds are used
  wildUsage?: { [cardId: string]: { asRank: Rank, asSuit?: Suit } }; // How each wild is interpreted
}

// Game Mode
export enum GameMode {
  Normal = 'Normal',
  Skill = 'Skill'
}

// Skill Card Types
export enum SkillCardType {
  DrawTwo = 'DrawTwo',           // 无中生有：获得随机两张牌
  Steal = 'Steal',               // 顺手牵羊：从目标玩家随机获得一张牌
  Discard = 'Discard',           // 过河拆桥：让目标玩家随机弃一张牌
  Skip = 'Skip',                 // 乐不思蜀：让目标玩家下回合跳过
  Harvest = 'Harvest'            // 五谷丰登：每个玩家各获得一张随机牌
}

export interface SkillCard {
  id: string;
  type: SkillCardType;
}

// Skill card display names
export const SkillCardNames: { [key in SkillCardType]: string } = {
  [SkillCardType.DrawTwo]: '无中生有',
  [SkillCardType.Steal]: '顺手牵羊',
  [SkillCardType.Discard]: '过河拆桥',
  [SkillCardType.Skip]: '乐不思蜀',
  [SkillCardType.Harvest]: '五谷丰登'
};
