// ════════════════════════════════════════════════════════════════
//  EVoting V3.1 — Full Backend Server
//  JWT · Helmet · Rate Limit · WebSocket · Gmail OTP
//  Audit Trail · CSV Export · QR Receipts · File Uploads
// ════════════════════════════════════════════════════════════════

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");
const crypto = require("crypto");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

// ════════════════════ CONFIG ════════════════════
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET || "evoting_jwt_secret_v3_2026";
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin@2026";
const JWT_EXPIRY = "2h";
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const DB_FILE = path.join(__dirname, "db.json");
const AUDIT_FILE = path.join(__dirname, "audit.json");
const UPLOADS_DIR = path.join(__dirname, "../frontend/uploads");
const CONFIG_FILE = path.join(__dirname, "../frontend/config.json");

// Ensure directories
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ════════════════════ EXPRESS APP ════════════════════
const app = express();
const server = http.createServer(app);

// ── Helmet Security Headers ──
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ── Rate Limiters ──
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 20,
    message: { message: "Too many attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false
});

const otpLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 min
    max: 10,
    message: { message: "Too many OTP requests. Wait 5 minutes." }
});

const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100
});

app.use(generalLimiter);

// ── Static Files ──
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/uploads", express.static(UPLOADS_DIR));

// ── Multer File Upload ──
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `candidate_${Date.now()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|svg|webp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype.replace("image/", ""));
        cb(null, ext || mime);
    }
});

// ════════════════════ WEBSOCKET SERVER ════════════════════
const wss = new WebSocket.Server({ server });
const wsClients = new Set();

wss.on("connection", (ws) => {
    wsClients.add(ws);
    console.log(`🔌 [WS] Client connected (total: ${wsClients.size})`);
    ws.on("close", () => {
        wsClients.delete(ws);
        console.log(`🔌 [WS] Client disconnected (total: ${wsClients.size})`);
    });
    ws.on("error", () => wsClients.delete(ws));
});

function broadcast(type, data) {
    const msg = JSON.stringify({ type, data, timestamp: Date.now() });
    wsClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

// ════════════════════ DATABASE HELPERS ════════════════════
function getData() {
    if (!fs.existsSync(DB_FILE)) {
        const initial = {
            users: [],
            collegeUsers: [],
            parties: [],
            votes: {},
            verifiedVoters: [],
            electionPhase: "SETUP",
            electionType: "NATIONAL",
            timerStart: null,
            timerDuration: 0,
            generationId: 1,
            paused: false
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveData(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ════════════════════ AUDIT LOG ════════════════════
function getAuditLog() {
    if (!fs.existsSync(AUDIT_FILE)) {
        fs.writeFileSync(AUDIT_FILE, JSON.stringify([], null, 2));
        return [];
    }
    return JSON.parse(fs.readFileSync(AUDIT_FILE));
}

function logAudit(action, details, req) {
    const logs = getAuditLog();
    const entry = {
        id: logs.length + 1,
        action,
        details,
        ip: req ? (req.headers["x-forwarded-for"] || req.ip || req.connection?.remoteAddress || "unknown") : "system",
        userAgent: req ? (req.headers["user-agent"] || "unknown") : "system",
        timestamp: new Date().toISOString()
    };
    logs.push(entry);
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(logs, null, 2));
    broadcast("audit", entry);
    console.log(`📝 [AUDIT] ${action}: ${JSON.stringify(details)}`);
    return entry;
}

// ════════════════════ JWT HELPERS ════════════════════
function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "No token provided" });
    }
    try {
        const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ message: "Invalid or expired token" });
    }
}

function adminOnly(req, res, next) {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
    }
    next();
}

// ════════════════════ GMAIL OTP SERVICE ════════════════════
let otps = {};
let emailTransporter = null;

// Try to set up Gmail
try {
    if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
        emailTransporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_PASS
            }
        });
        console.log("📧 Gmail OTP Service: CONFIGURED");
    } else {
        console.log("📧 Gmail OTP Service: FALLBACK MODE (console + UI display)");
    }
} catch (e) {
    console.log("📧 Gmail OTP Service: FALLBACK MODE (setup error)");
}

async function sendOTP(identifier, email) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otps[identifier] = { otp, expires: Date.now() + 5 * 60 * 1000 };

    let emailSent = false;

    if (emailTransporter && email) {
        try {
            await emailTransporter.sendMail({
                from: `"E-Voting System" <${process.env.GMAIL_USER}>`,
                to: email,
                subject: "🗳️ Your E-Voting OTP Verification Code",
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;background:#0a1628;color:#f0f4ff;border-radius:16px;">
                        <h2 style="color:#FF9933;text-align:center;">🇮🇳 E-Voting Verification</h2>
                        <p style="text-align:center;color:#8899bb;">Your One-Time Password</p>
                        <div style="text-align:center;font-size:36px;font-weight:bold;letter-spacing:8px;color:#FF9933;padding:20px;background:rgba(255,153,51,0.1);border-radius:12px;margin:20px 0;">
                            ${otp}
                        </div>
                        <p style="text-align:center;color:#5a6a8a;font-size:12px;">This code expires in 5 minutes. Do not share.</p>
                    </div>
                `
            });
            emailSent = true;
            console.log(`📧 [OTP] Email sent to ${email}`);
        } catch (e) {
            console.log(`📧 [OTP] Email failed, using fallback: ${e.message}`);
        }
    }

    console.log(`\n🔐 [AUTH] OTP for ${identifier}: ${otp}`);
    return { otp, emailSent };
}

// ════════════════════ hCAPTCHA VERIFICATION ════════════════════
async function verifyCaptcha(token) {
    if (!token) return true; // Skip if no token (demo mode)
    if (token === "demo_bypass") return true;
    try {
        const resp = await fetch("https://hcaptcha.com/siteverify", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `response=${token}&secret=${process.env.HCAPTCHA_SECRET || "0x0000000000000000000000000000000000000000"}`
        });
        const data = await resp.json();
        return data.success;
    } catch (e) {
        return true; // Demo fallback
    }
}

// ════════════════════ SHA-256 HELPER ════════════════════
function sha256(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
}

// ════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════

// ── Root ──
app.get("/", (req, res) => res.redirect("/index.html"));

// ── Contract Config ──
app.get("/config", (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE));
        return res.json(config);
    }
    res.json({ contractAddress: CONTRACT_ADDRESS, network: "localhost", version: "3.1" });
});

// ════════════════════ ADMIN AUTH ════════════════════

app.post("/admin-login", authLimiter, async (req, res) => {
    const { username, password, captchaToken } = req.body;
    await verifyCaptcha(captchaToken);

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = generateToken({ role: "admin", username });
        logAudit("ADMIN_LOGIN", { username }, req);
        return res.json({ message: "Admin authenticated", token, role: "admin" });
    }
    logAudit("ADMIN_LOGIN_FAILED", { username }, req);
    res.status(401).json({ message: "Invalid Admin Credentials" });
});

app.get("/verify-admin-token", verifyToken, adminOnly, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// ════════════════════ NATIONAL REGISTRATION ════════════════════

app.post("/register", otpLimiter, async (req, res) => {
    const { aadhaar, dob, voterId, district, city, pincode, mobile, email, captchaToken } = req.body;
    await verifyCaptcha(captchaToken);

    if (!aadhaar || aadhaar.length !== 12 || !/^\d{12}$/.test(aadhaar)) {
        return res.status(400).json({ message: "Invalid Aadhaar (12 digits required)" });
    }

    const birthYear = new Date(dob).getFullYear();
    const currentYear = new Date().getFullYear();
    if (isNaN(birthYear) || (currentYear - birthYear) < 18) {
        return res.status(400).json({ message: "Voter must be 18+ years old" });
    }

    if (!voterId || voterId.length < 5) {
        return res.status(400).json({ message: "Invalid Voter ID (min 5 characters)" });
    }

    const aadhaarHash = sha256(aadhaar);
    const data = getData();
    const existing = data.users.find(u => u.aadhaarHash === aadhaarHash);
    if (existing && existing.verified) {
        return res.status(400).json({ message: "This Aadhaar is already registered and verified" });
    }

    const { otp, emailSent } = await sendOTP(aadhaarHash, email);
    logAudit("VOTER_REGISTER_NATIONAL", { aadhaarHash: aadhaarHash.slice(0, 16) + "...", district, city, mobile, emailSent }, req);

    res.json({
        message: emailSent ? "OTP sent to your email!" : "OTP sent (check server console)",
        otpFallback: emailSent ? undefined : otp,
        aadhaarHash
    });
});

// ════════════════════ COLLEGE REGISTRATION ════════════════════

app.post("/register-college", otpLimiter, async (req, res) => {
    const { registerNo, phone, email, captchaToken } = req.body;
    await verifyCaptcha(captchaToken);

    if (!registerNo || registerNo.length < 5) {
        return res.status(400).json({ message: "Invalid Register Number (min 5 characters)" });
    }
    if (!phone || !/^\d{10}$/.test(phone)) {
        return res.status(400).json({ message: "Invalid Phone Number (10 digits required)" });
    }

    const regHash = sha256(registerNo);
    const data = getData();
    const existing = data.collegeUsers.find(u => u.regHash === regHash);
    if (existing && existing.verified) {
        return res.status(400).json({ message: "This Register Number is already registered" });
    }

    const { otp, emailSent } = await sendOTP(regHash, email);
    logAudit("VOTER_REGISTER_COLLEGE", { regHash: regHash.slice(0, 16) + "...", phone, emailSent }, req);

    res.json({
        message: emailSent ? "OTP sent to your email!" : "OTP sent (check server console)",
        otpFallback: emailSent ? undefined : otp,
        regHash
    });
});

// ════════════════════ VERIFY OTP (Both portals) ════════════════════

app.post("/verify-otp", authLimiter, async (req, res) => {
    const { identityHash, otp, type, voterId, dob, district, city, pincode, mobile, phone, walletAddress } = req.body;

    const stored = otps[identityHash];
    if (!stored || stored.otp !== otp) {
        logAudit("OTP_FAILED", { identityHash: identityHash?.slice(0, 16) + "..." }, req);
        return res.status(400).json({ message: "Invalid or Expired OTP" });
    }

    if (Date.now() > stored.expires) {
        delete otps[identityHash];
        return res.status(400).json({ message: "OTP has expired. Request a new one." });
    }

    const data = getData();

    if (type === "college") {
        const existingIdx = data.collegeUsers.findIndex(u => u.regHash === identityHash);
        const record = {
            regHash: identityHash,
            phone: phone || mobile || "",
            walletAddress: walletAddress || "",
            verified: true,
            registeredAt: new Date().toISOString()
        };
        if (existingIdx >= 0) data.collegeUsers[existingIdx] = record;
        else data.collegeUsers.push(record);
    } else {
        const existingIdx = data.users.findIndex(u => u.aadhaarHash === identityHash);
        const record = {
            aadhaarHash: identityHash,
            voterId: voterId || "",
            dob: dob || "",
            district: district || "",
            city: city || "",
            mobile: mobile || "",
            pincode: pincode || "",
            walletAddress: walletAddress || "",
            verified: true,
            registeredAt: new Date().toISOString()
        };
        if (existingIdx >= 0) data.users[existingIdx] = record;
        else data.users.push(record);
    }

    saveData(data);
    delete otps[identityHash];

    const token = generateToken({ role: "voter", identityHash, type: type || "national" });
    logAudit("OTP_VERIFIED", { identityHash: identityHash.slice(0, 16) + "...", type: type || "national" }, req);

    broadcast("voter_verified", { count: data.users.length + data.collegeUsers.length });

    res.json({ message: "Voter Verified Successfully!", token });
});

// ════════════════════ VOTER STATUS ════════════════════

app.get("/voter-status/:hash", (req, res) => {
    const data = getData();
    const user = data.users.find(u => u.aadhaarHash === req.params.hash) ||
                 data.collegeUsers.find(u => u.regHash === req.params.hash);
    if (user) return res.json({ registered: true, verified: user.verified, user });
    res.json({ registered: false, verified: false });
});

// ════════════════════ PARTY / CANDIDATE MANAGEMENT ════════════════════

app.post("/add-party", verifyToken, adminOnly, upload.single("logo"), (req, res) => {
    const { name, symbol } = req.body;
    const data = getData();

    if (!name) return res.status(400).json({ message: "Party name is required" });
    if (data.parties.find(p => p.name === name)) {
        return res.status(400).json({ message: "Party already exists" });
    }

    const party = {
        id: data.parties.length,
        name,
        symbol: symbol || "🏛️",
        logo: req.file ? `/uploads/${req.file.filename}` : null,
        addedAt: new Date().toISOString()
    };

    data.parties.push(party);
    saveData(data);
    logAudit("CANDIDATE_ADDED", { name, logo: party.logo }, req);
    broadcast("candidate_added", party);

    res.json({ message: "Candidate registered successfully", party });
});

app.get("/parties", (req, res) => {
    const data = getData();
    res.json(data.parties);
});

app.post("/remove-party", verifyToken, adminOnly, (req, res) => {
    const { id } = req.body;
    const data = getData();
    data.parties = data.parties.filter(p => p.id !== id);
    saveData(data);
    logAudit("CANDIDATE_REMOVED", { id }, req);
    broadcast("candidate_removed", { id });
    res.json({ message: "Candidate removed" });
});

// ════════════════════ VERIFIED VOTERS LIST ════════════════════

app.post("/add-verified-voter", (req, res) => {
    const { address } = req.body;
    const data = getData();
    if (!data.verifiedVoters) data.verifiedVoters = [];
    if (!data.verifiedVoters.includes(address)) {
        data.verifiedVoters.push(address);
        saveData(data);
    }
    res.json({ message: "Voter address recorded", total: data.verifiedVoters.length });
});

// ════════════════════ VOTE TRACKING ════════════════════

app.post("/cast-vote", (req, res) => {
    const { identityHash, partyId, txHash, type } = req.body;
    const data = getData();

    if (data.votes[identityHash]) {
        return res.status(400).json({ message: "You have already voted" });
    }

    data.votes[identityHash] = {
        partyId,
        txHash: txHash || "pending",
        type: type || "national",
        timestamp: new Date().toISOString()
    };
    saveData(data);
    logAudit("VOTE_COMMIT", { identityHash: identityHash.slice(0, 16) + "...", partyId, txHash }, req);
    broadcast("vote_cast", { totalVotes: Object.keys(data.votes).length });

    res.json({ message: "Vote recorded" });
});

app.post("/vote-revealed", (req, res) => {
    const { identityHash, candidateIndex, txHash } = req.body;
    logAudit("VOTE_REVEALED", { identityHash: identityHash?.slice(0, 16) + "...", candidateIndex, txHash }, req);
    broadcast("vote_revealed", { candidateIndex });
    res.json({ message: "Reveal recorded" });
});

// ════════════════════ RESULTS ════════════════════

app.get("/results", (req, res) => {
    const data = getData();
    const tally = {};

    data.parties.forEach(p => {
        tally[p.name] = { name: p.name, symbol: p.symbol || "🏛️", logo: p.logo, votes: 0 };
    });

    Object.values(data.votes).forEach(v => {
        const party = data.parties.find(p => p.id === v.partyId);
        if (party && tally[party.name]) tally[party.name].votes++;
    });

    res.json({
        totalVoters: data.users.length + data.collegeUsers.length,
        totalVotes: Object.keys(data.votes).length,
        parties: Object.values(tally)
    });
});

// ════════════════════ STATS ════════════════════

app.get("/stats", (req, res) => {
    const data = getData();
    res.json({
        totalRegistered: data.users.length + (data.collegeUsers || []).length,
        totalVerified: data.users.filter(u => u.verified).length + (data.collegeUsers || []).filter(u => u.verified).length,
        totalParties: data.parties.length,
        totalVotes: Object.keys(data.votes).length,
        verifiedVoters: data.verifiedVoters || [],
        electionPhase: data.electionPhase || "SETUP",
        electionType: data.electionType || "NATIONAL",
        generationId: data.generationId || 1,
        paused: data.paused || false,
        timerStart: data.timerStart,
        timerDuration: data.timerDuration
    });
});

app.get("/registered-voters", (req, res) => {
    const data = getData();
    res.json({ national: data.users || [], college: data.collegeUsers || [] });
});

// ════════════════════ ELECTION PHASE CONTROL ════════════════════

app.post("/set-phase", verifyToken, adminOnly, (req, res) => {
    const { phase } = req.body;
    const validPhases = ["SETUP", "COMMIT", "REVEAL", "ENDED"];
    if (!validPhases.includes(phase)) {
        return res.status(400).json({ message: "Invalid phase" });
    }
    const data = getData();
    data.electionPhase = phase;
    saveData(data);
    logAudit("PHASE_CHANGE", { phase }, req);
    broadcast("phase_change", { phase });
    res.json({ message: `Phase changed to ${phase}` });
});

app.post("/set-election-type", verifyToken, adminOnly, (req, res) => {
    const { type } = req.body;
    if (!["NATIONAL", "COLLEGE"].includes(type)) {
        return res.status(400).json({ message: "Invalid election type" });
    }
    const data = getData();
    data.electionType = type;
    saveData(data);
    logAudit("ELECTION_TYPE_CHANGE", { type }, req);
    broadcast("election_type", { type });
    res.json({ message: `Election type set to ${type}` });
});

app.post("/set-timer", verifyToken, adminOnly, (req, res) => {
    const { duration } = req.body; // in seconds
    const data = getData();
    data.timerStart = Date.now();
    data.timerDuration = duration || 3600;
    saveData(data);
    logAudit("TIMER_SET", { duration }, req);
    broadcast("timer_start", { start: data.timerStart, duration: data.timerDuration });
    res.json({ message: `Timer set for ${duration}s` });
});

app.get("/timer", (req, res) => {
    const data = getData();
    if (!data.timerStart) return res.json({ remaining: 0, active: false });
    const elapsed = (Date.now() - data.timerStart) / 1000;
    const remaining = Math.max(0, data.timerDuration - elapsed);
    res.json({ remaining: Math.floor(remaining), active: remaining > 0, start: data.timerStart, duration: data.timerDuration });
});

app.post("/pause-system", verifyToken, adminOnly, (req, res) => {
    const data = getData();
    data.paused = true;
    saveData(data);
    logAudit("SYSTEM_PAUSED", {}, req);
    broadcast("system_paused", { paused: true });
    res.json({ message: "System PAUSED" });
});

app.post("/unpause-system", verifyToken, adminOnly, (req, res) => {
    const data = getData();
    data.paused = false;
    saveData(data);
    logAudit("SYSTEM_UNPAUSED", {}, req);
    broadcast("system_paused", { paused: false });
    res.json({ message: "System UNPAUSED" });
});

// ════════════════════ FRESH START (ATOMIC RESET) ════════════════════

app.post("/fresh-start", verifyToken, adminOnly, (req, res) => {
    const data = getData();
    const newGenId = (data.generationId || 1) + 1;

    const freshData = {
        users: [],
        collegeUsers: [],
        parties: [],
        votes: {},
        verifiedVoters: [],
        electionPhase: "SETUP",
        electionType: data.electionType || "NATIONAL",
        timerStart: null,
        timerDuration: 0,
        generationId: newGenId,
        paused: false
    };
    saveData(freshData);

    // Clear audit log
    fs.writeFileSync(AUDIT_FILE, JSON.stringify([], null, 2));

    logAudit("FRESH_START", { newGenerationId: newGenId }, req);
    broadcast("fresh_start", { generationId: newGenId });

    res.json({ message: `Fresh Start complete! Generation ID: ${newGenId}`, generationId: newGenId });
});

// ════════════════════ VOTE RECEIPT + QR CODE ════════════════════

app.post("/generate-receipt", async (req, res) => {
    const { candidateName, txHash, walletAddress, timestamp, electionType } = req.body;

    const receiptData = {
        system: "Blockchain E-Voting System V3.1",
        election: electionType || "NATIONAL",
        candidate: candidateName,
        txHash: txHash || "0x" + crypto.randomBytes(32).toString("hex"),
        wallet: walletAddress || "0x0000",
        timestamp: timestamp || new Date().toISOString(),
        verification: sha256(`${candidateName}${txHash}${walletAddress}${timestamp}`)
    };

    try {
        const qrDataUrl = await QRCode.toDataURL(JSON.stringify(receiptData), {
            width: 256,
            margin: 2,
            color: { dark: "#FF9933", light: "#050d1a" }
        });

        res.json({
            receipt: receiptData,
            qrCode: qrDataUrl
        });
    } catch (e) {
        res.json({ receipt: receiptData, qrCode: null });
    }
});

// ════════════════════ AUDIT LOG & CSV EXPORT ════════════════════

app.get("/audit-log", verifyToken, adminOnly, (req, res) => {
    const logs = getAuditLog();
    res.json(logs);
});

app.get("/export-csv", verifyToken, adminOnly, (req, res) => {
    const logs = getAuditLog();
    const data = getData();

    let csv = "Type,ID,Action/Name,Details,IP,Timestamp\n";

    // Audit entries
    logs.forEach(l => {
        csv += `AUDIT,${l.id},"${l.action}","${JSON.stringify(l.details).replace(/"/g, '""')}","${l.ip}","${l.timestamp}"\n`;
    });

    // Registered voters
    data.users.forEach((u, i) => {
        csv += `VOTER_NATIONAL,${i + 1},"${u.aadhaarHash?.slice(0, 16)}...","district:${u.district || 'N/A'}","","${u.registeredAt || ''}"\n`;
    });

    (data.collegeUsers || []).forEach((u, i) => {
        csv += `VOTER_COLLEGE,${i + 1},"${u.regHash?.slice(0, 16)}...","phone:${u.phone || 'N/A'}","","${u.registeredAt || ''}"\n`;
    });

    // Votes
    Object.entries(data.votes).forEach(([key, v], i) => {
        csv += `VOTE,${i + 1},"${key.slice(0, 16)}...","party:${v.partyId} tx:${v.txHash || 'N/A'}","","${v.timestamp || ''}"\n`;
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=evoting_audit_${Date.now()}.csv`);
    res.send(csv);
});

// ════════════════════ START SERVER ════════════════════

server.listen(PORT, "0.0.0.0", () => {
    const interfaces = require("os").networkInterfaces();
    let localIP = "localhost";
    Object.values(interfaces).forEach(iface => {
        iface.forEach(addr => {
            if (addr.family === "IPv4" && !addr.internal) localIP = addr.address;
        });
    });

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  🇮🇳  BLOCKCHAIN E-VOTING SYSTEM V3.1`);
    console.log(`${"═".repeat(60)}`);
    console.log(`  🚀 Backend + WebSocket: http://localhost:${PORT}`);
    console.log(`  🌐 Network Access:      http://${localIP}:${PORT}`);
    console.log(`  🗳️ National Portal:     http://localhost:${PORT}/index.html`);
    console.log(`  🎓 College Portal:      http://localhost:${PORT}/college.html`);
    console.log(`  👑 Admin Dashboard:     http://localhost:${PORT}/admin.html`);
    console.log(`${"─".repeat(60)}`);
    console.log(`  🔐 Admin: ${ADMIN_USER} / ${ADMIN_PASS}`);
    console.log(`  ⛓️ Contract: ${CONTRACT_ADDRESS}`);
    console.log(`  📧 Gmail OTP: ${emailTransporter ? "ACTIVE" : "CONSOLE FALLBACK"}`);
    console.log(`  🔌 WebSocket: ws://localhost:${PORT}`);
    console.log(`${"═".repeat(60)}\n`);
});
