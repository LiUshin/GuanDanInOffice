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
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#1e1e1e] text-gray-300">
      <h1 className="text-5xl font-bold mb-8 text-[#519aba] font-mono">VS Code - GuanDan</h1>
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
      </form>
    </div>
  );
};
