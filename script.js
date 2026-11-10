// --- LOGIC ---
let peer, conn, isHost = false, connected = false;
let turnTime = 30, timeLeft = 0, timerInt;
let mySecret = "", mySecretSet = false, opSecretSet = false;
let isMyTurn = false, myRematch = false, opRematch = false;

const ID_PREFIX = "genesis-"; // namespaces our IDs on the shared public PeerJS server
const el = id => document.getElementById(id);
const screens = ['menu', 'lobby', 'setup', 'game', 'end'];

// ================== RELAY (TURN) SETUP ==================
// Phones on 5G/mobile data sit behind carrier-grade NAT, so direct peer-to-peer
// fails ("Negotiation of connection failed"). A TURN server relays the traffic.
const METERED_APP = "";
const METERED_API_KEY = "";

// Static TURN credentials from the Metered dashboard
const EXTRA_TURN = [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: '9644acacf16f76d3e1dd488b', credential: '9kmWJ2Fxg48hQbZK' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: '9644acacf16f76d3e1dd488b', credential: '9kmWJ2Fxg48hQbZK' },
    { urls: 'turn:global.relay.metered.ca:443', username: '9644acacf16f76d3e1dd488b', credential: '9kmWJ2Fxg48hQbZK' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '9644acacf16f76d3e1dd488b', credential: '9kmWJ2Fxg48hQbZK' }
];

const BASE_STUN = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
];

async function getIceServers() {
    let servers = BASE_STUN.slice();
    if (METERED_APP && METERED_API_KEY) {
        try {
            const r = await fetch(`https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`);
            if (!r.ok) throw new Error("HTTP " + r.status);
            servers = servers.concat(await r.json());
        } catch (e) {
            console.warn("Could not fetch TURN credentials:", e);
        }
    }
    servers = servers.concat(EXTRA_TURN);
    if (servers.length === BASE_STUN.length) {
        console.warn("No TURN server configured: mobile-to-mobile play will usually fail.");
    }
    return servers;
}

function showScreen(name) {
    screens.forEach(s => el('screen-'+s).classList.add('hidden'));
    el('screen-'+name).classList.remove('hidden');
}

function failAndReset(msg) {
    alert(msg);
    location.reload();
}

// --- PEERJS ---
async function initPeer(shortId, hostTarget) {
    el('lobby-status').innerText = "Preparing secure relay...";
    const iceServers = await getIceServers();
    const code = shortId || Math.floor(10000 + Math.random() * 90000).toString();
    const fullId = (isHost ? ID_PREFIX : ID_PREFIX + "p2-") + code;
    peer = new Peer(fullId, { config: { iceServers, sdpSemantics: 'unified-plan' }, debug: 2 });

    peer.on('open', () => {
        el('my-peer-id').innerText = code; // show only the 5 digits
        if (!isHost) {
            el('lobby-status').innerText = "Connecting to " + hostTarget + "...";
            conn = peer.connect(ID_PREFIX + hostTarget, { reliable: true });
            setupConn();
            // If nothing happens in 30s, it's almost always a NAT/firewall problem
            setTimeout(() => {
                if (!connected) failAndReset("Could not connect to host. Check the ID, or the network is blocking direct connections (a TURN server is needed).");
            }, 30000);
        } else {
            el('lobby-status').innerText = "Waiting for opponent...";
        }
    });

    peer.on('connection', (c) => {
        if (!isHost) return;
        if (conn && conn.open) { c.close(); return; } // only one opponent
        conn = c;
        setupConn();
    });

    // Signaling server drops idle peers; reconnect so the host stays joinable
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            peer.destroy();
            initPeer(null, hostTarget); // new random ID
        } else if (err.type === 'peer-unavailable') {
            failAndReset("No host found with that ID. Check the code and make sure the host is still on the waiting screen.");
        } else {
            failAndReset("Connection error: " + err.type);
        }
    });
}

function setupConn() {
    conn.on('open', () => {
        connected = true;
        showScreen('setup');
        if (isHost) el('host-controls').classList.remove('hidden');
    });
    conn.on('data', handleData);
    conn.on('close', () => { alert("Connection Lost"); location.reload(); });
    conn.on('error', (e) => { alert("Connection error: " + e); location.reload(); });
}

function hostGame() { isHost = true; showScreen('lobby'); initPeer(); }

function joinGame() {
    const hostId = el('join-id').value.trim();
    if (hostId.length !== 5) return alert("Enter the 5-digit ID");
    isHost = false;
    showScreen('lobby');
    initPeer(null, hostId);
}

// --- GAMEPLAY ---
function lockSequence() {
    const val = el('secret-input').value;
    if(val.length !== 4) return alert("4 Digits Required");
    mySecret = val; mySecretSet = true;

    el('secret-input').disabled = true;
    el('lock-btn').disabled = true;
    el('lock-btn').innerText = "LOCKED";
    el('setup-status').innerText = "Awaiting Opponent...";

    if(isHost) turnTime = parseInt(el('timer-slider').value);
    conn.send({ type: 'READY' });
    checkStart();
}

function checkStart() {
    if(mySecretSet && opSecretSet) {
        if(isHost) { conn.send({ type: 'START', time: turnTime }); startGame(); }
    }
}

function startGame() {
    showScreen('game');
    el('game-history').innerHTML = '';
    startTurn(isHost);
}

function startTurn(mine) {
    isMyTurn = mine;
    timeLeft = turnTime;
    updateTimer();
    clearInterval(timerInt);

    if(isMyTurn) {
        el('turn-badge').innerText = "YOUR TURN";
        el('turn-badge').classList.add('active-turn');
        el('guess-input').disabled = false;
        el('guess-input').value = '';
        el('guess-input').focus();

        timerInt = setInterval(() => {
            timeLeft--;
            updateTimer();
            if(timeLeft <= 0) {
                clearInterval(timerInt);
                conn.send({ type: 'SKIP' });
                addLog("TIMEOUT", 0, 0, true);
                startTurn(false);
            }
        }, 1000);
    } else {
        el('turn-badge').innerText = "OPPONENT TURN";
        el('turn-badge').classList.remove('active-turn');
        el('guess-input').disabled = true;
    }
}

function updateTimer() { el('timer-badge').innerText = timeLeft + "s"; }

function transmitGuess() {
    if(!isMyTurn) return;
    const val = el('guess-input').value;
    if(val.length !== 4) return;
    clearInterval(timerInt);
    el('guess-input').disabled = true;
    conn.send({ type: 'GUESS', val: val });
}

function handleData(d) {
    switch(d.type) {
        case 'READY':
            opSecretSet = true;
            if(mySecretSet) checkStart(); else el('setup-status').innerText = "Opponent Ready...";
            break;
        case 'START':
            turnTime = d.time; startGame();
            break;
        case 'GUESS': {
            const res = analyze(mySecret, d.val);
            if(res.place === 4) {
                conn.send({ type: 'WIN', val: d.val });
                endGame(false);
            } else {
                conn.send({ type: 'RES', val: d.val, res: res });
                addLog(d.val, res.num, res.place, false, true);
                startTurn(true);
            }
            break;
        }
        case 'RES':
            addLog(d.val, d.res.num, d.res.place, false, false);
            startTurn(false);
            break;
        case 'SKIP':
            addLog("OPPONENT TIMEOUT", 0, 0, true);
            startTurn(true);
            break;
        case 'WIN':
            addLog(d.val, 4, 4, false, false);
            endGame(true);
            break;
        case 'REMATCH_REQ':
            opRematch = true;
            el('rematch-status').innerText = "Opponent requesting reset...";
            checkRematch();
            break;
        case 'REMATCH_GO':
            resetGame();
            break;
    }
}

// --- ANALYSIS LOGIC ---
function analyze(secret, guess) {
    let place = 0;
    for(let i=0; i<4; i++) if(secret[i] === guess[i]) place++;

    let s2 = secret.split(''), num = 0;
    for(let i=0; i<4; i++) {
        const idx = s2.indexOf(guess[i]);
        if(idx !== -1) { num++; s2[idx] = null; }
    }
    return { num, place };
}

function addLog(guess, num, place, isMsg, isOpp) {
    const div = document.createElement('div');
    div.className = 'log-entry';

    if(isMsg) {
        div.innerHTML = `<span style="width:100%; text-align:center; color:#666;">${guess}</span>`;
    } else {
        const label = isOpp ? `<span style="font-size:0.6rem; vertical-align:middle; color:#666; margin-right:5px;">(OPP)</span>` : "";
        div.innerHTML = `
            <div class="log-guess">${label}${guess}</div>
            <div class="log-analysis">
                <span class="highlight">${num}</span> Correct Numbers<br>
                <span class="highlight">${place}</span> Correct Place
            </div>
        `;
    }
    el('game-history').prepend(div);
}

function endGame(win) {
    clearInterval(timerInt);
    showScreen('end');
    el('end-title').innerText = win ? "VICTORY" : "DEFEAT";
    el('end-title').style.color = win ? "#d4af37" : "#555";
    el('end-msg').innerText = win ? "Timeline Secured." : "Defense Breached.";
}

function requestRematch() {
    myRematch = true;
    el('rematch-btn').disabled = true;
    el('rematch-btn').innerText = "Requesting...";
    conn.send({ type: 'REMATCH_REQ' });
    checkRematch();
}

// Only the host triggers the reset, so both sides never reset twice
function checkRematch() {
    if(isHost && myRematch && opRematch) { conn.send({ type: 'REMATCH_GO' }); resetGame(); }
}

function resetGame() {
    mySecret = ""; mySecretSet = false; opSecretSet = false;
    myRematch = false; opRematch = false;
    el('secret-input').value = ''; el('secret-input').disabled = false;
    el('lock-btn').disabled = false; el('lock-btn').innerText = "Lock Sequence";
    el('setup-status').innerText = "";
    el('rematch-btn').disabled = false; el('rematch-btn').innerText = "Reset Timeline";
    el('rematch-status').innerText = "";
    showScreen('setup');
}

function copyId() {
    const text = el('my-peer-id').innerText;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => alert("ID Copied"), () => alert("ID: " + text));
    else alert("ID: " + text);
}

['secret-input', 'guess-input', 'join-id'].forEach(id => {
    el(id).addEventListener('input', function() { this.value = this.value.replace(/[^0-9]/g, ''); });
});
