import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { socket as defaultSocket } from './socket';
import type { Socket } from 'socket.io-client';
import { Card, GameMode, SkillCard, Hand, HistoryEntry } from '../shared/types';
import { formatLevelRank } from '../shared/rules';
import { browserStorage, NAME_KEY, parseSession, readStorage, roomFromUrl, RoomSession, SESSION_KEY, writeStorage } from './session';

export interface GameState {
  phase: string;
  level: number;
  currentTurn: number;
  hands: (Card[] | number)[]; 
  lastHand: { playerIndex: number, hand: any } | null;
  roundActions?: { [seat: number]: { type: 'play' | 'pass', cards?: Card[], hand?: any } };
  winners: number[];
  tributeState?: {
      pendingTributes: { from: number, to: number, card?: any }[];
      pendingReturns: { from: number, to: number, card?: any }[];
  };
  teamLevels?: { [key: number]: number };
  activeTeam?: number;
  // Skill mode fields
  gameMode?: GameMode;
  mySkillCards?: SkillCard[];
  skipNextTurn?: boolean[];
  // New cards to highlight
  newCardIds?: string[];
  // Game history
  history?: HistoryEntry[];
  currentRound?: number;
}

export interface RoomState {
  roomId: string;
  players: ({ id?: string, name: string, seatIndex: number, isReady: boolean, isHost?: boolean, isBot?: boolean, isDisconnected?: boolean } | null)[];
  gameMode?: GameMode;
}

export interface RoomInfo {
  id: string;
  playerCount: number;
  maxPlayers: number;
  inGame: boolean;
  gameMode: GameMode;
  hostName: string;
}
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export function useGame(socket: Socket = defaultSocket) {
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [mySeat, setMySeat] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>(socket.connected ? 'connected' : 'connecting');
  const [joining, setJoining] = useState(false);
  const [roomListLoading, setRoomListLoading] = useState(false);
  const [roomListLoaded, setRoomListLoaded] = useState(false);
  const [chatMessages, setChatMessages] = useState<{sender: string, text: string, time: string, seatIndex: number}[]>([]);
  const [roomList, setRoomList] = useState<RoomInfo[]>([]);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const joinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentRoom = useRef<string | null>(null);
  const activeSession = useRef<RoomSession | null>(null);
  const pendingJoin = useRef<RoomSession | null>(null);
  const listPending = useRef(false);

  const showError = useCallback((message: string) => {
    setError(message);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 6000);
  }, []);

  const resetRoom = useCallback(() => {
    setInRoom(false);
    setRoomState(null);
    setGameState(null);
    setMySeat(-1);
    setChatMessages([]);
    setMatchResult(null);
    currentRoom.current = null;
  }, []);

  const armJoinTimeout = useCallback(() => {
    clearTimeout(joinTimer.current);
    joinTimer.current = setTimeout(() => {
      pendingJoin.current = null;
      setJoining(false);
      resetRoom();
      showError('进入房间超时，请检查连接后重试。');
    }, 8000);
  }, [resetRoom, showError]);

  const sendJoin = useCallback((session: RoomSession) => {
    if (!socket.connected || pendingJoin.current) return;
    pendingJoin.current = session;
    setJoining(true);
    setError(null);
    armJoinTimeout();
    socket.emit('joinRoom', session);
  }, [armJoinTimeout, socket]);

  useEffect(() => {
    const saved = parseSession(readStorage(browserStorage('sessionStorage'), SESSION_KEY));
    const invitedRoom = roomFromUrl(window.location.href);
    activeSession.current = saved && (!invitedRoom || invitedRoom === saved.roomId) ? saved : null;
    const onConnect = () => {
      setConnection('connected');
      setGameState(null);
      if (activeSession.current) sendJoin(activeSession.current);
    };
    const onDisconnect = () => {
      setConnection('reconnecting');
      pendingJoin.current = null;
      setJoining(false);
      clearTimeout(joinTimer.current);
      listPending.current = false;
      setRoomListLoading(false);
      clearTimeout(listTimer.current);
    };
    const onRoomState = (state: RoomState) => {
      const me = state.players.find(player => player?.id === socket.id);
      if (!me) return;
      if (currentRoom.current !== state.roomId) {
        setGameState(null);
        setChatMessages([]);
        setMatchResult(null);
      }
      currentRoom.current = state.roomId;
      const url = new URL(window.location.href);
      url.searchParams.set('room', state.roomId);
      window.history.replaceState(null, '', url);
      activeSession.current = { playerName: me.name, roomId: state.roomId };
      writeStorage(browserStorage('sessionStorage'), SESSION_KEY, JSON.stringify(activeSession.current));
      writeStorage(browserStorage('localStorage'), NAME_KEY, me.name);
      pendingJoin.current = null;
      clearTimeout(joinTimer.current);
      setJoining(false);
      setError(null);
      setRoomState(state);
      setMySeat(me.seatIndex);
      setInRoom(true);
    };
    const onError = (message: string) => {
      if (pendingJoin.current) {
        pendingJoin.current = null;
        activeSession.current = null;
        writeStorage(browserStorage('sessionStorage'), SESSION_KEY, null);
        clearTimeout(joinTimer.current);
        setJoining(false);
        resetRoom();
      }
      showError(message);
    };
    const onNotice = (message: string) => {
      setNotice(message);
      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 4000);
    };
    const onGameState = (state: GameState) => {
      if (currentRoom.current) setGameState(state);
    };
    const onChat = (message: typeof chatMessages[number]) => {
      if (currentRoom.current) setChatMessages(previous => [...previous.slice(-99), message]);
    };
    const onMatchOver = (data: { winningTeam: number; finalLevels: { [key: number]: number } }) => {
      if (!currentRoom.current) return;
      setMatchResult(`对局结束，座位 ${data.winningTeam + 1} 和 ${data.winningTeam + 3} 获胜。打${formatLevelRank(data.finalLevels[0])} 对 打${formatLevelRank(data.finalLevels[1])}`);
      setGameState(null);
    };
    const onTerminated = () => setGameState(null);
    const onLeft = () => {
      activeSession.current = null;
      pendingJoin.current = null;
      writeStorage(browserStorage('sessionStorage'), SESSION_KEY, null);
      clearTimeout(joinTimer.current);
      setJoining(false);
      resetRoom();
    };
    const onRoomList = (list: RoomInfo[]) => {
      setRoomList(list);
      setRoomListLoaded(true);
      setRoomListLoading(false);
      listPending.current = false;
      clearTimeout(listTimer.current);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    socket.on('roomState', onRoomState);
    socket.on('gameState', onGameState);
    socket.on('chatMessage', onChat);
    socket.on('error', onError);
    socket.on('notice', onNotice);
    socket.on('matchOver', onMatchOver);
    socket.on('gameTerminated', onTerminated);
    socket.on('leftRoom', onLeft);
    socket.on('roomList', onRoomList);
    // StrictMode/HMR may restart effects while the original join is still pending.
    if (pendingJoin.current) armJoinTimeout();
    else if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
      socket.off('roomState', onRoomState);
      socket.off('gameState', onGameState);
      socket.off('chatMessage', onChat);
      socket.off('error', onError);
      socket.off('notice', onNotice);
      socket.off('matchOver', onMatchOver);
      socket.off('gameTerminated', onTerminated);
      socket.off('leftRoom', onLeft);
      socket.off('roomList', onRoomList);
      [errorTimer, noticeTimer, joinTimer, listTimer].forEach(timer => clearTimeout(timer.current));
      listPending.current = false;
    };
  }, [armJoinTimeout, resetRoom, sendJoin, showError, socket]);

  // Never queue game actions while offline: Socket.IO would replay stale moves on reconnect.
  const emitAction = useCallback((event: string, payload?: unknown) => {
    if (!socket.connected || pendingJoin.current || !currentRoom.current) return;
    socket.emit(event, payload);
  }, [socket]);
  const fetchRoomList = useCallback(() => {
    if (!socket.connected || listPending.current) return;
    listPending.current = true;
    setRoomListLoading(true);
    socket.emit('getRoomList');
    listTimer.current = setTimeout(() => {
      listPending.current = false;
      setRoomListLoading(false);
    }, 5000);
  }, [socket]);
  const actions = useMemo(() => ({
    joinRoom: (name: string, roomId: string) => sendJoin({ playerName: name.trim(), roomId: roomId.trim() || 'default' }),
    setReady: () => emitAction('ready'),
    startGame: () => emitAction('start'),
    playHand: (cards: Card[], handType?: Hand) => emitAction('playHand', { cards, handType }),
    passTurn: () => emitAction('pass'),
    payTribute: (cards: Card[]) => emitAction('tribute', cards),
    returnTribute: (cards: Card[]) => emitAction('returnTribute', cards),
    sendChat: (message: string) => {
      const text = message.trim();
      if (!text || text.length > 200) { showError('聊天消息需要 1–200 个字。'); return; }
      emitAction('chatMessage', text);
    },
    switchSeat: (seat: number) => emitAction('switchSeat', seat),
    setGameMode: (mode: GameMode) => emitAction('setGameMode', mode),
    useSkill: (skillId: string, targetSeat?: number) => emitAction('useSkill', { skillId, targetSeat }),
    forceEndGame: () => emitAction('forceEndGame'),
    leaveRoom: () => emitAction('leaveRoom'),
    fetchRoomList,
    retryConnection: () => socket.connect(),
    dismissMatchResult: () => setMatchResult(null),
    dismissError: () => setError(null),
  }), [emitAction, fetchRoomList, sendJoin, showError, socket]);

  return { inRoom, roomState, gameState, mySeat, error, notice, matchResult, chatMessages, roomList, roomListLoaded, roomListLoading, connection, joining, actions };
}
