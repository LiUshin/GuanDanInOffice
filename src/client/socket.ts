import { io, Socket } from 'socket.io-client';

// Connect to current host
// In dev, proxy handles it. In prod/packaged, we might need specific logic if serving static.
// If served from same origin, no URL needed.
export const socket: Socket = io();
