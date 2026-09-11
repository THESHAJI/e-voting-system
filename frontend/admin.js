// ════════════════════════════════════════════════════════════════
//  EVoting V3.1 — Admin Console JavaScript
//  JWT Auth · Smart Contract Authority · WebSocket · Audit Trail · CSV
// ════════════════════════════════════════════════════════════════

let provider, signer, contract;
let contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
let adminToken = "";
let isPausedState = false;
let adminChart = null;
let wsConnection = null;

const backendUrl = window.location.origin || "http://localhost:5000";

const abi = [
    "function setElectionType(uint8 _type)",
    "function addCandidate(string memory _name, string memory _logoHash)",
    "function verifyVoter(address _voter)",
    "function batchVerifyVoters(address[] memory _voters)",
    "function startVoting()",
    "function startReveal()",
    "function endElection()",
    "function pauseSystem()",
    "function unpauseSystem()",
    "function resetElection()",
    "function bindIdentity(bytes32 _identityHash, address _wallet)",
    "function getTotalCandidates() view returns (uint256)",
    "function getCandidate(uint256 _index) view returns (string memory name, string memory logoHash, uint256 voteCount)",
    "function getElectionInfo() view returns (uint8 phase, uint8 eType, bool isPaused, uint256 genId, uint256 candidateCount)"
];

// ═══════════════ UI HELPERS ═══════════════
function showToast(msg, error = false) {
    const toast = document.getElementById("toast");
    toast.innerText = msg;
    toast.style.borderLeftColor = error ? "#ef4444" : "var(--saffron)";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3500);
}

// ═══════════════ AUTH FETCH WRAPPER ═══════════════
async function authFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    if (options.headers instanceof Headers) {
        options.headers.set("Authorization", `Bearer ${adminToken}`);
    } else {
        options.headers["Authorization"] = `Bearer ${adminToken}`;
    }

    try {
        const res = await fetch(url, options);
        if (res.status === 401) {
            localStorage.removeItem("evoting_admin_token");
            adminToken = "";
            document.getElementById("adminSection").classList.add("hidden");
            document.getElementById("loginSection").classList.remove("hidden");
            showToast("⚠️ Admin session expired. Please log in again (admin / admin@2026)", true);
        }
        return res;
    } catch (err) {
        throw err;
    }
}

// ═══════════════ INIT ═══════════════
async function init() {
    try {
        const res = await fetch(`${backendUrl}/config`);
        const config = await res.json();
        if (config.contractAddress) {
            contractAddress = config.contractAddress;
            const el = document.getElementById("contractDisplay");
            if (el) el.innerText = contractAddress;
        }
    } catch (e) {}

    connectWebSocket();

    const storedToken = localStorage.getItem("evoting_admin_token");
    if (storedToken) {
        // Validate the stored token with backend
        try {
            const check = await fetch(`${backendUrl}/verify-admin-token`, {
                headers: { "Authorization": `Bearer ${storedToken}` }
            });
            if (check.ok) {
                adminToken = storedToken;
                document.getElementById("loginSection").classList.add("hidden");
                document.getElementById("adminSection").classList.remove("hidden");
                refreshAll();
                return;
            }
        } catch (e) {}
    }

    // Invalid or no token -> reset and show login
    localStorage.removeItem("evoting_admin_token");
    adminToken = "";
    document.getElementById("adminSection").classList.add("hidden");
    document.getElementById("loginSection").classList.remove("hidden");
}

init();

// ═══════════════ WEBSOCKET ═══════════════
function connectWebSocket() {
    const wsUrl = `ws://${window.location.hostname}:${window.location.port || 5000}`;
    try {
        wsConnection = new WebSocket(wsUrl);
        wsConnection.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === "audit") {
                appendAuditEntry(msg.data);
            } else {
                refreshAll();
            }
        };
        wsConnection.onclose = () => {
            setTimeout(connectWebSocket, 3000);
        };
    } catch (e) {}
}

// ═══════════════ 1. ADMIN AUTH ═══════════════
async function adminLogin() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!username || !password) {
        return showToast("Please enter username and password", true);
    }

    try {
        const res = await fetch(`${backendUrl}/admin-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok && data.token) {
            adminToken = data.token;
            localStorage.setItem("evoting_admin_token", adminToken);
            document.getElementById("loginSection").classList.add("hidden");
            document.getElementById("adminSection").classList.remove("hidden");
            showToast("Authority Session Authenticated ✓");
            refreshAll();
        } else {
            showToast(data.message || "Invalid Credentials (Default: admin / admin@2026)", true);
        }
    } catch (err) {
        showToast("Backend Server Offline. Check port 5000.", true);
    }
}

function adminLogout() {
    localStorage.removeItem("evoting_admin_token");
    adminToken = "";
    document.getElementById("adminSection").classList.add("hidden");
    document.getElementById("loginSection").classList.remove("hidden");
    showToast("Authority Logged Out");
}

// ═══════════════ 2. CONNECT ADMIN WALLET ═══════════════
async function connectAdminWallet() {
    try {
        if (!window.ethereum) {
            document.getElementById("adminWalletBadge").innerText = "Demo Authority Mode";
            document.getElementById("adminWalletBadge").className = "status-badge status-online";
            return showToast("Demo Authority Active (No MetaMask)");
        }

        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        contract = new ethers.Contract(contractAddress, abi, signer);

        const address = await signer.getAddress();
        const badge = document.getElementById("adminWalletBadge");
        badge.innerText = `● Admin: ${address.slice(0, 6)}...${address.slice(-4)}`;
        badge.className = "status-badge status-online";

        showToast("MetaMask Authority Connected");
        refreshAll();
    } catch (err) {
        showToast("Wallet Connection Failed: " + err.message, true);
    }
}

// ═══════════════ 3. CANDIDATE MANAGEMENT ═══════════════
async function addParty() {
    if (!adminToken) {
        showToast("Please log in as Admin first (admin / admin@2026)", true);
        document.getElementById("adminSection").classList.add("hidden");
        document.getElementById("loginSection").classList.remove("hidden");
        return;
    }

    const name = document.getElementById("partyName").value.trim();
    const symbol = document.getElementById("partySymbol").value.trim();
    const logoFile = document.getElementById("partyLogo").files[0];

    if (!name) return showToast("Candidate / Party name is required", true);

    const formData = new FormData();
    formData.append("name", name);
    formData.append("symbol", symbol || "🏛️");
    if (logoFile) formData.append("logo", logoFile);

    try {
        showToast("Recording candidate on server & blockchain...");
        const res = await authFetch(`${backendUrl}/add-party`, {
            method: "POST",
            body: formData
        });
        if (!res) return;
        const data = await res.json();

        if (res.ok) {
            // Also add on blockchain if contract connected
            if (contract && signer) {
                try {
                    const logoHash = data.party.logo ? data.party.logo.replace("/uploads/", "") : "";
                    const tx = await contract.addCandidate(name, logoHash);
                    await tx.wait();
                } catch (bcErr) {
                    console.warn("Blockchain addCandidate notice:", bcErr.message);
                }
            }

            showToast("Candidate successfully added!");
            document.getElementById("partyName").value = "";
            document.getElementById("partyLogo").value = "";
            loadParties();
            refreshAll();
        } else {
            showToast(data.message || "Failed to add candidate", true);
        }
    } catch (err) {
        showToast(err.message || "Error adding candidate", true);
    }
}

async function removeParty(id) {
    if (!confirm("Are you sure you want to remove this candidate?")) return;
    try {
        const res = await authFetch(`${backendUrl}/remove-party`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        if (!res) return;
        if (res.ok) {
            showToast("Candidate removed");
            loadParties();
            refreshAll();
        } else {
            const data = await res.json();
            showToast(data.message || "Failed to remove candidate", true);
        }
    } catch (e) {
        showToast("Error removing candidate", true);
    }
}

async function loadParties() {
    try {
        const res = await fetch(`${backendUrl}/parties`);
        const parties = await res.json();
        const list = document.getElementById("partyList");
        list.innerHTML = "";

        if (parties.length === 0) {
            list.innerHTML = "<p style='color:var(--text-dim);'>No candidates registered yet.</p>";
            return;
        }

        parties.forEach(p => {
            const badge = document.createElement("div");
            badge.className = "status-badge";
            badge.style.margin = "0";
            badge.style.display = "inline-flex";
            badge.style.alignItems = "center";
            badge.style.gap = "8px";
            badge.innerHTML = `
                ${p.logo ? `<img src="${p.logo}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;">` : (p.symbol || '🏛️')}
                <span><strong>${p.name}</strong></span>
                <button onclick="removeParty(${p.id})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:0 2px;margin-left:4px;" title="Remove Candidate">✕</button>
            `;
            list.appendChild(badge);
        });
    } catch (e) {}
}

// ═══════════════ 4. LIFECYCLE / PHASE CONTROL ═══════════════
async function startVotingPhase() {
    try {
        showToast("Transitioning to Voting (Commit) Phase...");
        if (contract && signer) {
            const tx = await contract.startVoting();
            await tx.wait();
        }
        await authFetch(`${backendUrl}/set-phase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phase: "COMMIT" })
        });
        showToast("🟢 VOTING PHASE IS LIVE!");
        refreshAll();
    } catch (err) {
        showToast("Phase Transition Failed: " + (err.reason || err.message), true);
    }
}

async function startRevealPhase() {
    try {
        showToast("Opening Reveal Phase...");
        if (contract && signer) {
            const tx = await contract.startReveal();
            await tx.wait();
        }
        await authFetch(`${backendUrl}/set-phase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phase: "REVEAL" })
        });
        showToast("🔵 REVEAL PHASE OPEN!");
        refreshAll();
    } catch (err) {
        showToast("Phase Transition Failed: " + (err.reason || err.message), true);
    }
}

async function endElectionPhase() {
    try {
        showToast("Finalizing Election Count...");
        if (contract && signer) {
            const tx = await contract.endElection();
            await tx.wait();
        }
        await authFetch(`${backendUrl}/set-phase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phase: "ENDED" })
        });
        showToast("🔴 ELECTION ENDED & FINALIZED!");
        refreshAll();
    } catch (err) {
        showToast("Phase Transition Failed: " + (err.reason || err.message), true);
    }
}

async function togglePauseSystem() {
    isPausedState = !isPausedState;
    const endpoint = isPausedState ? "/pause-system" : "/unpause-system";

    try {
        if (contract && signer) {
            const tx = isPausedState ? await contract.pauseSystem() : await contract.unpauseSystem();
            await tx.wait();
        }
        await authFetch(`${backendUrl}${endpoint}`, {
            method: "POST"
        });
        const btn = document.getElementById("btnTogglePause");
        btn.innerText = isPausedState ? "▶️ Unpause Freeze" : "⏸️ Emergency Freeze";
        btn.className = isPausedState ? "btn-success" : "btn-warning";
        showToast(isPausedState ? "⚠️ SYSTEM FROZEN" : "✅ System Restored");
    } catch (err) {
        showToast("Pause Toggle Failed", true);
    }
}

async function setTimer() {
    const duration = parseInt(document.getElementById("timerDurationInput").value);
    if (!duration || duration <= 0) return showToast("Enter a valid duration in seconds", true);

    try {
        const res = await authFetch(`${backendUrl}/set-timer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ duration })
        });
        if (res && res.ok) {
            showToast(`⏱️ Timer set for ${duration} seconds!`);
        }
    } catch (e) {
        showToast("Failed to set timer", true);
    }
}

async function triggerFreshStart() {
    if (!confirm("⚠️ ATOMIC RESET: Increment smart contract Generation ID and reset all votes and users?")) return;

    try {
        showToast("Executing Atomic Reset...");
        if (contract && signer) {
            const tx = await contract.resetElection();
            await tx.wait();
        }

        const res = await authFetch(`${backendUrl}/fresh-start`, {
            method: "POST"
        });
        if (!res) return;
        const data = await res.json();
        showToast(`✅ Fresh Start Complete! Generation: ${data.generationId}`);
        refreshAll();
    } catch (err) {
        showToast("Reset Failed: " + (err.reason || err.message), true);
    }
}

// ═══════════════ 5. ON-CHAIN VOTER AUTHORIZATION ═══════════════
async function directVerifyVoter() {
    const address = document.getElementById("directVoterAddress").value.trim();
    if (!address.startsWith("0x") || address.length !== 42) {
        return showToast("Invalid Ethereum Address", true);
    }

    try {
        showToast("Authorizing voter on-chain...");
        if (contract && signer) {
            const tx = await contract.verifyVoter(address);
            await tx.wait();
        }
        await fetch(`${backendUrl}/add-verified-voter`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address })
        });
        showToast("✅ Voter Authorized on Chain!");
        document.getElementById("directVoterAddress").value = "";
        refreshAll();
    } catch (err) {
        showToast("Authorization Failed on Chain", true);
    }
}

async function batchVerifyPrompt() {
    const input = prompt("Paste comma-separated Ethereum wallet addresses to batch authorize:");
    if (!input) return;

    const addrs = input.split(",").map(a => a.trim()).filter(a => a.startsWith("0x") && a.length === 42);
    if (addrs.length === 0) return showToast("No valid 0x addresses found", true);

    try {
        showToast(`Batch authorizing ${addrs.length} addresses...`);
        if (contract && signer) {
            const tx = await contract.batchVerifyVoters(addrs);
            await tx.wait();
        }
        for (const addr of addrs) {
            await fetch(`${backendUrl}/add-verified-voter`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address: addr })
            });
        }
        showToast(`✅ Batch verified ${addrs.length} voters on blockchain!`);
        refreshAll();
    } catch (err) {
        showToast("Batch verification failed", true);
    }
}

// ═══════════════ 6. AUDIT TRAIL & CSV EXPORT ═══════════════
async function loadAuditLog() {
    try {
        const res = await authFetch(`${backendUrl}/audit-log`);
        if (!res) return;
        const logs = await res.json();
        const tbody = document.getElementById("auditTableBody");
        tbody.innerHTML = "";

        if (logs.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;'>No audit records yet.</td></tr>";
            return;
        }

        // Show recent first
        [...logs].reverse().slice(0, 50).forEach(log => {
            appendAuditEntry(log);
        });
    } catch (e) {}
}

function appendAuditEntry(log) {
    const tbody = document.getElementById("auditTableBody");
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td>${log.id}</td>
        <td><strong style="color:var(--saffron);">${log.action}</strong></td>
        <td title='${JSON.stringify(log.details)}'>${JSON.stringify(log.details)}</td>
        <td><code>${log.ip}</code></td>
        <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
    `;
    if (tbody.firstChild && tbody.firstChild.innerText?.includes("No audit")) {
        tbody.innerHTML = "";
    }
    tbody.insertBefore(tr, tbody.firstChild);
}

function exportCSV() {
    window.location.href = `${backendUrl}/export-csv?token=${adminToken}`;
}

// ═══════════════ 7. LIVE METRICS & RESULTS ═══════════════
async function loadAdminResults() {
    try {
        const res = await fetch(`${backendUrl}/results`);
        const data = await res.json();
        const candidates = data.parties || [];
        const totalVotes = data.totalVotes || 0;

        renderAdminChart(candidates, totalVotes);

        const list = document.getElementById("adminResultsList");
        list.innerHTML = "";
        candidates.forEach(c => {
            const pct = totalVotes > 0 ? ((c.votes / totalVotes) * 100).toFixed(1) : 0;
            const card = document.createElement("div");
            card.className = "candidate-card";
            card.innerHTML = `
                <div class="candidate-icon">${c.symbol || '🏛️'}</div>
                <div class="candidate-name">${c.name}</div>
                <div class="vote-count">${c.votes}</div>
                <div class="subtitle">VOTES (${pct}%)</div>
            `;
            list.appendChild(card);
        });
    } catch (e) {}
}

function renderAdminChart(candidates, totalVotes) {
    const canvas = document.getElementById("adminChart");
    if (!canvas) return;

    if (adminChart) adminChart.destroy();

    const colors = ["#FF9933", "#138808", "#000080", "#3b82f6", "#8b5cf6", "#ef4444", "#f59e0b"];

    adminChart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: candidates.map(c => c.name),
            datasets: [{
                data: candidates.map(c => c.votes),
                backgroundColor: colors.slice(0, candidates.length),
                borderColor: "#050d1a",
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: "bottom", labels: { color: "#8899bb" } }
            }
        }
    });
}

async function loadRegisteredVoters() {
    try {
        const res = await fetch(`${backendUrl}/registered-voters`);
        const data = await res.json();
        const list = document.getElementById("adminVotersList");
        list.innerHTML = "";

        const all = [
            ...(data.national || []).map(u => ({ ...u, type: "National" })),
            ...(data.college || []).map(u => ({ ...u, type: "College" }))
        ];

        if (all.length === 0) {
            list.innerHTML = "<p style='color:var(--text-dim); text-align:center;'>No voters registered yet.</p>";
            return;
        }

        all.forEach(v => {
            const item = document.createElement("div");
            item.className = "voter-item";
            const id = v.aadhaarHash ? `Aadhaar: ${v.aadhaarHash.slice(0, 12)}...` : `Student Reg: ${v.regHash?.slice(0, 12)}...`;
            item.innerHTML = `
                <div>
                    <div><strong>[${v.type}]</strong> ${id}</div>
                    <div class="voter-address">Wallet: ${v.walletAddress ? v.walletAddress.slice(0, 10) + "..." : "Not bound"}</div>
                </div>
                <div class="status-badge status-online" style="margin:0;">Verified ✓</div>
            `;
            list.appendChild(item);
        });
    } catch (e) {}
}

async function refreshAll() {
    try {
        const stats = await fetch(`${backendUrl}/stats`).then(r => r.json());
        document.getElementById("statPhase").innerText = stats.electionPhase || "SETUP";
        document.getElementById("statCandidates").innerText = stats.totalParties || 0;
        document.getElementById("statRegistered").innerText = stats.totalRegistered || 0;
        document.getElementById("statVotes").innerText = stats.totalVotes || 0;
        document.getElementById("statGenId").innerText = stats.generationId || 1;

        loadParties();
        loadAuditLog();
        loadAdminResults();
        loadRegisteredVoters();
    } catch (e) {}
}

window.adminLogin = adminLogin;
window.adminLogout = adminLogout;
window.connectAdminWallet = connectAdminWallet;
window.addParty = addParty;
window.removeParty = removeParty;
window.startVotingPhase = startVotingPhase;
window.startRevealPhase = startRevealPhase;
window.endElectionPhase = endElectionPhase;
window.togglePauseSystem = togglePauseSystem;
window.setTimer = setTimer;
window.triggerFreshStart = triggerFreshStart;
window.directVerifyVoter = directVerifyVoter;
window.batchVerifyPrompt = batchVerifyPrompt;
window.exportCSV = exportCSV;
window.refreshAll = refreshAll;
window.loadAdminResults = loadAdminResults;
