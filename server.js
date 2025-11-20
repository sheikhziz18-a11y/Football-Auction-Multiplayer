const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

// Load players once (144 players)
let MASTER_PLAYERS = JSON.parse(fs.readFileSync("shuffled_players.json", "utf8"));

const app = express();
const server = http.createServer(app);

// ===========================
// ENABLE CORS FOR SOCKET.IO
// ===========================
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));

// ===========================
// GAME STATE (PER ROOM)
// ===========================
let rooms = {}; 

// ===========================
// UTILITY FUNCTIONS
// ===========================
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
  let room = rooms[roomId];
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

// ===========================
// SOCKET.IO LOGIC
// ===========================
io.on("connection", (socket) => {

  // ---- Create Room ----
  socket.on("createRoom", (name) => {
    let roomId = generateRoomId();
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

    socket.join(roomId);

    socket.emit("roomCreated", { roomId: roomId });

    broadcastRoomState(roomId);
  });

  // ---- Join Room ----
  socket.on("joinRoom", ({ roomId, playerName }) => {
    let room = rooms[roomId];
    if (!room) {
      socket.emit("errorMessage", "Room not found");
      return;
    }

    room.players[socket.id] = {
      name: playerName,
      budget: 100, // example starting budget
      team: []
    };

    socket.join(roomId);

    broadcastRoomState(roomId);
  });

  // ---- Disconnect ----
  socket.on("disconnect", () => {
    for (let roomId in rooms) {
      let room = rooms[roomId];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        broadcastRoomState(roomId);
      }
    }
  });
});

// ===========================
// START SERVER
// ===========================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
