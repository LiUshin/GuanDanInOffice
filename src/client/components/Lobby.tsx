import React, { useState, useEffect, useRef } from 'react';
import { GameMode } from '../../shared/types';
import { ConnectionStatus, RoomInfo } from '../useGame';
import { browserStorage, NAME_KEY, readStorage, roomFromUrl } from '../session';

interface Props {
  onJoin: (name: string, roomId: string) => void;
  roomList: RoomInfo[];
  onFetchRoomList: () => void;
  connection: ConnectionStatus;
  joining: boolean;
  loading: boolean;
  loaded: boolean;
}

export const Lobby: React.FC<Props> = ({ onJoin, roomList, onFetchRoomList, connection, joining, loading, loaded }) => {
  const [name, setName] = useState(() => readStorage(browserStorage('localStorage'), NAME_KEY) || '');
  const [roomId, setRoomId] = useState(() => roomFromUrl(window.location.href) || '');
  const [search, setSearch] = useState('');
  const [validation, setValidation] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const connected = connection === 'connected';
  useEffect(() => {
    if (!connected) return;
    onFetchRoomList();
    const interval = setInterval(onFetchRoomList, 5000);
    return () => clearInterval(interval);
  }, [connected, onFetchRoomList]);

  const join = (target: string) => {
    if (!name.trim()) {
      setValidation('先取个昵称，让同事认出你。');
      nameInput.current?.focus();
      return;
    }
    setValidation('');
    onJoin(name, target);
  };
  const shownRooms = roomList.filter(room => `${room.id} ${room.hostName}`.toLowerCase().includes(search.trim().toLowerCase()));
  const available = roomList.filter(room => !room.inGame && room.playerCount < room.maxPlayers).length;

  return (
    <main className="lobby-shell">
      <header className="brand-header">
        <a className="brand" href={window.location.pathname} aria-label="GuanDan In Office 大厅">
          <span className="brand-mark" aria-hidden="true">♠</span>
          <span>GuanDan<span className="brand-muted"> / In Office</span></span>
        </a>
        <span className={`connection-pill ${connected ? 'is-online' : ''}`} role="status"><i />{connected ? '局域网已连接' : '正在连接服务器'}</span>
      </header>
      <div className="lobby-intro">
        <div className="eyebrow">BREAK TIME, PLAY TIME</div>
        <h1>工作暂停，<br /><span>好牌开场。</span></h1>
        <p>和同事搭个档，来一局掼蛋。<br className="mobile-break" />同一网络，随时开桌。</p>
        <div className="intro-tags"><span>2 v 2 搭档</span><span>AI 自动补位</span><span>断线自动重连</span></div>
        <div className="decorative-hand" aria-hidden="true"><div>J<span>♣</span></div><div>Q<span>♦</span></div><div>K<span>♠</span></div><div>A<span>♥</span></div></div>
      </div>
      <div className="lobby-grid">
        <section className="panel join-panel" aria-labelledby="join-heading">
          <div className="panel-eyebrow"><span className="tiny-dot" /> PLAY.LOCAL</div>
          <h2 id="join-heading">就差你了</h2>
          <p className="muted">输入房间号加入好友，也可以开一桌新的。</p>
          <form onSubmit={event => { event.preventDefault(); join(roomId.trim() || `office-${Math.random().toString(36).slice(2, 7)}`); }}>
            <label htmlFor="player-name">你的昵称 <span>最多 10 个字</span></label>
            <input id="player-name" ref={nameInput} value={name} maxLength={10} placeholder="同事怎么称呼你？" autoComplete="nickname" aria-invalid={!!validation} aria-describedby={validation ? 'name-error' : undefined} onChange={event => { setName(event.target.value); setValidation(''); }} />
            {validation && <p className="field-error" id="name-error" role="alert">{validation}</p>}
            <label htmlFor="room-id">房间号 <span>选填</span></label>
            <input id="room-id" value={roomId} maxLength={40} placeholder="留空，创建专属房间" autoComplete="off" onChange={event => setRoomId(event.target.value)} />
            <button type="submit" className="button button-primary join-button" disabled={!connected || joining}>{joining ? '正在进入…' : roomId.trim() ? '进入房间' : '创建房间'}<span aria-hidden="true">↗</span></button>
            <p className="form-note">一个人也能开局，空位会由 AI 补齐。</p>
          </form>
        </section>
        <section className="panel rooms-panel" aria-labelledby="rooms-heading">
          <div className="section-heading"><div><h2 id="rooms-heading">找个牌搭子 <span className="count-badge">{roomList.length}</span></h2><p className="muted">{connected ? `${available} 桌可加入 · 每 5 秒自动刷新` : '连接恢复后会自动刷新房间'}</p></div><button type="button" className="button button-quiet refresh-button" onClick={onFetchRoomList} disabled={!connected || loading} aria-label="刷新房间列表">{loading ? '刷新中' : '↻ 刷新'}</button></div>
          <label htmlFor="room-search" className="sr-only">搜索房间号或房主</label>
          <input id="room-search" className="room-search" placeholder="搜索房间号或房主…" value={search} onChange={event => setSearch(event.target.value)} />
          <div className="room-list" aria-busy={loading}>
            {!loaded && connected ? <div className="empty-state"><span className="empty-symbol">···</span><h3>正在寻找房间</h3><p>稍等一下，牌搭子马上到。</p></div> : !connected ? <div className="empty-state"><span className="empty-symbol">⌁</span><h3>还没连上服务器</h3><p>请确认游戏服务已启动，并连接同一网络。</p></div> : shownRooms.length === 0 ? <div className="empty-state"><span className="empty-symbol">♧</span><h3>{search ? '没有找到这张桌' : '第一桌，等你来开'}</h3><p>{search ? '试试其他房间号，或清空搜索。' : '创建一个房间，把链接发给同事吧。'}</p>{search && <button className="text-button" type="button" onClick={() => setSearch('')}>清空搜索</button>}</div> : shownRooms.map(room => {
              const unavailable = room.inGame || room.playerCount >= room.maxPlayers;
              return <article className="room-card" key={room.id}><span className={`room-icon ${room.gameMode === GameMode.Skill ? 'skill' : ''}`} aria-hidden="true">{room.gameMode === GameMode.Skill ? '✧' : '♠'}</span><div className="room-detail"><h3>{room.id}</h3><p>{room.hostName} 的房间 · {room.gameMode === GameMode.Skill ? '技能模式' : '经典掼蛋'}</p><div className="room-meta"><span className={unavailable ? 'muted' : 'text-teal'}>{room.inGame ? '对局中' : unavailable ? '已满员' : '等待开局'}</span><span>{room.playerCount} / {room.maxPlayers} 人</span></div></div><button className="button button-secondary" type="button" disabled={!connected || joining || unavailable} onClick={() => join(room.id)}>{room.inGame ? '对局中' : unavailable ? '已满' : '加入'}</button></article>;
            })}
          </div>
          <p className="room-list-note">中途离开的玩家，可在左侧填写原昵称和房间号重新入座。</p>
        </section>
      </div>
      <footer className="lobby-footer"><span>GuanDan In Office <span className="footer-dot">·</span> 一起打好每一手</span><span>老板来了？按 <kbd>I</kbd> 切换摸鱼界面</span></footer>
    </main>
  );
};
