import React, { useState, useEffect, useRef } from 'react';
import { HistoryEntry, HistoryEventType } from '../../shared/types';

interface GameHistoryProps {
  history: HistoryEntry[];
  currentRound: number;
  isOpen: boolean;
  onClose: () => void;
}

export const GameHistory: React.FC<GameHistoryProps> = ({ history, currentRound, isOpen, onClose }) => {
  const [filter, setFilter] = useState<HistoryEventType | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const historyEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && historyEndRef.current) {
      historyEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [history, autoScroll]);

  if (!isOpen) return null;

  // Filter history entries
  const filteredHistory = history.filter(entry => {
    const matchesFilter = filter === 'all' || entry.type === filter;
    const matchesSearch = searchTerm === '' || 
      entry.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (entry.playerName && entry.playerName.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  // Get event type display name and color
  const getEventTypeInfo = (type: HistoryEventType) => {
    const info = {
      [HistoryEventType.GameStart]: { name: '游戏开始', color: 'text-green-400', bgColor: 'bg-green-900/30' },
      [HistoryEventType.PhaseChange]: { name: '阶段变化', color: 'text-blue-400', bgColor: 'bg-blue-900/30' },
      [HistoryEventType.Play]: { name: '出牌', color: 'text-yellow-400', bgColor: 'bg-yellow-900/30' },
      [HistoryEventType.Pass]: { name: '过牌', color: 'text-gray-400', bgColor: 'bg-gray-900/30' },
      [HistoryEventType.Tribute]: { name: '进贡', color: 'text-purple-400', bgColor: 'bg-purple-900/30' },
      [HistoryEventType.ReturnTribute]: { name: '还贡', color: 'text-pink-400', bgColor: 'bg-pink-900/30' },
      [HistoryEventType.SkillUse]: { name: '技能', color: 'text-cyan-400', bgColor: 'bg-cyan-900/30' },
      [HistoryEventType.RoundEnd]: { name: '回合结束', color: 'text-orange-400', bgColor: 'bg-orange-900/30' },
      [HistoryEventType.PlayerFinish]: { name: '出完', color: 'text-red-400', bgColor: 'bg-red-900/30' },
      [HistoryEventType.GameEnd]: { name: '游戏结束', color: 'text-red-500', bgColor: 'bg-red-900/50' },
      [HistoryEventType.LevelUp]: { name: '升级', color: 'text-green-500', bgColor: 'bg-green-900/50' }
    };
    return info[type] || { name: type, color: 'text-gray-400', bgColor: 'bg-gray-900/30' };
  };

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Handle scroll to detect if user scrolled up
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    const isAtBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
    setAutoScroll(isAtBottom);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg shadow-2xl w-11/12 max-w-4xl h-5/6 flex flex-col border-2 border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">游戏历史记录</h2>
            <p className="text-sm text-gray-400">第 {currentRound} 局 · 共 {filteredHistory.length} 条记录</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-3xl leading-none px-3 py-1"
          >
            ×
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-700 space-y-3">
          {/* Search */}
          <input
            type="text"
            placeholder="搜索玩家名或事件..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
          />

          {/* Event type filter */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                filter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              全部
            </button>
            {Object.values(HistoryEventType).map((type) => {
              const info = getEventTypeInfo(type);
              return (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                    filter === type
                      ? `${info.bgColor} ${info.color} border border-current`
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {info.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* History list */}
        <div 
          className="flex-1 overflow-y-auto p-4 space-y-2"
          onScroll={handleScroll}
        >
          {filteredHistory.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {searchTerm || filter !== 'all' ? '没有匹配的记录' : '暂无历史记录'}
            </div>
          ) : (
            filteredHistory.map((entry) => {
              const info = getEventTypeInfo(entry.type);
              return (
                <div
                  key={entry.id}
                  className={`${info.bgColor} rounded-lg p-3 border border-gray-700/50 hover:border-gray-600 transition`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-bold ${info.color} px-2 py-0.5 rounded`}>
                          {info.name}
                        </span>
                        {entry.playerName && (
                          <span className="text-xs text-gray-400">
                            {entry.playerName}
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          {formatTime(entry.timestamp)}
                        </span>
                      </div>
                      <p className="text-white text-sm leading-relaxed">
                        {entry.message}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={historyEndRef} />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            自动滚动到最新
          </label>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
