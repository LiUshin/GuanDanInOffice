import { Server, Socket } from 'socket.io';
import { createDeck, shuffleDeck, updateCardProperties } from '../shared/deck';
import { getHandType, compareHands, sortCards, getLargestCard, getLogicValue } from '../shared/rules';
import { Card, Hand, HandType } from '../shared/types';
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
  
  hands: Card[][] = [[], [], [], []];
  currentTurn: number = 0;
  
  lastHand: { playerIndex: number, hand: Hand } | null = null;
  passCount: number = 0;
  
  winners: number[] = [];
  tributeState: TributeState = { pendingTributes: [], pendingReturns: [] };
  
  // Track Team Levels
  teamLevels: { [key: number]: number } = { 0: 2, 1: 2 }; // Team 0 (0,2), Team 1 (1,3)
  activeTeam: number = 0; // Who is upgrading currently (Banker Team)
  prevWinners: number[] = [];

  constructor(io: Server, roomId: string, players: Player[]) {
    this.io = io;
    this.roomId = roomId;
    this.players = players;
    
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
      s.on('playHand', (cards: Card[]) => this.handlePlayHand(p.seatIndex, cards));
      s.on('pass', () => this.handlePass(p.seatIndex));
      s.on('tribute', (cards: Card[]) => this.handleTribute(p.seatIndex, cards));
      s.on('returnTribute', (cards: Card[]) => this.handleReturnTribute(p.seatIndex, cards));
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

  handlePlayHand(seatIndex: number, cards: Card[]) {
      if (this.currentPhase !== GamePhase.Playing) return;
      if (this.currentTurn !== seatIndex) return;
      
      const hand = getHandType(cards, this.level);
      if (!hand) {
          this.emitError(seatIndex, 'Invalid hand');
          return;
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
  
  handlePass(seatIndex: number) {
      if (this.currentPhase !== GamePhase.Playing) return;
      if (this.currentTurn !== seatIndex) return;
      
      if (!this.lastHand || this.lastHand.playerIndex === seatIndex) {
          this.emitError(seatIndex, 'Cannot pass on free turn');
          return;
      }
      
      this.passCount++;
      this.advanceTurn();
      
      if (this.passCount === 3) {
          this.currentTurn = this.lastHand!.playerIndex;
          this.lastHand = null;
          this.passCount = 0;
          
          if (this.hands[this.currentTurn].length === 0) {
              // Partner leads logic simplified: Next player
               const partner = (this.currentTurn + 2) % 4;
               this.currentTurn = partner;
               if (this.hands[this.currentTurn].length === 0) {
                   // Pass to next opponent
                    this.currentTurn = (this.currentTurn + 1) % 4;
               }
          }
      }
      
      this.broadcastGameState();
  }
  
  advanceTurn() {
      let next = (this.currentTurn + 1) % 4;
      let count = 0;
      // Skip finished players
      while (this.hands[next].length === 0 && count < 4) {
          next = (next + 1) % 4;
          count++;
      }
      if (count === 4) {
          this.endGame();
          return;
      }
      this.currentTurn = next;
  }
  
  endGame() {
      this.currentPhase = GamePhase.Score;
      this.io.to(this.roomId).emit('gameOver', { winners: this.winners });
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
                winners: this.winners,
                tributeState: this.currentPhase === GamePhase.Tribute || this.currentPhase === GamePhase.ReturnTribute ? this.tributeState : undefined,
                teamLevels: this.teamLevels,
                activeTeam: this.activeTeam
            });
        }
    });
    
    // Bot Turn Logic
    const currentPlayer = this.players[this.currentTurn];
    if (currentPlayer && currentPlayer.isBot && this.currentPhase === GamePhase.Playing && this.winners.length < 3) {
        // Prevent multiple timeouts
        setTimeout(() => this.handleBotTurn(this.currentTurn), 1500);
    }
  }
  
  handleBotTurn(seatIndex: number) {
      if (this.currentPhase !== GamePhase.Playing) return;
      if (this.currentTurn !== seatIndex) return;
      
      const hand = this.hands[seatIndex];
      const bot = new Bot(hand, this.level);
      const move = bot.decideMove(this.lastHand ? this.lastHand.hand : null);
      
      if (move) {
          this.handlePlayHand(seatIndex, move);
      } else {
          this.handlePass(seatIndex);
      }
  }
}
