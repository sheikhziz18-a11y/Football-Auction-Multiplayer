/* =================================
   Socket Init
================================= */

const socket = io();

/* =================================
   PAGE ELEMENTS
================================= */

// Login
const loginPage = document.getElementById("loginPage");
const auctionPage = document.getElementById("auctionPage");

const createName = document.getElementById("createName");
const joinName = document.getElementById("joinName");
const joinRoomId = document.getElementById("joinRoomId");

document.getElementById("createRoomBtn").onclick = () => {
  if (!createName.value) return alert("Enter your name");
  socket.emit("createRoom", createName.value);
};

document.getElementById("joinRoomBtn").onclick = () => {
  if (!joinName.value || !joinRoomId.value) return alert("Enter all fields");
  socket.emit("joinRoom", { roomId: joinRoomId.value.trim(), name: joinName.value });
};

// Auction Page
const roomIdDisplay = document.getElementById("roomIdDisplay");
const startSpinBtn = document.getElementById("startSpinBtn");
const wheel = document.getElementById("wheel");

const playerCard = document.getElementById("playerCard");
const playerNameBox = document.getElementById("playerName");
const playerPosBox = document.getElementById("playerPos");
const playerBaseBox = document.getElementById("playerBase");

const initialTimerBox = document.getElementById("initialTimer");
const bidTimerBox = document.getElementById("bidTimer");

const bidBtn = document.getElementById("bidBtn");
const skipBtn = document.getElementById("skipBtn");
const universalSkipBtn = document.getElementById("universalSkipBtn");

const logBox = document.getElementById("logBox");
const summaryList = document.getElementById("summaryList");

/* =================================
   ROOM DATA (LOCAL)
================================= */

let currentRoom = null;
let myId = null;

/* =================================
   SOCKET RESPONSES
================================= */

// When room is created
socket.on("roomCreated", (roomId) => {
  currentRoom = roomId;
  joinAuctionPage(roomId);
});

// When error occurs
socket.on("error", (msg) => {
  alert(msg);
});

// When full room state updates
socket.on("roomState", (state) => {
  renderRoomState(state);
});

/* =================================
   PAGE SWITCH
================================= */

function joinAuctionPage(roomId) {
  loginPage.classList.add("hidden");
  auctionPage.classList.remove("hidden");
  roomIdDisplay.innerText = "Room ID — " + roomId;
}

/* =================================
   RENDER UI BASED ON ROOM STATE
================================= */

function renderRoomState(state) {
  // Save ID
  if (!myId) myId = socket.id;

  // Host UI control:
  if (myId === state.hostId) {
    startSpinBtn.style.display = "inline-block";
    universalSkipBtn.style.display = "inline-block";
  } else {
    startSpinBtn.style.display = "none";
    universalSkipBtn.style.display = "none";
  }

  // Player card
  if (state.currentPlayer) {
    playerNameBox.innerText = state.currentPlayer.name;
    playerPosBox.innerText = "(" + state.currentPosition + ")";
    playerBaseBox.innerText = "Base Price: " + state.currentPlayer.basePrice + "M";
  } else {
    playerNameBox.innerText = "Player Name";
    playerPosBox.innerText = "Position";
    playerBaseBox.innerText = "Base Price";
  }

  // Timers
  initialTimerBox.innerText = state.initialTimeLeft;
  bidTimerBox.innerText = state.bidTimeLeft;

  // Disable bid button if:
  // - No active auction
  // - No current player
  // - Player is highest bidder
  // - Player has 11 players
  // - Player has no balance for next bid
  if (!state.auctionActive || !state.currentPlayer) {
    bidBtn.disabled = true;
  } else {
    const me = state.players[myId];
    if (!me || me.team.length >= 11) {
      bidBtn.disabled = true;
    } else {

      // next bid calc
      let nextBid =
        state.currentBid === 0
          ? state.currentPlayer.basePrice
          : state.currentBid < 200
          ? state.currentBid + 5
          : state.currentBid + 10;

      bidBtn.innerText = "Bid " + nextBid + "M";

      if (state.currentBidder === myId || me.balance < nextBid) {
        bidBtn.disabled = true;
      } else {
        bidBtn.disabled = false;
      }
    }
  }

  // Skip button active only during auction
  skipBtn.disabled = !(state.auctionActive && state.currentPlayer);

  // Log: show only changes
  // (Simplified: append activity based on timers and bids)
  // You may extend this if you want richer logs.

  // Summary
  renderSummary(state.players);
}

/* =================================
   SUMMARY WITH CLICK-TO-EXPAND TEAMS
================================= */

function renderSummary(players) {
  summaryList.innerHTML = "";

  for (let id in players) {
    let p = players[id];

    const div = document.createElement("div");
    div.className = "summary-player";

    let balanceTxt = `${p.balance}M`;
    let teamCountTxt = `${p.team.length}/11`;

    div.innerHTML = `
      <div><b>${p.name}</b> — Balance: ${balanceTxt} — Players: ${teamCountTxt}</div>
      <div class="player-team" id="team-${id}">
        ${p.team.map(t => `${t.name} — ${t.price}M`).join("<br>")}
      </div>
    `;

    div.onclick = () => {
      let box = document.getElementById("team-" + id);
      box.classList.toggle("show");
    };

    summaryList.appendChild(div);
  }
}

/* =================================
   BUTTON ACTIONS
================================= */

startSpinBtn.onclick = () => {
  socket.emit("startSpin", currentRoom);
  spinWheel();
};

bidBtn.onclick = () => {
  socket.emit("bid", currentRoom);
};

skipBtn.onclick = () => {
  socket.emit("skip", currentRoom);
};

universalSkipBtn.onclick = () => {
  socket.emit("universalSkip", currentRoom);
};

/* =================================
   WHEEL ANIMATION
================================= */

function spinWheel() {
  wheel.classList.add("spin");
  setTimeout(() => {
    wheel.classList.remove("spin");
  }, 2500);
}
