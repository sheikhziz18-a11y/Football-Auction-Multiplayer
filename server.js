const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

// Load players
let MASTER_PLAYERS = JSON.parse(fs.readFileSync("shuffled_players.json", "utf8"));

const app = express();
const server = http.createServer(app);

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

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function resetTimers(room) {
  if (room.initialTimer) clearInterval(room.initialTimer);
  if (room.bidTimer) clearInterval(room.bidTimer);
  room.initialTimeLeft = 60;
  room.bidTimeLeft = 30;
  room.skippedPlayers = [];
}

function broadcastRoomState(roomId) {
  const room = rooms[roomId];
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
    auctionActive: room.auctionActive,
    log: room.log
  });
}

function pickRandomPlayerByPosition(room, position) {
  const candidates = room.availablePlayers.filter(p => p.position === position);
  if (candidates.length === 0) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  const player = candidates.splice(idx, 1)[0];
  room.availablePlayers = room.availablePlayers.filter(p => p !== player);
  return player;
}

function startInitialTimer(roomId) {
  const room = rooms[roomId];
  room.initialTimer = setInterval(() => {
    room.initialTimeLeft--;
    if (room.initialTimeLeft <= 0) {
      clearInterval(room.initialTimer);
      room.auctionActive = false;
      endCurrentPlayer(roomId);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

function startBidTimer(roomId) {
  const room = rooms[roomId];
  if (room.bidTimer) clearInterval(room.bidTimer);
  room.bidTimeLeft = 30;
  room.bidTimer = setInterval(() => {
    room.bidTimeLeft--;
    if (room.bidTimeLeft <= 0) {
      clearInterval(room.bidTimer);
      room.auctionActive = false;
      endCurrentPlayer(roomId);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

function endCurrentPlayer(roomId) {
  const room = rooms[roomId];
  const player = room.currentPlayer;
  const bidderId = room.currentBidder;

  if (bidderId && player) {
    // Assign player to bidder
    room.players[bidderId].team.push({
      name: player.name,
      price: room.currentBid
    });
    room.players[bidderId].balance -= room.currentBid;
    room.log.push(`${room.players[bidderId].name} won ${player.name} for ${room.currentBid}M`);
  } else if (player) {
    room.log.push(`${player.name} was unsold`);
  }

  // Reset current player
  room.currentPlayer = null;
  room.currentBid = 0;
  room.currentBidder = null;
  room.currentPosition = null;
  room.auctionActive = false;

  broadcastRoomState(roomId);

  // Small delay before spinning wheel
  setTimeout(() => {
    spinWheel(roomId);
  }, 2000);
}

function spinWheel(roomId) {
  const room = rooms[roomId];
  if (room.availablePlayers.length === 0) return;

  room.spinInProgress = true;

  const positions = ["GK", "CB", "RB", "LB", "RW", "CF", "AM", "LW", "CM", "DM"];
  const position = positions[Math.floor(Math.random() * positions.length)];
  const player = pickRandomPlayerByPosition(room, position);

  if (!player) {
    room.spinInProgress = false;
    broadcastRoomState(roomId);
    return;
  }

  room.currentPlayer = player;
  room.currentPosition = position;
  room.currentBid = 0;
  room.currentBidder = null;
  room.auctionActive = true;
  resetTimers(room);

  broadcastRoomState(roomId);
  room.spinInProgress = false;

  startInitialTimer(roomId);
}

/* ===========================
   SOCKET LOGIC
=========================== */
io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  socket.on("createRoom", (name) => {
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
      initialTimer: null,
      bidTimer: null,
      auctionActive: false,
      spinInProgress: false,
      log: [],
      skippedPlayers: []
    };
    rooms[roomId].players[socket.id] = {
      name,
      balance: 1000,
      team: []
    };
    socket.join(roomId);
    socket.emit("roomCreated", roomId);
    broadcastRoomState(roomId);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("error", "Room not found");
    if (room.players[socket.id]) return; // Already in room
    room.players[socket.id] = {
      name,
      balance: 1000,
      team: []
    };
    socket.join(roomId);
    broadcastRoomState(roomId);
  });

  socket.on("startSpin", (roomId) => {
    spinWheel(roomId);
  });

  socket.on("bid", (roomId) => {
    const room = rooms[roomId];
    if (!room.auctionActive || !room.currentPlayer) return;

    const player = room.players[socket.id];
    let nextBid =
      room.currentBid === 0
        ? room.currentPlayer.basePrice
        : room.currentBid < 200
        ? room.currentBid + 5
        : room.currentBid + 10;

    if (player.balance < nextBid) return;

    room.currentBid = nextBid;
    room.currentBidder = socket.id;
    room.log.push(`${player.name} bid ${nextBid}M for ${room.currentPlayer.name}`);

    startBidTimer(roomId);
    broadcastRoomState(roomId);
  });

  socket.on("skip", (roomId) => {
    const room = rooms[roomId];
    if (!room.auctionActive || !room.currentPlayer) return;

    if (!room.skippedPlayers.includes(socket.id)) {
      room.skippedPlayers.push(socket.id);
      const player = room.players[socket.id];
      room.log.push(`${player.name} skipped ${room.currentPlayer.name}`);
    }

    // If everyone skipped, end player
    const totalPlayers = Object.keys(room.players).length;
    if (room.skippedPlayers.length === totalPlayers) {
      clearInterval(room.initialTimer);
      clearInterval(room.bidTimer);
      endCurrentPlayer(roomId);
    }

    broadcastRoomState(roomId);
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        broadcastRoomState(roomId);
      }
    }
  });
});

/* ===========================
   START SERVER
=========================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
