import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import mime from 'mime-types';
import { RoomManager, ServerSnapshot } from './room';
import { SnapshotStore } from './persistence';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const clientDirectory = path.resolve(__dirname, '../client');
const dataDirectory = path.resolve(process.env.GUANDAN_DATA_DIR || path.join(process.cwd(), 'data'));
const relativeDataPath = path.relative(clientDirectory, dataDirectory);
if (!relativeDataPath || (!relativeDataPath.startsWith(`..${path.sep}`) && relativeDataPath !== '..' && !path.isAbsolute(relativeDataPath))) {
  throw new Error('GUANDAN_DATA_DIR must be outside the public client directory.');
}
const roomManager = new RoomManager(io, new SnapshotStore<ServerSnapshot>(path.join(dataDirectory, 'rooms.json')));

// Serve static files from dist/client
app.use(express.static(clientDirectory, {
  setHeaders: (res, filePath) => {
    const mimeType = mime.lookup(filePath);
    if (mimeType) {
      res.setHeader('Content-Type', mimeType);
    }
  }
}));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', (data: unknown) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      socket.emit('error', '请输入昵称和房间号');
      return;
    }
    const { playerName, roomId } = data as { playerName?: unknown; roomId?: unknown };
    roomManager.joinRoom(socket, playerName, roomId);
  });

  socket.on('getRoomList', () => {
    roomManager.handleGetRoomList(socket);
  });

  socket.on('disconnect', () => {
    roomManager.handleDisconnect(socket);
  });
  
  // Game events handled in Room
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Save first, then exit. Closing sockets first would erase waiting-room occupants.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    roomManager.shutdown();
    process.exit(0);
  });
}
