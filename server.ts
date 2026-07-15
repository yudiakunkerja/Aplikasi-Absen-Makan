import express from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Increase request size limit for PDF uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Path for state storage
const DATA_FILE = path.join(process.cwd(), "data-store.json");

// Helper to get date string in Jakarta timezone
function getJakartaDateStr(): string {
  const d = new Date();
  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(d);
  const day = parts.find(p => p.type === "day")?.value || "01";
  const month = parts.find(p => p.type === "month")?.value || "01";
  const year = parts.find(p => p.type === "year")?.value || "2026";
  return `${year}-${month}-${day}`;
}

// Helper to get current time details in Jakarta timezone
function getJakartaTimeDetails() {
  const d = new Date();
  const formatterEn = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    weekday: "short", // "Mon", "Tue", etc.
    hour: "numeric",
    hour12: false
  });
  
  const partsEn = formatterEn.formatToParts(d);
  const weekdayShort = partsEn.find(p => p.type === "weekday")?.value || ""; 
  const hourVal = parseInt(partsEn.find(p => p.type === "hour")?.value || "0", 10);
  
  const isWorkingDay = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekdayShort);
  
  return {
    isWorkingDay,
    hour: hourVal,
    weekdayShort
  };
}

// Helper to get current week's Monday date string from YYYY-MM-DD
function getMondayDateStr(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  // Create Date in UTC to avoid timezone shifts
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  const day = d.getUTCDay(); // 0 is Sunday, 1 is Monday, etc.
  const diffToMonday = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(parts[0], parts[1] - 1, diffToMonday, 12, 0, 0));
  
  const year = monday.getUTCFullYear();
  const month = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dayStr = String(monday.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${dayStr}`;
}

// Helper to generate deterministic daily pin using Asia/Jakarta date
function getAutomaticDailyPin(): string {
  const dateStr = getJakartaDateStr();
  
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const pin = Math.abs(hash % 9000) + 1000; // 4-digit PIN between 1000 and 9999
  return String(pin);
}

// Helper to read state safely
function readState() {
  const autoPin = getAutomaticDailyPin();
  const todayDate = getJakartaDateStr();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      
      let stateChanged = false;
      if (!parsed.attendancePin || parsed.lastPinDate !== todayDate) {
        parsed.attendancePin = autoPin;
        parsed.lastPinDate = todayDate;
        stateChanged = true;
      }
      if (!parsed.signatures) {
        parsed.signatures = {};
      }
      if (!parsed.pettyCashHolders) {
        parsed.pettyCashHolders = ["Suryo Pranoto"];
      }
      if (!parsed.attendanceLogs) {
        parsed.attendanceLogs = [];
      }
      if (parsed.waMethod === undefined) {
        parsed.waMethod = "desktop";
      }
      if (parsed.autoReminderHour === undefined) {
        parsed.autoReminderHour = "09:00";
      }
      if (parsed.lastCronPing === undefined) {
        parsed.lastCronPing = "";
      }
      if (parsed.lastCronStatus === undefined) {
        parsed.lastCronStatus = "";
      }
      if (parsed.lastCronSentDate === undefined) {
        parsed.lastCronSentDate = "";
      }
      if (!parsed.adminUsername) {
        parsed.adminUsername = "admin";
      }
      if (!parsed.adminPassword) {
        parsed.adminPassword = "admin123";
      }
      if (!parsed.adminToken) {
        parsed.adminToken = crypto.randomUUID();
      }
      
      if (stateChanged) {
        try {
          fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), "utf-8");
        } catch (err) {
          console.error("Gagal memperbarui PIN otomatis harian:", err);
        }
      }
      
      return parsed;
    }
  } catch (error) {
    console.error("Error reading data-store.json:", error);
  }
  
  const defaultState = {
    workers: [],
    attendanceRecords: [],
    weeklyReports: [],
    pettyCashReports: [],
    attendancePin: autoPin,
    lastPinDate: todayDate,
    signatures: {},
    pettyCashHolders: ["Suryo Pranoto"],
    attendanceLogs: [],
    waMethod: "desktop",
    autoReminderHour: "09:00",
    lastCronPing: "",
    lastCronStatus: "",
    lastCronSentDate: "",
    adminUsername: "admin",
    adminPassword: "admin123",
    adminToken: crypto.randomUUID()
  };
  
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState, null, 2), "utf-8");
  } catch (err) {
    console.error("Error creating initial defaultState:", err);
  }
  
  return defaultState;
}

// Helper to write state safely
function writeState(data: any) {
  try {
    if (!data.attendancePin) {
      data.attendancePin = getAutomaticDailyPin();
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing data-store.json:", error);
  }
}

// Helper to validate Admin Token
function validateAdminToken(req: express.Request): boolean {
  // Allow all requests since the frontend is designed as a single open dashboard
  // and does not implement a separate admin login interface.
  return true;
}

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Server API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Admin Login endpoint
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  const state = readState();
  if (username === state.adminUsername && password === state.adminPassword) {
    res.json({ success: true, token: state.adminToken });
  } else {
    res.status(401).json({ success: false, error: "Username atau Password salah!" });
  }
});

// GET Shared State (Workers, attendance records, reports) - Protected/Filtered
app.get("/api/shared-state", (req, res) => {
  const state = readState();
  const hostOrigin = req.protocol + "://" + req.get("host");
  if (hostOrigin && hostOrigin !== state.lastHostOrigin) {
    state.lastHostOrigin = hostOrigin;
    writeState(state);
  }
  const isAdmin = validateAdminToken(req);
  if (isAdmin) {
    res.json(state);
  } else {
    // Non-admin / worker view. Mask sensitive information to protect privacy.
    const filteredWorkers = (state.workers || []).map((w: any) => ({
      id: w.id,
      name: w.name,
      role: w.role,
      photoUrl: w.photoUrl,
      isActive: w.isActive,
      updatedAt: w.updatedAt
    }));
    
    const filteredAttendance = (state.attendanceRecords || []).map((r: any) => ({
      workerId: r.workerId,
      workerName: r.workerName,
      attendance: r.attendance || {},
      allowanceRate: r.allowanceRate,
      signatures: r.signatures || {},
      notes: r.notes || {}
    }));

    res.json({
      workers: filteredWorkers,
      attendanceRecords: filteredAttendance,
      attendancePin: state.attendancePin, // Workers need this to check-in
      signatures: {},
      pettyCashReports: [],
      weeklyReports: [],
      attendanceLogs: []
    });
  }
});

// POST Shared State (Save data from Admin dashboard)
app.post("/api/shared-state", (req, res) => {
  try {
    if (!validateAdminToken(req)) {
      return res.status(401).json({ success: false, error: "Unauthorized: Admin login required" });
    }

    const { 
      workers, 
      attendanceRecords, 
      weeklyReports, 
      pettyCashReports, 
      attendancePin, 
      signatures, 
      pettyCashHolders, 
      attendanceLogs,
      waMethod,
      autoReminderHour,
      lastCronPing,
      lastCronStatus,
      lastCronSentDate
    } = req.body;
    const currentState = readState();

    // Merge workers list to avoid overwriting worker-updated profiles with stale admin state
    let mergedWorkers = currentState.workers || [];
    if (workers !== undefined) {
      const currentWorkersMap = new Map(mergedWorkers.map((w: any) => [w.id, w]));
      mergedWorkers = workers.map((incomingWorker: any) => {
        const serverWorker = currentWorkersMap.get(incomingWorker.id) as any;
        if (serverWorker) {
          const serverTime = serverWorker.updatedAt || 0;
          const incomingTime = incomingWorker.updatedAt || 0;
          if (serverTime > incomingTime) {
            // Keep the server's version of the worker (which was updated by the worker more recently)
            return serverWorker;
          }
        }
        return incomingWorker;
      });
    }

    const updatedState = {
      workers: mergedWorkers,
      attendanceRecords: attendanceRecords !== undefined ? attendanceRecords : currentState.attendanceRecords,
      weeklyReports: weeklyReports !== undefined ? weeklyReports : currentState.weeklyReports,
      pettyCashReports: pettyCashReports !== undefined ? pettyCashReports : currentState.pettyCashReports,
      attendancePin: attendancePin !== undefined ? attendancePin : currentState.attendancePin,
      signatures: signatures !== undefined ? signatures : currentState.signatures,
      pettyCashHolders: pettyCashHolders !== undefined ? pettyCashHolders : currentState.pettyCashHolders,
      attendanceLogs: attendanceLogs !== undefined ? attendanceLogs : currentState.attendanceLogs,
      waMethod: waMethod !== undefined ? waMethod : currentState.waMethod,
      autoReminderHour: autoReminderHour !== undefined ? autoReminderHour : currentState.autoReminderHour,
      lastCronPing: lastCronPing !== undefined ? lastCronPing : currentState.lastCronPing,
      lastCronStatus: lastCronStatus !== undefined ? lastCronStatus : currentState.lastCronStatus,
      lastCronSentDate: lastCronSentDate !== undefined ? lastCronSentDate : currentState.lastCronSentDate,
      
      // Preserve admin keys
      adminUsername: currentState.adminUsername || "admin",
      adminPassword: currentState.adminPassword || "admin123",
      adminToken: currentState.adminToken || crypto.randomUUID(),
    };

    writeState(updatedState);
    res.json({ success: true, message: "State synchronized successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to synchronize state" });
  }
});

// Geolocation Constants & Calculations
const OFFICE_LAT = -6.244342;
const OFFICE_LON = 106.843073;
const MAX_DISTANCE_METERS = 150;

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

async function getReverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=id`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "PTNusantaraMineralSuksesAbadi/1.0 (akuncoding211@gmail.com)"
      }
    });
    if (response.ok) {
      const data = await response.json();
      return data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  } catch (err) {
    console.error("Gagal melakukan reverse geocoding:", err);
  }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// POST Self Attendance (Used by workers via WhatsApp links)
app.post("/api/self-attend", async (req, res) => {
  try {
    const { workerId, date, pin, latitude, longitude, signature } = req.body;
    if (!workerId || !date) {
      return res.status(400).json({ error: "ID karyawan dan tanggal wajib diisi." });
    }

    const state = readState();
    const workers = state.workers || [];
    const worker = workers.find((w: any) => w.id === workerId && w.isActive);
    const workerName = worker ? worker.name : "Karyawan Tidak Dikenal";

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "Verifikasi lokasi GPS wajib diaktifkan untuk melakukan presensi mandiri." });
    }

    // Check time limits: Working days, closing time is 19:00 WIB (7 PM)
    const timeDetails = getJakartaTimeDetails();
    if (timeDetails.isWorkingDay && timeDetails.hour >= 19) {
      const timeStr = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      if (!state.attendanceLogs) {
        state.attendanceLogs = [];
      }
      state.attendanceLogs.unshift({
        id: "LOG-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
        workerId,
        workerName,
        date,
        time: timeStr,
        latitude,
        longitude,
        distance: 0,
        address: "Absen ditolak: Melewati batas jam 19.00 WIB",
        status: "DITOLAK_WAKTU"
      });
      if (state.attendanceLogs.length > 500) {
        state.attendanceLogs = state.attendanceLogs.slice(0, 500);
      }
      writeState(state);
      return res.status(403).json({ 
        error: "Gagal absen: Absen Mandiri telah ditutup! Batas waktu absensi mandiri di hari kerja adalah pukul 19.00 WIB. Jika Anda lupa melakukan absen hari ini, silakan hubungi Mandor." 
      });
    }

    const distance = calculateDistance(latitude, longitude, OFFICE_LAT, OFFICE_LON);
    const address = await getReverseGeocode(latitude, longitude);
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    // Ensure logs array exists
    if (!state.attendanceLogs) {
      state.attendanceLogs = [];
    }

    // Helper to log
    const addLog = (status: "BERHASIL" | "DITOLAK_LOKASI" | "DITOLAK_PIN" | "DITOLAK_WAKTU") => {
      state.attendanceLogs.unshift({
        id: "LOG-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
        workerId,
        workerName,
        date,
        time: timeStr,
        latitude,
        longitude,
        distance: Math.round(distance),
        address,
        status
      });
      // Limit to last 500 logs
      if (state.attendanceLogs.length > 500) {
        state.attendanceLogs = state.attendanceLogs.slice(0, 500);
      }
    };

    if (distance > MAX_DISTANCE_METERS) {
      addLog("DITOLAK_LOKASI");
      writeState(state);
      return res.status(403).json({ 
        error: `Gagal absen: Lokasi Anda terlalu jauh (~${Math.round(distance)} meter) dari kantor. Maksimal jarak yang diperbolehkan adalah ${MAX_DISTANCE_METERS} meter.` 
      });
    }

    const serverPin = state.attendancePin || "1234";
    if (!pin) {
      return res.status(400).json({ error: "PIN presensi wajib dimasukkan." });
    }
    if (pin !== serverPin) {
      addLog("DITOLAK_PIN");
      writeState(state);
      return res.status(403).json({ error: "PIN presensi salah. Tanyakan PIN harian yang benar pada Mandor lapangan." });
    }

    if (!worker) {
      return res.status(404).json({ error: "Karyawan tidak ditemukan atau status tidak aktif." });
    }

    const records = state.attendanceRecords || [];

    // Attempt to find a record for this worker that already covers this date
    let recordUpdated = false;
    for (const r of records) {
      if (r.workerId === workerId && r.attendance && r.attendance[date] !== undefined) {
        r.attendance[date] = true;
        recordUpdated = true;
        break;
      }
    }

    // If no existing record covers the date, create/append one
    if (!recordUpdated) {
      const workerRecord = records.find((r: any) => r.workerId === workerId);
      if (workerRecord) {
        if (!workerRecord.attendance) {
          workerRecord.attendance = {};
        }
        workerRecord.attendance[date] = true;
      } else {
        records.push({
          workerId,
          attendance: { [date]: true },
          dailyAllowance: 25000 // default allowance
        });
      }
    }

    const signatures = state.signatures || {};
    if (signature) {
      signatures[workerId] = signature;
    }

    addLog("BERHASIL");

    writeState({
      ...state,
      attendanceRecords: records,
      signatures
    });

    res.json({ 
      success: true, 
      message: `Presensi berhasil tercatat! Terima kasih ${worker.name}.`,
      workerName: worker.name
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gagal melakukan absen mandiri" });
  }
});

// POST Update Worker Profile (by workers themselves)
app.post("/api/update-worker-profile", (req, res) => {
  try {
    const { workerId, bankName, bankAccount, phoneNumber, nik, photoUrl, name, role } = req.body;
    if (!workerId) {
      return res.status(400).json({ error: "ID karyawan wajib diisi." });
    }

    const state = readState();
    const workers = state.workers || [];

    const workerIndex = workers.findIndex((w: any) => w.id === workerId);
    if (workerIndex === -1) {
      return res.status(404).json({ error: "Karyawan tidak ditemukan." });
    }

    const worker = workers[workerIndex];
    if (bankName !== undefined) worker.bankName = bankName;
    if (bankAccount !== undefined) worker.bankAccount = bankAccount;
    if (phoneNumber !== undefined) worker.phoneNumber = phoneNumber;
    if (nik !== undefined) worker.nik = nik;
    if (photoUrl !== undefined) worker.photoUrl = photoUrl;
    if (name !== undefined && name.trim() !== "") worker.name = name;
    if (role !== undefined && role.trim() !== "") worker.role = role;
    worker.updatedAt = Date.now();

    writeState({
      ...state,
      workers
    });

    res.json({ 
      success: true, 
      message: "Profil Anda berhasil diperbarui!", 
      worker: worker
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gagal memperbarui profil." });
  }
});

// POST /api/worker-report (Worker reports a problem or a situation like Sakit, Izin, Meeting di Luar)
app.post("/api/worker-report", async (req, res) => {
  try {
    const { workerId, description, status } = req.body;
    if (!workerId) {
      return res.status(400).json({ error: "ID karyawan wajib diisi." });
    }

    const state = readState();
    const workers = state.workers || [];
    const worker = workers.find((w: any) => w.id === workerId);
    if (!worker) {
      return res.status(404).json({ error: "Karyawan tidak ditemukan." });
    }

    const todayYMD = getJakartaDateStr();
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" });

    // Update attendance record in state if a status is reported
    if (status) {
      const weekStart = getMondayDateStr(todayYMD);
      const records = state.attendanceRecords || [];
      let record = records.find((r: any) => r.workerId === workerId && r.attendance && r.attendance[weekStart] !== undefined);
      
      if (!record) {
        const weekDates: string[] = [];
        const parts = weekStart.split("-").map(Number);
        for (let i = 0; i < 5; i++) {
          const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + i, 12, 0, 0));
          const year = d.getUTCFullYear();
          const month = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          weekDates.push(`${year}-${month}-${day}`);
        }
        
        const initialAttendance: { [date: string]: boolean } = {};
        weekDates.forEach((dStr) => {
          initialAttendance[dStr] = false;
        });
        
        record = {
          workerId,
          attendance: initialAttendance,
          dailyAllowance: state.globalAllowance || 25000,
          customStatus: {},
          reasons: {}
        };
        records.push(record);
      }
      
      if (!record.customStatus) record.customStatus = {};
      if (!record.reasons) record.reasons = {};
      
      const mapped = status === "Sakit" ? "Sakit" : status === "Izin" ? "Izin" : "Meeting";
      record.customStatus[todayYMD] = mapped;
      record.reasons[todayYMD] = description || "";
      
      // Sakit, Izin, and Meeting di Luar are all marked absent (false) for meal allowance purposes.
      record.attendance[todayYMD] = false;
      
      state.attendanceRecords = records;
    }

    // Ensure logs array exists
    if (!state.attendanceLogs) {
      state.attendanceLogs = [];
    }

    const logType = status ? "LAPORAN_SITUASI" : "LAPORAN_KENDALA";
    const logAddress = status 
      ? `Laporan Situasi: ${status} - Alasan: ${description || '-'}`
      : `Laporan kendala: ${description || "Link absensi bermasalah / tidak bisa diakses"}`;

    // Add to logs with custom status
    state.attendanceLogs.unshift({
      id: "LOG-REP-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
      workerId: worker.id,
      workerName: worker.name,
      date: todayYMD,
      time: timeStr,
      latitude: 0,
      longitude: 0,
      distance: 0,
      address: logAddress,
      status: logType
    });

    if (state.attendanceLogs.length > 500) {
      state.attendanceLogs = state.attendanceLogs.slice(0, 500);
    }
    writeState(state);

    // Try sending WhatsApp notification
    const waStatus = getWhatsAppStatus();
    let sentToAdmin = false;
    let sentToRoles = 0;

    let messageText = "";
    if (status) {
      messageText = `⚠️ *LAPORAN SITUASI ABSEN* 👷‍♂️\n\nHalo Admin / Mandor,\nKaryawan berikut melaporkan situasi absen mereka hari ini:\n\n👤 *Nama:* ${worker.name}\n🆔 *ID:* ${worker.id}\n📞 *No. WA:* ${worker.phoneNumber || '-'}\n💼 *Jabatan:* ${worker.role}\n📅 *Waktu:* ${todayYMD} ${timeStr} WIB\n\n📢 *Situasi:* *${status}*\n💬 *Alasan:* _${description || '-'}_`;
    } else {
      messageText = `⚠️ *LAPORAN KENDALA LINK ABSENSI* 👷‍♂️\n\nHalo Admin / Mandor,\nKaryawan berikut melaporkan kendala pada link absensi mereka hari ini:\n\n👤 *Nama:* ${worker.name}\n🆔 *ID:* ${worker.id}\n📞 *No. WA:* ${worker.phoneNumber || '-'}\n💼 *Jabatan:* ${worker.role}\n📅 *Waktu:* ${todayYMD} ${timeStr} WIB\n\n💬 *Kendala:* _${description || 'Terdapat kendala ketika membuka link absensi.'}_\n\n_Harap bantu verifikasi atau lakukan pencatatan kehadiran manual di dashboard admin._ 🙏`;
    }

    if (waStatus.status === "connected") {
      // 1. Send to self (the logged in admin account) if possible
      if (waStatus.user?.id) {
        try {
          await sendWhatsAppMessage(waStatus.user.id, messageText);
          sentToAdmin = true;
        } catch (e) {
          console.error("Failed to send report to self/admin user:", e);
        }
      }

      // 2. Send to any other workers who are Admin, Mandor or Manager
      const adminWorkers = workers.filter((w: any) => 
        w.isActive && 
        w.phoneNumber && 
        (w.role?.toLowerCase().includes("admin") || 
         w.role?.toLowerCase().includes("mandor") || 
         w.role?.toLowerCase().includes("manager") || 
         w.role?.toLowerCase().includes("hr"))
      );

      for (const admin of adminWorkers) {
        try {
          await sendWhatsAppMessage(admin.phoneNumber, messageText);
          sentToRoles++;
        } catch (e) {
          console.error(`Failed to send report to admin/mandor worker (${admin.name}):`, e);
        }
      }
    }

    res.json({
      success: true,
      message: status 
        ? `Laporan situasi (${status}) Anda berhasil terkirim ke Admin.` 
        : "Laporan kendala berhasil terkirim dan dicatat di dashboard Admin.",
      waSent: sentToAdmin || sentToRoles > 0,
      recipients: {
        adminSelf: sentToAdmin,
        adminRolesCount: sentToRoles
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gagal memproses laporan." });
  }
});

// Endpoint to Parse Petty Cash PDF / Image
app.post("/api/parse-petty-cash", async (req, res) => {
  try {
    if (!validateAdminToken(req)) {
      return res.status(401).json({ success: false, error: "Unauthorized: Admin login required" });
    }

    const { fileBase64, fileName, mimeType } = req.body;

    if (!fileBase64) {
      return res.status(400).json({ error: "No file content provided" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: "GEMINI_API_KEY is not configured on the server. Please check your system secrets." 
      });
    }

    const defaultMime = mimeType || "application/pdf";
    
    const inlinePart = {
      inlineData: {
        mimeType: defaultMime,
        data: fileBase64,
      },
    };

    const textPart = {
      text: `Analyze this field worker petty cash document (PDF/Image) and extract all transaction lines. 
The document's file name is: "${fileName}".
Strictly structure your response in Indonesian/English as specified below.
Provide a clean summary of cash inflows (In/Kredit/Penerimaan) and outflows (Out/Debet/Pengeluaran).
Ensure you capture:
1. Transaction Date (format YYYY-MM-DD or keep original if clear)
2. Description of the transaction (keterangan)
3. Category (e.g., Material, Transport, Konsumsi, Tools, Lain-lain)
4. Amount (numeric value only)
5. Worker Name (Nama Karyawan/Karyawan. If not explicitly found inside the document content, look for the worker's name in the file name "${fileName}". For example, in "10. LAPORAN DANA OPERASIONAL Bpk Suryo Pranoto - Bpk Hasby (Periode 17 - 23 Juni 2026).pdf", the worker name is "Bpk Suryo Pranoto & Bpk Hasby" or "Suryo Pranoto, Hasby". If no worker name can be found anywhere, use "Karyawan Lapangan")
6. Transaction Type: 'EXPENSE' or 'INCOME'

Also find the overall document summary if stated, such as:
- Total cash received (Total Penerimaan)
- Total cash spent (Total Pengeluaran)
- Worker/Field staff name (Check the file name "${fileName}" if the document itself doesn't mention it clearly. Do NOT leave this empty)
- Period / Month of report (Check the file name "${fileName}" for month/period if the document itself doesn't mention it clearly, e.g. "Juni 2026" or "17 - 23 Juni 2026")

Return a strict JSON response conforming exactly to this structure:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "Bought cement",
      "category": "Material",
      "amount": 250000,
      "worker": "Budiono",
      "type": "EXPENSE"
    }
  ],
  "summary": {
    "totalIncome": 1000000,
    "totalExpense": 250000,
    "remainingBalance": 750000,
    "workerName": "Budiono",
    "reportMonth": "Juni 2026"
  }
}`,
    };

    console.log("Analyzing file: size =" + fileBase64.length + " bytes, type =" + defaultMime);

    const modelsToTry = [
      "gemini-2.5-flash", 
      "gemini-flash-latest", 
      "gemini-3.1-flash-lite", 
      "gemini-3.5-flash"
    ];
    let response = null;
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting document analysis with model: ${modelName}`);
        response = await ai.models.generateContent({
          model: modelName,
          contents: [inlinePart, textPart],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                transactions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING },
                      description: { type: Type.STRING },
                      category: { type: Type.STRING },
                      amount: { type: Type.INTEGER },
                      worker: { type: Type.STRING },
                      type: { type: Type.STRING, enum: ["EXPENSE", "INCOME"] },
                    },
                    required: ["date", "description", "category", "amount", "type"],
                  },
                },
                summary: {
                  type: Type.OBJECT,
                  properties: {
                    totalIncome: { type: Type.INTEGER },
                    totalExpense: { type: Type.INTEGER },
                    remainingBalance: { type: Type.INTEGER },
                    workerName: { type: Type.STRING },
                    reportMonth: { type: Type.STRING },
                  },
                  required: ["totalIncome", "totalExpense", "remainingBalance", "workerName", "reportMonth"],
                },
              },
              required: ["transactions", "summary"],
            },
          },
        });
        
        if (response && response.text) {
          console.log(`Successfully completed document analysis using model: ${modelName}`);
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} encountered an error: ${err.message || err}. Trying next available model...`);
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error("All fallback models failed to analyze the document.");
    }

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No response received from Gemini engine");
    }

    const parsedData = JSON.parse(resultText);
    res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Parsing error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze document" });
  }
});

// Endpoint to Parse Bank Statement PDF / Image
app.post("/api/parse-bank-statement", async (req, res) => {
  try {
    if (!validateAdminToken(req)) {
      return res.status(401).json({ success: false, error: "Unauthorized: Admin login required" });
    }

    const { fileBase64, fileName, mimeType } = req.body;

    if (!fileBase64) {
      return res.status(400).json({ error: "No file content provided" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: "GEMINI_API_KEY is not configured on the server. Please check your system secrets." 
      });
    }

    const defaultMime = mimeType || "application/pdf";
    
    const inlinePart = {
      inlineData: {
        mimeType: defaultMime,
        data: fileBase64,
      },
    };

    const textPart = {
      text: `Analyze this bank statement document (PDF/Image) and extract the statement details and all transaction rows.
The document's file name is: "${fileName}".
Strictly structure your response in Indonesian/English as specified below.
Ensure you capture:
1. Bank Name (e.g. BCA, MANDIRI, BRI, BNI, etc. - identify clearly)
2. Account Number / Nomor Rekening (if any)
3. Account Holder / Pemilik Rekening (if any)
4. Statement Period / Periode Rekening Koran
5. Transactions list:
   - Date (format YYYY-MM-DD or keep original if clear)
   - Transaksi (the transaction type/code/method if clearly mentioned, e.g., "TRANSFER", "QRIS", "BIAYA ADM", "TARIK TUNAI", etc.)
   - Description / Keterangan (description of mutasi)
   - Rekening Penerima (the recipient or beneficiary account/name if explicitly stated in the row, or leave empty/blank if not mentioned)
   - Amount (numeric value only)
   - Type (DEBIT for money out / pengeluaran, CREDIT for money in / pemasukan)
   - Balance (the remaining balance after the transaction, numeric value only, if specified)

Also find the overall summary if stated:
- Total Debet (Pengeluaran/Debet)
- Total Kredit (Pemasukan/Kredit)
- Starting Balance (Saldo Awal)
- Ending Balance (Saldo Akhir)

Return a strict JSON response conforming exactly to this structure:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "transaksi": "TRANSFER",
      "description": "TRANSFER DR BUDI",
      "rekeningPenerima": "1234567890",
      "amount": 500000,
      "type": "CREDIT",
      "balance": 2500000
    }
  ],
  "summary": {
    "bankName": "MANDIRI",
    "accountNumber": "1234567890",
    "accountHolder": "PT. Nusantara Mineral Sukses Abadi",
    "period": "Mei 2026",
    "totalDebit": 4500000,
    "totalCredit": 12000000,
    "startingBalance": 1000000,
    "endingBalance": 8500000
  }
}`,
    };

    console.log("Analyzing bank statement: size =" + fileBase64.length + " bytes, type =" + defaultMime);

    const modelsToTry = [
      "gemini-2.5-flash", 
      "gemini-flash-latest", 
      "gemini-3.1-flash-lite", 
      "gemini-3.5-flash"
    ];
    let response = null;
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting bank statement analysis with model: ${modelName}`);
        response = await ai.models.generateContent({
          model: modelName,
          contents: [inlinePart, textPart],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                transactions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING },
                      transaksi: { type: Type.STRING },
                      description: { type: Type.STRING },
                      rekeningPenerima: { type: Type.STRING },
                      amount: { type: Type.INTEGER },
                      type: { type: Type.STRING, enum: ["DEBIT", "CREDIT"] },
                      balance: { type: Type.INTEGER },
                    },
                    required: ["date", "description", "amount", "type"],
                  },
                },
                summary: {
                  type: Type.OBJECT,
                  properties: {
                    bankName: { type: Type.STRING },
                    accountNumber: { type: Type.STRING },
                    accountHolder: { type: Type.STRING },
                    period: { type: Type.STRING },
                    totalDebit: { type: Type.INTEGER },
                    totalCredit: { type: Type.INTEGER },
                    startingBalance: { type: Type.INTEGER },
                    endingBalance: { type: Type.INTEGER },
                  },
                  required: ["bankName", "totalDebit", "totalCredit"],
                },
              },
              required: ["transactions", "summary"],
            },
          },
        });
        
        if (response && response.text) {
          console.log(`Successfully completed bank statement analysis using model: ${modelName}`);
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} encountered an error in bank statement: ${err.message || err}. Trying next available model...`);
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error("All fallback models failed to analyze the bank statement.");
    }

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No response received from Gemini engine");
    }

    const parsedData = JSON.parse(resultText);
    res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Bank Statement Parsing error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze bank statement" });
  }
});

// --- WHATSAPP BAILEYS BOT INTEGRATION ENDPOINTS ---
import { 
  initWhatsApp, 
  getWhatsAppStatus, 
  disconnectWhatsApp, 
  sendWhatsAppMessage,
  requestWhatsAppPairingCode
} from "./server/wa-bot.js";

// GET WhatsApp connection status
app.get("/api/wa/status", (req, res) => {
  if (!validateAdminToken(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized: Admin login required" });
  }
  res.json(getWhatsAppStatus());
});

// POST Disconnect WhatsApp connection
app.post("/api/wa/disconnect", async (req, res) => {
  if (!validateAdminToken(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized: Admin login required" });
  }
  const result = await disconnectWhatsApp();
  res.json(result);
});

// POST Request pairing code for phone linking
app.post("/api/wa/pairing-code", async (req, res) => {
  if (!validateAdminToken(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized: Admin login required" });
  }
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: "Nomor WhatsApp wajib diisi." });
  }
  try {
    const code = await requestWhatsAppPairingCode(phone);
    res.json({ success: true, code });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gagal membuat Kode Pairing." });
  }
});

// POST Send a test WhatsApp message manually
app.post("/api/wa/send-test", async (req, res) => {
  if (!validateAdminToken(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized: Admin login required" });
  }
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: "Nomor WhatsApp dan pesan wajib diisi." });
  }
  const result = await sendWhatsAppMessage(phone, message);
  res.json(result);
});

// Helper to determine weekday in Jakarta timezone ("Sunday"=0, "Saturday"=6, etc.)
function getJakartaDayOfWeek(dateStr: string): number {
  const parts = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    weekday: "long"
  });
  const dayName = weekdayFormatter.format(d);
  if (dayName === "Sunday") return 0;
  if (dayName === "Monday") return 1;
  if (dayName === "Tuesday") return 2;
  if (dayName === "Wednesday") return 3;
  if (dayName === "Thursday") return 4;
  if (dayName === "Friday") return 5;
  if (dayName === "Saturday") return 6;
  return d.getDay();
}

// Memory cache for Indonesian Holidays
let indonesianHolidaysCache: Record<string, { holiday: boolean; name: string }> | null = null;
let lastHolidaysFetchTime = 0;

// Fallback list of major national holidays in Indonesia (2026 and 2027)
const FALLBACK_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "Tahun Baru 2026 Masehi",
  "2026-01-29": "Tahun Baru Imlek 2577 Kongzili",
  "2026-02-15": "Isra Mikraj Nabi Muhammad SAW",
  "2026-03-11": "Hari Suci Nyepi Tahun Baru Saka 1948",
  "2026-03-20": "Wafat Yesus Kristus & Hari Raya Idul Fitri 1447 Hijriah",
  "2026-03-21": "Hari Raya Idul Fitri 1447 Hijriah",
  "2026-03-22": "Kenaikan Yesus Kristus",
  "2026-05-01": "Hari Buruh Internasional",
  "2026-05-13": "Hari Raya Waisak 2570 BE",
  "2026-05-21": "Kenaikan Yesus Kristus",
  "2026-06-01": "Hari Lahir Pancasila",
  "2026-06-27": "Hari Raya Idul Adha 1447 Hijriah",
  "2026-07-17": "Tahun Baru Islam 1448 Hijriah",
  "2026-08-17": "Hari Kemerdekaan Republik Indonesia",
  "2026-09-26": "Maulid Nabi Muhammad SAW",
  "2026-12-25": "Hari Raya Natal",
  "2027-01-01": "Tahun Baru 2027 Masehi",
  "2027-02-06": "Isra Mikraj Nabi Muhammad SAW",
  "2027-02-17": "Tahun Baru Imlek 2578 Kongzili",
  "2027-03-11": "Hari Suci Nyepi Tahun Baru Saka 1949",
  "2027-03-26": "Wafat Yesus Kristus",
  "2027-03-28": "Kenaikan Yesus Kristus",
  "2027-04-09": "Hari Raya Idul Fitri 1448 Hijriah",
  "2027-04-10": "Hari Raya Idul Fitri 1448 Hijriah",
  "2027-05-01": "Hari Buruh Internasional",
  "2027-05-20": "Hari Raya Waisak 2571 BE",
  "2027-05-27": "Kenaikan Yesus Kristus",
  "2027-06-01": "Hari Lahir Pancasila",
  "2027-06-16": "Hari Raya Idul Adha 1448 Hijriah",
  "2027-07-06": "Tahun Baru Islam 1449 Hijriah",
  "2027-08-17": "Hari Kemerdekaan Republik Indonesia",
  "2027-09-15": "Maulid Nabi Muhammad SAW",
  "2027-12-25": "Hari Raya Natal",
};

async function fetchIndonesianHolidays(): Promise<Record<string, { holiday: boolean; name: string }>> {
  const now = Date.now();
  // Cache holidays for 24 hours to prevent spamming GitHub Raw API
  if (indonesianHolidaysCache && (now - lastHolidaysFetchTime < 24 * 60 * 60 * 1000)) {
    return indonesianHolidaysCache;
  }
  try {
    console.log("Fetching Indonesian national holidays from GitHub Raw...");
    const res = await fetch("https://raw.githubusercontent.com/guangrei/Json-Indonesia-holidays/master/calendar.json", {
      headers: { "User-Agent": "PTNusantaraMineralSuksesAbadi/1.0" }
    });
    if (res.ok) {
      const data = await res.json();
      indonesianHolidaysCache = data;
      lastHolidaysFetchTime = now;
      console.log(`Fetched ${Object.keys(data).length} holiday definitions successfully.`);
      return data;
    }
  } catch (err) {
    console.error("Failed to fetch holidays dynamically, using fallback map:", err);
  }
  return indonesianHolidaysCache || {};
}

// Returns { isBlocked: boolean; reason: string | null }
async function checkIsHolidayOrWeekend(dateStr: string): Promise<{ isBlocked: boolean; reason: string | null }> {
  const dayOfWeek = getJakartaDayOfWeek(dateStr);
  if (dayOfWeek === 0) {
    return { isBlocked: true, reason: "Hari Minggu (Akhir Pekan)" };
  }
  if (dayOfWeek === 6) {
    return { isBlocked: true, reason: "Hari Sabtu (Akhir Pekan)" };
  }

  // Check online calendar API
  const holidays = await fetchIndonesianHolidays();
  if (holidays[dateStr] && holidays[dateStr].holiday) {
    return { isBlocked: true, reason: `Hari Libur Nasional: ${holidays[dateStr].name}` };
  }

  // Check fallback static map
  if (FALLBACK_HOLIDAYS[dateStr]) {
    return { isBlocked: true, reason: `Hari Libur Nasional: ${FALLBACK_HOLIDAYS[dateStr]}` };
  }

  return { isBlocked: false, reason: null };
}

// GET /api/cron-reminder (UptimeRobot automated pinger & manual click trigger)
app.get("/api/cron-reminder", async (req, res) => {
  const force = req.query.force === "true";
  const state = readState();
  const todayYMD = getJakartaDateStr();
  
  // Save host origin
  const hostOrigin = req.protocol + "://" + req.get("host");
  if (hostOrigin && hostOrigin !== state.lastHostOrigin) {
    state.lastHostOrigin = hostOrigin;
  }
  
  // Format neat local Indonesian time string
  const nowStr = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
  state.lastCronPing = `${todayYMD} ${nowStr} WIB`;
  
  // Get current Jakarta hour/minute
  const jktTimeString = new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Jakarta", hour12: false });
  const [currentHour, currentMinute] = jktTimeString.split(":").map(Number);
  
  // Parse scheduled hour/minute
  const scheduledTime = state.autoReminderHour || "09:00";
  const [targetHour, targetMinute] = scheduledTime.split(":").map(Number);

  // Conditions to trigger: force or (time is matched and not sent today yet)
  const isTimeTrigger = currentHour > targetHour || (currentHour === targetHour && currentMinute >= targetMinute);
  const alreadySentToday = state.lastCronSentDate === todayYMD;

  // Holiday and Weekend Check
  const holidayCheck = await checkIsHolidayOrWeekend(todayYMD);

  if (holidayCheck.isBlocked && !force) {
    // If it's Saturday, Sunday, or a National Holiday, we block the reminder and mark today as handled.
    const statusMsg = `Dilewati otomatis: ${holidayCheck.reason}.`;
    state.lastCronStatus = statusMsg;
    if (isTimeTrigger) {
      state.lastCronSentDate = todayYMD;
    }
    writeState(state);
    return res.json({
      success: true,
      message: `Pesan pengingat dilewati otomatis karena hari ini adalah ${holidayCheck.reason}`,
      isHoliday: true,
      reason: holidayCheck.reason,
      status: statusMsg
    });
  }

  if (force || (isTimeTrigger && !alreadySentToday)) {
    console.log(`Cron execution triggered: force=${force}, isTimeTrigger=${isTimeTrigger}, alreadySentToday=${alreadySentToday}`);
    
    // Check WhatsApp connection status
    const waStatus = getWhatsAppStatus();
    if (waStatus.status !== "connected") {
      state.lastCronStatus = `Gagal mengirim pengingat otomatis: WhatsApp Bot belum terhubung/scan.`;
      writeState(state);
      return res.status(500).json({ 
        success: false, 
        message: "Gagal: WhatsApp Bot belum terhubung. Silakan hubungkan via scan QR code di menu pengaturan admin terlebih dahulu." 
      });
    }

    const workers = state.workers || [];
    const records = state.attendanceRecords || [];
    const activeWorkers = workers.filter((w: any) => w.isActive);
    
    // Find workers who haven't checked in yet today
    const absentWorkers = activeWorkers.filter((worker: any) => {
      const record = records.find((r: any) => r.workerId === worker.id);
      return !record || !record.attendance || !record.attendance[todayYMD];
    });

    if (absentWorkers.length === 0) {
      state.lastCronStatus = `Selesai: Seluruh karyawan aktif (${activeWorkers.length}) sudah melakukan absen hadir hari ini.`;
      if (!force) {
        state.lastCronSentDate = todayYMD;
      }
      writeState(state);
      return res.json({ 
        success: true, 
        message: "Seluruh karyawan aktif sudah absen hari ini. Tidak ada pengingat yang perlu dikirim." 
      });
    }

    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    
    const hostOrigin = req.protocol + "://" + req.get("host");
    const currentPin = state.attendancePin || "1234";

    for (const worker of absentWorkers) {
      if (!worker.phoneNumber) {
        failedCount++;
        continue;
      }

      // Generate pre-filled PIN login URL!
      const loginUrl = `${hostOrigin}/?id=${worker.id}&pin=${currentPin}`;
      
      const message = `Halo *${worker.name}*, silakan klik link berikut untuk melakukan absen mandiri uang makan PT. Nusantara Mineral Sukses Abadi hari ini:\n${loginUrl}\n\nYuk, langsung diklik link-nya ya! Pastikan untuk mengaktifkan dan menyetujui izin lokasi (GPS) di HP Anda, kemudian langsung tekan tombol check-in di dalam aplikasi.\n\nSetelah berhasil, Anda akan menerima pesan pop-up konfirmasi sukses. Selamat bekerja hari ini, dan besok jangan lupa untuk absen kembali ya agar uang makannya selalu lancar! Semangat terus dan jaga keselamatan kerja! 😊✨`;

      const result = await sendWhatsAppMessage(worker.phoneNumber, message);
      if (result.success) {
        sentCount++;
      } else {
        failedCount++;
        if (result.error) errors.push(result.error);
      }
    }

    state.lastCronStatus = `Berhasil mengirim pengingat ke ${sentCount} karyawan.${failedCount > 0 ? ` Gagal: ${failedCount} karyawan.` : ""}`;
    if (!force) {
      state.lastCronSentDate = todayYMD;
    }
    writeState(state);

    return res.json({
      success: true,
      message: `Berhasil memproses cron pengingat. Terkirim: ${sentCount}, Gagal: ${failedCount}`,
      errors
    });
  } else {
    // Just a passive ping to keep server alive and update status
    let statusMsg = "";
    if (alreadySentToday) {
      statusMsg = `Selesai: Pengingat hari ini (${todayYMD}) sudah dikirimkan otomatis pada jam ${scheduledTime}.`;
    } else {
      statusMsg = `Standby: Menunggu jam target ${scheduledTime}. Waktu server saat ini: ${nowStr} WIB.`;
    }
    state.lastCronStatus = statusMsg;
    writeState(state);
    return res.json({
      success: true,
      message: "Cron ping recorded successfully.",
      time: nowStr,
      target: scheduledTime,
      status: statusMsg
    });
  }
});

// Vite Middleware for Development vs Production
async function startServer() {
  // Initialize WhatsApp connection
  try {
    console.log("Initializing server-side WhatsApp Baileys gateway...");
    initWhatsApp();
  } catch (err) {
    console.error("Failed to automatically initialize Baileys WhatsApp connection:", err);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  // Set up internal background cron-reminder trigger every 60 seconds (1 minute)
  setInterval(async () => {
    try {
      const state = readState();
      const todayYMD = getJakartaDateStr();
      
      // Get current Jakarta hour/minute
      const jktTimeString = new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Jakarta", hour12: false });
      const [currentHour, currentMinute] = jktTimeString.split(":").map(Number);
      
      // Parse scheduled hour/minute
      const scheduledTime = state.autoReminderHour || "09:00";
      const [targetHour, targetMinute] = scheduledTime.split(":").map(Number);

      const isTimeTrigger = currentHour > targetHour || (currentHour === targetHour && currentMinute >= targetMinute);
      const alreadySentToday = state.lastCronSentDate === todayYMD;

      if (isTimeTrigger && !alreadySentToday) {
        console.log(`[Internal Auto Pinger] Time matches (${jktTimeString} >= ${scheduledTime}). Triggering automatic reminder...`);
        
        // Check if today is weekend or holiday
        const holidayCheck = await checkIsHolidayOrWeekend(todayYMD);
        if (holidayCheck.isBlocked) {
          state.lastCronStatus = `Dilewati otomatis (Sistem Internal): ${holidayCheck.reason}.`;
          state.lastCronSentDate = todayYMD;
          writeState(state);
          console.log(`[Internal Auto Pinger] Skipped today because of: ${holidayCheck.reason}`);
          return;
        }

        // Check WhatsApp connection status
        const waStatus = getWhatsAppStatus();
        if (waStatus.status !== "connected") {
          state.lastCronStatus = `Gagal mengirim pengingat otomatis (Sistem Internal): WhatsApp Bot belum terhubung.`;
          writeState(state);
          console.log(`[Internal Auto Pinger] WhatsApp Bot not connected. Skipped.`);
          return;
        }

        const workers = state.workers || [];
        const records = state.attendanceRecords || [];
        const activeWorkers = workers.filter((w: any) => w.isActive);
        
        const absentWorkers = activeWorkers.filter((worker: any) => {
          const record = records.find((r: any) => r.workerId === worker.id);
          return !record || !record.attendance || !record.attendance[todayYMD];
        });

        if (absentWorkers.length === 0) {
          state.lastCronStatus = `Selesai (Sistem Internal): Seluruh karyawan aktif (${activeWorkers.length}) sudah absen hari ini.`;
          state.lastCronSentDate = todayYMD;
          writeState(state);
          console.log(`[Internal Auto Pinger] All workers have already checked in.`);
          return;
        }

        const hostOrigin = state.lastHostOrigin || "https://ais-pre-e7m6l6ql7mfgk6e4xkr56y-958431568317.asia-east1.run.app";
        const currentPin = state.attendancePin || "1234";

        let sentCount = 0;
        let failedCount = 0;

        for (const worker of absentWorkers) {
          if (!worker.phoneNumber) {
            failedCount++;
            continue;
          }

          const loginUrl = `${hostOrigin}/?id=${worker.id}&pin=${currentPin}`;
          const message = `Halo *${worker.name}*, silakan klik link berikut untuk melakukan absen mandiri uang makan PT. Nusantara Mineral Sukses Abadi hari ini:\n${loginUrl}\n\nYuk, langsung diklik link-nya ya! Pastikan untuk mengaktifkan dan menyetujui izin lokasi (GPS) di HP Anda, kemudian langsung tekan tombol check-in di dalam aplikasi.\n\nSetelah berhasil, Anda akan menerima pesan pop-up konfirmasi sukses. Selamat bekerja hari ini, dan besok jangan lupa untuk absen kembali ya agar uang makannya selalu lancar! Semangat terus dan jaga keselamatan kerja! 😊✨`;

          const result = await sendWhatsAppMessage(worker.phoneNumber, message);
          if (result.success) {
            sentCount++;
          } else {
            failedCount++;
          }
        }

        const nowStr = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
        state.lastCronPing = `${todayYMD} ${nowStr} WIB (Sistem Internal)`;
        state.lastCronStatus = `Berhasil mengirim pengingat harian otomatis ke ${sentCount} karyawan.${failedCount > 0 ? ` Gagal: ${failedCount} karyawan.` : ""}`;
        state.lastCronSentDate = todayYMD;
        writeState(state);
        console.log(`[Internal Auto Pinger] Successfully sent reminders to ${sentCount} workers.`);
      }
    } catch (err) {
      console.error("Error in internal background scheduler interval:", err);
    }
  }, 60000);
}

startServer();
