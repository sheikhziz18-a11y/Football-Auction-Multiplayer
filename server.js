const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

// ===============================
// LOAD PLAYERS
// ===============================
let MASTER_PLAYERS = JSON.parse(fs.readFileSync("shuffled_players.json", "utf8"));

const app = express();
const server = http.createServer(app);

// ===============================
// SOCKET.IO SETUP WITH CORS
// ===============================
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ===============================
// SERVE STATIC FILES
// ===============================
app.use(express.static("public"));

// ===============================
// GAME STATE
// ===============================
let rooms = {}; // { roomId: { hostId, players, availablePlayers, currentPlayer, ... } }

// ===============================
// UTILITY FUNCTIONS
// ===============================
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function resetTimers(room) {
  if (room.initialTimer) clearInterval(room.initialTimer);
  if (room.bidTimer) clearInterval(room.bidTimer);
  room.initialTimeLeft = 60;
  room.bidTimeLeft = 30;
}

function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("roomState", {
    players: room.players,
    hostId: room.hostId,
    currentPlayer: room.currentPlayer,
    currentPosition: room.currentPosition,
    currentBid: room.currentBid,
    currentBidder: room.currentBidder,
    initialTimeLeft: room.initialTimeLeft,
    bidTimeLeft: room.bidTimeLeft,
    spinInProgress: room.spinInProgress,
    auctionActive: room.auctionActive
  });
}

// ===============================
// SOCKET.IO EVENTS
// ===============================
io.on("connection", (socket) => {

  console.log(`Socket connected: ${socket.id}`);

  // ---- CREATE ROOM ----
  socket.on("createRoom", (playerName) => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      hostId: socket.id,
      players: {},
      availablePlayers: JSON.parse(JSON.stringify(MASTER_PLAYERS)),
      currentPlayer: null,
      currentPosition: null,
      currentBid: 0,
      currentBidder: null,
      initialTimeLeft: 60,
      bidTimeLeft: 30,
      spinInProgress: false,
      auctionActive: false,
      initialTimer: null,
      bidTimer: null
    };

    // Add creator as first player
    rooms[roomId].players[socket.id] = {
      name: playerName,
      budget: 100,
      team: []
    };

    socket.join(roomId);
    socket.emit("roomCreated", { roomId });
    broadcastRoomState(roomId);
  });

  // ---- JOIN ROOM ----
  socket.on("joinRoom", ({ roomId, playerName }) => {
    roomId = roomId.toUpperCase(); // ensure consistency
    const room = rooms[roomId];

    if (!room) {
      socket.emit("errorMessage", "Room not found");
      return;
    }

    // Add player to room
    room.players[socket.id] = {
      name: playerName,
      budget: 100,
      team: []
    };

    socket.join(roomId);

    // Notify joining player
    socket.emit("joinedRoom", { roomId });

    // Update all clients in the room
    broadcastRoomState(roomId);
  });

  // ---- HANDLE DISCONNECT ----
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        delete room.players[socket.id];

        // If host disconnected, assign new host
        if (room.hostId === socket.id) {
          const remainingIds = Object.keys(room.players);
          room.hostId = remainingIds.length ? remainingIds[0] : null;
        }

        // If room empty, delete it
        if (Object.keys(room.players).length === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} deleted (empty)`);
        } else {
          broadcastRoomState(roomId);
        }
      }
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
