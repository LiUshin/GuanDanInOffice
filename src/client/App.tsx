import React, { useState, useEffect } from 'react';
import { useGame } from './useGame';
import { Lobby } from './components/Lobby';
import { GameTable } from './components/GameTable';
import { FakeIDE } from './components/FakeIDE';

function App() {
  const { 
    inRoom, 
    roomState, 
    gameState, 
    mySeat, 
    error,
    chatMessages,
    roomList,
    actions 
  } = useGame();
  
  const [showFakeIDE, setShowFakeIDE] = useState(false);

  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          // Toggle on 'i' key, but avoid input fields
          if (e.key.toLowerCase() === 'i') {
              const target = e.target as HTMLElement;
              if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
              setShowFakeIDE(prev => !prev);
          }
      };
      
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="bg-[#1e1e1e] min-h-screen text-gray-300">
      {showFakeIDE && <FakeIDE />}
      
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-2 rounded-full shadow-lg z-50 font-bold animate-pulse">
          {error}
        </div>
      )}

      {!inRoom ? (
        <Lobby onJoin={actions.joinRoom} roomList={roomList} onFetchRoomList={actions.fetchRoomList} />
      ) : (
          roomState && (
            <GameTable 
              gameState={gameState} 
              roomState={roomState}
              mySeat={mySeat}
              onPlay={actions.playHand}
              onPass={actions.passTurn}
              onReady={actions.setReady}
              onStart={actions.startGame}
              onTribute={actions.payTribute}
              onReturnTribute={actions.returnTribute}
              chatMessages={chatMessages}
              onSendChat={actions.sendChat}
              onSwitchSeat={actions.switchSeat}
              onSetGameMode={actions.setGameMode}
              onUseSkill={actions.useSkill}
              onForceEndGame={actions.forceEndGame}
            />
        )
      )}
    </div>
  );
}

export default App;
