import { Server, Socket } from 'socket.io';
import { Game } from './game';

interface Player {
  id: string;
  name: string;
  socket?: Socket;
  seatIndex: number; // 0-3
  isReady: boolean;
  isBot?: boolean;
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
      room.removePlayer(socket);
    }
  }
}

class Room {
  id: string;
  io: Server;
  players: (Player | null)[] = [null, null, null, null];
  game: Game | null = null;

  constructor(id: string, io: Server) {
    this.id = id;
    this.io = io;
  }

  addPlayer(socket: Socket, name: string) {
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
    
    // Listen for room events
    // Use dynamic lookup instead of closure seatIndex to support swapping
    socket.on('ready', () => {
        const idx = this.getSeat(socket);
        if (idx !== -1) this.setReady(idx, true);
    });
    socket.on('start', () => {
        const idx = this.getSeat(socket);
        if (idx !== -1) this.forceStart(idx);
    });
    
    // New Features
    socket.on('chatMessage', (msg: string) => this.handleChat(socket, msg));
    socket.on('switchSeat', (targetSeat: number) => this.switchSeat(socket, targetSeat));
    
    // Broadcast update
    this.broadcastState();
  }

  handleChat(socket: Socket, msg: string) {
      const p = this.players.find(p => p && p.id === socket.id);
      if (p) {
          this.io.to(this.id).emit('chatMessage', { sender: p.name, text: msg, time: new Date().toLocaleTimeString() });
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
          
          // Re-bind listeners for seat-based logic if any (mostly index based)
          // But our socket logic uses closure 'seatIndex' which is now stale!
          // We need to update how we handle seat actions.
          // Actually, 'addPlayer' closure binds 'seatIndex'. 
          // FIX: The listeners (playHand etc) in Game use p.seatIndex which is updated.
          // BUT room listeners like setReady use the closure variable.
          // For MVP: We must update the socket listeners or use dynamic lookup.
          
          // Re-register room listeners is hard without clearing old ones.
          // Easier: Clients send actions, server looks up seat by socket ID.
          
          this.broadcastState();
      }
  }
  
  // Helper to find seat by socket
  getSeat(socket: Socket): number {
      const p = this.players.find(p => p && p.id === socket.id);
      return p ? p.seatIndex : -1;
  }

  removePlayer(socket: Socket) {
    const index = this.players.findIndex(p => p && p.id === socket.id);
    if (index !== -1) {
      const playerName = this.players[index]?.name;
      this.players[index] = null;
      
      // If game running, reset?
      if (this.game) {
          // Ideally convert to bot or end game
          // For MVP: simple reset
          this.game = null;
          // Notify everyone about the disconnect
          this.io.to(this.id).emit('error', `Player ${playerName} disconnected, game ended`);
      } else {
           // If game not started, just notify
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
          this.game = new Game(this.io, this.id, gamePlayers);
          this.game.start();
      } else {
          // Restart - Preserve State
          const prevWinners = this.game.prevWinners.length > 0 ? this.game.prevWinners : [];
          const oldGame = this.game;
          this.game = new Game(this.io, this.id, gamePlayers);
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
      players: playerList
    });
  }
}
