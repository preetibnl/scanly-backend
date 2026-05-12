import { Server } from "socket.io";

let ioInstance = null;

export const initSocket = (httpServer) => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  ioInstance.on("connection", (socket) => {
    console.log(`[Socket] admin connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`[Socket] admin disconnected: ${socket.id}`);
    });
  });

  return ioInstance;
};

export const getIo = () => ioInstance;
