// script.js
const socket = io();

/* PAGE ELEMENTS */
const loginPage = document.getElementById("loginPage");
const auctionPage = document.getElementById("auctionPage");

const createName = document.getElementById("createName");
const joinName = document.getElementById("joinName");
const joinRoomId = document.getElementById("joinRoomId");

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

let currentRoom = null;
let myId = null;

/* CREATE / JOIN */
document.getElementById("createRoomBtn").onclick = () => {
  if (!createName.value) return alert("Enter your name");
  socket.emit("createRoom", createName.value);
};

document.getElementById("joinRoomBtn").onclick = () => {
  if (!joinName.value || !joinRoomId.value) return alert("Enter all fields");
  socket.emit("joinRoom", { roomId: joinRoomId.value.trim(), name: joinName.value });
};

/* SOCKET EVENTS */
socket.on("roomJoined", (roomId) => {
  currentRoom = roomId;
  joinAuctionPage(roomId);
});

socket.on("roomCreated", (roomId) => {
  // older code sometimes emits roomCreated; handle gracefully
  if (!currentRoom) {
    currentRoom = roomId;
    joinAuctionPage(roomId);
  }
});

socket.on("roomState", (state) => {
  renderRoomState(state);
});

socket.on("error", (msg) => {
  alert(msg);
});

// server sends wheelResult { index, position }
socket.on("wheelResult", ({ index, position }) => {
  animateWheelToIndex(index);
});

/* UI switching */
function joinAuctionPage(roomId) {
  loginPage.classList.add("hidden");
  auctionPage.classList.remove("hidden");
  roomIdDisplay.innerText = "Room ID — " + roomId;
}

/* render */
function renderRoomState(state) {
  if (!myId) myId = socket.id;

  // show host controls
  startSpinBtn.style.display = myId === state.hostId ? "inline-block" : "none";

  // show current player
  if (state.currentPlayer) {
    playerNameBox.innerText = state.currentPlayer.name || "Player Name";
    playerPosBox.innerText = "(" + (state.currentPosition || "") + ")";
    playerBaseBox.innerText = "Base Price: " + state.currentPlayer.basePrice + "M";
  } else {
    playerNameBox.innerText = "Player Name";
    playerPosBox.innerText = "Position";
    playerBaseBox.innerText = "Base Price";
  }

  // timers
  initialTimerBox.innerText = typeof state.initialTimeLeft === "number" ? state.initialTimeLeft : 60;
  bidTimerBox.innerText = typeof state.bidTimeLeft === "number" ? state.bidTimeLeft : 30;

  // bid button logic
  if (!state.auctionActive || !state.currentPlayer) {
    bidBtn.disabled = true;
  } else {
    const me = state.players[myId];
    if (!me || me.team.length >= 11) {
      bidBtn.disabled = true;
    } else {
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

  skipBtn.disabled = !(state.auctionActive && state.currentPlayer);

  // log
  logBox.innerHTML = "";
  if (Array.isArray(state.log)) {
    state.log.slice(-200).forEach(line => {
      const d = document.createElement("div");
      d.innerText = line;
      logBox.appendChild(d);
    });
    logBox.scrollTop = logBox.scrollHeight;
  }

  // summary
  renderSummary(state.players);
}

/* summary with expandable teams */
function renderSummary(players) {
  summaryList.innerHTML = "";
  for (let id in players) {
    const p = players[id];
    const div = document.createElement("div");
    div.className = "summary-player";
    const balanceTxt = `${p.balance}M`;
    const teamCountTxt = `${p.team.length}/11`;
    div.innerHTML = `
      <div><b>${p.name}</b> — Balance: ${balanceTxt} — Players: ${teamCountTxt}</div>
      <div class="player-team" id="team-${id}">
        ${p.team.map(t => `${t.name} — ${t.price}M`).join("<br>")}
      </div>
    `;
    div.onclick = () => {
      const el = document.getElementById("team-" + id);
      if (el) el.classList.toggle("show");
    };
    summaryList.appendChild(div);
  }
}

/* BUTTON ACTIONS */
startSpinBtn.onclick = () => {
  if (!currentRoom) return alert("Room not set");
  socket.emit("startSpin", currentRoom);
  // client-side wheel rotation will happen when server emits wheelResult
};

bidBtn.onclick = () => {
  if (!currentRoom) return alert("Not in a room");
  socket.emit("bid", currentRoom);
};

skipBtn.onclick = () => {
  if (!currentRoom) return alert("Not in a room");
  socket.emit("skip", currentRoom);
};

/* WHEEL ANIMATION (real wheel with 10 slices) */
let wheelRotation = 0;

function animateWheelToIndex(index) {
  // 10 slices -> each slice angle = 360/10 = 36 degrees
  const slices = 10;
  const sliceAngle = 360 / slices;
  // target center of slice index
  const targetAngle = index * sliceAngle + sliceAngle / 2;
  // Add rotations so it spins multiple times before stopping
  const rotations = 6; // number of full rotations
  const finalAngle = rotations * 360 + (360 - targetAngle); // invert because CSS rotation direction

  // animate
  wheel.style.transition = "transform 2.5s cubic-bezier(.25,.8,.25,1)";
  wheelRotation = finalAngle;
  wheel.style.transform = `rotate(${wheelRotation}deg)`;

  // After animation ends, clear transition so future animations are immediate before next transform set
  setTimeout(() => {
    wheel.style.transition = "";
    // Normalize rotation to small angle to avoid huge numbers
    const normalized = wheelRotation % 360;
    wheelRotation = normalized;
    wheel.style.transform = `rotate(${wheelRotation}deg)`;
  }, 2600);
}

/* SAFETY: attempt to join if page reloaded and we have a room param in URL (optional) */
(function tryAutoJoinFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const r = params.get("room");
  const n = params.get("name");
  if (r && n) {
    joinRoomId.value = r;
    joinName.value = n;
    document.getElementById("joinRoomBtn").click();
  }
})();
