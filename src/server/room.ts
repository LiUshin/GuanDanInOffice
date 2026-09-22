import { Server, Socket } from 'socket.io';
import { Match } from './match';
import { GameMode } from '../shared/types';

export interface Player {
  id: string;
  name: string;
  socket?: Socket;
  seatIndex: number;
  isReady: boolean;
  isBot?: boolean;
  isDisconnected?: boolean;
  isHost?: boolean;
}

export class RoomManager {
  private io: Server;
  private rooms: Map<string, Room> = new Map();

  constructor(io: Server) {
    this.io = io;
  }

  joinRoom(socket: Socket, playerName: string, roomId: string) {
    for (const [id, existing] of this.rooms) {
      if (!existing.hasSocket(socket)) continue;
      if (id === roomId) {
        socket.emit('error', '你已经在这个房间里');
        return;
      }
      existing.leave(socket);
    }

    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, this.io);
      room.onEmpty = () => this.rooms.delete(roomId);
      this.rooms.set(roomId, room);
    }
    room.addPlayer(socket, playerName);
    if (room.isEmpty()) this.rooms.delete(roomId);
  }

  handleDisconnect(socket: Socket) {
    for (const [id, room] of [...this.rooms.entries()]) {
      room.handleDisconnect(socket);
      if (room.isEmpty()) this.rooms.delete(id);
    }
  }

  getRoomList() {
    return Array.from(this.rooms.values())
      .filter(room => !room.isEmpty())
      .map(room => ({
        id: room.id,
        playerCount: room.players.filter(player => player !== null).length,
        maxPlayers: 4,
        inGame: !!(room.match && room.match.currentGame && room.match.matchWinner === null),
        gameMode: room.gameMode,
        hostName: room.players.find(player => player && player.isHost)?.name || '未知'
      }));
  }

  handleGetRoomList(socket: Socket) {
    socket.emit('roomList', this.getRoomList());
  }
}

class Room {
  id: string;
  io: Server;
  players: (Player | null)[] = [null, null, null, null];
  match: Match | null = null;
  gameMode: GameMode = GameMode.Normal;
  onEmpty?: () => void;

  constructor(id: string, io: Server) {
    this.id = id;
    this.io = io;
  }

  isEmpty() {
    return this.players.every(player => player === null);
  }

  hasSocket(socket: Socket) {
    return this.players.some(player => player && player.socket === socket);
  }

  addPlayer(socket: Socket, name: string) {
    const existingPlayerIndex = this.players.findIndex(player => player && player.name === name);
    if (existingPlayerIndex !== -1) {
      const player = this.players[existingPlayerIndex]!;
      if (!player.isDisconnected) {
        socket.emit('error', '这个名字已经在房间里');
        return;
      }
      player.isDisconnected = false;
      player.id = socket.id;
      player.socket = socket;
      socket.join(this.id);
      this.bindSocketListeners(socket);
      this.broadcastState();
      if (this.match && this.match.currentGame) {
        const game = this.match.currentGame;
        game.players[player.seatIndex] = player;
        game.rebindPlayer(player);
        game.sendStateTo(player);
      }
      this.io.to(this.id).emit('notice', `${name} 重新连接`);
      return;
    }

    const seatIndex = this.players.findIndex(player => player === null);
    if (seatIndex === -1) {
      socket.emit('error', '房间已满');
      return;
    }

    const player: Player = {
      id: socket.id,
      name,
      socket,
      seatIndex,
      isReady: false,
      isHost: !this.players.some(seated => seated && seated.isHost)
    };

    this.players[seatIndex] = player;
    socket.join(this.id);
    this.bindSocketListeners(socket);
    this.broadcastState();
  }

  private readonly roomEventNames = ['ready', 'start', 'chatMessage', 'switchSeat', 'setGameMode', 'forceEndGame', 'leaveRoom'] as const;

  private unbind(socket: Socket) {
    for (const eventName of this.roomEventNames) socket.removeAllListeners(eventName);
  }

  bindSocketListeners(socket: Socket) {
    this.unbind(socket);
    socket.on('ready', () => {
      const idx = this.getSeat(socket);
      if (idx !== -1) this.toggleReady(idx);
    });
    socket.on('start', () => this.forceStart(socket));
    socket.on('chatMessage', (msg: string) => this.handleChat(socket, msg));
    socket.on('switchSeat', (targetSeat: number) => this.switchSeat(socket, targetSeat));
    socket.on('setGameMode', (mode: GameMode) => this.setGameMode(socket, mode));
    socket.on('forceEndGame', () => this.handleForceEnd(socket));
    socket.on('leaveRoom', () => this.leave(socket));
  }

  handleForceEnd(socket: Socket) {
    if (!this.isHostSocket(socket)) {
      socket.emit('error', '只有房主可以强制结束游戏');
      return;
    }
    if (!this.match) {
      socket.emit('error', '当前没有正在进行的对局');
      return;
    }

    this.match.forceEndMatch();
    this.match = null;
    this.releaseBots();
    this.io.to(this.id).emit('notice', '房主强制结束了对局');
    this.io.to(this.id).emit('gameTerminated');
    this.broadcastState();
  }

  setGameMode(socket: Socket, mode: GameMode) {
    if (!this.isHostSocket(socket)) {
      socket.emit('error', '只有房主可以切换游戏模式');
      return;
    }
    if (this.match && this.match.matchWinner === null) {
      socket.emit('error', '对局进行中无法切换模式');
      return;
    }
    this.gameMode = mode;
    this.io.to(this.id).emit('notice', `游戏模式已切换为: ${mode === GameMode.Skill ? '技能模式' : '普通模式'}`);
    this.broadcastState();
  }

  handleChat(socket: Socket, msg: string) {
    const player = this.players.find(seated => seated && seated.socket === socket);
    if (!player) return;
    this.io.to(this.id).emit('chatMessage', {
      sender: player.name,
      text: msg,
      time: new Date().toLocaleTimeString(),
      seatIndex: player.seatIndex
    });
  }

  switchSeat(socket: Socket, targetSeat: number) {
    if (this.match && this.match.matchWinner === null) return;
    if (targetSeat < 0 || targetSeat > 3) return;

    const currentIdx = this.players.findIndex(player => player && player.socket === socket);
    if (currentIdx === -1 || this.players[targetSeat] !== null) return;

    const player = this.players[currentIdx]!;
    player.seatIndex = targetSeat;
    this.players[targetSeat] = player;
    this.players[currentIdx] = null;
    this.broadcastState();
  }

  getSeat(socket: Socket): number {
    const player = this.players.find(seated => seated && seated.socket === socket);
    return player ? player.seatIndex : -1;
  }

  private isHostSocket(socket: Socket) {
    const player = this.players.find(seated => seated && seated.socket === socket);
    return !!player?.isHost;
  }

  private ensureHost() {
    if (this.players.some(player => player && player.isHost && !player.isDisconnected && !player.isBot)) return;
    this.players.forEach(player => {
      if (player) player.isHost = false;
    });
    const next = this.players.find(player => player && !player.isBot && !player.isDisconnected);
    if (next) next.isHost = true;
  }

  private inLiveMatch() {
    return !!(this.match && this.match.currentGame && this.match.matchWinner === null);
  }

  leave(socket: Socket) {
    const index = this.players.findIndex(player => player && player.socket === socket);
    if (index === -1) return;
    this.detach(index, socket, true);
  }

  handleDisconnect(socket: Socket) {
    const index = this.players.findIndex(player => player && player.socket === socket);
    if (index === -1) return;
    this.detach(index, socket, false);
  }

  /** 离开或断线。牌局中保留座位并托管，等待同名重连。 */
  private detach(index: number, socket: Socket, explicit: boolean) {
    const player = this.players[index]!;
    const playerName = player.name;
    this.unbind(socket);
    player.socket = undefined;
    player.isReady = false;
    socket.leave(this.id);
    if (explicit) socket.emit('leftRoom');

    if (this.inLiveMatch()) {
      player.isDisconnected = true;
      this.match!.currentGame!.noteDisconnected(index);
      this.io.to(this.id).emit('notice', explicit
        ? `${playerName} 离开了，系统托管`
        : `${playerName} 断线，系统托管，等待重连`);
    } else {
      const wasHost = !!player.isHost;
      this.players[index] = null;
      if (wasHost) this.ensureHost();
      this.io.to(this.id).emit('notice', `${playerName} 离开了房间`);
    }
    this.broadcastState();
    if (this.isEmpty()) this.onEmpty?.();
  }

  toggleReady(seatIndex: number) {
    const player = this.players[seatIndex];
    if (!player || player.isDisconnected || this.inLiveMatch()) return;
    player.isReady = !player.isReady;
    this.broadcastState();
    if (player.isReady) this.tryAutoStart();
  }

  tryAutoStart() {
    const readyCount = this.players.filter(player => player && player.isReady && !player.isDisconnected).length;
    if (readyCount === 4 && !this.match) this.startGame();
  }

  forceStart(socket: Socket) {
    if (!this.isHostSocket(socket)) {
      socket.emit('error', '只有房主可以开始游戏');
      return;
    }
    if (this.match && this.match.matchWinner === null) return;
    this.startGame();
  }

  startGame() {
    const gamePlayers: Player[] = this.players.map((player, index) => {
      if (player) return player;
      return {
        id: `bot-${index}`,
        name: `Bot ${index}`,
        seatIndex: index,
        isReady: true,
        isBot: true
      };
    });

    this.players = gamePlayers;
    this.broadcastState();

    this.match = new Match(this.io, this.id, gamePlayers, this.gameMode);
    this.match.onMatchEnd = () => this.releaseBots();
    this.match.startMatch();
    this.io.to(this.id).emit('matchStarted');
  }

  /** 整场结束后清掉 Bot 和没回来的人，房主仍是原来的玩家。 */
  private releaseBots() {
    this.players = this.players.map(player => {
      if (!player || player.isBot || player.isDisconnected) return null;
      return player;
    });
    this.ensureHost();
    this.players.forEach(player => {
      if (player) player.isReady = false;
    });
    this.broadcastState();
    if (this.isEmpty()) this.onEmpty?.();
  }

  broadcastState() {
    const playerList = this.players.map(player => player ? {
      id: player.id,
      name: player.name,
      seatIndex: player.seatIndex,
      isReady: player.isReady,
      isBot: player.isBot,
      isDisconnected: player.isDisconnected,
      isHost: player.isHost
    } : null);
    this.io.to(this.id).emit('roomState', {
      roomId: this.id,
      players: playerList,
      gameMode: this.gameMode
    });
  }
}
