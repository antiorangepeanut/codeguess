// --- LOGIC ---
let peer, conn, isHost = false;
let turnTime = 30, timeLeft = 0, timerInt;
let mySecret = "", mySecretSet = false, opSecretSet = false;
let isMyTurn = false, myRematch = false, opRematch = false;

const el = id => document.getElementById(id);
const screens = ['menu', 'lobby', 'setup', 'game', 'end'];

function showScreen(name) {
    screens.forEach(s => el('screen-'+s).classList.add('hidden'));
    el('screen-'+name).classList.remove('hidden');
}

// --- PEERJS ---
function initPeer(customId) {
    // Random 5-digit ID to prevent collisions
    const id = customId || Math.floor(10000 + Math.random() * 90000).toString();
    peer = new Peer(id);

    peer.on('open', (id) => {
        el('my-peer-id').innerText = id;
        if(!isHost) {
            const hostId = el('join-id').value.trim();
            if(!hostId) return alert("ID Required");
            el('lobby-status').innerText = "Connecting to " + hostId + "...";
            conn = peer.connect(hostId);
            setupConn();
        }
    });

    peer.on('connection', (c) => {
        if(isHost) { conn = c; setupConn(); }
    });

    peer.on('error', (err) => {
        if(err.type === 'unavailable-id') initPeer(); 
        else alert("Error: " + err.type);
    });
}

function setupConn() {
    conn.on('open', () => {
        showScreen('setup');
        if(isHost) el('host-controls').classList.remove('hidden');
    });
    conn.on('data', handleData);
    conn.on('close', () => { alert("Connection Lost"); location.reload(); });
}

function hostGame() { isHost = true; showScreen('lobby'); initPeer(); }
function joinGame() { isHost = false; showScreen('lobby'); initPeer("p2_" + Math.floor(10000+Math.random()*90000)); }

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
        case 'GUESS':
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
    let s = secret.split(''), g = guess.split('');
    let place = 0;
    
    // 1. Exact Matches (Correct Place)
    for(let i=0; i<4; i++) {
        if(s[i] === g[i]) {
            place++;
            s[i] = null; g[i] = null; // Mark as used
        }
    }
    
    // 2. Total Number Matches (Including Place)
    let s2 = secret.split(''), g2 = guess.split('');
    let num = 0;
    for(let i=0; i<4; i++) {
        let idx = s2.indexOf(g2[i]);
        if(idx !== -1) {
            num++;
            s2[idx] = null;
        }
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

function checkRematch() {
    if(myRematch && opRematch) { conn.send({ type: 'REMATCH_GO' }); resetGame(); }
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
    navigator.clipboard.writeText(el('my-peer-id').innerText);
    alert("ID Copied");
}

['secret-input', 'guess-input', 'join-id'].forEach(id => {
    el(id).addEventListener('input', function() { this.value = this.value.replace(/[^0-9]/g, ''); });
});
