import { Server, Socket } from 'socket.io';
import { Game } from './game';
import { GameMode } from '../shared/types';

interface Player {
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
}

class Room {
  id: string;
  io: Server;
  players: (Player | null)[] = [null, null, null, null];
  game: Game | null = null;
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
        if (this.game) {
            this.game.players[existingPlayerIndex] = player;
            // Also need to re-bind game listeners!
            this.game.rebindPlayer(player);
            // Send current game state to reconnected player
            const p = player;
            socket.emit('gameState', {
                phase: this.game.currentPhase,
                level: this.game.level,
                currentTurn: this.game.currentTurn,
                hands: this.game.hands.map((h, i) => i === p.seatIndex ? h : h.length),
                lastHand: this.game.lastHand,
                winners: this.game.winners,
                tributeState: this.game.currentPhase === 'Tribute' || this.game.currentPhase === 'ReturnTribute' ? this.game.tributeState : undefined,
                teamLevels: this.game.teamLevels,
                activeTeam: this.game.activeTeam
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
  }
  
  setGameMode(socket: Socket, mode: GameMode) {
      // Only host (seat 0) can change game mode
      const idx = this.getSeat(socket);
      if (idx !== 0) {
          socket.emit('error', '只有房主可以切换游戏模式');
          return;
      }
      // Can only change before game starts
      if (this.game) {
          socket.emit('error', '游戏进行中无法切换模式');
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
      if (this.game) return; // Cannot switch during game
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
      
      // If game running, DO NOT end game immediately.
      // Allow reconnect.
      if (this.game) {
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
      if (readyCount === 4 && !this.game) {
           this.startGame();
      }
  }
  
  forceStart(seatIndex: number) {
      if (seatIndex !== 0) return; // Only host can force start
      if (this.game) return;
      
      // Check if all *present* players are ready? 
      // Or just assume if host says start, we start.
      // Fill empty slots with bots.
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

      if (!this.game) {
          this.game = new Game(this.io, this.id, gamePlayers, this.gameMode);
          this.game.start();
      } else {
          // Restart - Preserve State
          const prevWinners = this.game.prevWinners.length > 0 ? this.game.prevWinners : [];
          const oldGame = this.game;
          this.game = new Game(this.io, this.id, gamePlayers, this.gameMode);
          this.game.teamLevels = oldGame.teamLevels;
          this.game.activeTeam = oldGame.activeTeam;
          this.game.prevWinners = prevWinners;
          
          this.game.resetAndStart();
      }
      this.io.to(this.id).emit('gameStarted');
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
