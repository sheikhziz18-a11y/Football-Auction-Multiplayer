const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

// Load players once (144 players)
let MASTER_PLAYERS = JSON.parse(fs.readFileSync("shuffled_players.json", "utf8"));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

/* ===========================
   GAME STATE (PER ROOM)
=========================== */
let rooms = {}; 
// rooms[roomId] = {
//   hostId,
//   players: { socketId: {name, balance, team, active, lastJoinTime} },
//   availablePlayers: [...],
//   currentPlayer: null,
//   currentPosition: null,
//   currentBid: 0,
//   currentBidder: null,
//   initialTimer: null,
//   bidTimer: null,
//   initialTimeLeft: 60,
//   bidTimeLeft: 30,
//   spinInProgress: false,
//   auctionActive: false
// }

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

  /* ---- Create Room ---- */
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
      initialTimer: null,
      bidTimer: null,
      initialTimeLeft: 60,
      bidTimeLeft: 30,
      spinInProgress: false,
      auctionActive: false
    };

    rooms[roomId].players[socket.id] = {
      name,
      balance: 1000,
      team: [],
      active: true,
      lastJoinTime: Date.now()
    };

    socket.join(roomId);
    socket.emit("roomCreated", roomId);
    broadcastRoomState(roomId);
  });

  /* ---- Join Room ---- */
  socket.on("joinRoom", ({ roomId, name }) => {
    if (!rooms[roomId]) {
      socket.emit("error", "Room does not exist");
      return;
    }
    if (Object.keys(rooms[roomId].players).length >= 6) {
      socket.emit("error", "Room is full");
      return;
    }

    rooms[roomId].players[socket.id] = {
      name,
      balance: 1000,
      team: [],
      active: true,
      lastJoinTime: Date.now()
    };

    socket.join(roomId);
    broadcastRoomState(roomId);
  });

  /* ---- Start Spin (Host Only) ---- */
  socket.on("startSpin", (roomId) => {
    let room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.spinInProgress) return;

    room.spinInProgress = true;
    room.auctionActive = false;
    room.currentPlayer = null;
    room.currentPosition = null;

    resetTimers(room);
    broadcastRoomState(roomId);

    // after wheel animation (2.5s)
    setTimeout(() => {
      const positions = ["GK", "LB", "RB", "CB", "DM", "CM", "AM", "LW", "RW", "CF"];
      room.currentPosition = positions[Math.floor(Math.random() * positions.length)];

      // pick available player
      let candidates = room.availablePlayers.filter(
        (p) => p.position === room.currentPosition
      );

      if (candidates.length === 0) {
        // fallback: re-spin automatically
        room.spinInProgress = false;
        socket.emit("error", "No players left for this position.");
        return;
      }

      room.currentPlayer = candidates[Math.floor(Math.random() * candidates.length)];
      room.currentBid = 0;
      room.currentBidder = null;
      room.auctionActive = true;

      // Start initial timer 60s
      room.initialTimer = setInterval(() => {
        room.initialTimeLeft--;
        if (room.initialTimeLeft <= 0) {
          clearInterval(room.initialTimer);
          // No bids → player removed from pool
          room.availablePlayers = room.availablePlayers.filter(
            (p) => p.name !== room.currentPlayer.name
          );
          room.auctionActive = false;
        }
        broadcastRoomState(roomId);
      }, 1000);

      room.spinInProgress = false;
      broadcastRoomState(roomId);

    }, 2500);
  });

  /* ---- Bid ---- */
  socket.on("bid", (roomId) => {
    let room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    let player = room.currentPlayer;
    if (!player) return;

    let user = room.players[socket.id];
    if (!user) return;

    // Already has 11 players?
    if (user.team.length >= 11) {
      socket.emit("error", "You already have 11 players.");
      return;
    }

    // Determine next bid:
    let nextBid =
      room.currentBid === 0
        ? player.basePrice
        : room.currentBid < 200
        ? room.currentBid + 5
        : room.currentBid + 10;

    if (user.balance < nextBid) {
      socket.emit("error", "Not enough balance to bid.");
      return;
    }

    // WHEN FIRST BID HAPPENS → STOP 60s TIMER AND START 30s
    if (room.currentBid === 0) {
      if (room.initialTimer) clearInterval(room.initialTimer);
      room.bidTimeLeft = 30;
      room.bidTimer = setInterval(() => {
        room.bidTimeLeft--;
        if (room.bidTimeLeft <= 0) {
          clearInterval(room.bidTimer);
          // finalize sale
          let winner = room.players[room.currentBidder];
          if (winner && winner.balance >= room.currentBid) {
            winner.balance -= room.currentBid;
            winner.team.push({
              name: player.name,
              price: room.currentBid
            });
          }
          // remove from pool
          room.availablePlayers = room.availablePlayers.filter(
            (p) => p.name !== player.name
          );
          room.auctionActive = false;
        }
        broadcastRoomState(roomId);
      }, 1000);
    } else {
      // reset per-bid timer
      room.bidTimeLeft = 30;
    }

    room.currentBid = nextBid;
    room.currentBidder = socket.id;

    broadcastRoomState(roomId);
  });

  /* ---- Skip ---- */
  socket.on("skip", (roomId) => {
    let room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    rooms[roomId].players[socket.id].active = false;

    // Check if all active players are skipped
    let activeRemaining = Object.values(room.players).filter((p) => p.active);
    if (activeRemaining.length === 0) {
      // remove player from pool
      room.availablePlayers = room.availablePlayers.filter(
        (p) => p.name !== room.currentPlayer.name
      );
      room.auctionActive = false;
      resetTimers(room);
    }
    broadcastRoomState(roomId);
  });

  /* ---- Universal Skip (Host Only) ---- */
  socket.on("universalSkip", (roomId) => {
    let room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (!room.auctionActive) return;

    // remove player permanently
    room.availablePlayers = room.availablePlayers.filter(
      (p) => p.name !== room.currentPlayer.name
    );

    room.auctionActive = false;
    resetTimers(room);
    broadcastRoomState(roomId);
  });

  /* ---- Disconnect ---- */
  socket.on("disconnect", () => {
    for (let roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        rooms[roomId].players[socket.id].active = false;

        // Host leaves → next user becomes host
        if (rooms[roomId].hostId === socket.id) {
          let others = Object.keys(rooms[roomId].players).filter(
            (id) => id !== socket.id
          );
          if (others.length > 0) {
            rooms[roomId].hostId = others[0];
          }
        }

        broadcastRoomState(roomId);
      }
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
