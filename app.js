const express = require("express");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const Pino = require("pino");

const app = express();
const PORT = process.env.PORT || 3000;

let socket; // Global WhatsApp socket
let isConnecting = false;

// Middleware
app.use(bodyParser.json());
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } })); // Max 10MB
app.use(express.static("public"));

// Ensure auth folder exists
const AUTH_PATH = "./auth_info";
if (!fs.existsSync(AUTH_PATH)) {
  fs.mkdirSync(AUTH_PATH);
}

// === CHECK CONNECTION STATUS ===
app.get("/status", (req, res) => {
  const connected = socket && socket.user;
  res.json({ connected });
});

// === UPLOAD CREDS.JSON ===
app.post("/upload-creds", async (req, res) => {
  if (!req.files || !req.files.creds) {
    return res.status(400).send("Vă rugăm să încărcați fișierul creds.json!");
  }

  const credsFile = req.files.creds;
  const filePath = path.join(AUTH_PATH, "creds.json");

  credsFile.mv(filePath, async (err) => {
    if (err) {
      console.error("File move error:", err);
      return res.status(500).send("A apărut o eroare la salvarea fișierului creds.json.");
    }

    try {
      await startWhatsApp(); // Start connection
      res.send("✅ Fișierul creds.json a fost încărcat și conexiunea WhatsApp a fost inițializată!");
    } catch (error) {
      console.error("Start WhatsApp error:", error);
      res.status(500).send("❌ Eroare la inițializarea WhatsApp.");
    }
  });
});

// === SEND MESSAGE API ===
app.post("/send-message", async (req, res) => {
  const { targets, message, delay } = req.body;

  if (!targets || !message || !delay || isNaN(delay)) {
    return res.status(400).send('⚠️ Missing or invalid fields: "targets", "message", "delay"!');
  }

  const targetArray = targets
    .split(",")
    .map((t) => t.trim().replace(/^(\+?92|0)?/, "").replace(/[^0-9]/g, "") + "@s.whatsapp.net");

  if (!socket || !socket.user) {
    return res.status(400).send("🚫 WhatsApp not connected. Scan QR first!");
  }

  try {
    for (const target of targetArray) {
      await socket.sendMessage(target, { text: message });
      console.log(`✅ Sent → ${target}`);
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
    res.send("🚀 Mesaje trimise cu succes!");
  } catch (err) {
    console.error("Send error:", err);
    res.status(500).send("💣 Eroare la trimiterea mesajelor.");
  }
});

// === START WHATSAPP CONNECTION ===
const startWhatsApp = async () => {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

    socket = makeWASocket({
      auth: state,
      logger: Pino({ level: "silent" }),
      printQRInTerminal: true,
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        console.log("🟢 Conectat la WhatsApp Web!");
        isConnecting = false;
      } else if (connection === "close") {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log("🔴 Conexiune închisă.", shouldReconnect ? "Reconectare..." : "");
        if (shouldReconnect) setTimeout(startWhatsApp, 3000);
        else isConnecting = false;
      }
    });

    socket.ev.on("messages.upsert", (m) => {
      // Optional: Auto reply ya logging
      // console.log("📩 Msg received:", m.messages[0]);
    });
  } catch (error) {
    console.error("🔧 Failed to start WhatsApp:", error);
    isConnecting = false;
  }
};

// AUTO-CONNECT IF CREDS ALREADY EXISTS
const init = async () => {
  if (fs.existsSync(path.join(AUTH_PATH, "creds.json"))) {
    console.log("🔐 Found existing creds.json, auto-connecting...");
    await startWhatsApp();
  } else {
    console.log("👋 No creds found. Aștept încărcarea din browser...");
  }
};

// Start server + init
app.listen(PORT, () => {
  console.log(`🔥 Serverul rulează la http://localhost:${PORT}`);
  init(); // Try auto-connect
});
