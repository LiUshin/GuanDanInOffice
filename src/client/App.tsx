import React, { useState, useEffect } from 'react';
import { useGame } from './useGame';
import { Lobby } from './components/Lobby';
import { GameTable } from './components/GameTable';

function App() {
  const { 
    inRoom, 
    roomState, 
    gameState, 
    mySeat, 
    error,
    chatMessages,
    actions 
  } = useGame();

  return (
    <div>
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-2 rounded-full shadow-lg z-50 font-bold animate-pulse">
          {error}
        </div>
      )}

      {!inRoom ? (
        <Lobby onJoin={actions.joinRoom} />
      ) : (
          roomState && (
            <GameTable 
              gameState={gameState!} 
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
            />
        )
      )}
    </div>
  );
}

export default App;
