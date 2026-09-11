// ════════════════════════════════════════════════════════════════
//  EVoting V3.1 — National Portal JavaScript
//  i18n · CAPTCHA · WebSocket · Chart.js · Receipts · Multi-Voter
// ════════════════════════════════════════════════════════════════

// ═══════════════ GLOBAL STATE ═══════════════
let provider, signer, contract;
let contractAddress = "";
let currentWallet = "";
let currentAadhaarHash = "";
let demoMode = false;
let voterToken = "";
let currentLang = "en";
let captchaAnswer = "";
let resultsChart = null;
let wsConnection = null;
let timerInterval = null;
let currentReceiptData = null;

const backendUrl = window.location.origin || "http://localhost:5000";

const abi = [
    "function commitVote(bytes32 hash)",
    "function revealVote(uint256 candidateIndex, string secret)",
    "function getVoteCount(uint256) view returns (uint256)",
    "function getTotalCandidates() view returns (uint256)",
    "function getCandidate(uint256) view returns (string, string, uint256)",
    "function getPhase() view returns (uint8)",
    "function getElectionInfo() view returns (uint8 phase, uint8 eType, bool isPaused, uint256 genId, uint256 candidateCount)",
    "function isVoterVerified(address) view returns (bool)",
    "function hasVoterCommitted(address) view returns (bool)",
    "function hasVoterRevealed(address) view returns (bool)",
    "function bindIdentity(bytes32 identityHash, address wallet)",
    "function verifyVoter(address voter)"
];

// ═══════════════ i18n TRANSLATIONS ═══════════════
const translations = {
    en: {
        title: "National Blockchain E-Voting",
        subtitle: "Government of India — Digital Democracy Initiative",
        secure: "Secure", transparent: "Transparent", tamperproof: "Tamper-Proof",
        national: "National", college: "College", admin: "Admin",
        demo_mode: "Demo Mode Active — MetaMask not detected. Blockchain interactions are simulated.",
        welcome: "Welcome, Citizen",
        connect_desc: "Connect your secure decentralized wallet to begin the authentication process. Your identity will be verified through Aadhaar-linked OTP.",
        connect_metamask: "Connect MetaMask Wallet",
        voter_auth: "Voter Authentication",
        auth_desc: "Enter your government credentials to receive a secure OTP for voter verification.",
        aadhaar_label: "Aadhaar Number", dob_label: "Date of Birth",
        voter_id_label: "Voter ID Card", district_label: "District",
        pincode_label: "PIN Code", email_label: "Email (for OTP)",
        send_otp: "Send OTP Verification",
        otp_label: "One-Time Password", otp_fallback: "Demo Mode — Your OTP:",
        verify_authorize: "Verify & Authorize",
        cast_vote: "Cast Your Vote",
        status_loading: "Status: Loading...",
        loading_candidates: "Loading candidates from blockchain...",
        vote_committed: "Vote Committed to Blockchain",
        commit_desc: "Your vote is hashed and secured on the blockchain. You must return to REVEAL your vote once the reveal phase begins for it to be counted.",
        view_receipt: "View Receipt", next_voter: "Next Voter",
        reveal_title: "Reveal Your Vote",
        reveal_desc: "The reveal phase is active. Submit your secret to have your vote counted on the public ledger.",
        secret_label: "Your Secret Passphrase",
        reveal_btn: "Reveal to Public Ledger",
        results: "Election Results",
        results_desc: "Official final count retrieved from the immutable blockchain ledger.",
        restart: "Restart Demo",
        vote_certificate: "Digital Vote Certificate",
        receipt_desc: "Your vote has been securely recorded on the blockchain.",
        download_receipt: "Download Receipt",
        hours: "Hours", minutes: "Minutes", seconds: "Seconds",
        wallet_not_connected: "Wallet: Not Connected",
        pause_msg: "Election has been temporarily paused by the administrator.",
        footer_title: "National Blockchain E-Voting System",
        footer_desc: "Secured by Ethereum Smart Contracts • Built for Digital India",
        vote_now: "Vote Now", voting_closed: "Voting Closed",
        phase_setup: "🟡 Setup", phase_commit: "🟢 Voting: LIVE",
        phase_reveal: "🔵 Reveal Phase", phase_ended: "🔴 Election Ended",
        candidates: "Candidates", total_votes: "Total Votes",
        registered: "Registered", votes: "VOTES"
    },
    hi: {
        title: "राष्ट्रीय ब्लॉकचेन ई-मतदान",
        subtitle: "भारत सरकार — डिजिटल लोकतंत्र पहल",
        secure: "सुरक्षित", transparent: "पारदर्शी", tamperproof: "छेड़छाड़-रहित",
        national: "राष्ट्रीय", college: "कॉलेज", admin: "प्रशासक",
        demo_mode: "डेमो मोड सक्रिय — MetaMask नहीं मिला। ब्लॉकचेन इंटरैक्शन सिमुलेट किए गए हैं।",
        welcome: "स्वागत है, नागरिक",
        connect_desc: "प्रमाणीकरण प्रक्रिया शुरू करने के लिए अपने सुरक्षित विकेंद्रीकृत वॉलेट को कनेक्ट करें। आपकी पहचान आधार-लिंक्ड OTP के माध्यम से सत्यापित की जाएगी।",
        connect_metamask: "MetaMask वॉलेट कनेक्ट करें",
        voter_auth: "मतदाता प्रमाणीकरण",
        auth_desc: "मतदाता सत्यापन के लिए सुरक्षित OTP प्राप्त करने हेतु अपने सरकारी प्रमाण-पत्र दर्ज करें।",
        aadhaar_label: "आधार संख्या", dob_label: "जन्म तिथि",
        voter_id_label: "मतदाता पहचान पत्र", district_label: "जिला",
        pincode_label: "पिन कोड", email_label: "ईमेल (OTP के लिए)",
        send_otp: "OTP सत्यापन भेजें",
        otp_label: "वन-टाइम पासवर्ड", otp_fallback: "डेमो मोड — आपका OTP:",
        verify_authorize: "सत्यापित करें और अधिकृत करें",
        cast_vote: "अपना वोट डालें",
        status_loading: "स्थिति: लोड हो रहा है...",
        loading_candidates: "ब्लॉकचेन से उम्मीदवार लोड हो रहे हैं...",
        vote_committed: "वोट ब्लॉकचेन पर प्रतिबद्ध",
        commit_desc: "आपका वोट हैश किया गया और ब्लॉकचेन पर सुरक्षित है। रिवील फेज शुरू होने पर आपको अपना वोट रिवील करना होगा।",
        view_receipt: "रसीद देखें", next_voter: "अगला मतदाता",
        reveal_title: "अपना वोट प्रकट करें",
        reveal_desc: "रिवील फेज सक्रिय है। अपना गुप्त पासवर्ड सबमिट करें।",
        secret_label: "आपका गुप्त पासफ्रेज़",
        reveal_btn: "सार्वजनिक लेजर पर प्रकट करें",
        results: "चुनाव परिणाम",
        results_desc: "अपरिवर्तनीय ब्लॉकचेन लेजर से प्राप्त आधिकारिक अंतिम गणना।",
        restart: "डेमो पुनः आरंभ करें",
        vote_certificate: "डिजिटल वोट प्रमाणपत्र",
        receipt_desc: "आपका वोट ब्लॉकचेन पर सुरक्षित रूप से दर्ज किया गया है।",
        download_receipt: "रसीद डाउनलोड करें",
        hours: "घंटे", minutes: "मिनट", seconds: "सेकंड",
        wallet_not_connected: "वॉलेट: कनेक्ट नहीं",
        pause_msg: "प्रशासक द्वारा चुनाव अस्थायी रूप से रोका गया है।",
        footer_title: "राष्ट्रीय ब्लॉकचेन ई-मतदान प्रणाली",
        footer_desc: "एथेरियम स्मार्ट कॉन्ट्रैक्ट्स द्वारा सुरक्षित • डिजिटल इंडिया के लिए निर्मित",
        vote_now: "अभी वोट करें", voting_closed: "मतदान बंद",
        phase_setup: "🟡 तैयारी", phase_commit: "🟢 मतदान: लाइव",
        phase_reveal: "🔵 रिवील फेज", phase_ended: "🔴 चुनाव समाप्त",
        candidates: "उम्मीदवार", total_votes: "कुल वोट",
        registered: "पंजीकृत", votes: "वोट"
    },
    ta: {
        title: "தேசிய பிளாக்செயின் மின்-வாக்களிப்பு",
        subtitle: "இந்திய அரசு — டிஜிட்டல் ஜனநாயக முன்னெடுப்பு",
        secure: "பாதுகாப்பான", transparent: "வெளிப்படையான", tamperproof: "மாற்ற-முடியாத",
        national: "தேசிய", college: "கல்லூரி", admin: "நிர்வாகி",
        demo_mode: "டெமோ பயன்முறை செயலில் — MetaMask கண்டறியப்படவில்லை.",
        welcome: "வணக்கம், குடிமகனே",
        connect_desc: "அங்கீகார செயல்முறையைத் தொடங்க உங்கள் பாதுகாப்பான பரவலாக்கப்பட்ட வாலட்டை இணைக்கவும்.",
        connect_metamask: "MetaMask வாலட்டை இணைக்கவும்",
        voter_auth: "வாக்காளர் அங்கீகாரம்",
        auth_desc: "வாக்காளர் சரிபார்ப்புக்கான OTP பெற உங்கள் அரசாங்க சான்றுகளை உள்ளிடவும்.",
        aadhaar_label: "ஆதார் எண்", dob_label: "பிறந்த தேதி",
        voter_id_label: "வாக்காளர் அடையாள அட்டை", district_label: "மாவட்டம்",
        pincode_label: "பின் கோட்", email_label: "மின்னஞ்சல் (OTP-க்கு)",
        send_otp: "OTP சரிபார்ப்பு அனுப்பு",
        otp_label: "ஒரு முறை கடவுச்சொல்", otp_fallback: "டெமோ — உங்கள் OTP:",
        verify_authorize: "சரிபார்த்து அங்கீகரிக்கவும்",
        cast_vote: "உங்கள் வாக்கை செலுத்துங்கள்",
        status_loading: "நிலை: ஏற்றுகிறது...",
        loading_candidates: "பிளாக்செயினில் இருந்து வேட்பாளர்களை ஏற்றுகிறது...",
        vote_committed: "வாக்கு பிளாக்செயினில் பதிவு செய்யப்பட்டது",
        commit_desc: "உங்கள் வாக்கு ஹாஷ் செய்யப்பட்டு பிளாக்செயினில் பாதுகாக்கப்பட்டுள்ளது.",
        view_receipt: "ரசீதைப் பார்", next_voter: "அடுத்த வாக்காளர்",
        reveal_title: "உங்கள் வாக்கை வெளிப்படுத்துங்கள்",
        reveal_desc: "வெளிப்படுத்தும் கட்டம் செயலில் உள்ளது. உங்கள் ரகசிய கடவுச்சொல்லை சமர்ப்பிக்கவும்.",
        secret_label: "உங்கள் ரகசிய கடவுச்சொல்",
        reveal_btn: "பொது லெட்ஜரில் வெளிப்படுத்து",
        results: "தேர்தல் முடிவுகள்",
        results_desc: "மாற்ற முடியாத பிளாக்செயின் லெட்ஜரில் இருந்து பெறப்பட்ட அதிகாரபூர்வ இறுதி எண்ணிக்கை.",
        restart: "டெமோ மறுதொடக்கம்",
        vote_certificate: "டிஜிட்டல் வாக்கு சான்றிதழ்",
        receipt_desc: "உங்கள் வாக்கு பிளாக்செயினில் பாதுகாப்பாக பதிவு செய்யப்பட்டுள்ளது.",
        download_receipt: "ரசீதைப் பதிவிறக்கு",
        hours: "மணி", minutes: "நிமிடங்கள்", seconds: "வினாடிகள்",
        wallet_not_connected: "வாலட்: இணைக்கப்படவில்லை",
        pause_msg: "நிர்வாகியால் தேர்தல் தற்காலிகமாக நிறுத்தப்பட்டுள்ளது.",
        footer_title: "தேசிய பிளாக்செயின் மின்-வாக்களிப்பு அமைப்பு",
        footer_desc: "எத்தேரியம் ஸ்மார்ட் ஒப்பந்தங்களால் பாதுகாக்கப்பட்டது • டிஜிட்டல் இந்தியாவுக்காக உருவாக்கப்பட்டது",
        vote_now: "இப்போது வாக்களிக்கவும்", voting_closed: "வாக்களிப்பு முடிந்தது",
        phase_setup: "🟡 அமைப்பு", phase_commit: "🟢 வாக்களிப்பு: நேரலை",
        phase_reveal: "🔵 வெளிப்படுத்தல் கட்டம்", phase_ended: "🔴 தேர்தல் முடிந்தது",
        candidates: "வேட்பாளர்கள்", total_votes: "மொத்த வாக்குகள்",
        registered: "பதிவு", votes: "வாக்குகள்"
    }
};

// ═══════════════ i18n ENGINE ═══════════════
function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem("evoting_lang", lang);
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (translations[lang] && translations[lang][key]) {
            el.textContent = translations[lang][key];
        }
    });
    document.querySelectorAll(".i18n-btn").forEach(btn => btn.classList.remove("active"));
    document.querySelectorAll(".i18n-btn").forEach(btn => {
        if ((lang === "en" && btn.textContent === "English") ||
            (lang === "hi" && btn.textContent === "हिंदी") ||
            (lang === "ta" && btn.textContent === "தமிழ்")) {
            btn.classList.add("active");
        }
    });
}

function t(key) {
    return (translations[currentLang] && translations[currentLang][key]) || translations.en[key] || key;
}

// ═══════════════ CAPTCHA GENERATOR ═══════════════
function generateCaptcha() {
    const canvas = document.getElementById("captchaCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    captchaAnswer = "";
    for (let i = 0; i < 5; i++) captchaAnswer += chars[Math.floor(Math.random() * chars.length)];

    // Draw background
    ctx.fillStyle = "#0a1628";
    ctx.fillRect(0, 0, 160, 50);

    // Noise lines
    for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = `rgba(${Math.random()*255},${Math.random()*255},${Math.random()*255},0.3)`;
        ctx.beginPath();
        ctx.moveTo(Math.random() * 160, Math.random() * 50);
        ctx.lineTo(Math.random() * 160, Math.random() * 50);
        ctx.stroke();
    }

    // Draw text
    ctx.font = "bold 28px 'Outfit', sans-serif";
    ctx.textBaseline = "middle";
    for (let i = 0; i < captchaAnswer.length; i++) {
        const x = 15 + i * 28;
        const y = 25 + (Math.random() * 10 - 5);
        const angle = (Math.random() - 0.5) * 0.4;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = i % 2 === 0 ? "#FF9933" : "#1DB954";
        ctx.fillText(captchaAnswer[i], 0, 0);
        ctx.restore();
    }

    // Noise dots
    for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.3})`;
        ctx.beginPath();
        ctx.arc(Math.random() * 160, Math.random() * 50, 1, 0, Math.PI * 2);
        ctx.fill();
    }

    document.getElementById("captchaInput").value = "";
}

function validateCaptcha() {
    const input = document.getElementById("captchaInput")?.value?.trim();
    if (!input) return false;
    return input.toLowerCase() === captchaAnswer.toLowerCase();
}

// ═══════════════ UI HELPERS ═══════════════
function showToast(msg, error = false) {
    const toast = document.getElementById("toast");
    toast.innerText = msg;
    toast.style.borderLeftColor = error ? "#ef4444" : "var(--saffron)";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3500);
}

function updateStep(step) {
    for (let i = 1; i <= 4; i++) {
        const stepEl = document.getElementById(`step${i}`);
        const lineEl = document.getElementById(`line${i}`);
        if (i < step) {
            stepEl.classList.add("completed");
            stepEl.classList.remove("active");
            stepEl.innerHTML = "✓";
        } else if (i === step) {
            stepEl.classList.add("active");
            stepEl.classList.remove("completed");
            stepEl.innerHTML = i;
        } else {
            stepEl.classList.remove("active", "completed");
            stepEl.innerHTML = i;
        }
        if (lineEl) {
            if (i < step) lineEl.classList.add("active");
            else lineEl.classList.remove("active");
        }
    }
}

function showSection(id) {
    document.querySelectorAll(".card").forEach(c => c.classList.add("hidden"));
    const section = document.getElementById(id);
    section.classList.remove("hidden");
    section.style.animation = "none";
    section.offsetHeight;
    section.style.animation = "fadeInUp 0.5s ease-out";
    const step = parseInt(id.replace("section", ""));
    updateStep(step);
}

// ═══════════════ WEBSOCKET ═══════════════
function connectWebSocket() {
    const wsUrl = `ws://${window.location.hostname}:${window.location.port || 5000}`;
    try {
        wsConnection = new WebSocket(wsUrl);
        wsConnection.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleWSMessage(msg);
        };
        wsConnection.onclose = () => {
            setTimeout(connectWebSocket, 3000);
        };
        wsConnection.onerror = () => {};
    } catch (e) {
        console.warn("WebSocket not available");
    }
}

function handleWSMessage(msg) {
    switch (msg.type) {
        case "phase_change":
            showToast(`Phase changed to: ${msg.data.phase}`);
            updatePhaseUI(msg.data.phase);
            break;
        case "candidate_added":
            loadCandidates();
            break;
        case "vote_cast":
        case "vote_revealed":
            // Refresh results if on results page
            if (!document.getElementById("section4").classList.contains("hidden")) {
                loadResults();
            }
            break;
        case "timer_start":
            startCountdownTimer(msg.data.start, msg.data.duration);
            break;
        case "system_paused":
            if (msg.data.paused) {
                document.getElementById("pauseOverlay").classList.add("visible");
            } else {
                document.getElementById("pauseOverlay").classList.remove("visible");
            }
            break;
        case "fresh_start":
            showToast("Election has been reset. Reloading...");
            setTimeout(() => location.reload(), 2000);
            break;
    }
}

function updatePhaseUI(phase) {
    const timerEl = document.getElementById("votingTimer");
    switch (phase) {
        case "SETUP":
            timerEl.innerHTML = t("phase_setup");
            timerEl.className = "status-badge status-warning";
            break;
        case "COMMIT":
            timerEl.innerHTML = t("phase_commit");
            timerEl.className = "status-badge status-online";
            if (document.getElementById("section3").classList.contains("hidden")) {
                showSection("section3");
                loadCandidates();
            } else {
                loadCandidates();
            }
            break;
        case "REVEAL":
            timerEl.innerHTML = t("phase_reveal");
            timerEl.className = "status-badge";
            timerEl.style.color = "#3b82f6";
            document.getElementById("revealSection").classList.remove("hidden");
            loadStoredSecret();
            break;
        case "ENDED":
            timerEl.innerHTML = t("phase_ended");
            timerEl.className = "status-badge status-danger";
            showSection("section4");
            loadResults();
            break;
    }
}

// ═══════════════ COUNTDOWN TIMER ═══════════════
function startCountdownTimer(startMs, durationSec) {
    document.getElementById("timerSection").classList.remove("hidden");
    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        const elapsed = (Date.now() - startMs) / 1000;
        const remaining = Math.max(0, durationSec - elapsed);

        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = Math.floor(remaining % 60);

        document.getElementById("timerHours").textContent = String(hours).padStart(2, "0");
        document.getElementById("timerMinutes").textContent = String(minutes).padStart(2, "0");
        document.getElementById("timerSeconds").textContent = String(seconds).padStart(2, "0");

        // Urgent styling when < 60s
        const blocks = document.querySelectorAll(".timer-block");
        if (remaining < 60 && remaining > 0) {
            blocks.forEach(b => b.classList.add("timer-urgent"));
        } else {
            blocks.forEach(b => b.classList.remove("timer-urgent"));
        }

        if (remaining <= 0) {
            clearInterval(timerInterval);
            blocks.forEach(b => b.classList.add("timer-urgent"));
        }
    }, 1000);
}

async function fetchTimer() {
    try {
        const res = await fetch(`${backendUrl}/timer`);
        const data = await res.json();
        if (data.active) {
            startCountdownTimer(data.start, data.duration);
        }
    } catch (e) {}
}

// ═══════════════ INIT ═══════════════
async function init() {
    // Load saved language
    const savedLang = localStorage.getItem("evoting_lang");
    if (savedLang) setLanguage(savedLang);

    // Generate CAPTCHA
    generateCaptcha();

    // Load config
    try {
        const res = await fetch(`${backendUrl}/config`);
        const config = await res.json();
        if (config.contractAddress) {
            contractAddress = config.contractAddress;
            console.log("📋 Contract loaded:", contractAddress);
        }
    } catch (e) {
        console.warn("Config not available");
    }

    // Check MetaMask
    if (!window.ethereum) {
        demoMode = true;
        document.getElementById("demoBanner").classList.remove("hidden");
        document.getElementById("connectBtn").querySelector("span").textContent =
            currentLang === "en" ? "Continue in Demo Mode" :
            currentLang === "hi" ? "डेमो मोड में जारी रखें" : "டெமோ பயன்முறையில் தொடரவும்";
        console.log("⚡ Demo Mode: MetaMask not detected");
    }

    // Connect WebSocket
    connectWebSocket();

    // Fetch timer
    fetchTimer();

    // Check initial phase
    try {
        const stats = await fetch(`${backendUrl}/stats`).then(r => r.json());
        if (stats.paused) {
            document.getElementById("pauseOverlay").classList.add("visible");
        }
        updatePhaseUI(stats.electionPhase || "SETUP");
    } catch (e) {}

    // Register service worker
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
}

init();

function enableInstantDemoVoter() {
    demoMode = true;
    currentWallet = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b => b.toString(16).padStart(2,"0")).join("");
    document.getElementById("walletAddress").innerText = `Linked: ${currentWallet.slice(0,6)}...${currentWallet.slice(-4)}`;
    document.getElementById("walletAddress").classList.remove("hidden");

    const status = document.getElementById("connectionStatus");
    status.innerHTML = `● Instant Citizen Wallet: ${currentWallet.slice(0,6)}...${currentWallet.slice(-4)}`;
    status.classList.remove("status-warning");
    status.classList.add("status-online");

    showToast("⚡ Instant Voter Session Active (No Popups)");
    showSection("section2");
}
window.enableInstantDemoVoter = enableInstantDemoVoter;

// ═══════════════ 1. CONNECT WALLET ═══════════════
document.getElementById("connectBtn").onclick = async () => {
    try {
        if (demoMode || !window.ethereum) {
            enableInstantDemoVoter();
            return;
        }

        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();

        if (contractAddress) {
            contract = new ethers.Contract(contractAddress, abi, signer);
        }

        currentWallet = await signer.getAddress();
        document.getElementById("walletAddress").innerText = `Linked: ${currentWallet.slice(0,6)}...${currentWallet.slice(-4)}`;
        document.getElementById("walletAddress").classList.remove("hidden");

        const status = document.getElementById("connectionStatus");
        status.innerHTML = `● Wallet: ${currentWallet.slice(0,6)}...${currentWallet.slice(-4)}`;
        status.classList.remove("status-warning");
        status.classList.add("status-online");

        showToast("Wallet Authorized Successfully");

        // Check if already verified on-chain
        if (contract) {
            try {
                const isVerified = await contract.isVoterVerified(currentWallet);
                if (isVerified) {
                    showSection("section3");
                    loadCandidates();
                    return;
                }
            } catch (e) {
                console.warn("Could not check voter status:", e.message);
            }
        }

        showSection("section2");
    } catch (err) {
        console.error(err);
        showToast("Connection Denied", true);
    }
};

// ═══════════════ 2. REGISTRATION (OTP) ═══════════════
document.getElementById("registerBtn").onclick = async () => {
    const aadhaar = document.getElementById("aadhaar").value.trim();
    const dob = document.getElementById("dob").value;
    const voterId = document.getElementById("voterId").value.trim();
    const district = document.getElementById("district").value.trim();
    const pincode = document.getElementById("pincode").value.trim();
    const email = document.getElementById("email").value.trim();

    if (aadhaar.length !== 12 || !/^\d{12}$/.test(aadhaar)) {
        return showToast("Aadhaar must be exactly 12 digits", true);
    }
    if (!dob) return showToast("Date of Birth is required", true);
    if (!voterId || voterId.length < 5) return showToast("Invalid Voter ID (min 5 characters)", true);

    // Validate CAPTCHA
    if (!validateCaptcha()) {
        generateCaptcha();
        return showToast("Invalid CAPTCHA. Please try again.", true);
    }

    try {
        const res = await fetch(`${backendUrl}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aadhaar, dob, voterId, district, pincode, email })
        });
        const data = await res.json();

        if (res.ok) {
            currentAadhaarHash = data.aadhaarHash;
            showToast(data.message);
            document.getElementById("otpSection").classList.remove("hidden");
            document.getElementById("registerBtn").classList.add("hidden");

            // Show OTP fallback if available
            if (data.otpFallback) {
                document.getElementById("otpDisplay").classList.remove("hidden");
                document.getElementById("otpCode").textContent = data.otpFallback;
            }
        } else {
            showToast(data.message, true);
            generateCaptcha();
        }
    } catch (err) {
        showToast("Backend Server Offline — Make sure server is running on port 5000", true);
    }
};

document.getElementById("verifyOtpBtn").onclick = async () => {
    const otp = document.getElementById("otp").value.trim();
    const voterId = document.getElementById("voterId").value.trim();
    const dob = document.getElementById("dob").value;
    const district = document.getElementById("district").value.trim();
    const pincode = document.getElementById("pincode").value.trim();

    if (!otp || otp.length !== 6) return showToast("Enter 6-digit OTP", true);

    try {
        const res = await fetch(`${backendUrl}/verify-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                identityHash: currentAadhaarHash,
                otp, type: "national",
                voterId, dob, district, pincode,
                walletAddress: currentWallet
            })
        });

        if (res.ok) {
            const data = await res.json();
            voterToken = data.token;
            showToast("✅ Verification Successful! Proceed to vote.");
            showSection("section3");
            loadCandidates();
        } else {
            const data = await res.json();
            showToast(data.message || "Invalid OTP", true);
        }
    } catch (err) {
        showToast("Verification Failed — Check server connection", true);
    }
};

// ═══════════════ 3. VOTING ═══════════════
async function loadCandidates() {
    const list = document.getElementById("candidateList");
    const timerEl = document.getElementById("votingTimer");

    // Get phase from backend
    let currentPhase = "SETUP";
    try {
        const stats = await fetch(`${backendUrl}/stats`).then(r => r.json());
        currentPhase = stats.electionPhase || "SETUP";
    } catch (e) {}

    // Try blockchain first
    if (contract && !demoMode) {
        try {
            const info = await contract.getElectionInfo();
            const phase = Number(info[0]); // 0=SETUP, 1=COMMIT, 2=REVEAL, 3=ENDED
            const total = Number(info[4]);
            const phaseNames = ["SETUP", "COMMIT", "REVEAL", "ENDED"];
            currentPhase = phaseNames[phase] || "SETUP";

            updatePhaseUI(currentPhase);
            list.innerHTML = "";

            if (total === 0) {
                list.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color: var(--text-secondary); padding: 2rem;">
                    <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">🏛️</p>
                    <p>${t("loading_candidates")}</p>
                </div>`;
                return;
            }

            // Check if voter already committed
            let hasCommitted = false;
            try {
                hasCommitted = await contract.hasVoterCommitted(currentWallet);
            } catch (e) {}

            for (let i = 0; i < total; i++) {
                const [name, logoHash, votes] = await contract.getCandidate(i);
                const card = document.createElement("div");
                card.className = "candidate-card";
                card.innerHTML = `
                    ${logoHash ? `<img src="/uploads/${logoHash}" class="candidate-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">` : ''}
                    <div class="candidate-icon" ${logoHash ? 'style="display:none"' : ''}>🏛️</div>
                    <div class="candidate-name">${name}</div>
                    <button class="btn-primary" onclick="castVote(${i}, '${name.replace(/'/g, "\\'")}')" 
                        style="width: 100%; margin-top: 0.8rem;" 
                        ${currentPhase !== "COMMIT" || hasCommitted ? 'disabled' : ''}>
                        ${currentPhase === "COMMIT" && !hasCommitted ? '🗳️ ' + t("vote_now") : '⏳ ' + t("voting_closed")}
                    </button>
                `;
                list.appendChild(card);
            }

            if (hasCommitted) {
                document.getElementById("commitInfo").classList.remove("hidden");
            }

            // Show reveal section if in REVEAL phase
            if (currentPhase === "REVEAL") {
                document.getElementById("revealSection").classList.remove("hidden");
                loadStoredSecret();
            }

            if (currentPhase === "ENDED") {
                showSection("section4");
                loadResults();
            }
            return;
        } catch (err) {
            console.warn("Blockchain read failed, falling back to backend:", err.message);
        }
    }

    // Fallback: Load from backend
    try {
        const res = await fetch(`${backendUrl}/parties`);
        const parties = await res.json();
        list.innerHTML = "";
        updatePhaseUI(currentPhase);

        if (parties.length === 0) {
            list.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color: var(--text-secondary); padding: 2rem;">
                <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">🏛️</p>
                <p>No candidates registered yet. Admin needs to add parties first.</p>
            </div>`;
            return;
        }

        parties.forEach((party, i) => {
            const card = document.createElement("div");
            card.className = "candidate-card";
            card.innerHTML = `
                ${party.logo ? `<img src="${party.logo}" class="candidate-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">` : ''}
                <div class="candidate-icon" ${party.logo ? 'style="display:none"' : ''}>${party.symbol || '🏛️'}</div>
                <div class="candidate-name">${party.name}</div>
                <button class="btn-primary" onclick="castVote(${party.id}, '${party.name.replace(/'/g, "\\'")}')" 
                    style="width: 100%; margin-top: 0.8rem;"
                    ${currentPhase !== "COMMIT" ? 'disabled' : ''}>
                    ${currentPhase === "COMMIT" ? '🗳️ ' + t("vote_now") : '⏳ ' + t("voting_closed")}
                </button>
            `;
            list.appendChild(card);
        });

        if (currentPhase === "REVEAL") {
            document.getElementById("revealSection").classList.remove("hidden");
            loadStoredSecret();
        }
    } catch (err) {
        list.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color: #ef4444; padding: 2rem;">
            <p>❌ Cannot connect to backend server</p>
        </div>`;
    }
}

// Cast Vote (Commit Phase)
async function castVote(index, candidateName) {
    const secret = prompt(
        currentLang === "hi" ? "अपना गुप्त पासफ्रेज़ दर्ज करें।\n\n⚠️ इसे सुरक्षित रखें!" :
        currentLang === "ta" ? "உங்கள் ரகசிய கடவுச்சொல்லை உள்ளிடவும்.\n\n⚠️ இதை பாதுகாப்பாக வைத்திருங்கள்!" :
        "Enter a unique secret passphrase to encrypt your vote.\n\n⚠️ KEEP THIS SECRET! You'll need it to reveal your vote later."
    );
    if (!secret) return;

    try {
        if (contract && !demoMode) {
            // Blockchain commit
            const hash = ethers.solidityPackedKeccak256(["uint256", "string"], [index, secret]);
            showToast("⏳ Waiting for blockchain confirmation...");
            const tx = await contract.commitVote(hash);
            await tx.wait();

            // Store secret in vault keyed by wallet
            storeSecret(currentWallet, secret, index, candidateName, tx.hash);

            // Record on backend
            await fetch(`${backendUrl}/cast-vote`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    identityHash: currentAadhaarHash || currentWallet,
                    partyId: index,
                    txHash: tx.hash,
                    type: "national"
                })
            });

            showToast("✅ Vote committed to blockchain!");
        } else {
            // Demo mode vote
            const fakeHash = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2,"0")).join("");
            storeSecret(currentWallet, secret, index, candidateName, fakeHash);

            await fetch(`${backendUrl}/cast-vote`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    identityHash: currentAadhaarHash || currentWallet || "demo_user",
                    partyId: index,
                    txHash: fakeHash,
                    type: "national"
                })
            });

            showToast("✅ Vote recorded successfully!");
        }

        document.getElementById("commitInfo").classList.remove("hidden");
        document.querySelectorAll("#candidateList button").forEach(btn => {
            btn.disabled = true;
            btn.innerHTML = "✅ Voted";
        });

    } catch (err) {
        showToast("Vote Failed: " + (err.reason || err.message || "Transaction rejected"), true);
    }
}

// ═══════════════ SECRET VAULT ═══════════════
function storeSecret(wallet, secret, candidateIndex, candidateName, txHash) {
    const vault = JSON.parse(localStorage.getItem("evoting_vault") || "{}");
    vault[wallet] = {
        secret,
        candidateIndex,
        candidateName,
        txHash,
        timestamp: new Date().toISOString()
    };
    localStorage.setItem("evoting_vault", JSON.stringify(vault));
    currentReceiptData = vault[wallet];
}

function getStoredSecret(wallet) {
    const vault = JSON.parse(localStorage.getItem("evoting_vault") || "{}");
    return vault[wallet] || null;
}

function loadStoredSecret() {
    const stored = getStoredSecret(currentWallet);
    if (stored) {
        document.getElementById("revealSecret").value = stored.secret;
        currentReceiptData = stored;
    }
}

// ═══════════════ NEXT VOTER ═══════════════
function nextVoter() {
    // Clear current session but keep vault
    currentWallet = "";
    currentAadhaarHash = "";
    voterToken = "";

    // Reset form fields
    document.querySelectorAll("input").forEach(inp => {
        if (inp.type !== "hidden") inp.value = "";
    });

    // Reset UI
    document.getElementById("registerBtn").classList.remove("hidden");
    document.getElementById("otpSection").classList.add("hidden");
    document.getElementById("otpDisplay").classList.add("hidden");
    document.getElementById("commitInfo").classList.add("hidden");
    document.getElementById("revealSection").classList.add("hidden");
    document.getElementById("walletAddress").classList.add("hidden");

    const status = document.getElementById("connectionStatus");
    status.innerHTML = `● ${t("wallet_not_connected")}`;
    status.classList.add("status-warning");
    status.classList.remove("status-online");

    generateCaptcha();
    showSection("section1");
    showToast("Ready for next voter!");
}

// ═══════════════ REVEAL VOTE ═══════════════
async function revealVote() {
    const secret = document.getElementById("revealSecret").value.trim();
    const stored = getStoredSecret(currentWallet);

    if (!secret && !stored) {
        return showToast("Enter your secret passphrase", true);
    }

    const revealSecret = secret || stored.secret;
    const revealIndex = stored ? stored.candidateIndex : 0;

    try {
        if (contract && !demoMode) {
            showToast("⏳ Revealing vote on blockchain...");
            const tx = await contract.revealVote(revealIndex, revealSecret);
            await tx.wait();

            // Log to backend
            await fetch(`${backendUrl}/vote-revealed`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    identityHash: currentAadhaarHash || currentWallet,
                    candidateIndex: revealIndex,
                    txHash: tx.hash
                })
            });

            showToast("✅ Vote successfully counted on the ledger!");
        } else {
            showToast("✅ Vote revealed (Demo mode)!");
        }

        document.getElementById("revealSection").classList.add("hidden");
        showSection("section4");
        loadResults();
    } catch (err) {
        showToast("Reveal Failed: " + (err.reason || err.message || "Invalid hash"), true);
    }
}

// ═══════════════ 4. RESULTS ═══════════════
async function loadResults() {
    const list = document.getElementById("resultsList");
    const summary = document.getElementById("resultsSummary");
    list.innerHTML = "";
    summary.innerHTML = "";

    let candidates = [];
    let totalVotes = 0;

    // Try blockchain
    if (contract && !demoMode) {
        try {
            const total = await contract.getTotalCandidates();
            for (let i = 0; i < total; i++) {
                const [name, logoHash, votes] = await contract.getCandidate(i);
                const v = Number(votes);
                candidates.push({ name, logo: logoHash ? `/uploads/${logoHash}` : null, votes: v });
                totalVotes += v;
            }
        } catch (err) {
            console.warn("Blockchain results failed, using backend:", err.message);
            candidates = [];
        }
    }

    // Fallback to backend
    if (candidates.length === 0) {
        try {
            const res = await fetch(`${backendUrl}/results`);
            const data = await res.json();
            candidates = data.parties || [];
            totalVotes = data.totalVotes || 0;
        } catch (e) {}
    }

    // Summary
    summary.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${candidates.length}</div>
            <div class="stat-label">${t("candidates")}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${totalVotes}</div>
            <div class="stat-label">${t("total_votes")}</div>
        </div>
    `;

    // Chart.js
    renderChart(candidates, totalVotes);

    // Cards
    candidates.forEach(c => {
        const pct = totalVotes > 0 ? ((c.votes / totalVotes) * 100).toFixed(1) : 0;
        const card = document.createElement("div");
        card.className = "candidate-card";
        card.innerHTML = `
            ${c.logo ? `<img src="${c.logo}" class="candidate-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">` : ''}
            <div class="candidate-icon" ${c.logo ? 'style="display:none"' : ''}>${c.symbol || '🏛️'}</div>
            <div class="candidate-name">${c.name}</div>
            <div class="vote-count">${c.votes}</div>
            <div class="subtitle">${t("votes")}</div>
            <div class="result-percentage">${pct}%</div>
            <div class="result-bar-container">
                <div class="result-bar">
                    <div class="result-bar-fill" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

function renderChart(candidates, totalVotes) {
    const canvas = document.getElementById("resultsChart");
    if (!canvas) return;

    if (resultsChart) {
        resultsChart.destroy();
    }

    const colors = [
        "#FF9933", "#138808", "#000080", "#3b82f6", "#8b5cf6",
        "#ef4444", "#f59e0b", "#10b981", "#ec4899", "#6366f1"
    ];

    resultsChart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: candidates.map(c => c.name),
            datasets: [{
                data: candidates.map(c => c.votes),
                backgroundColor: colors.slice(0, candidates.length),
                borderColor: "#050d1a",
                borderWidth: 3,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: {
                animateScale: true,
                animateRotate: true,
                duration: 1500,
                easing: "easeOutBounce"
            },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        color: "#8899bb",
                        font: { family: "'Outfit', sans-serif", size: 12, weight: 600 },
                        padding: 15,
                        usePointStyle: true,
                        pointStyleWidth: 10
                    }
                },
                tooltip: {
                    backgroundColor: "#0a1628",
                    borderColor: "rgba(255,153,51,0.3)",
                    borderWidth: 1,
                    titleFont: { family: "'Outfit', sans-serif", weight: 700 },
                    bodyFont: { family: "'Outfit', sans-serif" },
                    callbacks: {
                        label: (ctx) => {
                            const pct = totalVotes > 0 ? ((ctx.parsed / totalVotes) * 100).toFixed(1) : 0;
                            return ` ${ctx.label}: ${ctx.parsed} votes (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ═══════════════ RECEIPT MODAL ═══════════════
async function showReceiptModal() {
    const stored = getStoredSecret(currentWallet) || currentReceiptData;
    if (!stored) return showToast("No receipt data available", true);

    try {
        const res = await fetch(`${backendUrl}/generate-receipt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                candidateName: stored.candidateName,
                txHash: stored.txHash,
                walletAddress: currentWallet,
                timestamp: stored.timestamp,
                electionType: "NATIONAL"
            })
        });
        const data = await res.json();

        if (data.qrCode) {
            document.getElementById("receiptQR").src = data.qrCode;
        }

        const details = document.getElementById("receiptDetails");
        details.innerHTML = `
            <div class="receipt-row"><span class="receipt-label">Election</span><span class="receipt-value">${data.receipt.election}</span></div>
            <div class="receipt-row"><span class="receipt-label">Candidate</span><span class="receipt-value">${data.receipt.candidate}</span></div>
            <div class="receipt-row"><span class="receipt-label">Tx Hash</span><span class="receipt-value">${data.receipt.txHash.slice(0,20)}...</span></div>
            <div class="receipt-row"><span class="receipt-label">Wallet</span><span class="receipt-value">${data.receipt.wallet.slice(0,10)}...${data.receipt.wallet.slice(-4)}</span></div>
            <div class="receipt-row"><span class="receipt-label">Timestamp</span><span class="receipt-value">${new Date(data.receipt.timestamp).toLocaleString()}</span></div>
            <div class="receipt-row"><span class="receipt-label">Verification</span><span class="receipt-value">${data.receipt.verification.slice(0,20)}...</span></div>
        `;

        document.getElementById("receiptModal").classList.add("visible");
    } catch (err) {
        showToast("Could not generate receipt", true);
    }
}

function closeReceiptModal() {
    document.getElementById("receiptModal").classList.remove("visible");
}

function downloadReceipt() {
    const modal = document.getElementById("receiptModal");
    const content = modal.querySelector(".modal-content");

    // Create a simple text receipt for download
    const stored = getStoredSecret(currentWallet) || currentReceiptData || {};
    const text = `
═══════════════════════════════════════════
     🗳️ DIGITAL VOTE CERTIFICATE
     Blockchain E-Voting System V3.1
═══════════════════════════════════════════

Election:     NATIONAL
Candidate:    ${stored.candidateName || "N/A"}
Tx Hash:      ${stored.txHash || "N/A"}
Wallet:       ${currentWallet || "N/A"}
Timestamp:    ${stored.timestamp || new Date().toISOString()}

═══════════════════════════════════════════
This receipt can be verified on the
Ethereum blockchain ledger.
═══════════════════════════════════════════
    `.trim();

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vote_receipt_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Receipt downloaded!");
}

// Make functions globally accessible
window.castVote = castVote;
window.revealVote = revealVote;
window.nextVoter = nextVoter;
window.setLanguage = setLanguage;
window.generateCaptcha = generateCaptcha;
window.showReceiptModal = showReceiptModal;
window.closeReceiptModal = closeReceiptModal;
window.downloadReceipt = downloadReceipt;
