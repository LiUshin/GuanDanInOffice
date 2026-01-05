import React, { useState } from 'react';

interface Props {
  onJoin: (name: string, roomId: string) => void;
}

export const Lobby: React.FC<Props> = ({ onJoin }) => {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('default');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onJoin(name, roomId);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-green-800 text-white">
      <h1 className="text-5xl font-bold mb-8">局域网掼蛋</h1>
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-xl text-black flex flex-col gap-4 w-80">
        <div>
          <label className="block text-sm font-bold mb-2">昵称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full border p-2 rounded"
            placeholder="请输入名字"
            maxLength={10}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-bold mb-2">房间号</label>
          <input
            type="text"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
            className="w-full border p-2 rounded"
            placeholder="默认: default"
          />
        </div>
        <button 
          type="submit" 
          className="bg-green-600 text-white py-2 rounded hover:bg-green-700 font-bold"
        >
          加入游戏
        </button>
      </form>
    </div>
  );
};
