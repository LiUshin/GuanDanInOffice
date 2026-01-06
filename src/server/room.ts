import { Server, Socket } from 'socket.io';
import { Game } from './game';
import { Match } from './match';
import { GameMode } from '../shared/types';

export interface Player {
  id: string; // Socket ID (Current)
  name: string;
  socket?: Socket;
  seatIndex: number; // 0-3
  isReady: boolean;
  isBot?: boolean;
  isDisconnected?: boolean; // New flag
}

export class RoomManager {
  private io: Server;
  private rooms: Map<string, Room> = new Map();

  constructor(io: Server) {
    this.io = io;
  }

  joinRoom(socket: Socket, playerName: string, roomId: string) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, this.io);
      this.rooms.set(roomId, room);
    }
    room.addPlayer(socket, playerName);
  }

  handleDisconnect(socket: Socket) {
    for (const room of this.rooms.values()) {
      room.handleDisconnect(socket);
    }
  }

  getRoomList() {
    const roomList = Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      playerCount: room.players.filter(p => p !== null && !p.isDisconnected).length,
      maxPlayers: 4,
      inGame: room.match !== null && room.match.currentGame !== null,
      gameMode: room.gameMode,
      hostName: room.players[0]?.name || 'Unknown'
    }));
    return roomList;
  }

  handleGetRoomList(socket: Socket) {
    const roomList = this.getRoomList();
    socket.emit('roomList', roomList);
  }
}

class Room {
  id: string;
  io: Server;
  players: (Player | null)[] = [null, null, null, null];
  match: Match | null = null; // Changed from game to match
  gameMode: GameMode = GameMode.Normal;

  constructor(id: string, io: Server) {
    this.id = id;
    this.io = io;
  }

  addPlayer(socket: Socket, name: string) {
    // Check for reconnection first
    const existingPlayerIndex = this.players.findIndex(p => p && p.name === name && p.isDisconnected);
    if (existingPlayerIndex !== -1) {
        // Reconnect logic
        const player = this.players[existingPlayerIndex]!;
        player.isDisconnected = false;
        player.id = socket.id; // Update socket ID
        player.socket = socket;
        
        socket.join(this.id);
        
        // Re-bind listeners
        this.bindSocketListeners(socket, existingPlayerIndex);
        
        // If game is running, update game player ref?
        if (this.match && this.match.currentGame) {
            const game = this.match.currentGame;
            game.players[existingPlayerIndex] = player;
            // Also need to re-bind game listeners!
            game.rebindPlayer(player);
            // Send current game state to reconnected player
            const p = player;
            socket.emit('gameState', {
                phase: (game as any).currentPhase,
                level: game.level,
                currentTurn: game.currentTurn,
                hands: game.hands.map((h, i) => i === p.seatIndex ? h : h.length),
                lastHand: game.lastHand,
                winners: game.winners,
                tributeState: (game as any).currentPhase === 'Tribute' || (game as any).currentPhase === 'ReturnTribute' ? game.tributeState : undefined,
                teamLevels: game.teamLevels,
                activeTeam: game.activeTeam
            });
        }
        
        this.io.to(this.id).emit('error', `Player ${name} reconnected!`);
        this.broadcastState();
        return;
    }

    // Normal Join
    // Find empty seat
    const seatIndex = this.players.findIndex(p => p === null);
    if (seatIndex === -1) {
      socket.emit('error', 'Room is full');
      return;
    }

    const player: Player = {
      id: socket.id,
      name,
      socket,
      seatIndex,
      isReady: false
    };

    this.players[seatIndex] = player;
    socket.join(this.id);
    
    this.bindSocketListeners(socket, seatIndex);
    
    // Broadcast update
    this.broadcastState();
  }
  
  bindSocketListeners(socket: Socket, seatIndex: number) {
    // Listen for room events
    socket.on('ready', () => {
        // Use current seat index from player object in case of swap
        // Actually bind by socket ID lookup is safer if swapping is allowed.
        // But here we pass seatIndex.
        // Let's stick to dynamic lookup in methods.
        const idx = this.getSeat(socket);
        if (idx !== -1) this.setReady(idx, true);
    });
    socket.on('start', () => {
        const idx = this.getSeat(socket);
        if (idx !== -1) this.forceStart(idx);
    });
    
    socket.on('chatMessage', (msg: string) => this.handleChat(socket, msg));
    socket.on('switchSeat', (targetSeat: number) => this.switchSeat(socket, targetSeat));
    socket.on('setGameMode', (mode: GameMode) => this.setGameMode(socket, mode));
    socket.on('forceEndGame', () => this.handleForceEnd(socket));
  }
  
  handleForceEnd(socket: Socket) {
      const seat = this.getSeat(socket);
      // Only Host (Seat 0) can force end
      if (seat !== 0) {
          socket.emit('error', '只有房主可以强制结束游戏');
          return;
      }
      
      if (!this.match) {
          socket.emit('error', '当前没有正在进行的对局');
          return;
      }
      
      console.log(`[Room ${this.id}] Host forced end match.`);
      
      // Stop the match
      this.match.forceEndMatch();
      this.match = null;
      
      // Reset players ready status
      this.players.forEach(p => {
          if (p) {
              p.isReady = false;
          }
      });
      
      // Notify everyone
      this.io.to(this.id).emit('error', '房主强制结束了对局');
      // Emit a special "matchTerminated" or just let the roomState update handle it?
      // The client relies on `gameState` event to enter game view. 
      // If we stop emitting gameState, client might get stuck if it doesn't know game ended.
      // We should emit a null gameState or explicit termination signal.
      
      this.io.to(this.id).emit('gameTerminated'); 
      this.broadcastState();
  }

  setGameMode(socket: Socket, mode: GameMode) {
      // Only host (seat 0) can change game mode
      const idx = this.getSeat(socket);
      if (idx !== 0) {
          socket.emit('error', '只有房主可以切换游戏模式');
          return;
      }
      // Can only change before match starts
      if (this.match && this.match.matchWinner === null) {
          socket.emit('error', '对局进行中无法切换模式');
          return;
      }
      this.gameMode = mode;
      this.io.to(this.id).emit('error', `游戏模式已切换为: ${mode === GameMode.Skill ? '技能模式' : '普通模式'}`);
      this.broadcastState();
  }

  handleChat(socket: Socket, msg: string) {
      const p = this.players.find(p => p && p.id === socket.id);
      if (p) {
          this.io.to(this.id).emit('chatMessage', { 
              sender: p.name, 
              text: msg, 
              time: new Date().toLocaleTimeString(),
              seatIndex: p.seatIndex  // Include seat for bubble display
          });
      }
  }

  switchSeat(socket: Socket, targetSeat: number) {
      if (this.match && this.match.matchWinner === null) return; // Cannot switch during match
      if (targetSeat < 0 || targetSeat > 3) return;
      
      const currentIdx = this.players.findIndex(p => p && p.id === socket.id);
      if (currentIdx === -1) return;
      
      // Check if target is empty
      if (this.players[targetSeat] === null) {
          // Swap
          const p = this.players[currentIdx]!;
          p.seatIndex = targetSeat;
          this.players[targetSeat] = p;
          this.players[currentIdx] = null;
          
          this.broadcastState();
      }
  }
  
  // Helper to find seat by socket
  getSeat(socket: Socket): number {
      const p = this.players.find(p => p && p.id === socket.id);
      return p ? p.seatIndex : -1;
  }

  handleDisconnect(socket: Socket) {
    const index = this.players.findIndex(p => p && p.id === socket.id);
    if (index !== -1) {
      const player = this.players[index]!;
      const playerName = player.name;
      
      // Mark as disconnected instead of removing
      player.isDisconnected = true;
      player.isReady = false; // Unready
      // player.socket = undefined; // Don't remove ref entirely? or optional?
      
      // If match running, DO NOT end match immediately.
      // Allow reconnect.
      if (this.match && this.match.currentGame) {
          this.io.to(this.id).emit('error', `Player ${playerName} disconnected (Waiting for reconnect...)`);
      } else {
           // If game not started, just notify
           // Should we remove player if game not started? 
           // Maybe yes, to free up seat? 
           // Let's remove if game not started.
           this.players[index] = null;
           this.io.to(this.id).emit('error', `Player ${playerName} left the room`);
      }
      this.broadcastState();
    }
  }

  setReady(seatIndex: number, ready: boolean) {
    if (this.players[seatIndex]) {
      this.players[seatIndex]!.isReady = ready;
      this.broadcastState();
      this.tryAutoStart();
    }
  }
  
  tryAutoStart() {
      const readyCount = this.players.filter(p => p && p.isReady).length;
      if (readyCount === 4 && !this.match) {
           this.startGame();
      }
  }
  
  forceStart(seatIndex: number) {
      if (seatIndex !== 0) return; // Only host can force start
      
      // Don't allow starting if a match is already in progress
      if (this.match && this.match.matchWinner === null) {
          return; // Match is still ongoing
      }
      
      // Start new match
      this.startGame();
  }

  startGame() {
      // Fill empty slots with bots
      const gamePlayers: Player[] = this.players.map((p, index) => {
          if (p) return p;
          return {
              id: `bot-${index}`,
              name: `Bot ${index}`,
              seatIndex: index,
              isReady: true,
              isBot: true
          };
      });
      
      // Update room players (so clients see bots)
      this.players = gamePlayers; // This commits bots to the room
      this.broadcastState();

      // Start a new match (full game series from 2 to A)
      this.match = new Match(this.io, this.id, gamePlayers, this.gameMode);
      this.match.startMatch();
      
      this.io.to(this.id).emit('matchStarted');
  }

  broadcastState() {
    const playerList = this.players.map(p => p ? { id: p.id, name: p.name, seatIndex: p.seatIndex, isReady: p.isReady, isBot: p.isBot } : null);
    this.io.to(this.id).emit('roomState', {
      roomId: this.id,
      players: playerList,
      gameMode: this.gameMode
    });
  }
}
