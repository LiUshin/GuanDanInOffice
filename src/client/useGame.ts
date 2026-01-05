import { useState, useEffect, useCallback } from 'react';
import { socket } from './socket';
import { Card } from '../shared/types';

export interface GameState {
  phase: string;
  level: number;
  currentTurn: number;
  hands: (Card[] | number)[]; 
  lastHand: { playerIndex: number, hand: any } | null;
  winners: number[];
  tributeState?: {
      pendingTributes: { from: number, to: number, card?: any }[];
      pendingReturns: { from: number, to: number, card?: any }[];
  };
  teamLevels?: { [key: number]: number };
  activeTeam?: number;
}

export interface RoomState {
  roomId: string;
  players: ({ name: string, seatIndex: number, isReady: boolean } | null)[];
}

export function useGame() {
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [mySeat, setMySeat] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{sender: string, text: string, time: string}[]>([]);

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
      setGameState(state);
    });

    socket.on('error', (msg: string) => {
      setError(msg);
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      socket.off('roomState');
      socket.off('gameState');
      socket.off('error');
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

  const playHand = (cards: Card[]) => {
    socket.emit('playHand', cards);
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

  return {
    inRoom,
    roomState,
    gameState,
    mySeat,
    setMySeat,
    error,
    chatMessages,
    actions: { joinRoom, setReady, playHand, passTurn, startGame, payTribute, returnTribute, sendChat, switchSeat }
  };
}
