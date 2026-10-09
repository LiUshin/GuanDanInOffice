import React, { useState, useEffect } from 'react';
import { useGame } from './useGame';
import { Lobby } from './components/Lobby';
import { GameTable } from './components/GameTable';
import { WaitingRoom } from './components/WaitingRoom';
import { FakeIDE } from './components/FakeIDE';

function App() {
  const { inRoom, roomState, gameState, mySeat, error, notice, matchResult, chatMessages, roomList, roomListLoaded, roomListLoading, connection, joining, actions } = useGame();
  const [showFakeIDE, setShowFakeIDE] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key.toLowerCase() !== 'i' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || target.closest('input, textarea, select, [contenteditable="true"]')) return;
      setShowFakeIDE(value => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const interrupted = inRoom && (connection !== 'connected' || joining);
  return <div className="app-shell">
    {showFakeIDE && <FakeIDE />}
    {!showFakeIDE && <div className="app-toast-stack" aria-live="polite">
      {notice && <div className="app-toast" role="status">{notice}</div>}
      {error && <div className="app-toast app-toast-error" role="alert">{error}<button aria-label="关闭错误提示" onClick={actions.dismissError}>×</button></div>}
      {matchResult && !gameState && <div className="app-toast app-toast-result" role="status">{matchResult}<button onClick={actions.dismissMatchResult}>知道了</button></div>}
    </div>}
    <div inert={interrupted || showFakeIDE}>
      {!inRoom ? <Lobby onJoin={actions.joinRoom} roomList={roomList} onFetchRoomList={actions.fetchRoomList} connection={connection} joining={joining} loading={roomListLoading} loaded={roomListLoaded} /> : roomState && (gameState ? <GameTable interactionDisabled={interrupted || showFakeIDE} gameState={gameState} roomState={roomState} mySeat={mySeat} onPlay={actions.playHand} onPass={actions.passTurn} onReady={actions.setReady} onStart={actions.startGame} onTribute={actions.payTribute} onReturnTribute={actions.returnTribute} chatMessages={chatMessages} onSendChat={actions.sendChat} onSwitchSeat={actions.switchSeat} onSetGameMode={actions.setGameMode} onUseSkill={actions.useSkill} onForceEndGame={actions.forceEndGame} onLeave={actions.leaveRoom} /> : <WaitingRoom room={roomState} mySeat={mySeat} onReady={actions.setReady} onStart={actions.startGame} onLeave={actions.leaveRoom} onSwitchSeat={actions.switchSeat} onSetGameMode={actions.setGameMode} messages={chatMessages} onSendChat={actions.sendChat} />)}
    </div>
    {interrupted && !showFakeIDE && <div className="connection-overlay"><section className="connection-dialog" role="status" aria-live="polite"><span aria-hidden="true">⌁</span><h2>{joining ? '正在回到牌桌' : '连接暂时中断'}</h2><p>正在自动重连。对局中的座位会由 AI 暂时代打，连接恢复后交还给你。</p><button className="button button-secondary" onClick={actions.retryConnection}>立即重试连接</button></section></div>}
  </div>;
}
export default App;
