import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { Card as CardType, Rank, Suit, GameMode, SkillCard, SkillCardType, Hand, HandType } from '../../shared/types';
import { Bot } from '../../shared/bot';
import { Card } from './Card';
import { GameState, RoomState } from '../useGame';
import { getAllPossibleHandTypes, getHandDescription, sortCards, formatLevelRank } from '../../shared/rules';
import { arrangeHand, CardGroup } from '../../shared/arrange';
import { SkillCardButton } from './SkillCardButton';
import { TargetSelectModal } from './TargetSelectModal';
import { GameHistory } from './GameHistory';
import { GameDialog } from './gameDialog';
import { evaluateSelection, getTributeEligibleIds } from './gameSelection';
import './gameTable.css';

const EMPTY_HAND: CardType[] = [];
const CHAT_MAX_LENGTH = 200;
const QUICK_EMOJIS = ['😀', '😂', '😎', '🥳', '😭', '🤔', '👍', '🔥', '🎉', '🤝', '💪', '🙏'];
const SUIT_ORDER = [Suit.Joker, Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds];
const WINNER_LABELS = ['头游', '二游', '三游', '末游'];
type Player = NonNullable<RoomState['players'][number]>;

interface Props {
  interactionDisabled?: boolean;
  gameState: GameState | null;
  roomState: RoomState;
  mySeat: number;
  onPlay: (cards: CardType[], handType?: Hand) => void;
  onPass: () => void;
  onReady: () => void;
  onStart: () => void;
  onTribute?: (cards: CardType[]) => void;
  onReturnTribute?: (cards: CardType[]) => void;
  chatMessages: { sender: string; text: string; time: string; seatIndex: number }[];
  onSendChat: (msg: string) => void;
  onSwitchSeat: (seatIdx: number) => void;
  onSetGameMode?: (mode: GameMode) => void;
  onUseSkill?: (skillId: string, targetSeat?: number) => void;
  onForceEndGame?: () => void;
  onLeave?: () => void;
}

function countHand(gameState: GameState | null, seat: number) {
  const hand = gameState?.hands[seat];
  return Array.isArray(hand) ? hand.length : typeof hand === 'number' ? hand : 0;
}

function PlayerSeat({ player, seat, mySeat, position, gameState, bubble }: {
  player?: Player; seat: number; mySeat: number; position: string; gameState: GameState; bubble?: string;
}) {
  const isTeammate = seat % 2 === mySeat % 2;
  const count = countHand(gameState, seat);
  const action = gameState.roundActions?.[seat];
  const winner = gameState.winners.indexOf(seat);
  const active = gameState.phase === 'Playing' && gameState.currentTurn === seat;
  return (
    <section className={`game-seat game-seat--${position}${isTeammate ? ' is-teammate' : ''}${active ? ' is-active' : ''}`} aria-label={`${player?.name || '玩家'}，${isTeammate ? '队友' : '对手'}，剩余 ${count} 张`}>
      <div className="game-seat__identity">
        <span className="game-seat__avatar" aria-hidden="true">{player?.name?.slice(0, 1).toUpperCase() || '?'}</span>
        <div className="game-seat__details"><strong title={player?.name}>{player?.name || '等待中'}</strong><span>{isTeammate ? '队友' : '对手'}{player?.isHost ? ' · 房主' : ''}{player?.isBot ? ' · AI' : ''}</span></div>
      </div>
      <div className="game-seat__count"><strong className={count <= 5 ? 'is-low' : ''}>{count}</strong><span>张牌</span>{winner >= 0 && <span className="game-badge game-badge--violet">{WINNER_LABELS[winner]}</span>}</div>
      <div className="game-seat__activity">{player?.isDisconnected ? '离线 · 托管中' : active ? '思考中…' : action?.type === 'pass' ? '已过牌' : action?.hand ? getHandDescription(action.hand, gameState.level) : winner >= 0 ? '已出完' : '等待出牌'}</div>
      {bubble && <div className="game-seat__bubble" title={bubble}>{bubble}</div>}
    </section>
  );
}

export const GameTable: React.FC<Props> = ({ interactionDisabled = false, gameState, roomState, mySeat, onPlay, onPass, onTribute, onReturnTribute, chatMessages, onSendChat, onUseSkill, onForceEndGame, onLeave }) => {
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'arranged' | 'rank' | 'stacked'>('arranged');
  const [feedback, setFeedback] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingSkill, setPendingSkill] = useState<SkillCard | null>(null);
  const [possibleHands, setPossibleHands] = useState<Hand[]>([]);
  const [highlightedCardIds, setHighlightedCardIds] = useState<Set<string>>(new Set());
  const [chatBubbles, setChatBubbles] = useState<Record<number, string>>({});
  const bubbleTimers = useRef<Record<number, number>>({});
  const chatListRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const chatFollowRef = useRef(true);
  const handTitleId = useId();
  const selectionId = useId();
  const chatId = useId();

  const level = gameState?.level ?? 2;
  const handCards = gameState && Array.isArray(gameState.hands[mySeat]) ? gameState.hands[mySeat] as CardType[] : EMPTY_HAND;
  const groups = useMemo(() => arrangeHand(handCards, level), [handCards, level]);
  const visibleCards = viewMode === 'rank' ? sortCards(handCards, level) : groups.flatMap(group => group.cards);
  const selectedIds = useMemo(() => new Set(selectedCardIds), [selectedCardIds]);
  const selectedCards = useMemo(() => handCards.filter(card => selectedIds.has(card.id)), [handCards, selectedIds]);
  const target = gameState?.lastHand && gameState.lastHand.playerIndex !== mySeat ? gameState.lastHand.hand as Hand : null;
  const selection = useMemo(() => evaluateSelection(selectedCards, level, target), [selectedCards, level, target]);
  const isMyTurn = !interactionDisabled && gameState?.phase === 'Playing' && gameState.currentTurn === mySeat && handCards.length > 0;
  const isTributePhase = gameState?.phase === 'Tribute' || gameState?.phase === 'ReturnTribute';
  const amIPaying = !interactionDisabled && !!(isTributePhase && (gameState.phase === 'Tribute' ? gameState.tributeState?.pendingTributes : gameState.tributeState?.pendingReturns)?.some(tribute => tribute.from === mySeat && !tribute.card));
  const tributeHintIds = useMemo(() => amIPaying ? getTributeEligibleIds(handCards, level, gameState?.phase || '') : new Set<string>(), [amIPaying, handCards, level, gameState?.phase]);
  const validTribute = selectedCards.length === 1 && tributeHintIds.has(selectedCards[0].id);
  const straightFlushIds = useMemo(() => new Set(groups.filter(group => group.type === HandType.StraightFlush).flatMap(group => group.cards.map(card => card.id))), [groups]);
  const handKey = handCards.map(card => card.id).join('|');
  const newCardKey = gameState?.newCardIds?.join('|') || '';

  useEffect(() => {
    setSelectedCardIds(previous => {
      const next = previous.filter(id => handCards.some(card => card.id === id));
      return next.length === previous.length ? previous : next;
    });
  }, [handCards]);

  useEffect(() => {
    if (interactionDisabled) {
      setShowHistory(false);
      setPendingSkill(null);
      setPossibleHands([]);
    }
  }, [interactionDisabled]);

  useEffect(() => {
    setPossibleHands([]);
    setFeedback('');
  }, [gameState?.currentTurn, gameState?.phase, gameState?.currentRound, handKey]);

  useEffect(() => {
    if (pendingSkill && (!isMyTurn || !gameState?.mySkillCards?.some(skill => skill.id === pendingSkill.id))) setPendingSkill(null);
  }, [isMyTurn, gameState?.mySkillCards, pendingSkill]);

  useEffect(() => {
    if (!newCardKey) {
      setHighlightedCardIds(new Set());
      return;
    }
    const ids = newCardKey.split('|');
    setHighlightedCardIds(new Set(ids));
    const timer = window.setTimeout(() => setHighlightedCardIds(new Set()), 3000);
    return () => window.clearTimeout(timer);
  }, [newCardKey]);

  useEffect(() => {
    const last = chatMessages[chatMessages.length - 1];
    if (!last || last.seatIndex === undefined) return;
    setChatBubbles(previous => ({ ...previous, [last.seatIndex]: last.text }));
    window.clearTimeout(bubbleTimers.current[last.seatIndex]);
    bubbleTimers.current[last.seatIndex] = window.setTimeout(() => {
      setChatBubbles(previous => { const next = { ...previous }; delete next[last.seatIndex]; return next; });
    }, 5000);
  }, [chatMessages]);

  useEffect(() => () => Object.values(bubbleTimers.current).forEach(timer => window.clearTimeout(timer)), []);
  useEffect(() => {
    const list = chatListRef.current;
    if (showChat && list && chatFollowRef.current) list.scrollTop = list.scrollHeight;
  }, [chatMessages, showChat]);
  useEffect(() => { if (showChat) chatInputRef.current?.focus({ preventScroll: true }); }, [showChat]);

  const toggleSelect = (id: string) => {
    setFeedback('');
    setSelectedCardIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  };
  const toggleGroup = (group: CardGroup) => {
    setFeedback('');
    const ids = group.cards.map(card => card.id);
    setSelectedCardIds(previous => ids.every(id => previous.includes(id)) ? previous.filter(id => !ids.includes(id)) : [...new Set([...previous, ...ids])]);
  };
  const clearSelection = () => { setSelectedCardIds([]); setFeedback(''); };
  const handlePlay = () => {
    if (!isMyTurn || !selection.canPlay) return;
    const possibilities = selectedCards.some(card => card.isWild) ? getAllPossibleHandTypes(selectedCards, level) : [];
    if (possibilities.length > 1) { setPossibleHands(possibilities); return; }
    onPlay(selectedCards, selection.hand || undefined);
  };
  const handleHint = () => {
    if (!isMyTurn) return;
    const move = new Bot(visibleCards, level).decideMove(target);
    if (move && evaluateSelection(move, level, target).canPlay) {
      setSelectedCardIds(move.map(card => card.id));
      setFeedback('已选好建议出牌，你可以调整后再出。');
    } else {
      setFeedback(target ? '暂未找到可出的组合。可以自行选牌，或选择「过」。' : '暂未找到建议组合，请自行选择手牌。');
    }
  };
  const handleTribute = () => {
    if (!amIPaying || !validTribute) return;
    if (gameState?.phase === 'Tribute') onTribute?.(selectedCards);
    else onReturnTribute?.(selectedCards);
  };
  const handleSkill = (skill: SkillCard) => {
    if (!isMyTurn || !onUseSkill) return;
    if ([SkillCardType.Steal, SkillCardType.Discard, SkillCardType.Skip].includes(skill.type)) setPendingSkill(skill);
    else onUseSkill(skill.id);
  };
  const closeChat = () => { setShowChat(false); setShowEmojiPicker(false); chatButtonRef.current?.focus({ preventScroll: true }); };
  const handleChatSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    if (message.length > CHAT_MAX_LENGTH) {
      setChatError('消息最多 200 个字符，请缩短后再发送。');
      return;
    }
    onSendChat(message);
    setChatInput('');
    setChatError('');
    chatFollowRef.current = true;
  };

  if (!gameState) return null;
  const myTeam = mySeat >= 0 ? mySeat % 2 : 0;
  const me = roomState.players.find(player => player?.seatIndex === mySeat);
  const currentPlayer = roomState.players.find(player => player?.seatIndex === gameState.currentTurn);
  const lastPlayer = roomState.players.find(player => player?.seatIndex === gameState.lastHand?.playerIndex);
  const turnText = gameState.phase === 'Score' ? '本局结束' : amIPaying ? gameState.phase === 'Tribute' ? '请进贡最大牌' : '请选择还贡牌' : isTributePhase ? '等待其他玩家进贡 / 还贡' : handCards.length === 0 ? '你已出完，看看队友的表现' : isMyTurn ? '轮到你了' : `等待 ${currentPlayer?.name || '其他玩家'} 出牌`;
  const tributeText = gameState.phase === 'Tribute' ? '选择一张黄框标出的最大牌' : handCards.some(card => card.rank <= Rank.Ten && card.rank !== level) ? '还贡 10 及以下，不能是级牌或王；黄框为可选牌' : '没有普通可还牌，请选择黄框标出的最小牌';
  const selectionMessage = amIPaying ? selectedCards.length === 0 ? tributeText : validTribute ? '这张牌可以提交' : '请选择且只选择一张黄框牌' : isTributePhase ? '等待其他玩家提交进贡 / 还贡' : selection.canPlay && !isMyTurn ? `${getHandDescription(selection.hand!, level)} · 牌型有效，等待你的回合` : selection.message;
  const renderHandCard = (card: CardType, small = false) => <Card key={card.id} card={card} selected={selectedIds.has(card.id)} onClick={() => toggleSelect(card.id)} small={small} isHighlighted={highlightedCardIds.has(card.id)} hint={tributeHintIds.has(card.id)} />;

  return (
    <div className="game-screen">
      <header className="game-header">
        <div className="game-header__identity"><span className="game-eyebrow">GUANDAN / 房间 {roomState.roomId}</span><div className="game-header__title"><h1>当前 打{formatLevelRank(level)}</h1><span className="game-badge">第 {gameState.currentRound || 1} 局</span>{gameState.gameMode === GameMode.Skill && <span className="game-badge game-badge--violet">技能局</span>}</div></div>
        {gameState.teamLevels && <div className="game-scoreline"><span>我方 <strong>打{formatLevelRank(gameState.teamLevels[myTeam])}</strong>{gameState.activeTeam === myTeam && <i>庄</i>}</span><span>对方 <strong>打{formatLevelRank(gameState.teamLevels[1 - myTeam])}</strong>{gameState.activeTeam === 1 - myTeam && <i>庄</i>}</span></div>}
        <nav className="game-header__actions" aria-label="牌桌工具">
          <button ref={chatButtonRef} type="button" className={`game-button ${showChat ? 'is-on' : ''}`} aria-expanded={showChat} aria-controls={chatId} onClick={() => showChat ? closeChat() : setShowChat(true)}>聊天</button>
          <button type="button" className="game-button" onClick={() => setShowHistory(true)}>历史记录</button>
          {onLeave && <button type="button" className="game-button" onClick={onLeave}>离开房间</button>}
          {me?.isHost && onForceEndGame && <button type="button" className="game-button game-button--quiet-danger" onClick={() => { if (window.confirm('确定强制结束整场对局吗？当前进度将丢失，所有玩家返回准备房间。')) onForceEndGame(); }}>结束对局</button>}
        </nav>
      </header>

      <div className={`game-workspace${showChat ? ' has-chat' : ''}`}>
        <main className="game-board" aria-label="对局牌桌">
          {([{ offset: 2, position: 'top' }, { offset: 3, position: 'left' }, { offset: 1, position: 'right' }]).map(({ offset, position }) => {
            const seat = (mySeat + offset) % 4;
            return <PlayerSeat key={seat} player={roomState.players.find(player => player?.seatIndex === seat)} seat={seat} mySeat={mySeat} position={position} gameState={gameState} bubble={chatBubbles[seat]} />;
          })}
          <section className="game-center" aria-label="桌面出牌">
            {gameState.lastHand ? <>
              <p className="game-eyebrow">{lastPlayer?.name || '玩家'} 出牌</p>
              <div className="game-center__cards">{gameState.lastHand.hand.cards.map((card: CardType) => <Card key={card.id} card={card} small />)}</div>
              <span className="game-badge game-badge--teal">{getHandDescription(gameState.lastHand.hand, level)}</span>
            </> : <div className="game-center__empty"><span aria-hidden="true">♠</span><p>{isTributePhase ? '进贡 / 还贡阶段' : '新的出牌轮次'}</p><small>{isTributePhase ? '黄框标出了可提交的牌' : isMyTurn ? '你可以自由出牌' : '等待首家出牌'}</small></div>}
          </section>
          <div className="game-board__caption">红心{formatLevelRank(level)}是万能牌 · 座位相对的玩家为队友</div>
        </main>

        {showChat && <aside className="game-chat" id={chatId} aria-label="房间聊天" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeChat(); } }}>
          <div className="game-chat__header"><strong>房间聊天</strong><button type="button" className="game-button" onClick={closeChat} aria-label="关闭聊天">×</button></div>
          <div ref={chatListRef} className="game-chat__messages" role="log" aria-label="聊天消息" onScroll={event => { const el = event.currentTarget; chatFollowRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
            {chatMessages.length === 0 && <p className="game-muted">打个招呼吧。消息仅在当前房间可见。</p>}
            {chatMessages.map((message, index) => <div className="game-chat__message" key={`${message.time}-${index}`}><div><strong>{message.sender}</strong><time>{message.time}</time></div><p>{message.text}</p></div>)}
          </div>
          {showEmojiPicker && <div className="game-chat__emoji">{QUICK_EMOJIS.map(emoji => <button type="button" key={emoji} aria-label={`添加表情 ${emoji}`} disabled={chatInput.length + emoji.length > CHAT_MAX_LENGTH} onClick={() => { setChatInput(previous => previous.length + emoji.length <= CHAT_MAX_LENGTH ? previous + emoji : previous); setShowEmojiPicker(false); chatInputRef.current?.focus(); }}>{emoji}</button>)}</div>}
          <form className="game-chat__form" onSubmit={handleChatSubmit}><button type="button" className="game-button" aria-label="选择表情" aria-expanded={showEmojiPicker} onClick={() => setShowEmojiPicker(previous => !previous)}>☺</button><input ref={chatInputRef} aria-label="聊天消息" placeholder="输入消息…" maxLength={CHAT_MAX_LENGTH} value={chatInput} onChange={event => { setChatInput(event.target.value); setChatError(''); }} /><button type="submit" className="game-button game-button--primary" disabled={!chatInput.trim() || chatInput.trim().length > CHAT_MAX_LENGTH}>发送</button></form>
          <div className="game-chat__limit"><span role="alert">{chatError}</span><span>{chatInput.length} / {CHAT_MAX_LENGTH}</span></div>
        </aside>}
      </div>

      <section className="game-handdock" aria-label="我的手牌与操作">
        <div className="game-turnbar"><div className={`game-turnbar__status${isMyTurn || amIPaying ? ' is-active' : ''}`} role="status"><span className="game-status-dot" /><strong>{turnText}</strong>{isMyTurn && <small>{target ? '跟牌' : '自由出牌'}</small>}</div><span className="game-muted game-me">{me?.name} · <strong>{handCards.length}</strong> 张</span></div>
        <div className="game-actionbar">
          <div className="game-selection" id={selectionId} role="status"><span className="game-selection__count">已选 <strong>{selectedCards.length}</strong> 张</span><span className={selectedCards.length > 0 && (amIPaying ? !validTribute : !selection.canPlay) ? 'game-warning' : 'game-muted'}>{selectionMessage}</span></div>
          <div className="game-actionbar__buttons">
            <button type="button" className="game-button" onClick={clearSelection} disabled={!selectedCards.length}>清空选择</button>
            {amIPaying ? <button type="button" className="game-button game-button--primary" aria-describedby={selectionId} onClick={handleTribute} disabled={!validTribute}>{gameState.phase === 'Tribute' ? '确认进贡' : '确认还贡'}</button> : <>
              <button type="button" className="game-button game-button--hint" onClick={handleHint} disabled={!isMyTurn}>提示</button>
              <button type="button" className="game-button game-button--primary" onClick={handlePlay} disabled={!isMyTurn || !selection.canPlay} aria-describedby={selectionId}>出牌{selectedCards.length > 0 ? ` (${selectedCards.length})` : ''}</button>
              <button type="button" className="game-button" onClick={() => { if (isMyTurn && target) onPass(); }} disabled={!isMyTurn || !target} title={isMyTurn && !target ? '自由出牌时不能过牌' : undefined}>过</button>
            </>}
          </div>
        </div>
        {feedback && <p className="game-feedback" role="status">{feedback}</p>}
        {gameState.gameMode === GameMode.Skill && !!gameState.mySkillCards?.length && <div className="game-skills"><span className="game-eyebrow">技能 / 用后仍可出牌</span><div>{gameState.mySkillCards.map(skill => <SkillCardButton key={skill.id} skill={skill} onClick={() => handleSkill(skill)} disabled={!isMyTurn || !onUseSkill} />)}</div></div>}
        {handCards.length > 0 ? <>
          <div className="game-handtools"><div className="game-segmented" role="group" aria-label="手牌视图">{([['arranged', '理牌'], ['rank', '点数'], ['stacked', '同花顺']] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>{label}</button>)}</div><span className="game-muted">{viewMode === 'arranged' ? '点组名选整组 · 左右滚动查看全部手牌' : viewMode === 'stacked' ? '同点数分列 · 金色标记同花顺' : '按点数排列 · 左右滚动查看全部手牌'}</span></div>
          <div className="game-handscroll" aria-label="手牌，可左右滚动" tabIndex={0}>
            {viewMode === 'arranged' ? <div className="game-handgroups">{groups.map(group => <div className="game-handgroup" key={group.id}><button className="game-group-label" type="button" aria-pressed={group.cards.every(card => selectedIds.has(card.id))} onClick={() => toggleGroup(group)} title="选中或取消整组">{group.label}</button><div className="game-cardfan">{group.cards.map(card => renderHandCard(card))}</div></div>)}</div> : viewMode === 'rank' ? <div className="game-rankhand game-cardfan">{visibleCards.map(card => renderHandCard(card))}</div> : <div className="game-stackedhand">{[Rank.BigJoker, Rank.SmallJoker, ...Array.from({ length: 13 }, (_, index) => Rank.Ace - index)].filter(rank => handCards.some(card => card.rank === rank)).map(rank => <div className="game-stackcolumn" key={rank}>{SUIT_ORDER.map(suit => <div className="game-stackslot" key={suit}>{handCards.filter(card => card.rank === rank && card.suit === suit).map(card => <div key={card.id} className={straightFlushIds.has(card.id) ? 'game-straight-card' : ''}>{renderHandCard(card, true)}</div>)}</div>)}</div>)}</div>}
          </div>
          <div className="game-handfooter"><span>Tab 切换卡牌 · 空格 / Enter 选牌</span>{chatBubbles[mySeat] && <span className="game-my-bubble">我：{chatBubbles[mySeat]}</span>}</div>
        </> : <div className="game-emptyhand">本局手牌已出完，继续为队友加油。</div>}
      </section>

      {gameState.phase === 'Score' && <section className="game-score-overlay" role="status" aria-label="本局结算"><div><span className="game-eyebrow">ROUND COMPLETE</span><h2>本局结束</h2><ol>{gameState.winners.map((seat, index) => <li key={seat}><span>{WINNER_LABELS[index]}</span><strong>{roomState.players.find(player => player?.seatIndex === seat)?.name || `座位 ${seat + 1}`}</strong></li>)}</ol>{gameState.teamLevels && <p>我方 打{formatLevelRank(gameState.teamLevels[myTeam])} · 对方 打{formatLevelRank(gameState.teamLevels[1 - myTeam])}</p>}<p className="game-muted">即将自动开始下一局…</p></div></section>}
      <GameDialog open={possibleHands.length > 0 && isMyTurn} labelId={handTitleId} onClose={() => setPossibleHands([])}><div className="game-dialog__header"><h2 id={handTitleId}>选择牌型</h2></div><div className="game-dialog__body game-targets">{possibleHands.map((hand, index) => <button type="button" className="game-button" key={index} onClick={() => { if (isMyTurn && selection.canPlay) onPlay(selectedCards, hand); setPossibleHands([]); }}>{getHandDescription(hand, level)}</button>)}</div><div className="game-dialog__footer"><button type="button" className="game-button" onClick={() => setPossibleHands([])}>取消</button></div></GameDialog>
      {pendingSkill && isMyTurn && <TargetSelectModal skillType={pendingSkill.type} players={roomState.players.filter((player): player is Player => player !== null).map(player => ({ ...player, handCount: countHand(gameState, player.seatIndex) }))} mySeat={mySeat} onSelect={seat => { if (isMyTurn && countHand(gameState, seat) > 0 && gameState.mySkillCards?.some(skill => skill.id === pendingSkill.id)) onUseSkill?.(pendingSkill.id, seat); setPendingSkill(null); }} onCancel={() => setPendingSkill(null)} />}
      <GameHistory history={gameState.history || []} currentRound={gameState.currentRound || 1} isOpen={showHistory && !interactionDisabled} onClose={() => setShowHistory(false)} />
    </div>
  );
};
