import React, { useState, useEffect } from 'react';
import { GameMode } from '../../shared/types';

interface RoomInfo {
  id: string;
  playerCount: number;
  maxPlayers: number;
  inGame: boolean;
  gameMode: GameMode;
  hostName: string;
}

interface Props {
  onJoin: (name: string, roomId: string) => void;
  roomList: RoomInfo[];
  onFetchRoomList: () => void;
}

export const Lobby: React.FC<Props> = ({ onJoin, roomList, onFetchRoomList }) => {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('default');
  const [showRoomList, setShowRoomList] = useState(false);

  // Fetch room list on mount and periodically
  useEffect(() => {
    if (showRoomList) {
      onFetchRoomList();
      const interval = setInterval(onFetchRoomList, 3000); // Refresh every 3s
      return () => clearInterval(interval);
    }
  }, [showRoomList, onFetchRoomList]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onJoin(name, roomId);
    }
  };

  const handleQuickJoin = (targetRoomId: string) => {
    if (name.trim()) {
      onJoin(name, targetRoomId);
    } else {
      alert('请先输入用户名');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#1e1e1e] text-gray-300 p-4">
      <h1 className="text-5xl font-bold mb-8 text-[#519aba] font-mono">VS Code - GuanDan</h1>
      
      <div className="flex gap-6 items-start">
        {/* Join Form */}
        <form onSubmit={handleSubmit} className="bg-[#252526] p-8 rounded-lg shadow-xl border border-[#333333] text-gray-300 flex flex-col gap-4 w-80">
          <div>
            <label className="block text-sm font-bold mb-2 text-[#9cdcfe]">Username</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-[#3c3c3c] border border-[#3c3c3c] p-2 rounded text-white focus:outline-none focus:border-[#007acc]"
              placeholder="Enter name..."
              maxLength={10}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold mb-2 text-[#9cdcfe]">Room ID</label>
            <input
              type="text"
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              className="w-full bg-[#3c3c3c] border border-[#3c3c3c] p-2 rounded text-white focus:outline-none focus:border-[#007acc]"
              placeholder="Default: default"
            />
          </div>
          <button 
            type="submit" 
            className="bg-[#0e639c] text-white py-2 rounded hover:bg-[#1177bb] font-bold mt-2"
          >
            Connect
          </button>
          
          <button
            type="button"
            onClick={() => setShowRoomList(!showRoomList)}
            className="bg-[#3c3c3c] text-gray-300 py-2 rounded hover:bg-[#4a4a4a] font-bold border border-[#555555]"
          >
            {showRoomList ? '隐藏房间列表' : '查看房间列表'}
          </button>
        </form>

        {/* Room List */}
        {showRoomList && (
          <div className="bg-[#252526] p-6 rounded-lg shadow-xl border border-[#333333] w-96 max-h-96 overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 text-[#569cd6]">活跃房间</h2>
            {roomList.length === 0 ? (
              <div className="text-gray-500 text-center py-8">暂无活跃房间</div>
            ) : (
              <div className="flex flex-col gap-2">
                {roomList.map(room => (
                  <div 
                    key={room.id}
                    className="bg-[#1e1e1e] p-4 rounded border border-[#3c3c3c] hover:border-[#007acc] transition-colors cursor-pointer"
                    onClick={() => handleQuickJoin(room.id)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-bold text-[#9cdcfe]">房间: {room.id}</div>
                      <div className={`text-xs px-2 py-1 rounded ${room.inGame ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
                        {room.inGame ? '游戏中' : '等待中'}
                      </div>
                    </div>
                    <div className="text-sm text-gray-400 flex justify-between">
                      <span>房主: {room.hostName}</span>
                      <span>{room.playerCount}/{room.maxPlayers} 人</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      模式: {room.gameMode === GameMode.Normal ? '普通' : '技能'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
