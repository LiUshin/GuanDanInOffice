import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card as CardType, Rank, Suit, GameMode, SkillCard, SkillCardType, Hand, HandType } from '../../shared/types';
import { Bot } from '../../shared/bot';
import { Card } from './Card';
import { GameState, RoomState } from '../useGame';
import { getAllPossibleHandTypes, getHandDescription, sortCards, formatLevelRank } from '../../shared/rules';
import { arrangeHand, CardGroup } from '../../shared/arrange';
import { SkillCardButton } from './SkillCardButton';
import { TargetSelectModal } from './TargetSelectModal';
import { GameHistory } from './GameHistory';

const EMPTY_HAND: CardType[] = [];

interface Props {
  gameState: GameState | null;
  roomState: RoomState;
  mySeat: number;
  onPlay: (cards: CardType[], handType?: Hand) => void;
  onPass: () => void;
  onReady: () => void;
  onStart: () => void;
  onTribute?: (cards: CardType[]) => void;
  onReturnTribute?: (cards: CardType[]) => void;
  chatMessages: {sender: string, text: string, time: string, seatIndex: number}[];
  onSendChat: (msg: string) => void;
  onSwitchSeat: (seatIdx: number) => void;
  onSetGameMode?: (mode: GameMode) => void;
  onUseSkill?: (skillId: string, targetSeat?: number) => void;
  onForceEndGame?: () => void;
}

export const GameTable: React.FC<Props> = ({ 
  gameState, roomState, mySeat, onPlay, onPass, onReady, onStart,
  onTribute, onReturnTribute, chatMessages, onSendChat, onSwitchSeat,
  onSetGameMode, onUseSkill, onForceEndGame
}) => {
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [viewMode, setViewMode] = useState<'arranged' | 'rank' | 'stacked'>('arranged'); 
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  
  // Common emojis for quick selection
  const quickEmojis = ['😀', '😂', '🤣', '😎', '🥳', '😭', '😡', '🤔', '👍', '👎', '❤️', '🔥', '💯', '🎉', '🤝', '✌️', '💪', '🙏', '😱', '🤯'];
  
  // Skill card state
  const [pendingSkill, setPendingSkill] = useState<SkillCard | null>(null);
  const [showTargetSelect, setShowTargetSelect] = useState(false);
  
  // New card highlight state
  const [highlightedCardIds, setHighlightedCardIds] = useState<Set<string>>(new Set());
  
  // Chat bubble state for each seat (seat -> message)
  const [chatBubbles, setChatBubbles] = useState<{ [seat: number]: string }>({});
  
  // History window state
  const [showHistory, setShowHistory] = useState(false);
  
  // Hand type selection state (for wild cards with multiple interpretations)
  const [possibleHands, setPossibleHands] = useState<Hand[]>([]);
  const [showHandSelector, setShowHandSelector] = useState(false);
  
  // Track new cards and set up highlight timer
  useEffect(() => {
      if (gameState?.newCardIds && gameState.newCardIds.length > 0) {
          const newIds = new Set(gameState.newCardIds);
          setHighlightedCardIds(prev => new Set([...prev, ...newIds]));
          
          // Clear highlight after 3 seconds
          const timer = setTimeout(() => {
              setHighlightedCardIds(prev => {
                  const updated = new Set(prev);
                  gameState.newCardIds!.forEach(id => updated.delete(id));
                  return updated;
              });
          }, 3000);
          
          return () => clearTimeout(timer);
      }
  }, [gameState?.newCardIds]);
  
  // Track chat messages and show bubbles
  useEffect(() => {
      if (chatMessages.length > 0) {
          const lastMsg = chatMessages[chatMessages.length - 1];
          if (lastMsg.seatIndex !== undefined) {
              // Show bubble for this seat
              setChatBubbles(prev => ({
                  ...prev,
                  [lastMsg.seatIndex]: lastMsg.text
              }));
              
              // Clear bubble after 5 seconds
              const timer = setTimeout(() => {
                  setChatBubbles(prev => {
                      const updated = { ...prev };
                      delete updated[lastMsg.seatIndex];
                      return updated;
                  });
              }, 5000);
              
              return () => clearTimeout(timer);
          }
      }
  }, [chatMessages.length]);
  
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

  const level = gameState?.level ?? 2;
  const handCards = gameState && mySeat >= 0 && Array.isArray(gameState.hands[mySeat])
    ? (gameState.hands[mySeat] as CardType[])
    : EMPTY_HAND;
  const groups = useMemo(() => arrangeHand(handCards, level), [handCards, level]);
  const straightFlushIds = useMemo(() => {
    const ids = new Set<string>();
    groups.filter(g => g.type === HandType.StraightFlush).forEach(g => g.cards.forEach(c => ids.add(c.id)));
    return ids;
  }, [groups]);
  const visibleCards = viewMode === 'rank' ? sortCards(handCards, level) : groups.flatMap(g => g.cards);

  useEffect(() => {
    setSelectedCardIds(prev => {
      const next = prev.filter(id => handCards.some(c => c.id === id));
      return next.length === prev.length ? prev : next;
    });
  }, [handCards]);

  const toggleGroup = (group: CardGroup) => {
    const ids = group.cards.map(c => c.id);
    const allSelected = ids.every(id => selectedCardIds.includes(id));
    setSelectedCardIds(prev => allSelected
      ? prev.filter(id => !ids.includes(id))
      : [...new Set([...prev, ...ids])]);
  };

  const toggleSelect = (id: string) => {
    setSelectedCardIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handlePlay = () => {
    const cards = visibleCards.filter(c => selectedCardIds.includes(c.id));
    
    // Check if cards contain wild cards
    const hasWild = cards.some(c => c.isWild);
    
    if (hasWild && gameState) {
      // Get all possible hand types
      const possibilities = getAllPossibleHandTypes(cards, gameState.level);
      
      if (possibilities.length > 1) {
        // Multiple interpretations - show selector
        setPossibleHands(possibilities);
        setShowHandSelector(true);
        return;
      } else if (possibilities.length === 1) {
        // Single interpretation - play directly
        onPlay(cards, possibilities[0]);
        return;
      }
    }
    
    // No wild cards or no valid interpretation - play as normal
    onPlay(cards);
  };
  
  const handleHandTypeSelect = (hand: Hand) => {
    const cards = visibleCards.filter(c => selectedCardIds.includes(c.id));
    onPlay(cards, hand);
    setShowHandSelector(false);
    setPossibleHands([]);
  };
  
  const handleHint = () => {
      if (!gameState) return;
      const bot = new Bot(visibleCards, gameState.level);
      const target = gameState.lastHand && gameState.lastHand.playerIndex !== mySeat ? gameState.lastHand.hand : null;
      const move = bot.decideMove(target);
      
      if (move) {
          setSelectedCardIds(move.map(c => c.id));
      } else {
          setSelectedCardIds([]);
      }
  };
  
  const handleTributeAction = () => {
      const cards = visibleCards.filter(c => selectedCardIds.includes(c.id));
      if (cards.length !== 1) {
          alert("请选择一张牌");
          return;
      }
      if (gameState.phase === 'Tribute' && onTribute) onTribute(cards);
      if (gameState.phase === 'ReturnTribute' && onReturnTribute) {
          const card = cards[0];
          const hasLegal = visibleCards.some(c => c.rank <= Rank.Ten && c.rank !== gameState.level);
          const isLegal = card.rank <= Rank.Ten && card.rank !== gameState.level;
          if (!isLegal && hasLegal) {
              alert('还贡只能出 10 及以下，且不能是级牌或王');
              return;
          }
          onReturnTribute(cards);
      }
  };
  
  const handleChatSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (chatInput.trim()) {
          onSendChat(chatInput.trim());
          setChatInput('');
      }
  }
  
  // Skill card handlers
  const handleSkillClick = (skill: SkillCard) => {
      const needsTarget = [SkillCardType.Steal, SkillCardType.Discard, SkillCardType.Skip];
      if (needsTarget.includes(skill.type)) {
          setPendingSkill(skill);
          setShowTargetSelect(true);
      } else {
          // No target needed, use immediately
          onUseSkill?.(skill.id);
      }
  };
  
  const handleTargetSelect = (targetSeat: number) => {
      if (pendingSkill) {
          onUseSkill?.(pendingSkill.id, targetSeat);
          setPendingSkill(null);
          setShowTargetSelect(false);
      }
  };
  
  const handleTargetCancel = () => {
      setPendingSkill(null);
      setShowTargetSelect(false);
  };
  
  // Get players for target selection
  const getPlayersForTargeting = () => {
      return roomState.players
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .map(p => ({
              name: p.name,
              seatIndex: p.seatIndex,
              handCount: gameState 
                  ? (typeof gameState.hands[p.seatIndex] === 'number' 
                      ? gameState.hands[p.seatIndex] as number 
                      : (gameState.hands[p.seatIndex] as CardType[]).length)
                  : 0
          }));
  };

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
        <div className="text-yellow-300 font-bold mt-2">{getHandDescription(hand, gameState.level)}</div>
      </div>
    );
  };

  // Helper to render cards played in round action
  const renderActionCards = (cards: CardType[] | undefined) => {
      if (!cards || cards.length === 0) return null;
      return (
          <div className="flex gap-0.5 mt-1">
              {cards.slice(0, 6).map((card, i) => (
                  <div key={i} className="w-6 h-8 bg-white rounded text-xs flex items-center justify-center font-bold border border-gray-300"
                       style={{ color: (card.suit === Suit.Hearts || card.suit === Suit.Diamonds) ? 'red' : 'black' }}>
                      {card.rank === Rank.SmallJoker ? '🃏' : card.rank === Rank.BigJoker ? '🃟' : 
                       ['', '', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'][card.rank] || '?'}
                  </div>
              ))}
              {cards.length > 6 && <span className="text-white text-xs">+{cards.length - 6}</span>}
          </div>
      );
  };

  const PlayerArea = ({ data, pos }: { data: any, pos: string }) => {
    const action = gameState?.roundActions?.[data.seat];
    const bubble = chatBubbles[data.seat];
    
    // Get winner position (头游、二游、三游、末游)
    const getWinnerPosition = () => {
      if (!gameState || !gameState.winners) return null;
      const position = gameState.winners.indexOf(data.seat);
      if (position === -1) return null;
      const labels = ['头游', '二游', '三游', '末游'];
      const colors = ['bg-yellow-500', 'bg-orange-500', 'bg-purple-500', 'bg-gray-500'];
      return { label: labels[position], color: colors[position] };
    };
    
    const winnerPos = getWinnerPosition();
    
    return (
      <div 
          className={`absolute ${pos} flex flex-col items-center p-4 rounded-lg transition-colors ${data.isTeammate ? 'bg-blue-900/40 border-2 border-blue-400' : 'bg-black/20'} ${!gameState && !data.player ? 'cursor-pointer hover:bg-white/10' : ''}`}
          onClick={() => !gameState && !data.player && onSwitchSeat(data.seat)}
      >
         {/* Chat Bubble */}
         {bubble && (
           <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-50 animate-bounce-in">
             <div className="relative bg-white text-gray-800 px-4 py-2 rounded-xl shadow-lg max-w-48 text-sm font-medium whitespace-pre-wrap">
               {bubble}
               {/* Bubble arrow */}
               <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white"></div>
             </div>
           </div>
         )}
         
         <div className="w-12 h-12 bg-gray-300 rounded-full flex items-center justify-center mb-2 relative">
           {data.player ? data.player.name[0].toUpperCase() : (gameState ? '?' : '+')}
           {data.isTeammate && <div className="absolute -top-1 -right-1 bg-blue-500 text-xs text-white px-1 rounded">友</div>}
           {data.isOpponent && <div className="absolute -top-1 -right-1 bg-red-500 text-xs text-white px-1 rounded">敌</div>}
           {data.player && data.player.seatIndex === 0 && (
               <div className="absolute -bottom-1 -right-1 text-xs bg-yellow-500 text-black px-1 rounded font-bold border border-white">
                   房主
               </div>
           )}
           {/* Winner Position Badge */}
           {winnerPos && (
               <div className={`absolute -top-2 left-1/2 -translate-x-1/2 ${winnerPos.color} text-white text-xs px-2 py-0.5 rounded-full font-bold shadow-lg border-2 border-white animate-pulse`}>
                   {winnerPos.label}
               </div>
           )}
         </div>
         <div className="text-white font-bold flex items-center gap-2">
             {data.player ? data.player.name : (gameState ? '等待中' : '点击入座')}
             {data.player && (data.player as any).isDisconnected && (
                 <span className="text-red-500 text-xs font-bold bg-white px-1 rounded animate-pulse">OFF</span>
             )}
         </div>
         {gameState && <div className="text-yellow-400">剩余 {data.handCount}</div>}
         {data.player && data.player.isReady && !gameState && <div className="text-green-400 text-sm">已准备</div>}
         
         {/* Show current round action */}
         {gameState && action && (
             <div className="mt-2 flex flex-col items-center">
                 {action.type === 'pass' ? (
                     <div className="text-gray-400 font-bold text-sm bg-gray-700/50 px-3 py-1 rounded">过</div>
                 ) : (
                     <div className="flex flex-col items-center">
                         <div className="text-green-400 text-xs mb-1">{action.hand ? getHandDescription(action.hand, gameState.level) : '出牌'}</div>
                         {renderActionCards(action.cards)}
                     </div>
                 )}
             </div>
         )}
         
         {gameState && gameState.currentTurn === data.seat && !action && (
             data.seat === mySeat
               ? <div className="text-yellow-300 font-bold mt-2">轮到你了</div>
               : <div className="text-gray-300 font-bold mt-2">思考中</div>
         )}
      </div>
    );
  };

  const getStackedMatrix = () => {
      const columns: { key: string; slots: { [key: number]: CardType[] } }[] = [];
      const pushColumn = (key: string, cards: CardType[]) => {
          if (cards.length === 0) return;
          const slots: { [key: number]: CardType[] } = {
              [Suit.Joker]: [],
              [Suit.Spades]: [],
              [Suit.Hearts]: [],
              [Suit.Clubs]: [],
              [Suit.Diamonds]: []
          };
          cards.forEach(c => {
              if (c.rank >= Rank.SmallJoker) slots[Suit.Joker].push(c);
              else slots[c.suit].push(c);
          });
          columns.push({ key, slots });
      };
      pushColumn('big', handCards.filter(c => c.rank === Rank.BigJoker));
      pushColumn('small', handCards.filter(c => c.rank === Rank.SmallJoker));
      for (let rank = Rank.Ace; rank >= Rank.Two; rank--) {
          pushColumn(String(rank), handCards.filter(c => c.rank === rank));
      }
      return columns;
  };

  return (
    <div className="relative w-full h-screen bg-[#1e1e1e] overflow-hidden flex items-center justify-center font-mono">
      <div className="absolute inset-20 border-2 border-[#333333] rounded-xl opacity-50 pointer-events-none"></div>

      <PlayerArea data={top} pos="top-4 left-1/2 -translate-x-1/2" />
      <PlayerArea data={left} pos="left-8 top-1/2 -translate-y-1/2" />
      <PlayerArea data={right} pos="right-8 top-1/2 -translate-y-1/2" />
      
      {/* Chat Box */}
      <div className="absolute top-4 right-4 w-72 h-56 bg-[#252526] border border-[#333333] rounded flex flex-col pointer-events-auto z-10 shadow-lg">
          <div className="flex-1 overflow-y-auto p-2 text-sm text-[#d4d4d4] scrollbar-thin">
              {chatMessages.map((msg, i) => (
                  <div key={i} className="mb-1">
                      <span className="text-[#858585] text-xs">[{msg.time}] </span>
                      <span className="font-bold text-[#569cd6]">{msg.sender}: </span>
                      <span className="break-words">{msg.text}</span>
                  </div>
              ))}
              <div ref={chatEndRef} />
          </div>
          
          {/* Emoji Picker */}
          {showEmojiPicker && (
              <div className="p-2 border-t border-[#333333] bg-[#1e1e1e] grid grid-cols-10 gap-1">
                  {quickEmojis.map((emoji, i) => (
                      <button 
                          key={i} 
                          type="button"
                          onClick={() => {
                              setChatInput(prev => prev + emoji);
                              setShowEmojiPicker(false);
                          }}
                          className="text-lg hover:bg-[#3c3c3c] rounded p-1 transition-colors"
                      >
                          {emoji}
                      </button>
                  ))}
              </div>
          )}
          
          <form onSubmit={handleChatSubmit} className="p-2 border-t border-[#333333] flex items-center gap-1">
              <button 
                  type="button" 
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="text-lg hover:bg-[#3c3c3c] rounded p-1"
                  title="表情"
              >
                  😊
              </button>
              <input 
                  className="flex-1 bg-[#3c3c3c] border-none text-white text-sm focus:outline-none rounded px-2 py-1" 
                  placeholder="输入消息..." 
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
              />
              <button type="submit" className="text-[#0e639c] font-bold text-sm hover:text-[#1177bb]">发送</button>
          </form>
      </div>

      {gameState && (
          <div className="absolute top-4 left-4 flex flex-col gap-2 items-start z-50">
              <div className="text-[#d4d4d4] font-bold bg-[#252526] border border-[#333333] px-4 py-2 rounded shadow-lg text-sm leading-6">
                  <div className="text-lg">当前 打{formatLevelRank(gameState.level)}</div>
                  {gameState.teamLevels && (
                    <>
                      <div>
                        我方 打{formatLevelRank(gameState.teamLevels[mySeat >= 0 ? mySeat % 2 : 0])}
                        {gameState.activeTeam === (mySeat >= 0 ? mySeat % 2 : 0) ? ' · 庄' : ''}
                      </div>
                      <div>
                        对方 打{formatLevelRank(gameState.teamLevels[mySeat >= 0 ? 1 - (mySeat % 2) : 1])}
                        {gameState.activeTeam === (mySeat >= 0 ? 1 - (mySeat % 2) : 1) ? ' · 庄' : ''}
                      </div>
                    </>
                  )}
              </div>
              
              {/* Host Force End Button */}
              {me.player && me.player.seatIndex === 0 && (
                <button 
                    onClick={() => {
                        if (confirm('⚠️ 确定要强制结束当前游戏吗？所有进度将丢失。')) {
                            onForceEndGame?.();
                        }
                    }}
                    className="bg-red-900/80 hover:bg-red-600 text-white text-xs px-3 py-1 rounded border border-red-500/50 shadow-lg backdrop-blur-sm transition-all flex items-center gap-1"
                >
                    <span>⛔</span> 强制结束
                </button>
              )}
          </div>
      )}
      
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        {renderLastHand()}
        {!gameState && (
            <div className="flex flex-col gap-4 mt-8 items-center">
               <div className="text-white text-xl">等待玩家入座</div>
               
               {/* Game Mode Toggle - Only host can change */}
               <div className="flex items-center gap-4 bg-[#252526] px-4 py-2 rounded-lg border border-[#333333]">
                   <span className="text-[#9cdcfe] font-bold">模式:</span>
                   <button 
                       onClick={() => onSetGameMode?.(GameMode.Normal)}
                       disabled={mySeat !== 0}
                       className={`px-4 py-1 rounded font-bold transition-all ${
                           roomState.gameMode !== GameMode.Skill 
                               ? 'bg-blue-600 text-white' 
                               : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                       } ${mySeat !== 0 ? 'cursor-not-allowed opacity-70' : ''}`}
                   >
                       普通
                   </button>
                   <button 
                       onClick={() => onSetGameMode?.(GameMode.Skill)}
                       disabled={mySeat !== 0}
                       className={`px-4 py-1 rounded font-bold transition-all ${
                           roomState.gameMode === GameMode.Skill 
                               ? 'bg-purple-600 text-white' 
                               : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                       } ${mySeat !== 0 ? 'cursor-not-allowed opacity-70' : ''}`}
                   >
                       技能
                   </button>
               </div>
               {roomState.gameMode === GameMode.Skill && (
                   <div className="text-purple-400 text-sm">技能模式: 每人开局获得2张技能卡</div>
               )}
               
               {me.player && !me.player.isReady && (
                   <button onClick={onReady} className="bg-blue-500 text-white px-6 py-2 rounded font-bold">准备</button>
               )}
               {me.player && me.player.seatIndex === 0 && (
                   <button onClick={onStart} className="bg-yellow-500 text-black px-6 py-2 rounded font-bold">开始游戏</button>
               )}
            </div>
        )}
      </div>

      <div className="absolute bottom-0 w-full flex flex-col items-center pb-4 z-20 pointer-events-none">
        {/* Skill Cards Area */}
        {gameState && gameState.gameMode === GameMode.Skill && gameState.mySkillCards && gameState.mySkillCards.length > 0 && (
            <div className="mb-4 pointer-events-auto flex flex-col items-center">
                <div className="text-purple-400 text-sm mb-2 font-bold">我的技能卡</div>
                <div className="flex gap-3">
                    {gameState.mySkillCards.map((skill) => (
                        <SkillCardButton 
                            key={skill.id} 
                            skill={skill} 
                            onClick={() => handleSkillClick(skill)}
                            disabled={gameState.currentTurn !== mySeat || gameState.phase !== 'Playing'}
                        />
                    ))}
                </div>
                {gameState.currentTurn === mySeat && gameState.phase === 'Playing' && (
                    <div className="text-xs text-gray-400 mt-1">点击技能卡使用（使用后仍可出牌）</div>
                )}
            </div>
        )}

        {/* Controls Container */}
        <div className="mb-8 pointer-events-auto">
            {gameState && gameState.currentTurn === mySeat && gameState.phase === 'Playing' && (
                <div className="flex flex-col items-center gap-3">
                <div className="text-yellow-300 font-bold text-lg">轮到你了</div>
                <div className="flex gap-4">
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
                      disabled={!gameState.lastHand || gameState.lastHand.playerIndex === mySeat}
                      className="bg-red-600 hover:bg-red-700 text-white px-8 py-2 rounded-full font-bold shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      过
                    </button>
                </div>
                </div>
            )}
            
            {amIPaying && (
                <div className="flex gap-4">
                   <div className="text-yellow-400 font-bold text-xl animate-pulse">
                       {gameState!.phase === 'Tribute' ? '请进贡最大牌' : '还贡 10 及以下，不能是级牌或王'}
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

        {gameState && handCards.length > 0 && (
            <div className="mb-2 pointer-events-auto flex gap-2">
                {([
                    ['arranged', '理牌'],
                    ['rank', '点数'],
                    ['stacked', '同花顺'],
                ] as const).map(([mode, label]) => (
                    <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        className={`px-3 py-1 rounded-full text-sm font-bold ${viewMode === mode ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white hover:bg-gray-500'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>
        )}

        {/* Hand Area */}
        <div className={`w-full max-w-[100vw] overflow-x-auto px-4 pointer-events-auto ${viewMode === 'stacked' ? 'h-64' : 'h-40'}`}>
          {viewMode === 'arranged' ? (
              <div className="flex items-end justify-center gap-3 min-w-max mx-auto h-full">
                  {groups.map(group => (
                      <div key={group.id} className="flex flex-col items-center">
                          <button
                              type="button"
                              onClick={() => toggleGroup(group)}
                              className="text-[10px] leading-none mb-1 text-yellow-300/90 hover:text-yellow-200"
                          >
                              {group.label}
                          </button>
                          <div className="flex -space-x-8">
                              {group.cards.map(card => (
                                  <Card
                                      key={card.id}
                                      card={card}
                                      selected={selectedCardIds.includes(card.id)}
                                      onClick={() => toggleSelect(card.id)}
                                      isHighlighted={highlightedCardIds.has(card.id)}
                                  />
                              ))}
                          </div>
                      </div>
                  ))}
              </div>
          ) : viewMode === 'rank' ? (
              <div className="flex items-end justify-center -space-x-8 min-w-max mx-auto h-full">
              {visibleCards.map((card: CardType) => (
                <Card 
                  key={card.id} 
                  card={card} 
                  selected={selectedCardIds.includes(card.id)}
                  onClick={() => toggleSelect(card.id)}
                  isHighlighted={highlightedCardIds.has(card.id)}
                />
              ))}
              </div>
          ) : (
              <div className="flex items-end justify-center gap-1 min-w-max mx-auto h-full">
              {getStackedMatrix().map((col, cIdx) => (
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
                                    isHighlighted={highlightedCardIds.has(card.id)}
                                />
                              </div>
                          ));
                      })}
                  </div>
              ))}
              </div>
          )}
        </div>
        <div className="relative">
          {/* My Chat Bubble */}
          {chatBubbles[mySeat] && (
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-50 animate-bounce-in">
              <div className="relative bg-white text-gray-800 px-4 py-2 rounded-xl shadow-lg max-w-48 text-sm font-medium whitespace-pre-wrap">
                {chatBubbles[mySeat]}
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white"></div>
              </div>
            </div>
          )}
          <div className="text-white font-bold mt-2">{me.player?.name}（我）</div>
        </div>
      </div>
      
      {gameState && gameState.phase === 'Score' && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white z-50">
              <h1 className="text-6xl font-bold mb-8 text-yellow-400">本局结束</h1>
              <div className="text-2xl mb-4">
                  获胜顺序: {gameState.winners.map(w => {
                      const p = roomState.players.find(pl => pl && pl.seatIndex === w);
                      return p ? p.name : `Seat ${w}`;
                  }).join(' → ')}
              </div>
              {gameState.teamLevels && (
                  <div className="text-xl text-gray-300 mb-4">
                      我方 打{formatLevelRank(gameState.teamLevels[mySeat >= 0 ? mySeat % 2 : 0])}
                      {' '}| 对方 打{formatLevelRank(gameState.teamLevels[mySeat >= 0 ? 1 - (mySeat % 2) : 1])}
                  </div>
              )}
              <div className="text-lg text-yellow-300 animate-pulse">
                  ⏳ 3秒后自动开始下一局...
              </div>
              <div className="text-sm text-gray-400 mt-4">
                  (对局将持续到某队打到A并连胜两次)
              </div>
          </div>
      )}
      
      {/* Hand Type Selection Modal (for wild cards) */}
      {showHandSelector && possibleHands.length > 0 && gameState && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
              <div className="bg-[#252526] border border-[#333333] rounded-lg p-6 max-w-md shadow-2xl">
                  <h2 className="text-2xl font-bold text-[#9cdcfe] mb-4">选择牌型</h2>
                  <p className="text-gray-400 mb-4">您的牌包含红心{formatLevelRank(gameState.level)}（万能牌），可以组成以下牌型：</p>
                  <div className="flex flex-col gap-3">
                      {possibleHands.map((hand, idx) => (
                          <button
                              key={idx}
                              onClick={() => handleHandTypeSelect(hand)}
                              className="bg-[#3c3c3c] hover:bg-[#4c4c4c] text-white px-6 py-3 rounded-lg font-bold transition-colors text-left"
                          >
                              <div className="text-lg">{getHandDescription(hand, gameState.level)}</div>
                              <div className="text-sm text-gray-400 mt-1">
                                  点数 {hand.value}
                                  {hand.bombCount ? ` · ${hand.bombCount}张` : ''}
                              </div>
                          </button>
                      ))}
                  </div>
                  <button
                      onClick={() => {
                          setShowHandSelector(false);
                          setPossibleHands([]);
                      }}
                      className="mt-4 w-full bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg"
                  >
                      取消
                  </button>
              </div>
          </div>
      )}
      
      {/* Target Selection Modal for Skills */}
      {showTargetSelect && pendingSkill && (
          <TargetSelectModal
              skillType={pendingSkill.type}
              players={getPlayersForTargeting()}
              mySeat={mySeat}
              onSelect={handleTargetSelect}
              onCancel={handleTargetCancel}
          />
      )}
      
      {/* Game History Window */}
      {gameState && gameState.history && (
          <GameHistory
              history={gameState.history}
              currentRound={gameState.currentRound || 1}
              isOpen={showHistory}
              onClose={() => setShowHistory(false)}
          />
      )}
      
      {/* History Button (floating) */}
      {gameState && (
          <button
              onClick={() => setShowHistory(true)}
              className="fixed top-4 right-4 z-40 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-lg font-medium transition flex items-center gap-2"
              title="查看游戏历史记录"
          >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              历史记录
              {gameState.history && gameState.history.length > 0 && (
                  <span className="bg-red-500 text-xs px-2 py-0.5 rounded-full">
                      {gameState.history.length}
                  </span>
              )}
          </button>
      )}
    </div>
  );
};
