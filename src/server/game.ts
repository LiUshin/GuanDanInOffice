import { Server, Socket } from 'socket.io';
import { createDeck, shuffleDeck, updateCardProperties } from '../shared/deck';
import { getHandType, compareHands, sortCards, getLargestCard, getLogicValue } from '../shared/rules';
import { Card, Hand, HandType, GameMode, SkillCard, SkillCardType, Suit, Rank } from '../shared/types';
import { Bot } from '../shared/bot';

interface Player {
  id: string;
  name: string;
  socket?: Socket;
  seatIndex: number;
  isBot?: boolean;
}

enum GamePhase {
  Waiting = 'Waiting',
  Dealing = 'Dealing',
  Tribute = 'Tribute',
  ReturnTribute = 'ReturnTribute',
  Playing = 'Playing',
  Score = 'Score'
}

interface TributeState {
  pendingTributes: { from: number, to: number, card?: Card }[];
  pendingReturns: { from: number, to: number, card?: Card }[];
  nextStartPlayer?: number;
}

export class Game {
  io: Server;
  roomId: string;
  players: Player[];
  
  level: number = 2; 
  currentPhase: GamePhase = GamePhase.Waiting;
  
  // Callback for when game ends (used by Match)
  onGameEnd?: (winners: number[]) => void;
  
  hands: Card[][] = [[], [], [], []];
  currentTurn: number = 0;
  
  lastHand: { playerIndex: number, hand: Hand } | null = null;
  passCount: number = 0;
  
  // Track each player's action in current round (for display)
  roundActions: { [seat: number]: { type: 'play' | 'pass', cards?: Card[], hand?: Hand } } = {};
  
  winners: number[] = [];
  tributeState: TributeState = { pendingTributes: [], pendingReturns: [] };
  
  // Track Team Levels
  teamLevels: { [key: number]: number } = { 0: 2, 1: 2 }; // Team 0 (0,2), Team 1 (1,3)
  activeTeam: number = 0; // Who is upgrading currently (Banker Team)
  prevWinners: number[] = [];
  
  // Skill Mode
  gameMode: GameMode = GameMode.Normal;
  skillCards: SkillCard[][] = [[], [], [], []];  // Each player's skill cards
  skipNextTurn: boolean[] = [false, false, false, false];  // 乐不思蜀 effect
  newCardIds: { [seat: number]: string[] } = {};  // Track newly acquired cards for highlight

  constructor(io: Server, roomId: string, players: Player[], gameMode: GameMode = GameMode.Normal) {
    this.io = io;
    this.roomId = roomId;
    this.players = players;
    this.gameMode = gameMode;
    
    // Setup listeners for human players
    this.players.forEach(p => {
        if (!p.isBot && p.socket) {
            this.bindPlayerListeners(p);
        }
    });
  }
  
  rebindPlayer(p: Player) {
      if (!p.isBot && p.socket) {
          // Remove old listeners? Socket is new, so no need to remove old ones from new socket.
          // Old socket is dead.
          this.bindPlayerListeners(p);
      }
  }
  
  bindPlayerListeners(p: Player) {
      if (!p.socket) return;
      const s = p.socket;
      s.on('playHand', (data: { cards: Card[], handType?: Hand } | Card[]) => {
          // Support both old format (Card[]) and new format ({ cards, handType })
          if (Array.isArray(data)) {
              this.handlePlayHand(p.seatIndex, data, undefined);
          } else {
              this.handlePlayHand(p.seatIndex, data.cards, data.handType);
          }
      });
      s.on('pass', () => this.handlePass(p.seatIndex));
      s.on('tribute', (cards: Card[]) => this.handleTribute(p.seatIndex, cards));
      s.on('returnTribute', (cards: Card[]) => this.handleReturnTribute(p.seatIndex, cards));
      s.on('useSkill', (data: { skillId: string, targetSeat?: number }) => 
          this.handleUseSkill(p.seatIndex, data.skillId, data.targetSeat));
  }

  // Called by Room when restarting
  resetAndStart() {
      // Save winners
      if (this.winners.length === 4) {
          this.prevWinners = [...this.winners];
          this.handleLevelUp();
      }
      this.winners = [];
      this.tributeState = { pendingTributes: [], pendingReturns: [] };
      
      this.start();
  }

  start() {
    this.currentPhase = GamePhase.Dealing;
    
    // First time start logic
    if (this.prevWinners.length === 0 && this.winners.length === 0) {
        // Fresh game
        this.activeTeam = 0;
        this.teamLevels = { 0: 2, 1: 2 };
    }

    // Use Active Team Level
    this.level = this.teamLevels[this.activeTeam];

    let deck = createDeck();
    deck = shuffleDeck(deck);
    
    this.hands = [[], [], [], []];
    for (let i = 0; i < 108; i++) {
        this.hands[i % 4].push(deck[i]);
    }
    
    // Process hands
    this.hands = this.hands.map(h => updateCardProperties(h, this.level));
    this.hands = this.hands.map(h => sortCards(h, this.level));
    
    // Reset skip flags
    this.skipNextTurn = [false, false, false, false];
    
    // Deal skill cards if in Skill mode
    if (this.gameMode === GameMode.Skill) {
        this.dealSkillCards();
    } else {
        this.skillCards = [[], [], [], []];
    }

    // If it's a restart (not fresh)
    if (this.prevWinners.length > 0) {
         this.initTributePhase();
    } else {
         this.currentTurn = 0;
         this.currentPhase = GamePhase.Playing;
         this.passCount = 0;
         this.lastHand = null;
    }
    
    this.broadcastGameState();
  }
  
  handleLevelUp() {
      if (this.prevWinners.length === 0) return;
      
      const p1 = this.prevWinners[0];
      const p2 = this.prevWinners[1];
      const isSameTeam = (a: number, b: number) => (a % 2) === (b % 2);
      
      // Determine Winning Team (First Winner's Team)
      const winningTeam = p1 % 2;
      
      // Determine Step
      let step = 0;
      if (isSameTeam(p1, p2)) step = 3; // Double Up (1st, 2nd same team) -> +3
      else if (isSameTeam(p1, this.prevWinners[2])) step = 2; // 1st, 3rd -> +2 
      else step = 1; 

      if (winningTeam !== this.activeTeam) {
          // Switch Banker
          this.activeTeam = winningTeam;
          this.teamLevels[this.activeTeam] += step; 
      } else {
          // Keep Banker
          this.teamLevels[this.activeTeam] += step;
      }
      
      if (this.teamLevels[this.activeTeam] > 14) this.teamLevels[this.activeTeam] = 14; 
  }
  
  initTributePhase() {
      if (this.prevWinners.length < 4) {
          // First game or error, no tribute
          this.currentPhase = GamePhase.Playing;
          this.currentTurn = this.activeTeam; // Banker starts first game? Or Random? Usually Banker.
          // In GuanDan, first game usually starts from Host or Random. 
          // Let's assume ActiveTeam's P1 starts.
          return;
      }

      const p1 = this.prevWinners[0];
      const p2 = this.prevWinners[1];
      const p3 = this.prevWinners[2];
      const p4 = this.prevWinners[3];
      const isSameTeam = (a: number, b: number) => (a % 2) === (b % 2);

      this.tributeState = { pendingTributes: [], pendingReturns: [] };
      
      // Anti-Tribute Logic (Resistance)
      // Check for 2 Big Jokers in losing team's hands
      // Losing Team:
      let losingTeam: number[] = [];
      let isDouble = false;
      
      if (isSameTeam(p1, p2)) {
          // Double Win
          isDouble = true;
          losingTeam = [p3, p4];
      } else {
          // Single Win (1,3 or 1,4)
          losingTeam = [p4]; // Only last place pays in Single Win? 
          // Rule: Single Win (1,3 same team) -> 4 pays 1.
          // Rule: Tie (1,4 same team) -> 4 pays 1? Or no tribute?
          // Standard: 
          // Double Win: 4->1, 3->2.
          // Single Win (1,3): 4->1.
          // Tie (1,4): No tribute.
          if (isSameTeam(p1, p4)) {
             // Tie (1,4 same team) -> No tribute
             this.currentPhase = GamePhase.Playing;
             this.currentTurn = p1;
             return;
          }
      }
      
      // Count Big Jokers in Losing Team Hands
      let bigJokerCount = 0;
      losingTeam.forEach(seat => {
          bigJokerCount += this.hands[seat].filter(c => c.rank === 16).length; // Rank.BigJoker = 16
      });
      
      if (bigJokerCount === 2) {
          // Resistance Successful!
          // No Tribute
          // Who starts? P1 (Winner) starts.
          this.currentPhase = GamePhase.Playing;
          this.currentTurn = p1;
          // Notify? Ideally send message.
          this.io.to(this.roomId).emit('error', '抗贡成功！双大王在手，免除进贡！');
          return;
      }
      
      // Tribute Rules
      if (isDouble) {
          // Double: 4->1, 3->2
          this.tributeState.pendingTributes.push({ from: p4, to: p1 }); 
          this.tributeState.pendingTributes.push({ from: p3, to: p2 }); 
      } else {
          // Single: 4->1
          this.tributeState.pendingTributes.push({ from: p4, to: p1 });
      }
      
      if (this.tributeState.pendingTributes.length > 0) {
          this.currentPhase = GamePhase.Tribute;
          this.processAutoTribute();
      } else {
          this.currentPhase = GamePhase.Playing;
          this.currentTurn = p1; 
      }
  }
  
  processAutoTribute() {
      this.tributeState.pendingTributes.forEach(t => {
           const player = this.players[t.from];
           if (player.isBot) {
               const hand = this.hands[t.from];
               const largest = getLargestCard(hand, this.level);
               t.card = largest;
               this.hands[t.from] = this.hands[t.from].filter(c => c.id !== largest.id);
               this.hands[t.to].push(largest);
               this.hands[t.to] = sortCards(this.hands[t.to], this.level);
           }
      });
      
      const allDone = this.tributeState.pendingTributes.every(t => t.card);
      if (allDone) {
          this.currentPhase = GamePhase.ReturnTribute;
          this.tributeState.pendingReturns = this.tributeState.pendingTributes.map(t => ({
              from: t.to,
              to: t.from
          }));
          this.tributeState.pendingTributes = []; 
          
           this.tributeState.pendingReturns.forEach(r => {
               const player = this.players[r.from];
               if (player.isBot) {
                   const hand = this.hands[r.from];
                   const smallest = hand[hand.length - 1]; 
                   r.card = smallest;
                   this.hands[r.from] = this.hands[r.from].filter(c => c.id !== smallest.id);
                   this.hands[r.to].push(smallest);
                   this.hands[r.to] = sortCards(this.hands[r.to], this.level);
               }
           });
           
           this.checkReturnDone();
      }
  }

  handleTribute(seatIndex: number, cards: Card[]) {
      if (this.currentPhase !== GamePhase.Tribute) return;
      if (cards.length !== 1) return;
      
      const tribute = this.tributeState.pendingTributes.find(t => t.from === seatIndex && !t.card);
      if (!tribute) return;
      
      // Verify largest
      const hand = this.hands[seatIndex];
      const largest = getLargestCard(hand, this.level);
      const valPlay = getLogicValue(cards[0].rank, this.level);
      const valMax = getLogicValue(largest.rank, this.level);
      
      if (valPlay < valMax) {
           this.emitError(seatIndex, 'Must pay the largest card');
           return;
      }
      
      tribute.card = cards[0];
      this.hands[seatIndex] = this.hands[seatIndex].filter(c => c.id !== cards[0].id);
      this.hands[tribute.to].push(cards[0]);
      this.hands[tribute.to] = sortCards(this.hands[tribute.to], this.level);
      
      const allDone = this.tributeState.pendingTributes.every(t => t.card);
      if (allDone) {
          // Determine who goes first in next round (Playing Phase)
          // Rule: "The one who paid the largest tribute goes first"
          // If equal? (e.g. both paid Heart 5?) -> Usually the one who paid to First Place? Or downstream order?
          // Rule: If single tribute, payer goes first.
          // If double tribute: Compare tribute cards. Largest payer goes first.
          // If equal max tribute cards? Payer to P1 goes first? Or P4 (Last place) goes first?
          // Common Rule: Payer of largest card. If equal, Last Place (p4) goes first.
          
          let nextTurn = -1;
          
          // Logic for next turn needs to be stored for after Return Tribute
          // Actually, currentTurn updates when entering Playing phase.
          // We can calculate it now and store it? 
          // Wait, Return Tribute phase happens next. We shouldn't set currentTurn for Playing yet.
          // But we need to know who starts.
          
          // Compare tribute cards
          let maxVal = -1;
          let maxPayer = -1;
          
          this.tributeState.pendingTributes.forEach(t => {
              if (t.card) {
                  const val = getLogicValue(t.card.rank, this.level);
                  if (val > maxVal) {
                      maxVal = val;
                      maxPayer = t.from;
                  } else if (val === maxVal) {
                      // Tie breaker: Usually Last Place (p4) has priority if ties with 3rd place?
                      // Or 3rd place?
                      // Let's stick to: If tie, the one who paid to First Winner (P1) gets priority? 
                      // Actually rules say: "If tribute cards are equal, the tributer to the first winner goes first" (Some rules)
                      // OR "Last place goes first"
                      // Let's assume maxPayer updates only if STRICTLY greater, so first one found keeps it.
                      // Order is p4->p1, p3->p2. So p4 is checked first.
                      // If p3 pays same value, maxVal is same, maxPayer stays p4.
                      // So p4 (Last place) wins tie.
                  }
              }
          });
          
          // Store this for later use in checkReturnDone
          this.tributeState.nextStartPlayer = maxPayer;

          this.currentPhase = GamePhase.ReturnTribute;
          this.tributeState.pendingReturns = this.tributeState.pendingTributes.map(t => ({
              from: t.to,
              to: t.from
          }));
          this.tributeState.pendingTributes = [];
          this.broadcastGameState();
      } else {
          this.broadcastGameState();
      }
  }

  handleReturnTribute(seatIndex: number, cards: Card[]) {
      if (this.currentPhase !== GamePhase.ReturnTribute) return;
      if (cards.length !== 1) return;
      
      const ret = this.tributeState.pendingReturns.find(r => r.from === seatIndex && !r.card);
      if (!ret) return;
      
      ret.card = cards[0];
      this.hands[seatIndex] = this.hands[seatIndex].filter(c => c.id !== cards[0].id);
      this.hands[ret.to].push(cards[0]);
      this.hands[ret.to] = sortCards(this.hands[ret.to], this.level);
      
      this.checkReturnDone();
      this.broadcastGameState();
  }
  
  checkReturnDone() {
      const allDone = this.tributeState.pendingReturns.every(r => r.card);
      if (allDone) {
          this.currentPhase = GamePhase.Playing;
          // Set start player based on tribute result
          if (this.tributeState.nextStartPlayer !== undefined) {
              this.currentTurn = this.tributeState.nextStartPlayer;
          } else {
              // Fallback (Shouldn't happen if tribute occurred)
              this.currentTurn = this.prevWinners[0];
          }
          this.tributeState = { pendingTributes: [], pendingReturns: [] }; // Clear
          this.broadcastGameState();
      }
  }

  handlePlayHand(seatIndex: number, cards: Card[], providedHandType?: Hand) {
      if (this.currentPhase !== GamePhase.Playing) return;
      if (this.currentTurn !== seatIndex) return;
      
      // Use provided hand type if available, otherwise infer it
      let hand: Hand | null;
      if (providedHandType) {
          // Validate that the provided hand type is actually valid for these cards
          const inferredHand = getHandType(cards, this.level);
          if (!inferredHand) {
              this.emitError(seatIndex, 'Invalid hand');
              return;
          }
          // Use the provided interpretation
          hand = providedHandType;
      } else {
          hand = getHandType(cards, this.level);
          if (!hand) {
              this.emitError(seatIndex, 'Invalid hand');
              return;
          }
      }
      
      // Debug Log
      console.log(`Player ${seatIndex} plays. Level: ${this.level}. Hand: ${hand.type} (Val: ${hand.value}). LastHand: ${this.lastHand ? `${this.lastHand.hand.type} (Val: ${this.lastHand.hand.value})` : 'None'}`);

      if (this.lastHand && this.lastHand.playerIndex !== seatIndex) {
          // Compare
          const result = compareHands(hand, this.lastHand.hand);
          if (result <= 0) {
               console.log(`Compare failed: ${result}`);
               this.emitError(seatIndex, 'Hand not big enough');
               return;
          }
      }
      
      const playerHand = this.hands[seatIndex];
      // Check if cards exist in hand (by ID)
      const validCards = cards.every(c => playerHand.some(ph => ph.id === c.id));
      if (!validCards) {
           this.emitError(seatIndex, 'You do not have these cards');
           return;
      }

      // Remove cards
      const newHand = playerHand.filter(c => !cards.some(played => played.id === c.id));
      this.hands[seatIndex] = newHand;
      
      this.lastHand = { playerIndex: seatIndex, hand };
      this.passCount = 0;
      
      // Reset round actions when someone plays (new round starts)
      this.roundActions = {};
      this.roundActions[seatIndex] = { type: 'play', cards: cards, hand: hand };
      
      if (this.hands[seatIndex].length === 0) {
          this.winners.push(seatIndex);
          
          // Check Double Win (First two winners are same team)
          if (this.winners.length === 2) {
              const p1 = this.winners[0];
              const p2 = this.winners[1];
              if ((p1 % 2) === (p2 % 2)) {
                  // Double Win!
                  const losers = [0, 1, 2, 3].filter(i => !this.winners.includes(i));
                  this.winners.push(...losers); 
                  this.endGame();
                  return;
              }
          }
          
          // Check Any Team Finished (Both players of a team are in winners list)
          // Since Double Win checks 1st/2nd, we just need to check if game should end when 3rd winner is determined?
          // OR if Team A finishes at positions 1 and 3.
          // OR if Team B finishes at positions 2 and 3? (Impossible if A took 1)
          
          // General Rule: If 3 players have finished, game MUST end.
          // Because if 3 finished, at least one team has 2 members finished.
          // Is it possible for a team to finish earlier?
          // We checked 2 players above.
          // So if 3 players finish, we are done.
          
          if (this.winners.length === 3) {
              // 4th player is the loser
              const last = [0, 1, 2, 3].find(i => !this.winners.includes(i))!;
              this.winners.push(last);
              this.endGame();
              return;
          }
      }
      
      this.advanceTurn();
      this.broadcastGameState();
  }
  
  // Helper to end current round and find next start player
  endRoundAndFindNext(winner: number) {
      console.log(`[endRound] Round ended. Winner: ${winner}`);
      
      // JieFeng Logic: If winner has no cards, partner leads
      if (this.hands[winner].length === 0) {
          console.log(`[endRound] Winner ${winner} has no cards. Partner接风.`);
          winner = (winner + 2) % 4;
      }

      this.lastHand = null;
      this.passCount = 0; // Deprecated but kept for compatibility
      this.roundActions = {}; 

      // If the designated starter (e.g. partner) also has no cards, pass to next
      const order = [winner, (winner + 1) % 4, (winner + 2) % 4, (winner + 3) % 4];
      let found = false;
      for (const seat of order) {
          if (this.hands[seat].length > 0) {
              this.currentTurn = seat;
              found = true;
              console.log(`[endRound] Next turn goes to seat ${seat}`);
              break;
          }
      }
      
      if (!found) {
          console.log('[endRound] All players finished, ending game');
          this.endGame();
          return;
      }
      
      this.broadcastGameState();
  }

  handlePass(seatIndex: number) {
      if (this.currentPhase !== GamePhase.Playing) return;
      if (this.currentTurn !== seatIndex) return;
      
      if (!this.lastHand || this.lastHand.playerIndex === seatIndex) {
          this.emitError(seatIndex, 'Cannot pass on free turn');
          return;
      }
      
      this.roundActions[seatIndex] = { type: 'pass' };
      console.log(`[handlePass] Player ${seatIndex} passed.`);
      
      this.advanceTurn();
      this.broadcastGameState();
  }
  
  advanceTurn() {
      const prevTurn = this.currentTurn;
      let next = (this.currentTurn + 1) % 4;
      
      // Look ahead up to 4 times to find next valid player
      for (let i = 0; i < 4; i++) {
          // Check if we cycled back to the round winner (or their seat)
          if (this.lastHand && next === this.lastHand.playerIndex) {
               console.log(`[advanceTurn] Cycled back to last player ${next}. Round End.`);
               this.endRoundAndFindNext(next);
               return;
          }

          const isFinished = this.hands[next].length === 0;
          const isSkipped = this.skipNextTurn[next];
          
          if (isFinished) {
              console.log(`[advanceTurn] Skipping seat ${next} (no cards)`);
              next = (next + 1) % 4;
              continue;
          }
          
          if (isSkipped) {
              console.log(`[advanceTurn] Skipping seat ${next} (乐不思蜀 effect)`);
              this.skipNextTurn[next] = false;
              this.io.to(this.roomId).emit('error', `${this.players[next].name} 被【乐不思蜀】跳过了回合！`);
              this.roundActions[next] = { type: 'pass' }; // Visually show pass
              
              // After skipping, check round end condition again for the NEXT player
              // But easiest is just to loop again
              next = (next + 1) % 4;
              continue;
          }
          
          // Found valid player
          this.currentTurn = next;
          console.log(`[advanceTurn] Turn changed: ${prevTurn} -> ${next}.`);
          return;
      }
      
      // If we exit loop, everyone is finished?
      this.endGame();
  }
  
  // ==================== SKILL CARD METHODS ====================
  
  dealSkillCards() {
      // Create skill pool: 2 of each type = 10 cards
      const pool: SkillCard[] = [];
      const types = [SkillCardType.DrawTwo, SkillCardType.Steal, SkillCardType.Discard, 
                     SkillCardType.Skip, SkillCardType.Harvest];
      types.forEach(type => {
          pool.push({ id: `skill-${type}-1`, type });
          pool.push({ id: `skill-${type}-2`, type });
      });
      
      // Shuffle pool
      for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      
      // Deal 2 cards to each player (8 total, 2 left in pool)
      this.skillCards = [[], [], [], []];
      for (let i = 0; i < 4; i++) {
          this.skillCards[i] = [pool[i * 2], pool[i * 2 + 1]];
      }
      
      console.log(`[Skill] Dealt skill cards in Skill mode`);
  }
  
  generateRandomCard(): Card {
      // Generate a random card (can create "extra" cards beyond 2 decks)
      const suits = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds];
      const ranks = [Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven,
                     Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King, Rank.Ace];
      
      // Small chance for joker
      if (Math.random() < 0.05) {
          const isSmall = Math.random() < 0.5;
          return {
              id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              suit: Suit.Joker,
              rank: isSmall ? Rank.SmallJoker : Rank.BigJoker
          };
      }
      
      const suit = suits[Math.floor(Math.random() * suits.length)];
      const rank = ranks[Math.floor(Math.random() * ranks.length)];
      
      const card: Card = {
          id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          suit,
          rank
      };
      
      // Update properties based on current level
      if (rank === this.level) {
          card.isLevelCard = true;
          if (suit === Suit.Hearts) {
              card.isWild = true;
          }
      }
      
      return card;
  }
  
  handleUseSkill(seatIndex: number, skillId: string, targetSeat?: number) {
      if (this.gameMode !== GameMode.Skill) {
          this.emitError(seatIndex, '当前不是技能模式');
          return;
      }
      if (this.currentPhase !== GamePhase.Playing) {
          this.emitError(seatIndex, '只能在出牌阶段使用技能');
          return;
      }
      if (this.currentTurn !== seatIndex) {
          this.emitError(seatIndex, '不是你的回合');
          return;
      }
      
      const skillIndex = this.skillCards[seatIndex].findIndex(s => s.id === skillId);
      if (skillIndex === -1) {
          this.emitError(seatIndex, '你没有这张技能卡');
          return;
      }
      
      const skill = this.skillCards[seatIndex][skillIndex];
      
      // Validate target for skills that need it
      const needsTarget = [SkillCardType.Steal, SkillCardType.Discard, SkillCardType.Skip];
      if (needsTarget.includes(skill.type)) {
          if (targetSeat === undefined || targetSeat === seatIndex) {
              this.emitError(seatIndex, '请选择一个目标玩家');
              return;
          }
          // Target must be active (have cards)
          if (this.hands[targetSeat].length === 0) {
              this.emitError(seatIndex, '目标玩家已出完牌');
              return;
          }
      }
      
      // Apply the skill effect
      const success = this.applySkillEffect(skill.type, seatIndex, targetSeat);
      
      if (success) {
          // Remove the used skill card
          this.skillCards[seatIndex].splice(skillIndex, 1);
          console.log(`[Skill] Player ${seatIndex} used ${skill.type}${targetSeat !== undefined ? ` on Player ${targetSeat}` : ''}`);
          this.broadcastGameState();
      }
  }
  
  applySkillEffect(type: SkillCardType, user: number, target?: number): boolean {
      const playerName = this.players[user].name;
      const targetName = target !== undefined ? this.players[target].name : '';
      
      // Helper to track new cards
      const trackNewCard = (seat: number, cardId: string) => {
          if (!this.newCardIds[seat]) {
              this.newCardIds[seat] = [];
          }
          this.newCardIds[seat].push(cardId);
      };
      
      switch (type) {
          case SkillCardType.DrawTwo: {
              // 无中生有: Get 2 random cards
              const card1 = this.generateRandomCard();
              const card2 = this.generateRandomCard();
              this.hands[user].push(card1, card2);
              this.hands[user] = sortCards(this.hands[user], this.level);
              trackNewCard(user, card1.id);
              trackNewCard(user, card2.id);
              this.io.to(this.roomId).emit('error', `${playerName} 使用了【无中生有】，获得2张牌！`);
              return true;
          }
          
          case SkillCardType.Steal: {
              // 顺手牵羊: Steal 1 random card from target
              if (target === undefined || this.hands[target].length === 0) return false;
              const targetHand = this.hands[target];
              const randIdx = Math.floor(Math.random() * targetHand.length);
              const stolenCard = targetHand.splice(randIdx, 1)[0];
              this.hands[user].push(stolenCard);
              this.hands[user] = sortCards(this.hands[user], this.level);
              trackNewCard(user, stolenCard.id);
              this.io.to(this.roomId).emit('error', `${playerName} 对 ${targetName} 使用了【顺手牵羊】！`);
              return true;
          }
          
          case SkillCardType.Discard: {
              // 过河拆桥: Target discards 1 random card
              if (target === undefined || this.hands[target].length === 0) return false;
              const targetHand = this.hands[target];
              const randIdx = Math.floor(Math.random() * targetHand.length);
              targetHand.splice(randIdx, 1);
              this.io.to(this.roomId).emit('error', `${playerName} 对 ${targetName} 使用了【过河拆桥】！`);
              return true;
          }
          
          case SkillCardType.Skip: {
              // 乐不思蜀: Target skips next turn
              if (target === undefined) return false;
              this.skipNextTurn[target] = true;
              this.io.to(this.roomId).emit('error', `${playerName} 对 ${targetName} 使用了【乐不思蜀】！下回合将被跳过！`);
              return true;
          }
          
          case SkillCardType.Harvest: {
              // 五谷丰登: All active players get 1 random card
              const activePlayers = [0, 1, 2, 3].filter(i => this.hands[i].length > 0);
              activePlayers.forEach(seat => {
                  const card = this.generateRandomCard();
                  this.hands[seat].push(card);
                  this.hands[seat] = sortCards(this.hands[seat], this.level);
                  trackNewCard(seat, card.id);
              });
              this.io.to(this.roomId).emit('error', `${playerName} 使用了【五谷丰登】，每人获得1张牌！`);
              return true;
          }
          
          default:
              return false;
      }
  }
  
  // ==================== END SKILL CARD METHODS ====================
  
  endGame() {
      console.log(`[endGame] Game ended. Winners: ${this.winners.join(', ')}`);
      this.currentPhase = GamePhase.Score;
      
      // Broadcast final game state FIRST so clients see the last hand
      this.broadcastGameState();
      
      // Then send gameOver event
      this.io.to(this.roomId).emit('gameOver', { winners: this.winners });
      
      // Call onGameEnd callback if set (used by Match)
      if (this.onGameEnd) {
          this.onGameEnd(this.winners);
      }
  }

  emitError(seatIndex: number, msg: string) {
      const p = this.players[seatIndex];
      if (!p.isBot && p.socket) {
          p.socket.emit('error', msg);
      }
  }

  broadcastGameState() {
    this.players.forEach((p, idx) => {
        if (!p.isBot && p.socket) {
            p.socket.emit('gameState', {
                phase: this.currentPhase,
                level: this.level,
                currentTurn: this.currentTurn,
                hands: this.hands.map((h, i) => i === idx ? h : h.length),
                lastHand: this.lastHand,
                roundActions: this.roundActions,
                winners: this.winners,
                tributeState: this.currentPhase === GamePhase.Tribute || this.currentPhase === GamePhase.ReturnTribute ? this.tributeState : undefined,
                teamLevels: this.teamLevels,
                activeTeam: this.activeTeam,
                // Skill mode data
                gameMode: this.gameMode,
                mySkillCards: this.skillCards[idx],  // Only send player's own skill cards
                skipNextTurn: this.skipNextTurn,
                // New cards highlight
                newCardIds: this.newCardIds[idx] || []
            });
        }
    });
    
    // Clear new card IDs after broadcasting (they only need to be shown once)
    this.newCardIds = {};
    
    // Bot Turn Logic
    const currentPlayer = this.players[this.currentTurn];
    if (currentPlayer && currentPlayer.isBot && this.currentPhase === GamePhase.Playing && this.winners.length < 3) {
        // Capture the current seat to avoid race conditions
        const botSeat = this.currentTurn;
        console.log(`[Bot] Scheduling Bot ${botSeat} to play in 1.5s...`);
        setTimeout(() => this.handleBotTurn(botSeat), 1500);
    } else {
        // Human's turn or game over
        console.log(`[Turn] Now waiting for Player ${this.currentTurn} (Human) to play. Phase: ${this.currentPhase}`);
    }
  }
  
  // Bot emoji/chat messages
  botEmojis = {
      play: ['😎', '✨', '💪', '🔥', '👍', '😏', '🎯', '⚡'],
      bomb: ['💣', '🔥🔥🔥', '💥', '😈', '🚀', '☄️', '🤯'],
      win: ['🎉', '🥳', '😎👍', '✌️', '💯', '🏆'],
      pass: ['😅', '🤔', '😢', '💭', '🙈', '😬'],
      taunt: ['😂', '🤣', '😜', '👀', '🤭', '😁'],
  };
  
  botSendChat(seatIndex: number, category: 'play' | 'bomb' | 'win' | 'pass' | 'taunt') {
      // 30% chance to send emoji
      if (Math.random() > 0.3) return;
      
      const emojis = this.botEmojis[category];
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      const botName = this.players[seatIndex].name;
      
      this.io.to(this.roomId).emit('chatMessage', {
          sender: botName,
          text: emoji,
          time: new Date().toLocaleTimeString(),
          seatIndex: seatIndex
      });
  }

  handleBotTurn(seatIndex: number) {
      console.log(`[Bot] handleBotTurn called for seat ${seatIndex}. currentTurn=${this.currentTurn}, phase=${this.currentPhase}`);
      
      if (this.currentPhase !== GamePhase.Playing) {
          console.log(`[Bot] Abort: Phase is ${this.currentPhase}, not Playing`);
          return;
      }
      if (this.currentTurn !== seatIndex) {
          console.log(`[Bot] Abort: currentTurn is ${this.currentTurn}, not ${seatIndex}`);
          return;
      }
      
      const hand = this.hands[seatIndex];
      if (hand.length === 0) {
          console.log(`[Bot] Seat ${seatIndex} has no cards left, skipping...`);
          this.advanceTurn();
          this.broadcastGameState();
          return;
      }
      
      // In Skill mode, bot may use a skill first
      if (this.gameMode === GameMode.Skill && this.skillCards[seatIndex].length > 0) {
          const skillDecision = this.decideBotSkillUse(seatIndex);
          if (skillDecision) {
              console.log(`[Bot] Seat ${seatIndex} decides to use skill: ${skillDecision.skill.type}`);
              this.handleUseSkill(seatIndex, skillDecision.skill.id, skillDecision.target);
              // After using skill, schedule another bot turn for playing cards
              setTimeout(() => this.handleBotTurn(seatIndex), 1000);
              return;
          }
      }
      
      const bot = new Bot(hand, this.level);
      const move = bot.decideMove(this.lastHand ? this.lastHand.hand : null);
      
      console.log(`[Bot] Seat ${seatIndex} decides: ${move ? `Play ${move.length} cards` : 'Pass'}`);
      
      if (move) {
          // Check if it's a bomb (4+ same cards or straight flush)
          const handType = getHandType(move, this.level);
          const isBomb = handType && (handType.type === HandType.Bomb || handType.type === HandType.StraightFlush || handType.type === HandType.FourKings);
          
          this.handlePlayHand(seatIndex, move);
          
          // Bot sends emoji based on action
          if (isBomb) {
              this.botSendChat(seatIndex, 'bomb');
          } else if (this.hands[seatIndex].length === 0) {
              // Bot just finished all cards
              this.botSendChat(seatIndex, 'win');
          } else {
              this.botSendChat(seatIndex, 'play');
          }
      } else {
          this.handlePass(seatIndex);
          this.botSendChat(seatIndex, 'pass');
      }
  }
  
  decideBotSkillUse(seatIndex: number): { skill: SkillCard, target?: number } | null {
      const mySkills = this.skillCards[seatIndex];
      if (mySkills.length === 0) return null;
      
      const myTeam = seatIndex % 2;
      const teammates = [0, 1, 2, 3].filter(i => i % 2 === myTeam && i !== seatIndex && this.hands[i].length > 0);
      const opponents = [0, 1, 2, 3].filter(i => i % 2 !== myTeam && this.hands[i].length > 0);
      const activePlayers = [0, 1, 2, 3].filter(i => this.hands[i].length > 0);
      
      const myHandSize = this.hands[seatIndex].length;
      
      // Strategy: Use skills based on situation
      for (const skill of mySkills) {
          switch (skill.type) {
              case SkillCardType.DrawTwo:
                  // Use if I have few cards (< 10)
                  if (myHandSize < 10) {
                      return { skill };
                  }
                  break;
                  
              case SkillCardType.Steal:
                  // Steal from opponent with most cards
                  if (opponents.length > 0) {
                      const target = opponents.reduce((a, b) => 
                          this.hands[a].length > this.hands[b].length ? a : b);
                      if (this.hands[target].length > 5) {
                          return { skill, target };
                      }
                  }
                  break;
                  
              case SkillCardType.Discard:
                  // Discard from opponent with few cards (close to winning)
                  if (opponents.length > 0) {
                      const target = opponents.find(o => this.hands[o].length <= 5 && this.hands[o].length > 0);
                      if (target !== undefined) {
                          return { skill, target };
                      }
                  }
                  break;
                  
              case SkillCardType.Skip:
                  // Skip opponent who is about to win
                  if (opponents.length > 0) {
                      const target = opponents.find(o => this.hands[o].length <= 3);
                      if (target !== undefined) {
                          return { skill, target };
                      }
                  }
                  break;
                  
              case SkillCardType.Harvest:
                  // Use if hand sizes are relatively balanced
                  if (myHandSize < 15 && activePlayers.length >= 3) {
                      return { skill };
                  }
                  break;
          }
      }
      
      // Randomly use a skill 20% of the time if we have one
      if (Math.random() < 0.2 && mySkills.length > 0) {
          const skill = mySkills[0];
          if ([SkillCardType.DrawTwo, SkillCardType.Harvest].includes(skill.type)) {
              return { skill };
          }
          if ([SkillCardType.Steal, SkillCardType.Discard, SkillCardType.Skip].includes(skill.type)) {
              if (opponents.length > 0) {
                  return { skill, target: opponents[0] };
              }
          }
      }
      
      return null;
  }
}
