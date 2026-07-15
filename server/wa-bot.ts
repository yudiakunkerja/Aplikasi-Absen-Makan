import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
import path from "path";
import fs from "fs";
import QRCode from "qrcode";

// Safely extract baileys methods handling any ESM/CJS interop issues
const getBaileysModule = () => {
  if (!baileys) return {} as any;
  return baileys;
};

const getMakeWASocket = () => {
  const pkg = getBaileysModule();
  if (typeof pkg.makeWASocket === "function") return pkg.makeWASocket;
  if (pkg.default && typeof pkg.default.makeWASocket === "function") return pkg.default.makeWASocket;
  if (pkg.default && typeof pkg.default.default === "function") return pkg.default.default;
  if (typeof pkg.default === "function") return pkg.default;
  return (pkg as any).makeWASocket || (pkg as any).default;
};

const getUseMultiFileAuthState = () => {
  const pkg = getBaileysModule();
  if (typeof pkg.useMultiFileAuthState === "function") return pkg.useMultiFileAuthState;
  if (pkg.default && typeof pkg.default.useMultiFileAuthState === "function") return pkg.default.useMultiFileAuthState;
  return (pkg as any).useMultiFileAuthState;
};

const getDisconnectReason = () => {
  const pkg = getBaileysModule();
  if (pkg.DisconnectReason) return pkg.DisconnectReason;
  if (pkg.default && pkg.default.DisconnectReason) return pkg.default.DisconnectReason;
  return (pkg as any).DisconnectReason || {};
};

const makeWASocket = getMakeWASocket();
const useMultiFileAuthState = getUseMultiFileAuthState();
const DisconnectReason = getDisconnectReason();

const AUTH_DIR = path.join(process.cwd(), "auth_info_baileys");

// Global state variables for WhatsApp Bot
let sock: any = null;
let connectionStatus: "disconnected" | "connecting" | "connected" | "qr" = "disconnected";
let qrCodeDataUrl: string | null = null;
let connectedUser: { id: string; name?: string } | null = null;
let lastError: string | null = null;

// Convert Indonesian/regular phone numbers to WhatsApp JID format
export function formatToWaJid(phone: string): string {
  let cleaned = phone.replace(/[^0-9]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "62" + cleaned.slice(1);
  } else if (cleaned.startsWith("8")) {
    cleaned = "62" + cleaned;
  }
  
  if (!cleaned.endsWith("@s.whatsapp.net")) {
    return cleaned + "@s.whatsapp.net";
  }
  return cleaned;
}

// Check status helper
export function getWhatsAppStatus() {
  return {
    status: connectionStatus,
    qr: qrCodeDataUrl,
    user: connectedUser,
    error: lastError
  };
}

// Initialize/Start WhatsApp connection
export async function initWhatsApp() {
  try {
    if (connectionStatus === "connected" && sock) {
      return sock;
    }

    connectionStatus = "connecting";
    lastError = null;

    console.log("Baileys integration checks:", {
      makeWASocketType: typeof makeWASocket,
      useMultiFileAuthStateType: typeof useMultiFileAuthState,
      DisconnectReasonType: typeof DisconnectReason,
    });

    if (typeof useMultiFileAuthState !== "function") {
      throw new Error("useMultiFileAuthState is not a function. Check baileys bundle/import.");
    }

    if (typeof makeWASocket !== "function") {
      throw new Error("makeWASocket is not a function. Check baileys bundle/import.");
    }

    // Initialize Auth state folder
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Create Socket
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }) as any,
    });

    // Handle credential updates
    sock.ev.on("creds.update", saveCreds);

    // Handle connection updates
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionStatus = "qr";
        try {
          qrCodeDataUrl = await QRCode.toDataURL(qr);
        } catch (err: any) {
          console.error("Failed to generate QR data URL", err);
          qrCodeDataUrl = null;
        }
      }

      if (connection === "open") {
        connectionStatus = "connected";
        qrCodeDataUrl = null;
        const user = sock?.user;
        connectedUser = user ? { id: user.id, name: user.name || "Admin WhatsApp" } : { id: "unknown" };
        console.log("WhatsApp connection successfully opened for", connectedUser);
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log(`WhatsApp connection closed. Status Code: ${statusCode}, Reconnecting: ${shouldReconnect}`);
        
        connectedUser = null;
        qrCodeDataUrl = null;

        if (shouldReconnect) {
          connectionStatus = "connecting";
          setTimeout(() => {
            initWhatsApp();
          }, 5000);
        } else {
          connectionStatus = "disconnected";
          lastError = "Logged out of WhatsApp. Please scan QR Code again.";
          cleanupAuthFolder();
        }
      }
    });

    return sock;
  } catch (err: any) {
    console.error("Error starting WhatsApp Baileys:", err);
    connectionStatus = "disconnected";
    lastError = err.message || "Failed to initialize WhatsApp connection.";
    return null;
  }
}

// Helper to clean up auth credentials folder
function cleanupAuthFolder() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      console.log("Cleared Baileys auth directory successfully.");
    }
  } catch (err) {
    console.error("Error clearing Baileys auth folder:", err);
  }
}

// Disconnect/Logout WhatsApp
export async function disconnectWhatsApp() {
  try {
    qrCodeDataUrl = null;
    connectedUser = null;
    
    if (sock) {
      try {
        await sock.logout();
      } catch (e) {
        // ignore logout errors if socket is already dead
      }
      sock.end(undefined);
      sock = null;
    }
    
    connectionStatus = "disconnected";
    cleanupAuthFolder();
    
    // Trigger a fresh connection after 2 seconds to regenerate a clean QR code
    setTimeout(() => {
      initWhatsApp();
    }, 2000);

    return { success: true, message: "Logged out and reset successfully." };
  } catch (err: any) {
    console.error("Error during logout:", err);
    return { success: false, error: err.message };
  }
}

// Send Message helper
export async function sendWhatsAppMessage(phoneNumber: string, text: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (connectionStatus !== "connected" || !sock) {
      throw new Error("WhatsApp bot is not connected.");
    }

    const jid = formatToWaJid(phoneNumber);
    console.log(`Sending WhatsApp message to ${jid}: ${text.slice(0, 40)}...`);
    
    await sock.sendMessage(jid, { text });
    return { success: true };
  } catch (err: any) {
    console.error(`Failed to send WhatsApp message to ${phoneNumber}:`, err);
    return { success: false, error: err.message || "Unknown error" };
  }
}

// Request pairing code helper (Link via Phone Number)
export async function requestWhatsAppPairingCode(phone: string): Promise<string> {
  if (connectionStatus === "connected") {
    throw new Error("WhatsApp sudah terhubung. Sila putuskan koneksi terlebih dahulu.");
  }

  // Ensure socket is initialized and alive
  if (!sock) {
    await initWhatsApp();
  }

  if (!sock) {
    throw new Error("Gagal menginisialisasi server WhatsApp.");
  }

  let cleaned = phone.replace(/[^0-9]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "62" + cleaned.slice(1);
  } else if (cleaned.startsWith("8")) {
    cleaned = "62" + cleaned;
  }

  console.log(`Requesting pairing code for phone number: ${cleaned}`);
  try {
    const code = await sock.requestPairingCode(cleaned);
    return code;
  } catch (err: any) {
    console.error("Error requesting pairing code from Baileys:", err);
    throw new Error(err.message || "Gagal meminta kode pairing dari WhatsApp. Coba beberapa saat lagi atau putuskan koneksi dulu.");
  }
}
