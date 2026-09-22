import { Server, Socket } from 'socket.io';
import { createDeck, shuffleDeck, updateCardProperties } from '../shared/deck';
import { getHandType, compareHands, sortCards, getLargestCard, getLogicValue, getHandDescription } from '../shared/rules';
import { Card, Hand, HandType, GameMode, SkillCard, SkillCardType, Suit, Rank, HistoryEntry, HistoryEventType } from '../shared/types';
import { Bot } from '../shared/bot';

interface Player {
  id: string;
  name: string;
  socket?: Socket;
  seatIndex: number;
  isBot?: boolean;
  isDisconnected?: boolean;
}

/**
 * 双下时给还没出完的两人排三游、末游。
 * 剩余牌少的在前；牌数相同则离二游顺时针更近的在前。
 */
export function rankUnfinishedPlayers(handSizes: number[], finished: number[]): number[] {
  const anchor = finished[finished.length - 1] ?? 0;
  const losers = [0, 1, 2, 3].filter(seat => !finished.includes(seat));
  return losers.sort((a, b) => {
    const byCount = handSizes[a] - handSizes[b];
    if (byCount !== 0) return byCount;
    const distance = (seat: number) => (seat - anchor + 4) % 4;
    return distance(a) - distance(b);
  });
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
  
  // Lifecycle management
  private isActive: boolean = true;
  private pendingTimeouts: NodeJS.Timeout[] = [];
  
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
  
  // Game History
  history: HistoryEntry[] = [];
  private historyIdCounter: number = 0;
  currentRound: number = 0;

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
  
  // Lifecycle management methods
  private registerTimeout(timeout: NodeJS.Timeout) {
      this.pendingTimeouts.push(timeout);
  }
  
  private clearAllTimeouts() {
      this.pendingTimeouts.forEach(t => clearTimeout(t));
      this.pendingTimeouts = [];
  }
  
  destroy() {
      console.log(`[Game] Destroying game instance for room ${this.roomId}`);
      this.isActive = false;
      this.clearAllTimeouts();
      
      // Unbind all socket listeners
      this.players.forEach(p => {
          if (p.socket) {
              p.socket.removeAllListeners('playHand');
              p.socket.removeAllListeners('pass');
              p.socket.removeAllListeners('tribute');
              p.socket.removeAllListeners('returnTribute');
              p.socket.removeAllListeners('useSkill');
          }
      });
  }
  
  // History logging methods
  private addHistoryEntry(type: HistoryEventType, message: string, playerIndex?: number, details?: any) {
      const entry: HistoryEntry = {
          id: `history-${this.historyIdCounter++}`,
          timestamp: Date.now(),
          type,
          playerIndex,
          playerName: playerIndex !== undefined ? this.players[playerIndex]?.name : undefined,
          message,
          details
      };
      this.history.push(entry);
      
      // Broadcast to all players
      this.io.to(this.roomId).emit('historyUpdate', entry);
  }
  
  private getCardDescription(cards: Card[]): string {
      if (cards.length === 0) return '';
      if (cards.length === 1) {
          const c = cards[0];
          const suitName = ['♠', '♥', '♣', '♦', 'Joker'][c.suit];
          const rankName = c.rank === 15 ? '小王' : c.rank === 16 ? '大王' : 
                          c.rank === 11 ? 'J' : c.rank === 12 ? 'Q' : 
                          c.rank === 13 ? 'K' : c.rank === 14 ? 'A' : c.rank.toString();
          return c.rank >= 15 ? rankName : `${suitName}${rankName}`;
      }
      return `${cards.length}张牌`;
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
        this.currentRound = 1;
        this.history = []; // Clear history for new match
        this.historyIdCounter = 0;
    } else {
        this.currentRound++;
    }

    // Use Active Team Level
    this.level = this.teamLevels[this.activeTeam];
    
    // Add history entry for game start
    const teamName = this.activeTeam === 0 ? 'Team 0 (Seat 0, 2)' : 'Team 1 (Seat 1, 3)';
    this.addHistoryEntry(
        HistoryEventType.GameStart,
        `第${this.currentRound}局开始 - 当前等级: ${this.level} - 庄家: ${teamName}`,
        undefined,
        { level: this.level, activeTeam: this.activeTeam, round: this.currentRound }
    );

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
          this.io.to(this.roomId).emit('notice', '抗贡成功！双大王在手，免除进贡！');
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
  
  /** 10 及以下，且不是级牌、大小王。 */
  private isLegalReturnCard(card: Card): boolean {
      if (card.rank > Rank.Ten) return false;
      if (card.rank === this.level) return false;
      return true;
  }

  /** 有合法牌时还最小的合法牌；一手都是级牌/大牌/王时还逻辑点数最小的一张。 */
  private pickReturnCard(hand: Card[]): Card | null {
      if (hand.length === 0) return null;
      const legal = hand.filter(c => this.isLegalReturnCard(c));
      const pool = legal.length > 0 ? legal : hand;
      return sortCards(pool, this.level)[pool.length - 1];
  }

  private transferCard(from: number, to: number, card: Card) {
      this.hands[from] = this.hands[from].filter(c => c.id !== card.id);
      this.hands[to].push(card);
      this.hands[to] = sortCards(this.hands[to], this.level);
  }

  /** 进贡牌最大者先出。点数相同则末游优先（pending 里末游在前，相等不覆盖）。 */
  private resolveTributeStarter(): number {
      let maxVal = -1;
      let maxPayer = this.prevWinners[this.prevWinners.length - 1];
      for (const t of this.tributeState.pendingTributes) {
          if (!t.card) continue;
          const val = getLogicValue(t.card.rank, this.level);
          if (val > maxVal) {
              maxVal = val;
              maxPayer = t.from;
          }
      }
      return maxPayer;
  }

  private beginReturnPhase() {
      this.tributeState.nextStartPlayer = this.resolveTributeStarter();
      this.currentPhase = GamePhase.ReturnTribute;
      this.tributeState.pendingReturns = this.tributeState.pendingTributes.map(t => ({
          from: t.to,
          to: t.from
      }));
      this.tributeState.pendingTributes = [];
      this.autoReturnForBots();
      this.checkReturnDone();
  }

  private autoReturnForBots() {
      this.tributeState.pendingReturns.forEach(r => {
          if (r.card) return;
          const player = this.players[r.from];
          if (!this.isAutoPlayer(player)) return;
          const card = this.pickReturnCard(this.hands[r.from]);
          if (!card) return;
          r.card = card;
          this.transferCard(r.from, r.to, card);
          this.addHistoryEntry(
              HistoryEventType.ReturnTribute,
              `${player.name} 向 ${this.players[r.to].name} 还贡: ${this.getCardDescription([card])}`,
              r.from,
              { card, to: r.to }
          );
      });
  }

  processAutoTribute() {
      this.tributeState.pendingTributes.forEach(t => {
          if (t.card) return;
          const player = this.players[t.from];
          if (!this.isAutoPlayer(player)) return;
          const largest = getLargestCard(this.hands[t.from], this.level);
          t.card = largest;
          this.transferCard(t.from, t.to, largest);
          this.addHistoryEntry(
              HistoryEventType.Tribute,
              `${player.name} 向 ${this.players[t.to].name} 进贡: ${this.getCardDescription([largest])}`,
              t.from,
              { card: largest, to: t.to }
          );
      });

      if (this.tributeState.pendingTributes.every(t => t.card)) {
          this.beginReturnPhase();
      } else {
          this.broadcastGameState();
      }
  }

  private isAutoPlayer(player?: Player): boolean {
      return !!player && (!!player.isBot || !!player.isDisconnected);
  }

  /** 玩家掉线后，出牌、进贡、还贡改由系统代打，直到他重连。 */
  noteDisconnected(seat: number) {
      const player = this.players[seat];
      if (!player || player.isBot) return;
      player.isDisconnected = true;
      this.addHistoryEntry(
          HistoryEventType.PhaseChange,
          `${player.name} 断线，系统托管出牌`,
          seat
      );
      if (this.currentPhase === GamePhase.Tribute) {
          this.processAutoTribute();
          return;
      }
      if (this.currentPhase === GamePhase.ReturnTribute) {
          this.autoReturnForBots();
          this.checkReturnDone();
          return;
      }
      if (this.currentPhase === GamePhase.Playing && this.currentTurn === seat && this.winners.length < 3) {
          this.scheduleAutoTurn(seat);
      }
  }

  handleTribute(seatIndex: number, cards: Card[]) {
      if (this.currentPhase !== GamePhase.Tribute) return;
      if (cards.length !== 1) return;
      
      const tribute = this.tributeState.pendingTributes.find(t => t.from === seatIndex && !t.card);
      if (!tribute) return;

      const hand = this.hands[seatIndex];
      const serverCard = hand.find(c => c.id === cards[0].id);
      if (!serverCard) {
          this.emitError(seatIndex, '你没有这张牌');
          return;
      }
      
      const largest = getLargestCard(hand, this.level);
      const valPlay = getLogicValue(serverCard.rank, this.level);
      const valMax = getLogicValue(largest.rank, this.level);
      
      if (valPlay < valMax) {
           this.emitError(seatIndex, '必须进贡最大的牌');
           return;
      }
      
      tribute.card = serverCard;
      this.transferCard(seatIndex, tribute.to, serverCard);
      
      this.addHistoryEntry(
          HistoryEventType.Tribute,
          `${this.players[seatIndex].name} 向 ${this.players[tribute.to].name} 进贡: ${this.getCardDescription([serverCard])}`,
          seatIndex,
          { card: serverCard, to: tribute.to }
      );
      
      if (this.tributeState.pendingTributes.every(t => t.card)) {
          this.beginReturnPhase();
      } else {
          this.broadcastGameState();
      }
  }

  handleReturnTribute(seatIndex: number, cards: Card[]) {
      if (this.currentPhase !== GamePhase.ReturnTribute) return;
      if (cards.length !== 1) return;
      
      const ret = this.tributeState.pendingReturns.find(r => r.from === seatIndex && !r.card);
      if (!ret) return;

      const hand = this.hands[seatIndex];
      const serverCard = hand.find(c => c.id === cards[0].id);
      if (!serverCard) {
          this.emitError(seatIndex, '你没有这张牌');
          return;
      }

      const hasLegal = hand.some(c => this.isLegalReturnCard(c));
      if (hasLegal && !this.isLegalReturnCard(serverCard)) {
          this.emitError(seatIndex, '还贡只能出 10 及以下，且不能是级牌或王');
          return;
      }
      if (!hasLegal) {
          const smallest = this.pickReturnCard(hand);
          if (!smallest || getLogicValue(serverCard.rank, this.level) > getLogicValue(smallest.rank, this.level)) {
              this.emitError(seatIndex, '没有可还的小牌时，必须还最小的一张');
              return;
          }
      }
      
      ret.card = serverCard;
      this.transferCard(seatIndex, ret.to, serverCard);
      
      this.addHistoryEntry(
          HistoryEventType.ReturnTribute,
          `${this.players[seatIndex].name} 向 ${this.players[ret.to].name} 还贡: ${this.getCardDescription([serverCard])}`,
          seatIndex,
          { card: serverCard, to: ret.to }
      );
      
      this.checkReturnDone();
  }
  
  checkReturnDone() {
      const allDone = this.tributeState.pendingReturns.every(r => r.card);
      if (allDone) {
          this.currentPhase = GamePhase.Playing;
          if (this.tributeState.nextStartPlayer !== undefined) {
              this.currentTurn = this.tributeState.nextStartPlayer;
          } else {
              this.currentTurn = this.prevWinners[0];
          }
          this.tributeState = { pendingTributes: [], pendingReturns: [] };
      }
      this.broadcastGameState();
  }

  /** 用手里的服务器牌对象出牌，忽略客户端自报的牌型和 isWild。 */
  handlePlayHand(seatIndex: number, cards: Card[], _providedHandType?: Hand): boolean {
      if (!this.isActive) return false;
      if (this.currentPhase !== GamePhase.Playing) return false;
      if (this.currentTurn !== seatIndex) return false;

      const playerHand = this.hands[seatIndex];
      const serverCards: Card[] = [];
      for (const c of cards) {
          const found = playerHand.find(ph => ph.id === c.id);
          if (!found || serverCards.some(s => s.id === found.id)) {
              this.emitError(seatIndex, 'You do not have these cards');
              return false;
          }
          serverCards.push(found);
      }

      const hand = getHandType(serverCards, this.level);
      if (!hand) {
          this.emitError(seatIndex, 'Invalid hand');
          return false;
      }
      
      // Debug Log
      console.log(`Player ${seatIndex} plays. Level: ${this.level}. Hand: ${hand.type} (Val: ${hand.value}). LastHand: ${this.lastHand ? `${this.lastHand.hand.type} (Val: ${this.lastHand.hand.value})` : 'None'}`);

      if (this.lastHand && this.lastHand.playerIndex !== seatIndex) {
          const result = compareHands(hand, this.lastHand.hand);
          if (result <= 0) {
               console.log(`Compare failed: ${result}`);
               this.emitError(seatIndex, 'Hand not big enough');
               return false;
          }
      }

      const playedIds = new Set(serverCards.map(c => c.id));
      this.hands[seatIndex] = playerHand.filter(c => !playedIds.has(c.id));
      
      this.lastHand = { playerIndex: seatIndex, hand };
      this.passCount = 0;
      
      // Reset round actions when someone plays (new round starts)
      this.roundActions = {};
      this.roundActions[seatIndex] = { type: 'play', cards: serverCards, hand: hand };
      
      // Add history entry
      const handTypeName = getHandDescription(hand, this.level);
      this.addHistoryEntry(
          HistoryEventType.Play,
          `${this.players[seatIndex].name} 出牌: ${handTypeName} (${this.getCardDescription(serverCards)})`,
          seatIndex,
          { cards: serverCards, handType: hand.type, cardsCount: serverCards.length }
      );
      
      if (this.recordFinishIfEmpty(seatIndex)) return true;
      
      this.advanceTurn();
      this.broadcastGameState();
      return true;
  }

  /** 手牌被出完或被技能打空时记名次。返回 true 表示这一局已经结束。 */
  private recordFinishIfEmpty(seat: number): boolean {
      if (this.hands[seat].length !== 0) return false;
      if (this.winners.includes(seat)) return false;

      this.winners.push(seat);
      const position = ['第一名', '第二名', '第三名', '第四名'][this.winners.length - 1];
      this.addHistoryEntry(
          HistoryEventType.PlayerFinish,
          `${this.players[seat].name} 出完所有牌，获得${position}！`,
          seat,
          { position: this.winners.length }
      );

      if (this.winners.length === 2) {
          const p1 = this.winners[0];
          const p2 = this.winners[1];
          if ((p1 % 2) === (p2 % 2)) {
              const losers = rankUnfinishedPlayers(this.hands.map(h => h.length), this.winners);
              this.winners.push(...losers);
              this.endGame();
              return true;
          }
      }

      if (this.winners.length === 3) {
          const last = [0, 1, 2, 3].find(i => !this.winners.includes(i))!;
          this.winners.push(last);
          this.endGame();
          return true;
      }
      return false;
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
          if (this.hands[seat].length === 0) continue;
          if (this.skipNextTurn[seat]) {
              this.skipNextTurn[seat] = false;
              this.io.to(this.roomId).emit('notice', `${this.players[seat].name} 被【乐不思蜀】跳过了回合！`);
              console.log(`[endRound] Seat ${seat} skipped by 乐不思蜀, lead passes on`);
              continue;
          }
          this.currentTurn = seat;
          found = true;
          console.log(`[endRound] Next turn goes to seat ${seat}`);
          break;
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
      
      // Add history entry
      this.addHistoryEntry(
          HistoryEventType.Pass,
          `${this.players[seatIndex].name} 选择过牌`,
          seatIndex
      );
      
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
              this.io.to(this.roomId).emit('notice', `${this.players[next].name} 被【乐不思蜀】跳过了回合！`);
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
      // Check if game is still active
      if (!this.isActive) {
          console.log(`[Skill] Game is no longer active, ignoring skill use`);
          return;
      }
      
      // Check if game has ended
      if (this.winners.length >= 3) {
          this.emitError(seatIndex, '游戏已结束，无法使用技能');
          return;
      }
      
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
      
      // Apply the skill effect first
      const success = this.applySkillEffect(skill.type, seatIndex, targetSeat);
      
      if (success) {
          // Only remove the skill card after successful application
          this.skillCards[seatIndex].splice(skillIndex, 1);
          console.log(`[Skill] Player ${seatIndex} used ${skill.type}${targetSeat !== undefined ? ` on Player ${targetSeat}` : ''}`);
          
          // Add history entry for skill use
          const skillNames = {
              [SkillCardType.DrawTwo]: '无中生有',
              [SkillCardType.Steal]: '顺手牵羊',
              [SkillCardType.Discard]: '过河拆桥',
              [SkillCardType.Skip]: '乐不思蜀',
              [SkillCardType.Harvest]: '五谷丰登'
          };
          const skillName = skillNames[skill.type];
          const targetName = targetSeat !== undefined ? this.players[targetSeat].name : '';
          const message = targetSeat !== undefined 
              ? `${this.players[seatIndex].name} 对 ${targetName} 使用了 ${skillName}`
              : `${this.players[seatIndex].name} 使用了 ${skillName}`;
          this.addHistoryEntry(
              HistoryEventType.SkillUse,
              message,
              seatIndex,
              { skillType: skill.type, targetSeat }
          );
          
          this.broadcastGameState();
      }
  }
  
  applySkillEffect(type: SkillCardType, user: number, target?: number): boolean {
      // Check if game is still active
      if (!this.isActive || this.winners.length >= 3) {
          console.log(`[Skill] Cannot apply skill effect, game is ending/ended`);
          return false;
      }
      
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
              this.io.to(this.roomId).emit('notice', `${playerName} 使用了【无中生有】，获得2张牌！`);
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
              this.io.to(this.roomId).emit('notice', `${playerName} 对 ${targetName} 使用了【顺手牵羊】！`);
              this.recordFinishIfEmpty(target);
              return true;
          }
          
          case SkillCardType.Discard: {
              // 过河拆桥: Target discards 1 random card
              if (target === undefined || this.hands[target].length === 0) return false;
              const targetHand = this.hands[target];
              const randIdx = Math.floor(Math.random() * targetHand.length);
              targetHand.splice(randIdx, 1);
              this.io.to(this.roomId).emit('notice', `${playerName} 对 ${targetName} 使用了【过河拆桥】！`);
              this.recordFinishIfEmpty(target);
              return true;
          }
          
          case SkillCardType.Skip: {
              // 乐不思蜀: Target skips next turn
              if (target === undefined) return false;
              this.skipNextTurn[target] = true;
              this.io.to(this.roomId).emit('notice', `${playerName} 对 ${targetName} 使用了【乐不思蜀】！下回合将被跳过！`);
              return true;
          }
          
          case SkillCardType.Harvest: {
              // 五谷丰登: All active players get 1 random card
              // Explicitly filter out players who have finished
              const activePlayers = [0, 1, 2, 3].filter(i => 
                  this.hands[i].length > 0 && !this.winners.includes(i)
              );
              activePlayers.forEach(seat => {
                  const card = this.generateRandomCard();
                  this.hands[seat].push(card);
                  this.hands[seat] = sortCards(this.hands[seat], this.level);
                  trackNewCard(seat, card.id);
              });
              this.io.to(this.roomId).emit('notice', `${playerName} 使用了【五谷丰登】，每人获得1张牌！`);
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
      
      // Add history entry for game end
      const winnerNames = this.winners.map(w => this.players[w].name).join(', ');
      const team0 = this.winners.filter(w => w % 2 === 0);
      const team1 = this.winners.filter(w => w % 2 === 1);
      
      let resultType = '';
      if (team0.length === 2 && this.winners[0] % 2 === 0 && this.winners[1] % 2 === 0) {
          resultType = 'Team 0 双扣！';
      } else if (team1.length === 2 && this.winners[0] % 2 === 1 && this.winners[1] % 2 === 1) {
          resultType = 'Team 1 双扣！';
      } else if (this.winners[0] % 2 === this.winners[2] % 2) {
          resultType = `Team ${this.winners[0] % 2} 单扣`;
      } else {
          resultType = `Team ${this.winners[0] % 2} 保级`;
      }
      
      this.addHistoryEntry(
          HistoryEventType.GameEnd,
          `游戏结束！${resultType} - 排名: ${winnerNames}`,
          undefined,
          { winners: this.winners, resultType }
      );
      
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
            const myNewCardIds = this.newCardIds[idx] || [];
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
                newCardIds: myNewCardIds,
                // Game history
                history: this.history,
                currentRound: this.currentRound
            });
            
            // Delay clearing newCardIds to give client time to display highlight
            if (myNewCardIds.length > 0) {
                const timeout = setTimeout(() => {
                    if (this.isActive) {
                        this.newCardIds[idx] = [];
                    }
                }, 2000); // Clear after 2 seconds
                this.registerTimeout(timeout);
            }
        }
    });
    
    // Don't globally clear newCardIds anymore
    // this.newCardIds = {};
    
    const currentPlayer = this.players[this.currentTurn];
    if (currentPlayer && this.isAutoPlayer(currentPlayer) && this.currentPhase === GamePhase.Playing && this.winners.length < 3) {
        this.scheduleAutoTurn(this.currentTurn);
    } else {
        console.log(`[Turn] Now waiting for Player ${this.currentTurn} (Human) to play. Phase: ${this.currentPhase}`);
    }
  }

  private scheduleAutoTurn(seat: number) {
      console.log(`[Bot] Scheduling auto turn for seat ${seat}`);
      const timeout = setTimeout(() => {
          if (!this.isActive) return;
          this.handleBotTurn(seat);
      }, 800);
      this.registerTimeout(timeout);
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
      // Check if game is still active
      if (!this.isActive) {
          console.log(`[Bot] Game is no longer active, aborting bot turn`);
          return;
      }
      
      console.log(`[Bot] handleBotTurn called for seat ${seatIndex}. currentTurn=${this.currentTurn}, phase=${this.currentPhase}`);
      
      if (this.currentPhase !== GamePhase.Playing) {
          console.log(`[Bot] Abort: Phase is ${this.currentPhase}, not Playing`);
          return;
      }
      const actor = this.players[seatIndex];
      if (!actor || (!actor.isBot && !actor.isDisconnected)) {
          console.log(`[Bot] Seat ${seatIndex} is a connected human, leaving the turn`);
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
      if (actor.isBot && this.gameMode === GameMode.Skill && this.skillCards[seatIndex].length > 0) {
          const skillDecision = this.decideBotSkillUse(seatIndex);
          if (skillDecision) {
              console.log(`[Bot] Seat ${seatIndex} decides to use skill: ${skillDecision.skill.type}`);
              this.handleUseSkill(seatIndex, skillDecision.skill.id, skillDecision.target);
              // After using skill, schedule another bot turn for playing cards
              const timeout = setTimeout(() => {
                  if (!this.isActive) {
                      console.log(`[Bot] Game no longer active, aborting bot turn for seat ${seatIndex}`);
                      return;
                  }
                  this.handleBotTurn(seatIndex);
              }, 1000);
              this.registerTimeout(timeout);
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
          
          const played = this.handlePlayHand(seatIndex, move);
          if (!played) {
              if (this.lastHand && this.lastHand.playerIndex !== seatIndex) {
                  this.handlePass(seatIndex);
              }
              return;
          }
          
          // Bot sends emoji based on action
          if (actor.isBot) {
              if (isBomb) {
                  this.botSendChat(seatIndex, 'bomb');
              } else if (this.hands[seatIndex].length === 0) {
                  this.botSendChat(seatIndex, 'win');
              } else {
                  this.botSendChat(seatIndex, 'play');
              }
          }
      } else {
          this.handlePass(seatIndex);
          if (actor.isBot) this.botSendChat(seatIndex, 'pass');
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
