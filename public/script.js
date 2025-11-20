/* =================================
   Socket Init
================================= */
const socket = io();

/* =================================
   PAGE ELEMENTS
================================= */
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

const roomIdDisplay = document.getElementById("roomIdDisplay");
const startSpinBtn = document.getElementById("startSpinBtn");
const wheel = document.getElementById("wheel");

const playerNameBox = document.getElementById("playerName");
const playerPosBox = document.getElementById("playerPos");
const playerBaseBox = document.getElementById("playerBase");

const initialTimerBox = document.getElementById("initialTimer");
const bidTimerBox = document.getElementById("bidTimer");

const bidBtn = document.getElementById("bidBtn");
const skipBtn = document.getElementById("skipBtn");

const logBox = document.getElementById("logBox");
const summaryList = document.getElementById("summaryList");

/* =================================
   ROOM DATA
================================= */
let currentRoom = null;
let myId = null;

/* =================================
   SOCKET RESPONSES
================================= */
socket.on("roomCreated", (roomId) => {
  currentRoom = roomId;
  joinAuctionPage(roomId);
});

socket.on("error", (msg) => alert(msg));

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
   RENDER UI
================================= */
function renderRoomState(state) {
  if (!myId) myId = socket.id;

  // Host control
  startSpinBtn.style.display = myId === state.hostId ? "inline-block" : "none";

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

  // Bid button
  if (!state.auctionActive || !state.currentPlayer) {
    bidBtn.disabled = true;
  } else {
    const me = state.players[myId];
    if (!me || me.team.length >= 11) bidBtn.disabled = true;
    else {
      let nextBid =
        state.currentBid === 0
          ? state.currentPlayer.basePrice
          : state.currentBid < 200
          ? state.currentBid + 5
          : state.currentBid + 10;
      bidBtn.innerText = "Bid " + nextBid + "M";
      bidBtn.disabled = state.currentBidder === myId || me.balance < nextBid;
    }
  }

  // Skip button
  skipBtn.disabled = !(state.auctionActive && state.currentPlayer);

  // Log
  logBox.innerHTML = state.log.join("<br>");

  // Summary
  renderSummary(state.players);
}

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
    div.onclick = () => document.getElementById("team-" + id).classList.toggle("show");
    summaryList.appendChild(div);
  }
}

/* =================================
   BUTTON ACTIONS
================================= */
startSpinBtn.onclick = () => {
  socket.emit("startSpin", currentRoom);
};

bidBtn.onclick = () => {
  socket.emit("bid", currentRoom);
};

skipBtn.onclick = () => {
  socket.emit("skip", currentRoom);
};
