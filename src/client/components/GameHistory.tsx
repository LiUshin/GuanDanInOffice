import React, { useState, useEffect, useRef, useId } from 'react';
import { HistoryEntry, HistoryEventType } from '../../shared/types';
import { GameDialog } from './gameDialog';

interface GameHistoryProps { history: HistoryEntry[]; currentRound: number; isOpen: boolean; onClose: () => void; }
const EVENT_NAMES: Record<HistoryEventType, string> = {
  [HistoryEventType.GameStart]: '游戏开始', [HistoryEventType.PhaseChange]: '阶段变化',
  [HistoryEventType.Play]: '出牌', [HistoryEventType.Pass]: '过牌',
  [HistoryEventType.Tribute]: '进贡', [HistoryEventType.ReturnTribute]: '还贡',
  [HistoryEventType.SkillUse]: '技能', [HistoryEventType.RoundEnd]: '回合结束',
  [HistoryEventType.PlayerFinish]: '出完', [HistoryEventType.GameEnd]: '游戏结束', [HistoryEventType.LevelUp]: '升级',
};

export const GameHistory: React.FC<GameHistoryProps> = ({ history, currentRound, isOpen, onClose }) => {
  const [filter, setFilter] = useState<HistoryEventType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const term = search.trim().toLowerCase();
  const filtered = history.filter(entry => (filter === 'all' || entry.type === filter) && (!term || entry.message.toLowerCase().includes(term) || entry.playerName?.toLowerCase().includes(term)));

  useEffect(() => {
    if (isOpen && autoScroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [history, autoScroll, isOpen, filter, search]);

  return (
    <GameDialog open={isOpen} labelId={titleId} onClose={onClose} className="game-history">
      <div className="game-dialog__header"><div><span className="game-eyebrow">MATCH LOG</span><h2 id={titleId}>游戏历史记录</h2><p className="game-muted">第 {currentRound} 局 · {filtered.length} 条记录</p></div><button type="button" className="game-button" onClick={onClose} aria-label="关闭历史记录">×</button></div>
      <div className="game-history__filters"><label><span>搜索记录</span><input type="search" placeholder="玩家名或事件…" value={search} onChange={event => setSearch(event.target.value)} /></label><label><span>事件类型</span><select value={filter} onChange={event => setFilter(event.target.value as HistoryEventType | 'all')}><option value="all">全部事件</option>{Object.values(HistoryEventType).map(type => <option key={type} value={type}>{EVENT_NAMES[type]}</option>)}</select></label></div>
      <div className="game-history__list" ref={listRef} tabIndex={0} aria-label="历史记录列表" onScroll={event => { const list = event.currentTarget; setAutoScroll(list.scrollHeight - list.scrollTop <= list.clientHeight + 40); }}>
        {filtered.length === 0 ? <div className="game-history__empty"><p>{search || filter !== 'all' ? '没有匹配的记录' : '暂无历史记录'}</p>{(search || filter !== 'all') && <button type="button" className="game-button" onClick={() => { setSearch(''); setFilter('all'); }}>清除筛选</button>}</div> : filtered.map(entry => <article key={entry.id} className={`game-history__entry${entry.type === HistoryEventType.SkillUse ? ' is-skill' : ''}`}><div><span className="game-badge">{EVENT_NAMES[entry.type] || entry.type}</span>{entry.playerName && <strong>{entry.playerName}</strong>}<time>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div><p>{entry.message}</p></article>)}
      </div>
      <div className="game-dialog__footer"><label className="game-history__follow"><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} /> 跟随最新记录</label><button type="button" className="game-button game-button--primary" onClick={onClose}>返回牌桌</button></div>
    </GameDialog>
  );
};
