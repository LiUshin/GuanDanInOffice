import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import mime from 'mime-types';
import { RoomManager } from './room';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const roomManager = new RoomManager(io);

// Serve static files from dist/client
app.use(express.static(path.join(__dirname, '../client'), {
  setHeaders: (res, filePath) => {
    const mimeType = mime.lookup(filePath);
    if (mimeType) {
      res.setHeader('Content-Type', mimeType);
    }
  }
}));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', ({ playerName, roomId }) => {
    roomManager.joinRoom(socket, playerName, roomId || 'default');
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
