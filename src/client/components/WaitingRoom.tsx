import React, { useEffect, useRef, useState } from 'react';
import { GameMode } from '../../shared/types';
import { RoomState } from '../useGame';
import { roomInviteUrl } from '../session';

interface Props {
  room: RoomState;
  mySeat: number;
  onReady: () => void;
  onStart: () => void;
  onLeave: () => void;
  onSwitchSeat: (seat: number) => void;
  onSetGameMode: (mode: GameMode) => void;
  messages: { sender: string; text: string; time: string; seatIndex: number }[];
  onSendChat: (text: string) => void;
}

export function WaitingRoom({ room, mySeat, onReady, onStart, onLeave, onSwitchSeat, onSetGameMode, messages, onSendChat }: Props) {
  const me = room.players[mySeat];
  const [chat, setChat] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const chatList = useRef<HTMLDivElement>(null);
  const invite = roomInviteUrl(window.location.href, room.roomId);
  const seats = [0, 2, 1, 3];
  const count = room.players.filter(Boolean).length;
  useEffect(() => { const list = chatList.current; if (list) list.scrollTop = list.scrollHeight; }, [messages]);
  const copyInvite = async () => {
    setShowInvite(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(invite);
      setCopyStatus('邀请链接已复制');
    } catch { setCopyStatus('请选中下方链接复制'); }
  };
  return <main className="waiting-shell">
    <header className="brand-header"><div className="brand"><span className="brand-mark" aria-hidden="true">♠</span><span>GuanDan<span className="brand-muted"> / In Office</span></span></div><button className="button button-quiet" onClick={onLeave}>← 返回大厅</button></header>
    <div className="waiting-title"><div><div className="eyebrow">ROOM / {room.roomId}</div><h1>人齐，牌就齐了。</h1><p className="muted">对座是搭档。点击空位换座，挑个好搭档吧。</p></div><button className="button button-secondary" onClick={copyInvite}>↗ 邀请同事</button></div>
    {showInvite && <section className="invite-panel"><label htmlFor="invite-link">房间邀请链接</label><input id="invite-link" readOnly value={invite} onFocus={event => event.target.select()} /><span role="status">{copyStatus}</span><p>同事需要能访问此地址；如果是 localhost，请换成房主的局域网 IP。</p></section>}
    <div className="waiting-grid">
      <section className="panel seating-panel" aria-labelledby="seating-heading"><div className="section-heading"><h2 id="seating-heading">牌桌成员</h2><span className="muted">{count} / 4 人</span></div><div className="seat-grid">{seats.map(seat => {
        const player = room.players[seat];
        const teammate = seat % 2 === mySeat % 2;
        return <div className={`seat-card ${teammate ? 'team-mine' : 'team-other'} ${seat === mySeat ? 'seat-self' : ''}`} key={seat}>
          <div className="seat-label"><span>{teammate ? '我方' : '对方'} · 座位 {seat + 1}</span>{player?.isHost && <span className="host-badge">房主</span>}</div>
          {player ? <><div className="seat-avatar">{player.name.slice(0, 1)}</div><h3>{player.name}{seat === mySeat && <span>（我）</span>}</h3><p className={player.isReady ? 'text-teal' : 'muted'}>{player.isDisconnected ? '暂时离线' : player.isReady ? '✓ 已准备' : '等你准备'}</p></> : <button className="empty-seat" onClick={() => onSwitchSeat(seat)} aria-label={`换到座位 ${seat + 1}`}><span>＋</span><strong>空位，点击入座</strong><small>开局时 AI 自动补位</small></button>}
        </div>;
      })}</div><div className="ready-bar"><div><strong>{me?.isReady ? '已准备，等大家入座' : '准备好接下一手了吗？'}</strong><p>四人全部准备后自动开局。</p></div><button className={`button ${me?.isReady ? 'button-secondary' : 'button-primary'}`} onClick={onReady}>{me?.isReady ? '取消准备' : '准备好了'}</button></div></section>
      <aside className="waiting-sidebar"><section className="panel mode-panel"><div className="section-heading"><h2>这局怎么玩</h2><span className="muted">{me?.isHost ? '房主设置' : '由房主设置'}</span></div><div className="mode-options">{[[GameMode.Normal, '♠', '经典掼蛋', '纯粹的 2v2，从 2 打到 A。'], [GameMode.Skill, '✧', '技能掼蛋', '每人 2 张技能卡，多点惊喜。']].map(([mode, icon, title, description]) => <button type="button" key={mode} className={`mode-option ${room.gameMode === mode || (!room.gameMode && mode === GameMode.Normal) ? 'is-selected' : ''}`} disabled={!me?.isHost} aria-pressed={room.gameMode === mode || (!room.gameMode && mode === GameMode.Normal)} onClick={() => onSetGameMode(mode as GameMode)}><span aria-hidden="true">{icon}</span><span><strong>{title}</strong><small>{description}</small></span></button>)}</div>{me?.isHost ? <><button className="button button-primary start-button" onClick={onStart}>开始游戏 <span>→</span></button><p className="form-note">{count < 4 ? `缺 ${4 - count} 位？没关系，AI 自动补齐。` : '将直接开局，无需等待所有人准备。'}</p></> : <p className="form-note">准备后等待房主开局，或等四人全部准备。</p>}</section>
      <section className="panel waiting-chat"><h2>桌边聊两句</h2><div className="waiting-messages" ref={chatList} role="log" aria-label="房间聊天">{messages.length === 0 ? <p className="muted chat-empty">发个招呼，等大家坐好。</p> : messages.map((message, index) => <p key={`${message.time}-${index}`}><span>{message.sender}</span><small>{message.time}</small><br />{message.text}</p>)}</div><form onSubmit={event => { event.preventDefault(); if (chat.trim()) { onSendChat(chat.trim()); setChat(''); } }}><label htmlFor="waiting-chat-input" className="sr-only">聊天消息</label><input id="waiting-chat-input" placeholder="打个招呼…" maxLength={200} value={chat} onChange={event => setChat(event.target.value)} /><button className="button button-secondary" disabled={!chat.trim()}>发送</button></form></section></aside>
    </div><footer className="lobby-footer"><span>房间 {room.roomId}</span><span>随时按 <kbd>I</kbd> 切换摸鱼界面</span></footer>
  </main>;
}
