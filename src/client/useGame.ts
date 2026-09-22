import { useState, useEffect, useRef } from 'react';
import { socket } from './socket';
import { Card, GameMode, SkillCard, Hand, HistoryEntry } from '../shared/types';
import { formatLevelRank } from '../shared/rules';

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
  players: ({ name: string, seatIndex: number, isReady: boolean, isHost?: boolean, isBot?: boolean, isDisconnected?: boolean } | null)[];
  gameMode?: GameMode;
}

export function useGame() {
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [mySeat, setMySeat] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const errorTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);
  const [chatMessages, setChatMessages] = useState<{sender: string, text: string, time: string, seatIndex: number}[]>([]);
  const [roomList, setRoomList] = useState<Array<{
    id: string;
    playerCount: number;
    maxPlayers: number;
    inGame: boolean;
    gameMode: GameMode;
    hostName: string;
  }>>([]);

  useEffect(() => {
    socket.on('roomState', (state: any) => {
      setRoomState(state);
      setInRoom(true);
      const me = state.players.find((p: any) => p && p.id === socket.id);
      if (me) {
          setMySeat(me.seatIndex);
      }
    });

    socket.on('chatMessage', (msg: any) => {
        setChatMessages(prev => [...prev, msg]);
    });

    socket.on('gameState', (state: GameState) => {
      console.log(`[Client] Received gameState: currentTurn=${state.currentTurn}, phase=${state.phase}, mySeat will compare with ${state.currentTurn}`);
      setGameState(state);
    });

    socket.on('error', (msg: string) => {
      setError(msg);
      window.clearTimeout(errorTimer.current);
      errorTimer.current = window.setTimeout(() => setError(null), 3000);
    });

    socket.on('notice', (msg: string) => {
      setNotice(msg);
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
    });
    
    socket.on('gameOver', (data: { winners: number[] }) => {
      console.log(`[Client] Game Over! Winners: ${data.winners.join(', ')}`);
    });
    
    socket.on('matchOver', (data: { winningTeam: number, winners: any[], finalLevels: { [key: number]: number } }) => {
      const side = data.winningTeam === 0 ? '座位 0 和 2' : '座位 1 和 3';
      const levels = data.finalLevels
        ? `打${formatLevelRank(data.finalLevels[0])} 对 打${formatLevelRank(data.finalLevels[1])}`
        : '';
      setMatchResult(`对局结束，${side} 获胜。${levels}`);
      setGameState(null);
    });

    socket.on('gameTerminated', () => {
        console.log('[Client] Game Terminated by Host');
        setGameState(null);
    });

    socket.on('leftRoom', () => {
        setInRoom(false);
        setRoomState(null);
        setGameState(null);
        setMySeat(-1);
    });

    socket.on('roomList', (list: any[]) => {
        console.log('[Client] Received room list:', list);
        setRoomList(list);
    });

    return () => {
      socket.off('roomState');
      socket.off('chatMessage');
      socket.off('gameState');
      socket.off('error');
      socket.off('notice');
      socket.off('gameOver');
      socket.off('matchOver');
      socket.off('gameTerminated');
      socket.off('leftRoom');
      socket.off('roomList');
    };
  }, []);

  const joinRoom = (name: string, roomId: string) => {
    socket.emit('joinRoom', { playerName: name, roomId });
  };

  const setReady = () => {
    socket.emit('ready');
  };
  
  const startGame = () => {
      socket.emit('start');
  }

  const playHand = (cards: Card[], handType?: Hand) => {
    socket.emit('playHand', { cards, handType });
  };

  const passTurn = () => {
    socket.emit('pass');
  };
  
  const payTribute = (cards: Card[]) => {
      socket.emit('tribute', cards);
  }
  
  const returnTribute = (cards: Card[]) => {
      socket.emit('returnTribute', cards);
  }
  
  const sendChat = (msg: string) => {
      socket.emit('chatMessage', msg);
  }

  const switchSeat = (seatIdx: number) => {
      socket.emit('switchSeat', seatIdx);
  }
  
  const setGameMode = (mode: GameMode) => {
      socket.emit('setGameMode', mode);
  }
  
  const useSkill = (skillId: string, targetSeat?: number) => {
      socket.emit('useSkill', { skillId, targetSeat });
  }

  const forceEndGame = () => {
      socket.emit('forceEndGame');
  }

  const leaveRoom = () => {
      socket.emit('leaveRoom');
  };

  const fetchRoomList = () => {
      socket.emit('getRoomList');
  };

  return {
    inRoom,
    roomState,
    gameState,
    mySeat,
    setMySeat,
    error,
    notice,
    matchResult,
    chatMessages,
    roomList,
    actions: { joinRoom, setReady, playHand, passTurn, startGame, payTribute, returnTribute, sendChat, switchSeat, setGameMode, useSkill, forceEndGame, fetchRoomList, leaveRoom, dismissMatchResult: () => setMatchResult(null) }
  };
}
