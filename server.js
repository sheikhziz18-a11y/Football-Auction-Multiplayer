// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

// Load players
let MASTER_PLAYERS = JSON.parse(fs.readFileSync("shuffled_players.json", "utf8"));

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
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
    auctionActive: room.auctionActive,
    log: room.log
  });
}

function pickRandomPlayerByPosition(room, position) {
  const candidates = room.availablePlayers.filter(p => p.position === position);
  if (candidates.length === 0) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  // remove selected from availablePlayers
  const player = candidates[idx];
  room.availablePlayers = room.availablePlayers.filter(p => p !== player);
  return player;
}

function startInitialTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.initialTimer) clearInterval(room.initialTimer);
  room.initialTimeLeft = 60;
  room.initialTimer = setInterval(() => {
    room.initialTimeLeft--;
    if (room.initialTimeLeft <= 0) {
      clearInterval(room.initialTimer);
      room.initialTimer = null;
      room.auctionActive = false;
      endCurrentPlayer(roomId);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

function startBidTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.bidTimer) clearInterval(room.bidTimer);
  room.bidTimeLeft = 30;
  room.bidTimer = setInterval(() => {
    room.bidTimeLeft--;
    if (room.bidTimeLeft <= 0) {
      clearInterval(room.bidTimer);
      room.bidTimer = null;
      room.auctionActive = false;
      endCurrentPlayer(roomId);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

function endCurrentPlayer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const player = room.currentPlayer;
  const bidderId = room.currentBidder;

  if (bidderId && player) {
    // Assign player to bidder
    if (!room.players[bidderId]) {
      room.log.push(`Winner disconnected; ${player.name} unsold`);
    } else {
      room.players[bidderId].team.push({
        name: player.name,
        price: room.currentBid
      });
      room.players[bidderId].balance -= room.currentBid;
      room.log.push(`${room.players[bidderId].name} won ${player.name} for ${room.currentBid}M`);
    }
  } else if (player) {
    room.log.push(`${player.name} was unsold`);
  }

  // Reset current player (do NOT auto-spin; host must press Start Spin)
  room.currentPlayer = null;
  room.currentBid = 0;
  room.currentBidder = null;
  room.currentPosition = null;
  room.auctionActive = false;
  resetTimers(room);

  broadcastRoomState(roomId);
  // **No auto spin** - host must press Start Spin
}

function spinWheel(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.availablePlayers.length === 0) {
    room.log.push("No players left in pool");
    broadcastRoomState(roomId);
    return;
  }

  room.spinInProgress = true;
  room.auctionActive = false;
  room.currentPlayer = null;
  room.currentPosition = null;
  room.currentBid = 0;
  room.currentBidder = null;
  resetTimers(room);
  broadcastRoomState(roomId);

  // positions array; order is important for wheel slices (10 slices)
  const positions = ["GK", "CB", "RB", "LB", "RW", "CF", "AM", "LW", "CM", "DM"];
  const chosenIndex = Math.floor(Math.random() * positions.length);
  const position = positions[chosenIndex];

  // pick player (removes from availablePlayers)
  const player = pickRandomPlayerByPosition(room, position);

  // after small delay to allow client wheel animation, we set current player
  // but we need to inform clients immediately which slice index they should animate to
  // emit wheelResult with index + position; clients will animate and then request state/receive later
  io.to(roomId).emit("wheelResult", { index: chosenIndex, position });

  // set a short timeout (2.5s) to mirror wheel animation time before revealing player and starting timers
  setTimeout(() => {
    room.spinInProgress = false;
    if (!player) {
      broadcastRoomState(roomId);
      return;
    }
    room.currentPlayer = player;
    room.currentPosition = position;
    room.currentBid = 0;
    room.currentBidder = null;
    room.auctionActive = true;
    room.log.push(`Wheel picked position ${position} → ${player.name} (${player.basePrice}M)`);
    broadcastRoomState(roomId);
    startInitialTimer(roomId);
  }, 2500);
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
    socket.emit("roomJoined", roomId); // tell creator they joined & switch UI
    broadcastRoomState(roomId);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("error", "Room not found");
    if (room.players[socket.id]) return socket.emit("roomJoined", roomId); // already joined
    // limit room size to 6
    if (Object.keys(room.players).length >= 6) return socket.emit("error", "Room is full");
    room.players[socket.id] = {
      name,
      balance: 1000,
      team: []
    };
    socket.join(roomId);
    socket.emit("roomJoined", roomId); // inform joining client to switch UI
    room.log.push(`${name} joined the room`);
    broadcastRoomState(roomId);
  });

  socket.on("startSpin", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    // only host can start
    if (socket.id !== room.hostId) return;
    // don't start if spin already in progress or auction active
    if (room.spinInProgress || room.auctionActive) return;
    spinWheel(roomId);
  });

  socket.on("bid", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive || !room.currentPlayer) return;

    if (!room.players[socket.id]) return;

    const playerObj = room.players[socket.id];

    let nextBid =
      room.currentBid === 0
        ? room.currentPlayer.basePrice
        : room.currentBid < 200
        ? room.currentBid + 5
        : room.currentBid + 10;

    if (playerObj.balance < nextBid) {
      socket.emit("error", "Insufficient balance");
      return;
    }

    // first bid: stop initial timer and start bid timer
    if (room.currentBid === 0) {
      if (room.initialTimer) {
        clearInterval(room.initialTimer);
        room.initialTimer = null;
      }
      startBidTimer(roomId);
    } else {
      // reset bid timer to 30s
      room.bidTimeLeft = 30;
    }

    room.currentBid = nextBid;
    room.currentBidder = socket.id;
    room.log.push(`${playerObj.name} bid ${nextBid}M for ${room.currentPlayer.name}`);
    broadcastRoomState(roomId);
  });

  socket.on("skip", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive || !room.currentPlayer) return;
    if (!room.players[socket.id]) return;

    if (!room.skippedPlayers.includes(socket.id)) {
      room.skippedPlayers.push(socket.id);
      room.log.push(`${room.players[socket.id].name} skipped ${room.currentPlayer.name}`);
    }
    // if everyone skipped -> end
    const totalPlayers = Object.keys(room.players).length;
    if (room.skippedPlayers.length === totalPlayers) {
      if (room.initialTimer) { clearInterval(room.initialTimer); room.initialTimer = null; }
      if (room.bidTimer) { clearInterval(room.bidTimer); room.bidTimer = null; }
      endCurrentPlayer(roomId);
    }
    broadcastRoomState(roomId);
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (!room) continue;
      if (room.players[socket.id]) {
        // preserve player data but mark absent: do NOT delete so state remains for others
        // we will keep player entry but flag as disconnected by setting name suffix (optional)
        // For simplicity we keep the entry; it will rejoin if same socket id returns (unlikely)
        delete room.players[socket.id];
        room.log.push(`A player disconnected`);
        // if host left -> transfer host to first remaining player (if any)
        if (room.hostId === socket.id) {
          const remaining = Object.keys(room.players);
          room.hostId = remaining.length ? remaining[0] : null;
          if (room.hostId) room.log.push(`${room.players[room.hostId].name} is now host`);
        }
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
