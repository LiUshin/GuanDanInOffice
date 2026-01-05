import React, { useState, useEffect, useRef } from 'react';
import { Card as CardType, Rank, Suit } from '../../shared/types';
import { Bot } from '../../shared/bot';
import { Card } from './Card';
import { GameState, RoomState } from '../useGame';
import { getLogicValue, isConsecutive } from '../../shared/rules';

interface Props {
  gameState: GameState;
  roomState: RoomState;
  mySeat: number;
  onPlay: (cards: CardType[]) => void;
  onPass: () => void;
  onReady: () => void;
  onStart: () => void;
  onTribute?: (cards: CardType[]) => void;
  onReturnTribute?: (cards: CardType[]) => void;
  chatMessages: {sender: string, text: string, time: string}[];
  onSendChat: (msg: string) => void;
  onSwitchSeat: (seatIdx: number) => void;
}

export const GameTable: React.FC<Props> = ({ 
  gameState, roomState, mySeat, onPlay, onPass, onReady, onStart,
  onTribute, onReturnTribute, chatMessages, onSendChat, onSwitchSeat
}) => {
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [viewMode, setViewMode] = useState<'normal' | 'stacked'>('normal'); 
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll chat
  useEffect(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const getPlayerAt = (offset: number) => {
    const seat = (mySeat + offset) % 4;
    const player = roomState.players.find(p => p && p.seatIndex === seat);
    const handCount = gameState ? (
      seat === mySeat 
        ? (gameState.hands[seat] as CardType[]).length 
        : (gameState.hands[seat] as number)
    ) : 0;
    
    // Team identification
    const isTeammate = (mySeat + 2) % 4 === seat;
    const isOpponent = !isTeammate && seat !== mySeat;
    
    return { player, handCount, seat, isTeammate, isOpponent };
  };

  const top = getPlayerAt(2);
  const left = getPlayerAt(3);
  const right = getPlayerAt(1);
  const me = getPlayerAt(0);

  const myHandOriginal = gameState ? (gameState.hands[mySeat] as CardType[]) : [];
  const [sortedHand, setSortedHand] = useState<CardType[]>([]);
  const [straightFlushIds, setStraightFlushIds] = useState<Set<string>>(new Set());

  useEffect(() => {
      if (myHandOriginal.length > 0 && gameState) {
          setSortedHand(myHandOriginal);
          
          // Detect Straight Flushes for Highlighting
          const sfSet = new Set<string>();
          // Logic: Group by Suit -> Sort by Rank -> Check consecutive 5+
          const suits = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds];
          
          suits.forEach(s => {
              const suitCards = myHandOriginal.filter(c => c.suit === s && !c.isWild && c.rank <= Rank.Ace);
              // Sort by Rank Ascending
              suitCards.sort((a, b) => a.rank - b.rank);
              
              // Find sequences
              let seq: CardType[] = [];
              for (let i = 0; i < suitCards.length; i++) {
                  if (seq.length === 0) {
                      seq.push(suitCards[i]);
                  } else {
                      const last = seq[seq.length - 1];
                      if (suitCards[i].rank === last.rank + 1) {
                          seq.push(suitCards[i]);
                      } else if (suitCards[i].rank === last.rank) {
                          // Duplicate rank? Skip or fork? 
                          // For visualization, just highlight one path or all?
                          // Simple: Reset sequence if gap
                          // Actually duplicates break strict sequence check if we just use prev.
                          // But if it is duplicate rank, we can still form SF if we have 5 unique ranks.
                          // Simplification: Check strict consecutive ranks.
                          // If gap > 1, reset.
                      } else {
                          // Gap
                          if (seq.length >= 5) {
                              seq.forEach(c => sfSet.add(c.id));
                          }
                          seq = [suitCards[i]];
                      }
                  }
              }
              if (seq.length >= 5) {
                  seq.forEach(c => sfSet.add(c.id));
              }
          });
          setStraightFlushIds(sfSet);

      } else {
          setSortedHand([]);
          setStraightFlushIds(new Set());
      }
  }, [myHandOriginal, gameState?.level]); 

  const toggleViewMode = () => {
      setViewMode(prev => prev === 'normal' ? 'stacked' : 'normal');
  };

  const toggleSelect = (id: string) => {
    setSelectedCardIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handlePlay = () => {
    const cards = sortedHand.filter(c => selectedCardIds.includes(c.id));
    onPlay(cards);
    setSelectedCardIds([]);
  };
  
  const handleHint = () => {
      if (!gameState) return;
      const bot = new Bot(sortedHand, gameState.level);
      const target = gameState.lastHand && gameState.lastHand.playerIndex !== mySeat ? gameState.lastHand.hand : null;
      const move = bot.decideMove(target);
      
      if (move) {
          setSelectedCardIds(move.map(c => c.id));
      } else {
          setSelectedCardIds([]);
      }
  };
  
  const handleTributeAction = () => {
      const cards = sortedHand.filter(c => selectedCardIds.includes(c.id));
      if (cards.length !== 1) {
          alert("请选择一张牌");
          return;
      }
      if (gameState.phase === 'Tribute' && onTribute) onTribute(cards);
      if (gameState.phase === 'ReturnTribute' && onReturnTribute) onReturnTribute(cards);
      setSelectedCardIds([]);
  };
  
  const handleChatSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (chatInput.trim()) {
          onSendChat(chatInput.trim());
          setChatInput('');
      }
  }

  const isTributePhase = gameState && (gameState.phase === 'Tribute' || gameState.phase === 'ReturnTribute');
  const amIPaying = isTributePhase && gameState.tributeState && (
      (gameState.phase === 'Tribute' && gameState.tributeState.pendingTributes.some((t: any) => t.from === mySeat)) ||
      (gameState.phase === 'ReturnTribute' && gameState.tributeState.pendingReturns.some((t: any) => t.from === mySeat))
  );

  const renderLastHand = () => {
    if (!gameState || !gameState.lastHand) return null;
    const { playerIndex, hand } = gameState.lastHand;
    const playerName = roomState.players.find(p => p && p.seatIndex === playerIndex)?.name || `Seat ${playerIndex}`;
    
    return (
      <div className="bg-green-700/50 p-4 rounded-lg flex flex-col items-center">
        <div className="text-white mb-2 font-bold">{playerName} 出牌:</div>
        <div className="flex -space-x-8">
           {hand.cards.map((c: CardType) => (
             <Card key={c.id} card={c} />
           ))}
        </div>
        <div className="text-yellow-300 font-bold mt-2">{hand.type}</div>
      </div>
    );
  };

  const PlayerArea = ({ data, pos }: { data: any, pos: string }) => (
    <div 
        className={`absolute ${pos} flex flex-col items-center p-4 rounded-lg transition-colors ${data.isTeammate ? 'bg-blue-900/40 border-2 border-blue-400' : 'bg-black/20'} ${!gameState && !data.player ? 'cursor-pointer hover:bg-white/10' : ''}`}
        onClick={() => !gameState && !data.player && onSwitchSeat(data.seat)}
    >
       <div className="w-12 h-12 bg-gray-300 rounded-full flex items-center justify-center mb-2 relative">
         {data.player ? data.player.name[0].toUpperCase() : (gameState ? '?' : '+')}
         {data.isTeammate && <div className="absolute -top-1 -right-1 bg-blue-500 text-xs text-white px-1 rounded">友</div>}
         {data.isOpponent && <div className="absolute -top-1 -right-1 bg-red-500 text-xs text-white px-1 rounded">敌</div>}
         {data.player && data.player.seatIndex === 0 && (
             <div className="absolute -bottom-1 -right-1 text-xs bg-yellow-500 text-black px-1 rounded font-bold border border-white">
                 Host
             </div>
         )}
       </div>
       <div className="text-white font-bold flex items-center gap-2">
           {data.player ? data.player.name : (gameState ? 'Waiting...' : '点击入座')}
           {data.player && (data.player as any).isDisconnected && (
               <span className="text-red-500 text-xs font-bold bg-white px-1 rounded animate-pulse">OFF</span>
           )}
       </div>
       {gameState && <div className="text-yellow-400">Cards: {data.handCount}</div>}
       {data.player && data.player.isReady && !gameState && <div className="text-green-400 text-sm">Ready</div>}
       {gameState && gameState.currentTurn === data.seat && (
           <div className="animate-bounce text-red-500 font-bold">Thinking...</div>
       )}
    </div>
  );

  const getStackedMatrix = () => {
      if (!gameState) return [];
      
      const matrix: { [key: number]: { [key: number]: CardType } } = {};
      const suits = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds, Suit.Joker];
      
      const presentValues = new Set<number>();
      
      sortedHand.forEach(c => {
          const val = getLogicValue(c.rank, gameState.level);
          presentValues.add(val);
      });

      const sortedVals = Array.from(presentValues).sort((a, b) => b - a);
      
      return sortedVals.map(val => {
          const cardsOfRank = sortedHand.filter(c => getLogicValue(c.rank, gameState.level) === val);
          
          const slots: { [key: number]: CardType[] } = {
              [Suit.Joker]: [],
              [Suit.Spades]: [],
              [Suit.Hearts]: [],
              [Suit.Clubs]: [],
              [Suit.Diamonds]: []
          };
          
          cardsOfRank.forEach(c => {
             if (c.rank === Rank.SmallJoker || c.rank === Rank.BigJoker) {
                 slots[Suit.Joker].push(c);
             } else {
                 slots[c.suit].push(c);
             }
          });
          
          return { val, slots };
      });
  };

  return (
    <div className="relative w-full h-screen bg-[#1e1e1e] overflow-hidden flex items-center justify-center font-mono">
      <div className="absolute inset-20 border-2 border-[#333333] rounded-xl opacity-50 pointer-events-none"></div>

      <PlayerArea data={top} pos="top-4 left-1/2 -translate-x-1/2" />
      <PlayerArea data={left} pos="left-8 top-1/2 -translate-y-1/2" />
      <PlayerArea data={right} pos="right-8 top-1/2 -translate-y-1/2" />
      
      {/* Chat Box */}
      <div className="absolute top-4 right-4 w-64 h-48 bg-[#252526] border border-[#333333] rounded flex flex-col pointer-events-auto z-10 shadow-lg">
          <div className="flex-1 overflow-y-auto p-2 text-sm text-[#d4d4d4] scrollbar-thin">
              {chatMessages.map((msg, i) => (
                  <div key={i} className="mb-1">
                      <span className="text-[#858585] text-xs">[{msg.time}] </span>
                      <span className="font-bold text-[#569cd6]">{msg.sender}: </span>
                      <span>{msg.text}</span>
                  </div>
              ))}
              <div ref={chatEndRef} />
          </div>
          <form onSubmit={handleChatSubmit} className="p-2 border-t border-[#333333] flex">
              <input 
                  className="flex-1 bg-[#3c3c3c] border-none text-white text-sm focus:outline-none rounded px-2" 
                  placeholder="Type..." 
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
              />
              <button type="submit" className="text-[#0e639c] font-bold text-sm ml-2 hover:text-[#1177bb]">Send</button>
          </form>
      </div>

      {gameState && (
          <div className="absolute top-4 left-4 text-[#d4d4d4] font-bold text-xl bg-[#252526] border border-[#333333] px-4 py-2 rounded shadow-lg">
              <span className="text-[#569cd6]">const</span> <span className="text-[#9cdcfe]">Level</span> = <span className="text-[#b5cea8]">{gameState.level}</span>;
          </div>
      )}
      
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        {renderLastHand()}
        {!gameState && (
            <div className="flex flex-col gap-4 mt-8">
               <div className="text-white text-xl">Waiting for players...</div>
               {me.player && !me.player.isReady && (
                   <button onClick={onReady} className="bg-blue-500 text-white px-6 py-2 rounded font-bold">准备</button>
               )}
               {me.player && me.player.seatIndex === 0 && (
                   <button onClick={onStart} className="bg-yellow-500 text-black px-6 py-2 rounded font-bold">开始游戏 (Host)</button>
               )}
            </div>
        )}
      </div>

      <div className="absolute bottom-0 w-full flex flex-col items-center pb-4 z-20 pointer-events-none">
        {/* Debug Info - remove in production */}
        {gameState && (
            <div className="text-xs text-gray-500 mb-1 pointer-events-auto">
                [Debug] mySeat={mySeat}, currentTurn={gameState.currentTurn}, phase={gameState.phase}, isMyTurn={gameState.currentTurn === mySeat}
            </div>
        )}
        
        {/* Controls Container */}
        <div className="mb-8 pointer-events-auto">
            {gameState && gameState.currentTurn === mySeat && gameState.phase === 'Playing' && (
                <div className="flex gap-4">
                    <button 
                      onClick={toggleViewMode}
                      className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-full font-bold shadow-lg mr-4"
                    >
                      {viewMode === 'normal' ? '切换同花顺视图' : '切换普通视图'}
                    </button>
                    <button 
                      onClick={handleHint}
                      className="bg-yellow-500 hover:bg-yellow-600 text-black px-4 py-2 rounded-full font-bold shadow-lg mr-4"
                    >
                      提示
                    </button>
                    <button 
                      onClick={handlePlay} 
                      disabled={selectedCardIds.length === 0}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2 rounded-full font-bold shadow-lg disabled:opacity-50"
                    >
                      出牌
                    </button>
                    <button 
                      onClick={onPass}
                      className="bg-red-600 hover:bg-red-700 text-white px-8 py-2 rounded-full font-bold shadow-lg"
                    >
                      过
                    </button>
                </div>
            )}
            
            {amIPaying && (
                <div className="flex gap-4">
                   <div className="text-yellow-400 font-bold text-xl animate-pulse">
                       {gameState!.phase === 'Tribute' ? '请进贡最大牌' : '请还贡一张牌'}
                   </div>
                   <button 
                      onClick={handleTributeAction} 
                      className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-2 rounded-full font-bold shadow-lg"
                   >
                      确认
                   </button>
                </div>
            )}
        </div>

        {/* Hand Area - Compact Grid */}
        <div className={`px-8 flex items-end justify-center pointer-events-auto transition-all duration-300 ${viewMode === 'normal' ? 'h-32 -space-x-8' : 'h-64 gap-1'}`}>
          {viewMode === 'normal' ? (
              // Normal View
              sortedHand.map((card: CardType) => (
                <Card 
                  key={card.id} 
                  card={card} 
                  selected={selectedCardIds.includes(card.id)}
                  onClick={() => toggleSelect(card.id)}
                />
              ))
          ) : (
              // Stacked Matrix View (Compact columns)
              getStackedMatrix().map((col, cIdx) => (
                  <div key={cIdx} className="relative w-16 h-64 flex-shrink-0">
                      {[Suit.Joker, Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds].map((suit, sIdx) => {
                          const cards = col.slots[suit];
                          if (!cards || cards.length === 0) return null;
                          
                          return cards.map((card, idx) => (
                              <div 
                                key={card.id} 
                                className={`absolute transition-transform ${straightFlushIds.has(card.id) ? 'ring-2 ring-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)] rounded' : ''}`}
                                style={{ 
                                    bottom: `${(4 - sIdx) * 30 + (idx * 5)}px`, 
                                    zIndex: sIdx * 10 + idx 
                                }}
                              >
                                <Card 
                                    card={card} 
                                    selected={selectedCardIds.includes(card.id)}
                                    onClick={() => toggleSelect(card.id)}
                                    small 
                                />
                              </div>
                          ));
                      })}
                  </div>
              ))
          )}
        </div>
        <div className="text-white font-bold mt-2">{me.player?.name} (Me)</div>
      </div>
      
      {gameState && gameState.phase === 'Score' && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white z-50">
              <h1 className="text-6xl font-bold mb-8 text-yellow-400">Game Over</h1>
              <div className="text-2xl">
                  Winners: {gameState.winners.map(w => {
                      const p = roomState.players.find(pl => pl && pl.seatIndex === w);
                      return p ? p.name : `Seat ${w}`;
                  }).join(', ')}
              </div>
              <button onClick={onStart} className="mt-8 bg-white text-black px-6 py-2 rounded font-bold hover:bg-gray-200">
                  下一局 / 升级 (Host Only)
              </button>
          </div>
      )}
    </div>
  );
};
