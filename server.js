const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

// Load players once (144 players)
let MASTER_PLAYERS = JSON.parse(fs.readFileSync("shuffled_players.json", "utf8"));

const app = express();
const server = http.createServer(app);

// ===========================
// ENABLE CORS FOR RENDER
// ===========================
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));

/* ===========================
   GAME STATE (PER ROOM)
=========================== */
let rooms = {};

/* ===========================
   UTILITY
=========================== */
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

/* ===========================
   SOCKET LOGIC
=========================== */
io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  /* ---- CREATE ROOM ---- */
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
      auctionActive: false
    };

    // Add host as first player
    rooms[roomId].players[socket.id] = {
      name: name,
      balance: 1000,
      team: []
    };

    socket.join(roomId);
    socket.emit("roomCreated", { roomId });
    broadcastRoomState(roomId);
  });

  /* ---- JOIN ROOM ---- */
  socket.on("joinRoom", ({ roomId, name }) => {
    roomId = roomId.toUpperCase();
    let room = rooms[roomId];
    if (!room) return socket.emit("errorMessage", "Room not found");

    // Add new player
    room.players[socket.id] = {
      name: name,
      balance: 1000,
      team: []
    };

    socket.join(roomId);
    io.to(socket.id).emit("joinedRoom", { roomId });
    broadcastRoomState(roomId);
  });

  /* ---- START SPIN ---- */
  socket.on("startSpin", (roomId) => {
    let room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    if (room.availablePlayers.length === 0) return;

    room.spinInProgress = true;
    io.to(roomId).emit("spinStarted"); // Trigger wheel for all

    // Pick next player randomly
    const idx = Math.floor(Math.random() * room.availablePlayers.length);
    const player = room.availablePlayers.splice(idx, 1)[0];

    room.currentPlayer = player;
    room.currentPosition = player.position;
    room.currentBid = 0;
    room.currentBidder = null;
    room.auctionActive = true;

    broadcastRoomState(roomId);
  });

  /* ---- BID ---- */
  socket.on("bid", (roomId) => {
    let room = rooms[roomId];
    if (!room || !room.currentPlayer || !room.auctionActive) return;

    const me = room.players[socket.id];
    if (!me) return;

    let nextBid =
      room.currentBid === 0
        ? room.currentPlayer.basePrice
        : room.currentBid < 200
        ? room.currentBid + 5
        : room.currentBid + 10;

    if (me.balance < nextBid) return;

    room.currentBid = nextBid;
    room.currentBidder = socket.id;

    broadcastRoomState(roomId);
  });

  /* ---- SKIP ---- */
  socket.on("skip", (roomId) => {
    let room = rooms[roomId];
    if (!room || !room.currentPlayer || !room.auctionActive) return;

    room.currentPlayer = null;
    room.currentPosition = null;
    room.currentBid = 0;
    room.currentBidder = null;
    room.auctionActive = false;

    broadcastRoomState(roomId);
  });

  /* ---- UNIVERSAL SKIP ---- */
  socket.on("universalSkip", (roomId) => {
    let room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    room.currentPlayer = null;
    room.currentPosition = null;
    room.currentBid = 0;
    room.currentBidder = null;
    room.auctionActive = false;

    broadcastRoomState(roomId);
  });

  /* ---- HANDLE DISCONNECT ---- */
  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    for (let roomId in rooms) {
      let room = rooms[roomId];
      if (room.players[socket.id]) delete room.players[socket.id];

      if (room.hostId === socket.id) {
        // If host leaves, assign new host
        const ids = Object.keys(room.players);
        room.hostId = ids[0] || null;
      }

      broadcastRoomState(roomId);
    }
  });
});

/* ===========================
   START SERVER
=========================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
