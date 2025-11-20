const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

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

let rooms = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function emitRoomState(roomId) {
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
    auctionActive: room.auctionActive,
    skips: room.skips
  });
}

function resetTimers(room) {
  if (room.initialTimer) clearInterval(room.initialTimer);
  if (room.bidTimer) clearInterval(room.bidTimer);
  room.initialTimeLeft = 60;
  room.bidTimeLeft = 30;
}

function startInitialTimer(roomId) {
  const room = rooms[roomId];
  resetTimers(room);
  room.initialTimer = setInterval(() => {
    room.initialTimeLeft--;
    if (room.initialTimeLeft <= 0) {
      clearInterval(room.initialTimer);
      room.initialTimer = null;
      if (!room.currentBidder) {
        // No one bid, player auction ends
        nextPlayer(roomId);
      }
    }
    emitRoomState(roomId);
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
      room.bidTimer = null;
      if (room.currentBidder) {
        // Assign player to highest bidder
        const winner = room.players[room.currentBidder];
        winner.balance -= room.currentBid;
        winner.team.push({
          name: room.currentPlayer.name,
          price: room.currentBid
        });
      }
      nextPlayer(roomId);
    }
    emitRoomState(roomId);
  }, 1000);
}

function nextPlayer(roomId) {
  const room = rooms[roomId];
  room.currentPlayer = null;
  room.currentBid = 0;
  room.currentBidder = null;
  room.skips = new Set();
  if (room.availablePlayers.length === 0) return; // Auction finished
  // Pick random player
  const index = Math.floor(Math.random() * room.availablePlayers.length);
  const player = room.availablePlayers.splice(index, 1)[0];
  room.currentPlayer = player;
  room.currentPosition = player.position;
  room.auctionActive = true;
  startInitialTimer(roomId);
  io.to(roomId).emit("spinWheel");
  emitRoomState(roomId);
}

io.on("connection", (socket) => {
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
      initialTimer: null,
      bidTimer: null,
      initialTimeLeft: 60,
      bidTimeLeft: 30,
      auctionActive: false,
      skips: new Set()
    };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = { name, balance: 100, team: [] };
    socket.emit("roomCreated", roomId);
    emitRoomState(roomId);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("error", "Room not found");
    socket.join(roomId);
    room.players[socket.id] = { name, balance: 100, team: [] };
    emitRoomState(roomId);
  });

  socket.on("startSpin", (roomId) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;
    if (!room.currentPlayer) nextPlayer(roomId);
  });

  socket.on("bid", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.currentPlayer) return;
    const me = room.players[socket.id];
    if (!me) return;

    let nextBid = room.currentBid === 0 ? room.currentPlayer.basePrice
      : room.currentBid < 200 ? room.currentBid + 5 : room.currentBid + 10;

    if (me.balance < nextBid) return;

    room.currentBid = nextBid;
    room.currentBidder = socket.id;

    // Stop initial timer if running
    if (room.initialTimer) {
      clearInterval(room.initialTimer);
      room.initialTimer = null;
    }

    startBidTimer(roomId);
    room.skips = new Set(); // reset skips when a new bid happens
    emitRoomState(roomId);
  });

  socket.on("skip", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.currentPlayer) return;
    room.skips.add(socket.id);

    // If everyone skipped, assign to highest bidder or move to next player
    if (room.skips.size >= Object.keys(room.players).length) {
      if (room.currentBidder) {
        const winner = room.players[room.currentBidder];
        winner.balance -= room.currentBid;
        winner.team.push({
          name: room.currentPlayer.name,
          price: room.currentBid
        });
      }
      nextPlayer(roomId);
    } else {
      emitRoomState(roomId);
    }
  });

  socket.on("disconnect", () => {
    for (let roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) delete room.players[socket.id];
      emitRoomState(roomId);
    }
  });
});

server.listen(3000, () => console.log("Server running on port 3000"));
