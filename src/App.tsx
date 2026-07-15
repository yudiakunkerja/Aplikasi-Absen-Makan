import React, { useState, useEffect, useRef } from "react";
import { 
  Calendar, 
  Users, 
  CheckSquare, 
  FileText, 
  CloudUpload, 
  Download, 
  Plus, 
  Trash, 
  Edit, 
  Settings, 
  CheckCircle, 
  AlertCircle, 
  Search, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  FolderPlus, 
  ArrowRight,
  Database,
  Building,
  Globe,
  Upload,
  RefreshCw,
  LogOut,
  HelpCircle,
  FileCheck,
  Phone,
  MessageSquare,
  Lock,
  Copy,
  Check,
  MapPin,
  AlertTriangle,
  User,
  Camera,
  CreditCard,
  Pencil,
  Image,
  Folder,
  LayoutDashboard,
  BarChart3,
  Clock,
  Zap,
  ChevronDown,
  ChevronUp,
  Cpu,
  ArrowUp,
  ArrowDown,
  ArrowUpDown
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Worker, AttendanceRecord, WeeklyReport, PettyCashReport, PettyCashTransaction, TransactionType, BankStatementReport } from "./types";
import { INITIAL_WORKERS, INDONESIAN_DAYS, COMMON_CATEGORIES } from "./constants";
import { triggerExcelDownload } from "./lib/excelGenerator";
import { triggerAttendanceExcelDownload, printWeeklyReportPDF } from "./lib/attendanceSheetGenerator";
import { getOrCreateFolder, getOrCreateNestedFolder, uploadFileToDrive, exportAttendanceToGoogleSheet } from "./lib/googleWorkspace";
import { initAuth, googleSignIn, googleSignOut } from "./lib/firebase";

// Utility to format Date as local YYYY-MM-DD
function formatLocalYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Helper to sort transactions putting "Saldo Awal" at the very top, and then the rest by date ascending
function sortTransactionsWithSaldoAwalFirst(txs: PettyCashTransaction[]): PettyCashTransaction[] {
  const isSaldoAwal = (t: PettyCashTransaction) => 
    (t.category === "Saldo Awal" || 
     t.description.toLowerCase().includes("saldo awal"));

  const saldoAwalTxs = txs.filter(isSaldoAwal);
  const otherTxs = txs.filter(t => !isSaldoAwal(t));

  // Sort other transactions by date ascending
  otherTxs.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (isNaN(dateA)) return 1;
    if (isNaN(dateB)) return -1;
    return dateA - dateB;
  });

  return [...saldoAwalTxs, ...otherTxs];
}

// Helper to generate deterministic daily pin
function getAutomaticDailyPin(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;
  
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const pin = Math.abs(hash % 9000) + 1000; // 4-digit PIN between 1000 and 9999
  return String(pin);
}

// Utility to get current week's Monday and Friday dates
function getWeekRange(dateInput: Date) {
  const d = new Date(dateInput);
  const day = d.getDay();
  // Adjust so day 1 is Monday
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return {
    monday: formatLocalYYYYMMDD(monday),
    friday: formatLocalYYYYMMDD(friday),
  };
}

// Utility to get beautiful Indonesian date string
function getIndonesianDateStr(dateInput: Date): string {
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  const dayName = days[dateInput.getDay()];
  const dateNum = dateInput.getDate();
  const monthName = months[dateInput.getMonth()];
  const yearNum = dateInput.getFullYear();
  return `${dayName}, ${dateNum} ${monthName} ${yearNum}`;
}

export default function App() {
  // --- States ---
  const [workers, setWorkers] = useState<Worker[]>(() => {
    const saved = localStorage.getItem("karyawan_uang_makan");
    return saved ? JSON.parse(saved) : INITIAL_WORKERS;
  });

  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>(() => {
    const saved = localStorage.getItem("absensi_uang_makan_records");
    return saved ? JSON.parse(saved) : [];
  });

  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>(() => {
    const saved = localStorage.getItem("laporan_uang_makan_log");
    return saved ? JSON.parse(saved) : [];
  });

  const [pettyCashReports, setPettyCashReports] = useState<PettyCashReport[]>(() => {
    const saved = localStorage.getItem("petty_cash_reports");
    return saved ? JSON.parse(saved) : [];
  });

  const [attendanceLogs, setAttendanceLogs] = useState<any[]>(() => {
    const saved = localStorage.getItem("attendance_logs_v1");
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem("attendance_logs_v1", JSON.stringify(attendanceLogs));
  }, [attendanceLogs]);

  const [pettyCashHolders, setPettyCashHolders] = useState<string[]>(() => {
    const saved = localStorage.getItem("petty_cash_holders_v2");
    return saved ? JSON.parse(saved) : ["Suryo Pranoto"];
  });

  const [selectedUploadHolder, setSelectedUploadHolder] = useState<string>("Suryo Pranoto");

  // --- Bank Statement States ---
  const [activeSubTab, setActiveSubTab] = useState<"pettycash" | "bankstatement">("pettycash");
  const [bankStatementFile, setBankStatementFile] = useState<File | null>(null);
  const [isParsingBankStatement, setIsParsingBankStatement] = useState<boolean>(false);
  const [bankStatementParseError, setBankStatementParseError] = useState<string | null>(null);
  const [bankStatements, setBankStatements] = useState<BankStatementReport[]>(() => {
    const saved = localStorage.getItem("bank_statement_reports");
    return saved ? JSON.parse(saved) : [];
  });
  const [activeBankStatement, setActiveBankStatement] = useState<BankStatementReport | null>(() => {
    const saved = localStorage.getItem("bank_statement_reports");
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.length > 0 ? parsed[0] : null;
    }
    return null;
  });

  const [rkCompanies, setRkCompanies] = useState<{ name: string; banks: string[] }[]>(() => {
    const saved = localStorage.getItem("rk_companies");
    return saved ? JSON.parse(saved) : [
      { name: "PT. Nusantara Mineral Sukses Abadi", banks: ["BNI", "BCA", "Mandiri"] },
      { name: "PT. Nusantara Mineral Mandiri", banks: ["BCA", "BRI"] }
    ];
  });
  
  const [selectedRkCompany, setSelectedRkCompany] = useState<string>(() => {
    const saved = localStorage.getItem("selected_rk_company");
    return saved || "PT. Nusantara Mineral Sukses Abadi";
  });

  const [selectedRkBank, setSelectedRkBank] = useState<string>(() => {
    const saved = localStorage.getItem("selected_rk_bank");
    return saved || "BNI";
  });

  const [newRkCompanyName, setNewRkCompanyName] = useState<string>("");
  const [newRkBankName, setNewRkBankName] = useState<string>("");

  const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] = useState<boolean>(false);
  const [bankStatementToDelete, setBankStatementToDelete] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("bank_statement_reports", JSON.stringify(bankStatements));
  }, [bankStatements]);

  useEffect(() => {
    localStorage.setItem("rk_companies", JSON.stringify(rkCompanies));
  }, [rkCompanies]);

  useEffect(() => {
    localStorage.setItem("selected_rk_company", selectedRkCompany);
  }, [selectedRkCompany]);

  useEffect(() => {
    localStorage.setItem("selected_rk_bank", selectedRkBank);
  }, [selectedRkBank]);

  useEffect(() => {
    const comp = rkCompanies.find(c => c.name === selectedRkCompany);
    if (comp && comp.banks.length > 0) {
      if (!comp.banks.includes(selectedRkBank)) {
        setSelectedRkBank(comp.banks[0]);
      }
    } else {
      setSelectedRkBank("");
    }
  }, [selectedRkCompany, rkCompanies]);

  const handleAddCompany = () => {
    const trimmed = newRkCompanyName.trim();
    if (!trimmed) return;
    if (rkCompanies.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
      alert("Nama Perusahaan (PT) sudah terdaftar.");
      return;
    }
    const updated = [...rkCompanies, { name: trimmed, banks: [] }];
    setRkCompanies(updated);
    setSelectedRkCompany(trimmed);
    setNewRkCompanyName("");
  };

  const handleDeleteCompany = (compName: string) => {
    if (window.confirm(`Apakah Anda yakin ingin menghapus PT "${compName}" beserta seluruh daftar banknya?`)) {
      const updated = rkCompanies.filter(c => c.name !== compName);
      setRkCompanies(updated);
      if (selectedRkCompany === compName) {
        setSelectedRkCompany(updated[0]?.name || "");
      }
    }
  };

  const handleAddBank = () => {
    const trimmed = newRkBankName.trim();
    if (!trimmed) return;
    if (!selectedRkCompany) {
      alert("Silakan pilih Perusahaan (PT) terlebih dahulu.");
      return;
    }
    const updated = rkCompanies.map(c => {
      if (c.name === selectedRkCompany) {
        if (c.banks.some(b => b.toLowerCase() === trimmed.toLowerCase())) {
          alert("Bank ini sudah terdaftar untuk perusahaan tersebut.");
          return c;
        }
        return { ...c, banks: [...c.banks, trimmed] };
      }
      return c;
    });
    setRkCompanies(updated);
    setSelectedRkBank(trimmed);
    setNewRkBankName("");
  };

  const handleDeleteBank = (compName: string, bankName: string) => {
    if (window.confirm(`Hapus bank "${bankName}" dari PT "${compName}"?`)) {
      const updated = rkCompanies.map(c => {
        if (c.name === compName) {
          return { ...c, banks: c.banks.filter(b => b !== bankName) };
        }
        return c;
      });
      setRkCompanies(updated);
    }
  };

  const filteredBankStatements = bankStatements.filter((report) => {
    const reportCompany = report.companyName || "PT. Nusantara Mineral Sukses Abadi";
    const reportBank = report.bankName || "BNI";
    return reportCompany === selectedRkCompany && reportBank === selectedRkBank;
  });

  // Automatically update activeBankStatement when selected company/bank or bankStatements changes
  useEffect(() => {
    const filtered = bankStatements.filter((report) => {
      const reportCompany = report.companyName || "PT. Nusantara Mineral Sukses Abadi";
      const reportBank = report.bankName || "BNI";
      return reportCompany === selectedRkCompany && reportBank === selectedRkBank;
    });
    if (filtered.length > 0) {
      // Find if activeBankStatement is in the filtered list, if not set to first
      const exists = filtered.find(f => f.id === activeBankStatement?.id);
      if (!exists) {
        setActiveBankStatement(filtered[0]);
      } else if (exists !== activeBankStatement) {
        setActiveBankStatement(exists);
      }
    } else {
      setActiveBankStatement(null);
    }
  }, [selectedRkCompany, selectedRkBank, bankStatements, activeBankStatement]);

  const handleUpdateTransactionPemakaian = (reportId: string, txIdx: number, value: string) => {
    setBankStatements((prev) =>
      prev.map((report) => {
        if (report.id === reportId) {
          const updatedTransactions = [...report.transactions];
          updatedTransactions[txIdx] = {
            ...updatedTransactions[txIdx],
            pemakaian: value,
          };
          return {
            ...report,
            transactions: updatedTransactions,
          };
        }
        return report;
      })
    );
  };

  // Self-profile editing states
  const [editBankName, setEditBankName] = useState<string>("");
  const [editBankAccount, setEditBankAccount] = useState<string>("");
  const [editPhoneNumber, setEditPhoneNumber] = useState<string>("");
  const [editNik, setEditNik] = useState<string>("");
  const [editPhotoUrl, setEditPhotoUrl] = useState<string>("");
  const [lastInitializedWorkerId, setLastInitializedWorkerId] = useState<string>("");
  const [editName, setEditName] = useState<string>("");
  const [editRole, setEditRole] = useState<string>("");
  const [profileSaveStatus, setProfileSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [profileSaveMsg, setProfileSaveMsg] = useState<string>("");
  const [isEditingProfile, setIsEditingProfile] = useState<boolean>(false);
  const [hasVerifiedProfile, setHasVerifiedProfile] = useState<boolean>(false);
  const [sendingBotMsgId, setSendingBotMsgId] = useState<string | null>(null);
  const [isAgreedToDataVerification, setIsAgreedToDataVerification] = useState<boolean>(false);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<"dashboard" | "absen" | "pettycash" | "workers">("dashboard");
  const [globalAllowance, setGlobalAllowance] = useState<number>(() => {
    const saved = localStorage.getItem("global_allowance");
    return saved ? Number(saved) : 25000;
  });

  // --- Shared State Sync & Self-Attendance States ---
  const [serverSyncing, setServerSyncing] = useState<boolean>(false);
  const [lastSynced, setLastSynced] = useState<string>("");
  const [initialFetchDone, setInitialFetchDone] = useState<boolean>(false);

  // Dynamic daily pin security
  const [attendancePin, setAttendancePin] = useState<string>(() => getAutomaticDailyPin());
  const [selfInputPin, setSelfInputPin] = useState<string>("");

  // Self attendance worker details
  const [selfWorker, setSelfWorker] = useState<Worker | null>(null);
  const [selfAttendStatus, setSelfAttendStatus] = useState<"idle" | "success" | "error">("idle");
  const [selfAttendMessage, setSelfAttendMessage] = useState<string>("");
  const [selfIsAttendedToday, setSelfIsAttendedToday] = useState<boolean>(false);
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const [liveTime, setLiveTime] = useState<string>("");

  // Worker reporting states
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [reportDescription, setReportDescription] = useState<string>("");
  const [reportSubmitStatus, setReportSubmitStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [reportSubmitMsg, setReportSubmitMsg] = useState<string>("");
  const [reportStatus, setReportStatus] = useState<string>("Sakit");
  const [manageStatusModal, setManageStatusModal] = useState<{ workerId: string; workerName: string; date: string; status: string; reason: string } | null>(null);

  // Geolocation States for Workspace Verification
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "requesting" | "available" | "denied" | "error">("idle");
  const [geoErrorMsg, setGeoErrorMsg] = useState<string>("");
  const [geoDistance, setGeoDistance] = useState<number | null>(null);

  // Signatures for Friday Confirmation
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [selfSignature, setSelfSignature] = useState<string | null>(null);

  // Bulk WA broadcast panel
  const [showBulkWA, setShowBulkWA] = useState<boolean>(false);
  const [bulkSentStatus, setBulkSentStatusState] = useState<Record<string, boolean>>(() => {
    try {
      const todayStr = formatLocalYYYYMMDD(new Date());
      const stored = localStorage.getItem(`manual_sent_${todayStr}`);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  });

  const setBulkSentStatus = (updater: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setBulkSentStatusState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try {
        const todayStr = formatLocalYYYYMMDD(new Date());
        localStorage.setItem(`manual_sent_${todayStr}`, JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };
  const [waMethod, setWaMethod] = useState<"desktop" | "web">(() => {
    return (localStorage.getItem("wa_method") as "desktop" | "web") || "desktop";
  });
  const [copiedWorkerMsgId, setCopiedWorkerMsgId] = useState<string | null>(null);
  const [copiedWorkerLinkId, setCopiedWorkerLinkId] = useState<string | null>(null);
  const [bulkViewMode, setBulkViewMode] = useState<"list" | "step">("list");
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);

  // WhatsApp Auto-Reminder Settings (100% FREE Workflow Assistant)
  const [autoReminderEnabled, setAutoReminderEnabled] = useState<boolean>(() => {
    return localStorage.getItem("wa_auto_reminder_enabled") !== "false"; // default to true (enabled)
  });
  const [autoReminderHour, setAutoReminderHour] = useState<string>(() => {
    return localStorage.getItem("wa_auto_reminder_hour") || "09:00";
  });

  // --- WhatsApp Baileys Bot State ---
  const [waPanelMode, setWaPanelMode] = useState<"bot" | "manual">("bot");
  const [waBotStatus, setWaBotStatus] = useState<string>("disconnected");
  const [waBotQr, setWaBotQr] = useState<string | null>(null);
  const [waBotUser, setWaBotUser] = useState<{ id: string; name?: string } | null>(null);
  const [waBotError, setWaBotError] = useState<string | null>(null);
  
  // Link via phone/pairing code states
  const [waConnectMethod, setWaConnectMethod] = useState<"qr" | "phone">("qr");
  const [waPairingPhone, setWaPairingPhone] = useState<string>("");
  const [waPairingCode, setWaPairingCode] = useState<string | null>(null);
  const [waPairingLoading, setWaPairingLoading] = useState<boolean>(false);

  
  // Test message states
  const [waTestPhone, setWaTestPhone] = useState<string>("");
  const [waTestMessage, setWaTestMessage] = useState<string>("");
  const [waTestSending, setWaTestSending] = useState<boolean>(false);
  const [waTestResult, setWaTestResult] = useState<{ success: boolean; msg: string } | null>(null);

  // Cron states (saved in the database store on the server)
  const [lastCronPing, setLastCronPing] = useState<string>("");
  const [lastCronStatus, setLastCronStatus] = useState<string>("");
  const [lastCronSentDate, setLastCronSentDate] = useState<string>("");
  const [isCronRunning, setIsCronRunning] = useState<boolean>(false);

  // --- Dashboard Collapsible/Dropdown Section States ---
  const [isDashMetricsOpen, setIsDashMetricsOpen] = useState<boolean>(false);
  const [isDashGpsOpen, setIsDashGpsOpen] = useState<boolean>(false);
  const [isDashWaOpen, setIsDashWaOpen] = useState<boolean>(false);

  // Activity ticks to reset the 1-minute auto-close timers on user clicks
  const [metricsActivityTick, setMetricsActivityTick] = useState<number>(0);
  const [gpsActivityTick, setGpsActivityTick] = useState<number>(0);
  const [waActivityTick, setWaActivityTick] = useState<number>(0);

  // Auto-close metrics panel after 1 minute of inactivity
  useEffect(() => {
    if (isDashMetricsOpen) {
      const timer = setTimeout(() => {
        setIsDashMetricsOpen(false);
      }, 60000);
      return () => clearTimeout(timer);
    }
  }, [isDashMetricsOpen, metricsActivityTick]);

  // Auto-close GPS logs panel after 1 minute of inactivity
  useEffect(() => {
    if (isDashGpsOpen) {
      const timer = setTimeout(() => {
        setIsDashGpsOpen(false);
      }, 60000);
      return () => clearTimeout(timer);
    }
  }, [isDashGpsOpen, gpsActivityTick]);

  // Auto-close WhatsApp panel after 1 minute of inactivity
  useEffect(() => {
    if (isDashWaOpen) {
      const timer = setTimeout(() => {
        setIsDashWaOpen(false);
      }, 60000);
      return () => clearTimeout(timer);
    }
  }, [isDashWaOpen, waActivityTick]);

  // Periodically fetch WhatsApp Gateway status from Express backend
  useEffect(() => {
    let active = true;
    const checkWaStatus = async () => {
      try {
        const res = await fetch("/api/wa/status");
        if (res.ok && active) {
          const data = await res.json();
          setWaBotStatus(data.status);
          setWaBotQr(data.qr);
          setWaBotUser(data.user);
          setWaBotError(data.error);
        }
      } catch (err) {
        console.error("Error fetching WhatsApp status:", err);
      }
    };
    
    checkWaStatus(); // run immediately
    const interval = setInterval(checkWaStatus, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("wa_auto_reminder_enabled", autoReminderEnabled ? "true" : "false");
  }, [autoReminderEnabled]);

  useEffect(() => {
    localStorage.setItem("wa_auto_reminder_hour", autoReminderHour);
  }, [autoReminderHour]);

  // Get selfWorkerId if present in URL query params
  const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const selfWorkerId = urlParams.get("workerId") || urlParams.get("id");

  // Automatically pre-fill the PIN if present in URL parameters
  useEffect(() => {
    const urlPin = urlParams.get("pin") || urlParams.get("code") || urlParams.get("pin_harian");
    if (urlPin) {
      setSelfInputPin(urlPin);
    }
  }, []);

  // --- Workspace Google Auth Simulation & Token ---
  // --- PWA Installation State ---
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState<boolean>(false);

  const [googleToken, setGoogleToken] = useState<string>(() => {
    return localStorage.getItem("g_access_token") || "";
  });
  const [googleUserEmail, setGoogleUserEmail] = useState<string>(() => {
    return localStorage.getItem("g_user_email") || "";
  });
  const [isDriveConnected, setIsDriveConnected] = useState<boolean>(!!googleToken);
  const [showTokenInput, setShowTokenInput] = useState<boolean>(false);
  const [tempToken, setTempToken] = useState<string>("");

  // --- Attendance UI State ---
  const { monday: weekStart, friday: weekEnd } = getWeekRange(selectedDate);
  const getDatesOfWeek = (): string[] => {
    const dates: string[] = [];
    const parts = weekStart.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const current = new Date(year, month, day);
    for (let i = 0; i < 5; i++) {
      dates.push(formatLocalYYYYMMDD(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };
  const weekDates = getDatesOfWeek();

  // --- PDF Petty Cash OCR States ---
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string | null>(null);
  
  // Interactive workspace for editing parsed transaction tables
  const [activeWorkspaceReport, setActiveWorkspaceReport] = useState<PettyCashReport | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<{ status: "idle" | "syncing" | "success" | "error"; msg?: string }>({ status: "idle" });

  // Add transaction row form state
  const [newTxDate, setNewTxDate] = useState<string>("");
  const [newTxDesc, setNewTxDesc] = useState<string>("");
  const [newTxCat, setNewTxCat] = useState<string>("Material");
  const [newTxAmount, setNewTxAmount] = useState<number>(0);
  const [newTxWorker, setNewTxWorker] = useState<string>("");
  const [newTxType, setNewTxType] = useState<TransactionType>(TransactionType.EXPENSE);

  // Swap/Tukar Baris States
  const [swapStartIndex, setSwapStartIndex] = useState<number | null>(null);

  // Workers management settings state
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerRole, setNewWorkerRole] = useState("");
  const [newWorkerBankName, setNewWorkerBankName] = useState("");
  const [newWorkerBankAccount, setNewWorkerBankAccount] = useState("");
  const [newWorkerPhoneNumber, setNewWorkerPhoneNumber] = useState("");
  const [newWorkerNik, setNewWorkerNik] = useState("");

  // Editing Worker state
  const [showAddWorkerModal, setShowAddWorkerModal] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [editWorkerName, setEditWorkerName] = useState("");
  const [editWorkerRole, setEditWorkerRole] = useState("");
  const [editWorkerBankName, setEditWorkerBankName] = useState("");
  const [editWorkerBankAccount, setEditWorkerBankAccount] = useState("");
  const [editWorkerPhoneNumber, setEditWorkerPhoneNumber] = useState("");
  const [editWorkerNik, setEditWorkerNik] = useState("");

  // Initialize Firebase Auth listener on mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleToken(token);
        if (user.email) setGoogleUserEmail(user.email);
        setIsDriveConnected(true);
      },
      () => {
        setGoogleToken("");
        setGoogleUserEmail("");
        setIsDriveConnected(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Listen for PWA installation prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Check if app is already installed / running in standalone mode
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setShowInstallBtn(false);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA install option: ${outcome}`);
    setDeferredPrompt(null);
    setShowInstallBtn(false);
  };

  // Save changes to localStorage on edit
  useEffect(() => {
    localStorage.setItem("karyawan_uang_makan", JSON.stringify(workers));
  }, [workers]);

  useEffect(() => {
    localStorage.setItem("absensi_uang_makan_records", JSON.stringify(attendanceRecords));
  }, [attendanceRecords]);

  useEffect(() => {
    localStorage.setItem("laporan_uang_makan_log", JSON.stringify(weeklyReports));
  }, [weeklyReports]);

  useEffect(() => {
    localStorage.setItem("petty_cash_reports", JSON.stringify(pettyCashReports));
  }, [pettyCashReports]);

  useEffect(() => {
    localStorage.setItem("petty_cash_holders_v2", JSON.stringify(pettyCashHolders));
  }, [pettyCashHolders]);

  useEffect(() => {
    if (pettyCashHolders.length > 0 && !pettyCashHolders.includes(selectedUploadHolder)) {
      setSelectedUploadHolder(pettyCashHolders[0]);
    }
  }, [pettyCashHolders, selectedUploadHolder]);

  useEffect(() => {
    if (selfWorker && lastInitializedWorkerId !== selfWorker.id) {
      setEditBankName(selfWorker.bankName || "");
      setEditBankAccount(selfWorker.bankAccount || "");
      setEditPhoneNumber(selfWorker.phoneNumber || "");
      setEditNik(selfWorker.nik || "");
      setEditPhotoUrl(selfWorker.photoUrl || "");
      setEditName(selfWorker.name || "");
      setEditRole(selfWorker.role || "");
      setLastInitializedWorkerId(selfWorker.id);
    }
  }, [selfWorker, lastInitializedWorkerId]);

  useEffect(() => {
    if (selfWorker) {
      const alreadyVerified = localStorage.getItem(`has_verified_profile_${selfWorker.id}`) === "true";
      if (alreadyVerified) {
        setHasVerifiedProfile(true);
      }
    }
  }, [selfWorker]);

  useEffect(() => {
    localStorage.setItem("global_allowance", globalAllowance.toString());
  }, [globalAllowance]);

  


  // Auto-generate and upload Weekly Report on Friday for Admin
  useEffect(() => {
    if (selfWorkerId) return; // Only admin runs this

    const checkAndAutoUpload = async () => {
      const today = new Date();
      if (today.getDay() === 5) { // Friday
        const { monday, friday } = getWeekRange(today);
        
        // Check if report already generated this week
        const alreadyGenerated = weeklyReports.some(
          r => r.weekStartDate === monday && r.weekEndDate === friday
        );

        if (!alreadyGenerated && attendanceRecords.length > 0 && isDriveConnected && googleToken) {
          console.log("Friday detected: Auto generating weekly report and syncing to Firebase/Drive...");
          
          try {
            // 1. Generate Report
            const newReport = {
              id: Date.now().toString(),
              weekStartDate: monday,
              weekEndDate: friday,
              records: attendanceRecords,
              createdAt: Date.now(), isSubmitted: true,
            };

            const updatedReports = [newReport, ...weeklyReports];
            setWeeklyReports(updatedReports);

            // 2. Sync to Firebase
            try {
              const { db } = await import('./lib/firebase');
              const { doc, setDoc } = await import('firebase/firestore');
              await setDoc(doc(db, "weekly_reports", newReport.id), newReport);
              
              // Also sync workers
              await setDoc(doc(db, "sync", "workers"), { workers });
              console.log("Data synced to Firebase!");
            } catch (fbErr) {
              console.error("Firebase sync failed", fbErr);
            }

            // 3. Generate PDF and Upload to Google Drive
            try {
              const { generateWeeklyReportPDFBlob } = await import('./lib/attendanceSheetGeneratorPDF');
              const pdfBlob = generateWeeklyReportPDFBlob(newReport, workers);
              
              const fileName = `Rekap_Uang_Makan_${monday}_${friday}.pdf`;
              const monthName = today.toLocaleString('id-ID', {month: 'long'});
              const folderYear = today.getFullYear().toString();
              const folderId = await getOrCreateNestedFolder(googleToken, ["Laporan Uang Makan PT. NMSA", folderYear, monthName]);
              await uploadFileToDrive(googleToken, folderId, fileName, pdfBlob);
              
              alert("Laporan hari Jumat berhasil dibuat otomatis dan disimpan di Google Drive!");
            } catch (driveErr) {
              console.error("Google Drive upload failed", driveErr);
            }
            
          } catch (e) {
            console.error(e);
          }
        }
      }
    };

    checkAndAutoUpload();
  }, [selfWorkerId, weeklyReports, attendanceRecords, isDriveConnected, googleToken, workers]);



  // --- Server Synchronization Logic ---
  // Helper to sync state to server
  const syncStateToServer = async (
    workersList = workers,
    recordsList = attendanceRecords,
    weeklyRepList = weeklyReports,
    pettyRepList = pettyCashReports,
    pinVal = attendancePin,
    signaturesList = signatures,
    holdersList = pettyCashHolders,
    logsList = attendanceLogs,
    methodVal = waMethod,
    hourVal = autoReminderHour
  ) => {
    try {
      setServerSyncing(true);
      const res = await fetch("/api/shared-state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workers: workersList,
          attendanceRecords: recordsList,
          weeklyReports: weeklyRepList,
          pettyCashReports: pettyRepList,
          attendancePin: pinVal,
          signatures: signaturesList,
          pettyCashHolders: holdersList,
          attendanceLogs: logsList,
          waMethod: methodVal,
          autoReminderHour: hourVal,
        }),
      });
      if (res.ok) {
        setLastSynced(new Date().toLocaleTimeString("id-ID"));
      }
    } catch (err) {
      console.error("Gagal sinkronisasi data ke server:", err);
    } finally {
      setServerSyncing(false);
    }
  };

  // Reusable function to load shared state from server
  const fetchSharedState = async (quiet = false) => {
    try {
      if (!quiet) setServerSyncing(true);
      const res = await fetch("/api/shared-state");
      if (res.ok) {
        const data = await res.json();
        if (data.workers && data.workers.length > 0) {
          setWorkers(data.workers);
          if (data.attendanceRecords) {
            const workerIds = new Set(data.workers.map((w: any) => w.id));
            const prunedRecords = data.attendanceRecords.filter((r: any) => workerIds.has(r.workerId));
            setAttendanceRecords(prunedRecords);
          }
          if (data.weeklyReports) setWeeklyReports(data.weeklyReports);
          if (data.pettyCashReports) setPettyCashReports(data.pettyCashReports);
          if (data.attendancePin) setAttendancePin(data.attendancePin);
          if (data.signatures) setSignatures(data.signatures);
          if (data.pettyCashHolders) setPettyCashHolders(data.pettyCashHolders);
          if (data.attendanceLogs) setAttendanceLogs(data.attendanceLogs);
          
          if (data.waMethod) setWaMethod(data.waMethod);
          if (data.autoReminderHour) setAutoReminderHour(data.autoReminderHour);
          
          if (data.lastCronPing !== undefined) setLastCronPing(data.lastCronPing);
          if (data.lastCronStatus !== undefined) setLastCronStatus(data.lastCronStatus);
          if (data.lastCronSentDate !== undefined) setLastCronSentDate(data.lastCronSentDate);
          
          setLastSynced(new Date().toLocaleTimeString("id-ID"));
        } else if (!quiet) {
          // Server has no data (first startup), sync our initial local storage data
          await fetch("/api/shared-state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
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
            }),
          });
          setLastSynced(new Date().toLocaleTimeString("id-ID"));
        }
      }
    } catch (err) {
      console.error("Gagal memuat shared-state dari server:", err);
    } finally {
      if (!quiet) setServerSyncing(false);
      setInitialFetchDone(true);
    }
  };

  // 1. Load shared state from server on mount
  useEffect(() => {
    fetchSharedState();
  }, []);

  // 1b. Periodic quiet background sync (every 15 seconds) to get worker updates automatically
  useEffect(() => {
    if (!initialFetchDone) return;
    const interval = setInterval(() => {
      fetchSharedState(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [initialFetchDone]);

  // 2. Debounced auto-save to server when states change (only after initial load)
  useEffect(() => {
    if (!initialFetchDone) return;
    const timer = setTimeout(() => {
      syncStateToServer(
        workers, 
        attendanceRecords, 
        weeklyReports, 
        pettyCashReports, 
        attendancePin, 
        signatures, 
        pettyCashHolders, 
        attendanceLogs,
        waMethod,
        autoReminderHour
      );
    }, 1200); // 1.2s debounce
    return () => clearTimeout(timer);
  }, [
    workers, 
    attendanceRecords, 
    weeklyReports, 
    pettyCashReports, 
    attendancePin, 
    pettyCashHolders, 
    attendanceLogs, 
    waMethod, 
    autoReminderHour, 
    initialFetchDone
  ]);

  // 3. Worker self-attendance handlers
  useEffect(() => {
    if (selfWorkerId && workers.length > 0) {
      const matched = workers.find((w) => w.id === selfWorkerId);
      if (matched) {
        setSelfWorker(matched);
      }
    }
  }, [selfWorkerId, workers]);

  useEffect(() => {
    if (selfWorker) {
      const todayYMD = formatLocalYYYYMMDD(new Date());
      const workerRecord = attendanceRecords.find((r) => r.workerId === selfWorker.id);
      if (workerRecord && workerRecord.attendance && workerRecord.attendance[todayYMD]) {
        setSelfIsAttendedToday(true);
      } else {
        setSelfIsAttendedToday(false);
      }
    }
  }, [selfWorker, attendanceRecords]);

  useEffect(() => {
    if (selfWorkerId) {
      const timer = setInterval(() => {
        const now = new Date();
        setLiveTime(
          now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        );
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [selfWorkerId]);

  // Geolocation Constants & Calculations
  const OFFICE_LAT = -6.244342;
  const OFFICE_LON = 106.843073;
  const MAX_DISTANCE_METERS = 150;

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
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
  };

  const requestGeolocation = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGeoStatus("error");
      setGeoErrorMsg("Browser Anda tidak mendukung deteksi lokasi (Geolocation).");
      return;
    }

    setGeoStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setUserCoords({ latitude: lat, longitude: lon });
        
        const dist = calculateDistance(lat, lon, OFFICE_LAT, OFFICE_LON);
        setGeoDistance(dist);
        setGeoStatus("available");
      },
      (error) => {
        setGeoStatus("denied");
        let msg = "Akses lokasi ditolak.";
        if (error.code === error.PERMISSION_DENIED) {
          msg = "Akses lokasi ditolak. Harap izinkan akses lokasi (GPS) di browser Anda untuk melakukan absensi.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          msg = "Informasi lokasi GPS tidak tersedia atau perangkat Anda tidak mengaktifkan GPS.";
        } else if (error.code === error.TIMEOUT) {
          msg = "Waktu permintaan lokasi habis.";
        }
        setGeoErrorMsg(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    if (selfWorkerId) {
      requestGeolocation();
    }
  }, [selfWorkerId]);

  const handleSelfSubmitAttendance = async () => {
    if (!selfWorker) return;
    if (!selfInputPin.trim()) {
      setSelfAttendStatus("error");
      setSelfAttendMessage("PIN presensi harian wajib diisi.");
      return;
    }
    if (geoStatus !== "available" || userCoords === null) {
      setSelfAttendStatus("error");
      setSelfAttendMessage("Lokasi GPS Anda belum terverifikasi. Harap aktifkan dan izinkan akses lokasi (GPS) terlebih dahulu.");
      return;
    }
    if (geoDistance === null || geoDistance > MAX_DISTANCE_METERS) {
      setSelfAttendStatus("error");
      setSelfAttendMessage(`Gagal melakukan absensi. Lokasi Anda berada di luar radius kantor (${Math.round(geoDistance || 0)} meter).`);
      return;
    }


    try {
      setSelfAttendStatus("idle");
      const todayYMD = formatLocalYYYYMMDD(new Date());
      const res = await fetch("/api/self-attend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          workerId: selfWorker.id, 
          date: todayYMD, 
          pin: selfInputPin,
          latitude: userCoords.latitude,
          longitude: userCoords.longitude
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelfAttendStatus("success");
        setSelfAttendMessage(data.message);
        setSelfIsAttendedToday(true);
        setShowSuccessModal(true);

        // Update locally to keep visual states reactive
        const updatedRecords = attendanceRecords.map((r) => {
          if (r.workerId === selfWorker.id) {
            return {
              ...r,
              attendance: {
                ...r.attendance,
                [todayYMD]: true,
              },
            };
          }
          return r;
        });
        setAttendanceRecords(updatedRecords);
      } else {
        setSelfAttendStatus("error");
        setSelfAttendMessage(data.error || "Gagal mencatatkan kehadiran.");
      }
    } catch (err: any) {
      setSelfAttendStatus("error");
      setSelfAttendMessage(err.message || "Kesalahan koneksi ke server.");
    }
  };

  // Ensure record structure exists for each active worker for current week, and prune deleted workers
  useEffect(() => {
    const activeWorkers = workers.filter((w) => w.isActive);
    const workerIds = new Set(workers.map((w) => w.id));

    setAttendanceRecords((prev) => {
      let updated = false;
      // Filter out records of workers that no longer exist in workers list
      let newRecords = prev.filter((r) => workerIds.has(r.workerId));
      if (newRecords.length !== prev.length) {
        updated = true;
      }

      activeWorkers.forEach((worker) => {
        const matchIdx = newRecords.findIndex(
          (r) => r.workerId === worker.id && r.attendance[weekStart] !== undefined
        );

        // If no attendance record exists for this worker on this week, initiate it
        if (matchIdx === -1) {
          const initialAttendance: { [date: string]: boolean } = {};
          weekDates.forEach((date) => {
            initialAttendance[date] = false; // default is absent
          });

          newRecords.push({
            workerId: worker.id,
            attendance: initialAttendance,
            dailyAllowance: globalAllowance,
          });
          updated = true;
        }
      });

      return updated ? newRecords : prev;
    });
  }, [weekStart, workers, globalAllowance]);

  // --- Handlers ---
  const handleToggleAttendance = (workerId: string, date: string) => {
    const updated = attendanceRecords.map((r) => {
      // Find the specific worker record for this week's start date
      const hasThisWeek = r.attendance[weekStart] !== undefined;
      if (r.workerId === workerId && hasThisWeek) {
        const nextVal = !r.attendance[date];
        const newCustomStatus = { ...(r.customStatus || {}) };
        const newReasons = { ...(r.reasons || {}) };
        delete newCustomStatus[date];
        delete newReasons[date];
        return {
          ...r,
          attendance: {
            ...r.attendance,
            [date]: nextVal,
          },
          customStatus: newCustomStatus,
          reasons: newReasons,
        };
      }
      return r;
    });
    setAttendanceRecords(updated);
  };

  const handleToggleAllForDay = (date: string, forceCheck: boolean) => {
    const updated = attendanceRecords.map((r) => {
      if (r.attendance[weekStart] !== undefined) {
        return {
          ...r,
          attendance: {
            ...r.attendance,
            [date]: forceCheck,
          },
        };
      }
      return r;
    });
    setAttendanceRecords(updated);
  };

  const handleToggleAllForWorker = (workerId: string, forceCheck: boolean) => {
    const updated = attendanceRecords.map((r) => {
      if (r.workerId === workerId && r.attendance[weekStart] !== undefined) {
        const newAttMap = { ...r.attendance };
        weekDates.forEach((d) => {
          newAttMap[d] = forceCheck;
        });
        return {
          ...r,
          attendance: newAttMap,
        };
      }
      return r;
    });
    setAttendanceRecords(updated);
  };

  // Check if current week's report is submitted
  const currentWeekReportLog = weeklyReports.find(
    (log) => log.weekStartDate === weekStart
  );

  const handleSubmitFridayReport = async () => {
    // Generate filtered records for this week
    const activeWorkerIds = new Set(workers.map((w) => w.id));
    const thisWeeksRecords = attendanceRecords.filter(
      (r) => r.attendance[weekStart] !== undefined && activeWorkerIds.has(r.workerId)
    );

    if (thisWeeksRecords.length === 0) {
      alert("Tidak ada data absen untuk minggu ini.");
      return;
    }

    const todayDayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
    const isFriday = todayDayName === "Friday";

    const confirmMsg = isFriday
      ? "Apakah Anda yakin ingin mengirimkan Laporan Mingguan Absen Uang Makan Hari Ini?"
      : `Saat ini bukan hari Jumat (Hari ini: ${todayDayName}). Laporan uang makan wajib diserahkan di hari Jumat. Apakah Anda ingin tetap mengirimkan laporan untuk periode ${weekStart} s/d ${weekEnd}?`;

    if (!window.confirm(confirmMsg)) return;

    const reportId = "REP-" + Math.floor(Math.random() * 900000 + 100000);
    const newReport: WeeklyReport = {
      id: reportId,
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      records: thisWeeksRecords,
      isSubmitted: true,
      submittedAt: new Date().toISOString(),
    };

    // Export to screen and local download immediately
    triggerAttendanceExcelDownload(weekStart, weekEnd, thisWeeksRecords, workers, `Rekap_Uang_Makan_${weekStart}_to_${weekEnd}.xlsx`);

    // If connected to Google Sheets, try uploading automatically!
    if (isDriveConnected && googleToken) {
      try {
        const sheetTitle = `Rekap Uang Makan Mingguan (${weekStart} s/d ${weekEnd})`;
        const headers = ["No.", "Nama Karyawan", "Jabatan", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Total Hadir", "Tarif Harian (Rp)", "Total Uang Makan (Rp)"];
        
        const workerMap = new Map<string, Worker>(workers.map((w) => [w.id, w]));
        const rows = thisWeeksRecords.map((rec, index) => {
          const w = workerMap.get(rec.workerId);
          let totalHadir = 0;
          const dayStates = weekDates.map((date) => {
            const hasAtt = rec.attendance[date] || false;
            if (hasAtt) totalHadir++;
            return hasAtt ? "Hadir" : "Absen";
          });

          return [
            index + 1,
            w?.name || "Karyawan",
            w?.role || "-",
            ...dayStates,
            totalHadir,
            rec.dailyAllowance,
            totalHadir * rec.dailyAllowance
          ];
        });

        const sheetResult = await exportAttendanceToGoogleSheet(
          googleToken,
          sheetTitle,
          headers,
          rows
        );
        newReport.sheetsUrl = sheetResult.spreadsheetUrl;
        alert(`Sukses! Laporan berhasil divalidasi, diunduh sebagai Excel, dan diexport langsung ke dokumen Google Sheets baru: ${sheetTitle}`);
      } catch (err: any) {
        console.error("Failed to automatically post to sheets", err);
        alert(`Laporan tersimpan secara lokal dan diunduh ke komputer Anda, namun gagal sinkronisasi ke Google Sheets: ${err.message}. Pastikan Token Google Anda masih valid.`);
      }
    } else {
      alert("Laporan Uang Makan Mingguan berhasil disimpan dan terunduh otomatis ke komputer Anda! Silakan hubungkan Google Sheets di pojok kanan atas jika Anda ingin pencatatan otomatis di Cloud.");
    }

    setWeeklyReports([newReport, ...weeklyReports]);
  };

  // --- Petty Cash PDF Handlers ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileToUpload(e.target.files[0]);
      setParseError(null);
    }
  };

  const handleUploadAndParse = async () => {
    if (!fileToUpload) {
      setParseError("Silakan pilih file PDF atau Gambar kwitansi terlebih dahulu.");
      return;
    }

    setIsParsing(true);
    setParseError(null);

    try {
      // Read file file into base64
      const base64 = await toBase64(fileToUpload);
      const cleanBase64 = base64.split(",")[1];

      const payload = {
        fileBase64: cleanBase64,
        fileName: fileToUpload.name,
        mimeType: fileToUpload.type,
      };

      const response = await fetch("/api/parse-petty-cash", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || "Gagal menghubungi modul analisis server.");
      }

      const rawResult = await response.json();

      const newReportId = "PC-" + Math.floor(Math.random() * 900000 + 100000);
      const processedReport: PettyCashReport = {
        id: newReportId,
        fileName: fileToUpload.name,
        uploadedAt: new Date().toISOString(),
        summary: {
          ...rawResult.summary,
          workerName: selectedUploadHolder
        },
        transactions: (rawResult.transactions || []).map((t: any) => ({
          ...t,
          worker: selectedUploadHolder
        })),
      };

      const updatedReports = [processedReport, ...pettyCashReports];
      setPettyCashReports(updatedReports);
      localStorage.setItem("petty_cash_reports", JSON.stringify(updatedReports));
      setActiveWorkspaceReport(processedReport);
      setFileToUpload(null);

      await syncStateToServer(
        workers,
        attendanceRecords,
        weeklyReports,
        updatedReports,
        attendancePin,
        signatures,
        pettyCashHolders,
        attendanceLogs,
        waMethod,
        autoReminderHour
      );

    } catch (error: any) {
      console.error(error);
      setParseError(error.message || "Terjadi kesalahan internal saat membaca struk/PDF petty cash.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleBankStatementUploadAndParse = async () => {
    if (!bankStatementFile) {
      setBankStatementParseError("Silakan pilih file PDF atau Gambar rekening koran terlebih dahulu.");
      return;
    }

    setIsParsingBankStatement(true);
    setBankStatementParseError(null);

    try {
      const base64 = await toBase64(bankStatementFile);
      const cleanBase64 = base64.split(",")[1];

      const payload = {
        fileBase64: cleanBase64,
        fileName: bankStatementFile.name,
        mimeType: bankStatementFile.type,
      };

      const response = await fetch("/api/parse-bank-statement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || "Gagal menghubungi modul analisis server.");
      }

      const rawResult = await response.json();

      const newReportId = "BS-" + Math.floor(Math.random() * 900000 + 100000);
      const processedReport: BankStatementReport = {
        id: newReportId,
        fileName: bankStatementFile.name,
        uploadedAt: new Date().toISOString(),
        summary: {
          ...rawResult.summary,
          bankName: selectedRkBank || rawResult.summary?.bankName || "BCA",
          accountHolder: selectedRkCompany || rawResult.summary?.accountHolder || "PT. Nusantara Mineral Sukses Abadi"
        },
        transactions: rawResult.transactions || [],
        companyName: selectedRkCompany,
        bankName: selectedRkBank,
      };

      const updatedStatements = [processedReport, ...bankStatements];
      setBankStatements(updatedStatements);
      localStorage.setItem("bank_statement_reports", JSON.stringify(updatedStatements));
      setActiveBankStatement(processedReport);
      setBankStatementFile(null);

    } catch (error: any) {
      console.error(error);
      setBankStatementParseError(error.message || "Terjadi kesalahan internal saat membaca rekening koran.");
    } finally {
      setIsParsingBankStatement(false);
    }
  };

  const handleLoadDemoBankStatement = () => {
    setIsParsingBankStatement(true);
    setBankStatementParseError(null);

    setTimeout(() => {
      const demoId = "BS-DEMO-" + Math.floor(Math.random() * 9000 + 1000);
      const demoReport: BankStatementReport = {
        id: demoId,
        fileName: `Rekening_Koran_${selectedRkBank}_${selectedRkCompany.replace(/\s+/g, '_')}_Mei_2026.pdf`,
        uploadedAt: new Date().toISOString(),
        summary: {
          bankName: selectedRkBank || "BCA (Bank Central Asia)",
          accountNumber: "8472910482",
          accountHolder: selectedRkCompany || "PT. Nusantara Mineral Sukses Abadi",
          period: "01 Mei 2026 - 31 Mei 2026",
          totalDebit: 18500000,
          totalCredit: 45000000,
          startingBalance: 12500000,
          endingBalance: 39000000,
        },
        transactions: [
          { date: "2026-05-02", description: "TRSF E-BANKING DB PT NMSA SETORAN", amount: 45000000, type: "CREDIT", balance: 57500000 },
          { date: "2026-05-05", description: "BIAYA LOGISTIK SOLAR PROYEK", amount: 8500000, type: "DEBIT", balance: 49000000 },
          { date: "2026-05-12", description: "TARIK TUNAI ATM MANDOR BAMBANG", amount: 5000000, type: "DEBIT", balance: 44000000 },
          { date: "2026-05-18", description: "SWASTA SEWA EXCAVATOR CAT320", amount: 4500000, type: "DEBIT", balance: 39500000 },
          { date: "2026-05-25", description: "BIAYA ADMIN REKENING BULANAN", amount: 500000, type: "DEBIT", balance: 39000000 },
        ],
        companyName: selectedRkCompany,
        bankName: selectedRkBank,
      };

      const updatedStatements = [demoReport, ...bankStatements];
      setBankStatements(updatedStatements);
      localStorage.setItem("bank_statement_reports", JSON.stringify(updatedStatements));
      setActiveBankStatement(demoReport);
      setIsParsingBankStatement(false);
    }, 1200);
  };

  const handleDeleteBankStatement = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBankStatementToDelete(id);
    setIsDeleteConfirmModalOpen(true);
  };

  const handleConfirmDeleteBankStatement = () => {
    if (!bankStatementToDelete) return;
    const remaining = bankStatements.filter(s => s.id !== bankStatementToDelete);
    setBankStatements(remaining);
    localStorage.setItem("bank_statement_reports", JSON.stringify(remaining));
    if (activeBankStatement?.id === bankStatementToDelete) {
      setActiveBankStatement(remaining.length > 0 ? remaining[0] : null);
    }
    setIsDeleteConfirmModalOpen(false);
    setBankStatementToDelete(null);
  };

  const handleLocalDownloadBankStatement = () => {
    if (!activeBankStatement) return;
    const cleanFileName = `RekeningKoran_${activeBankStatement.summary.bankName.replace(/\s+/g, "_")}_${activeBankStatement.summary.period?.replace(/\s+/g, "_") || "Mei"}.xlsx`;
    import("./lib/excelGenerator").then(({ triggerBankStatementExcelDownload }) => {
      triggerBankStatementExcelDownload(activeBankStatement.transactions, activeBankStatement.summary, cleanFileName);
    });
  };

  const handleSaveBankStatementToGoogleDrive = async () => {
    if (!activeBankStatement) return;
    if (!isDriveConnected || !googleToken) {
      alert("Hubungkan akun Google Drive Anda di panel atas terlebih dahulu.");
      return;
    }

    setCloudSyncStatus({ status: "syncing" });

    try {
      // 1. Generate Excel locally as Blob
      const { generateBankStatementExcelBlob } = await import("./lib/excelGenerator");
      const excelBlob = generateBankStatementExcelBlob(activeBankStatement.transactions, activeBankStatement.summary);

      // 2. Search or Create nested folders in GDrive
      const companyName = activeBankStatement.summary.accountHolder || "Perusahaan Belum Teridentifikasi";
      const bankName = activeBankStatement.summary.bankName || "Bank Lain";
      const periodName = activeBankStatement.summary.period || "Mei 2026";
      
      const periodFolderId = await getOrCreateNestedFolder(googleToken, [
        "Laporan Rekening Koran",
        companyName,
        bankName,
        periodName
      ]);

      // 3. Save the file inside this period child folder
      const cleanCompany = companyName.replace(/[\/\\?%*:|"<>\s]+/g, "_");
      const cleanBank = bankName.replace(/[\/\\?%*:|"<>\s]+/g, "_");
      const cleanPeriod = periodName.replace(/[\/\\?%*:|"<>\s]+/g, "_");
      const targetFileName = `RekeningKoran_${cleanCompany}_${cleanBank}_${cleanPeriod}.xlsx`;
      
      const uploadResult = await uploadFileToDrive(googleToken, periodFolderId, targetFileName, excelBlob);

      // Update state
      const updated = {
        ...activeBankStatement,
        driveFileId: uploadResult.id,
        driveUrl: uploadResult.webViewLink
      };

      setActiveBankStatement(updated);
      setBankStatements(bankStatements.map(s => s.id === updated.id ? updated : s));
      setCloudSyncStatus({ status: "success", msg: targetFileName });

      alert(`Sukses! Laporan rekening koran berhasil diconvert menjadi Excel (.xlsx), kemudian diunggah secara aman dan otomatis tersimpan rapi ke akun Google Drive Anda dalam folder: "Laporan Rekening Koran > ${companyName} > ${bankName} > ${periodName}"`);

    } catch (err: any) {
      console.error(err);
      setCloudSyncStatus({ status: "error", msg: err.message });
      alert(`Sinkronisasi Gagal: ${err.message}. Pastikan koneksi dan kredensial token Anda valid.`);
    }
  };

  // Inject beautiful preset templates/samples for user convenience to showcase Gemini parsing in 1-click
  const handleLoadDemoPettyCash = (demoType: "general" | "material") => {
    setIsParsing(true);
    setParseError(null);
    
    // Simulating deep network OCR extraction 
    setTimeout(() => {
      const demoId = "PC-DEMO-" + Math.floor(Math.random() * 9000 + 1000);
      let demoReport: PettyCashReport;

      if (demoType === "general") {
        demoReport = {
          id: demoId,
          fileName: "PettyCash_Proyek_Sipil_Bambang_Juni_2026.pdf",
          uploadedAt: new Date().toISOString(),
          summary: {
            totalIncome: 12000000,
            totalExpense: 10550000,
            remainingBalance: 1450000,
            workerName: selectedUploadHolder,
            reportMonth: "Juni 2026",
          },
          transactions: [
            { date: "2026-06-02", description: "Terima Drop Kas Keluar Mandor Bambang", category: "Penerimaan Kas", amount: 12000000, worker: selectedUploadHolder, type: TransactionType.INCOME },
            { date: "2026-06-03", description: "Beli Seng Talang & Paku Kayu", category: "Material", amount: 1550000, worker: selectedUploadHolder, type: TransactionType.EXPENSE },
            { date: "2026-06-05", description: "Sewa Molen Pengaduk Semen (3 hari)", category: "Tools", amount: 750000, worker: selectedUploadHolder, type: TransactionType.EXPENSE },
            { date: "2026-06-08", description: "Makan Siang Tim Lapangan Sipil", category: "Konsumsi", amount: 480000, worker: selectedUploadHolder, type: TransactionType.EXPENSE },
            { date: "2026-06-11", description: "Bantuan Semen Gresik 15 Sak", category: "Material", amount: 1125000, worker: selectedUploadHolder, type: TransactionType.EXPENSE },
            { date: "2026-06-15", description: "Ongkos Transport Dump Truck Pasir", category: "Transport", amount: 2400000, worker: selectedUploadHolder, type: TransactionType.EXPENSE },
            { date: "2026-06-18", description: "Upah Harian Tukang Listrik Lembur", category: "Lain-lain", amount: 3500000, worker: selectedUploadHolder, type: TransactionType.EXPENSE },
            { date: "2026-06-20", description: "Uang Koordinasi Lingkungan RT Proyek", category: "Keamanan / Koordinasi", amount: 745000, worker: selectedUploadHolder, type: TransactionType.EXPENSE }
          ]
        };
      } else {
        demoReport = {
          id: demoId,
          fileName: "Kwitansi_Pembelian_Besi_Beton_Ahmad.jpg",
          uploadedAt: new Date().toISOString(),
          summary: {
            totalIncome: 5000000,
            totalExpense: 4850000,
            remainingBalance: 150000,
            workerName: selectedUploadHolder,
            reportMonth: "Juni 2026",
          },
          transactions: [
            { date: "2026-06-10", description: "Terima tunai kas kecil dari kantor pusat", category: "Penerimaan Kas", amount: 5000000, worker: selectedUploadHolder, type: TransactionType.INCOME },
            { date: "2026-06-12", description: "Besi Beton Ulir Dia 12mm 20 batang", category: "Material", amount: 3400000, worker: selectedUploadHolder, type: TransactionType.EXPENSE },
            { date: "2026-06-12", description: "Kawat Ikat Beton (Kawat Bendrat)", category: "Material", amount: 250000, worker: selectedUploadHolder, type: TransactionType.EXPENSE },
            { date: "2026-06-13", description: "Sewa mobil angkut pick-up material", category: "Transport", amount: 1200000, worker: selectedUploadHolder, type: TransactionType.EXPENSE }
          ]
        };
      }

      const updatedReports = [demoReport, ...pettyCashReports];
      setPettyCashReports(updatedReports);
      localStorage.setItem("petty_cash_reports", JSON.stringify(updatedReports));
      setActiveWorkspaceReport(demoReport);
      setIsParsing(false);

      syncStateToServer(
        workers,
        attendanceRecords,
        weeklyReports,
        updatedReports,
        attendancePin,
        signatures,
        pettyCashHolders,
        attendanceLogs,
        waMethod,
        autoReminderHour
      );
    }, 1800);
  };

  const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });

  const resizeAndCompressImage = (file: File, maxWidth = 240, maxHeight = 240): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = window.document.createElement("canvas");
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              }
            } else {
              if (height > maxHeight) {
                width = Math.round((width * maxHeight) / height);
                height = maxHeight;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(event.target?.result as string);
              return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            const compressedBase64 = canvas.toDataURL("image/jpeg", 0.65);
            resolve(compressedBase64);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = (err) => reject(err);
        img.src = event.target?.result as string;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  // --- Workspace Transaction Interactive Editors ---
  const handleAddWorkspaceTx = () => {
    if (!activeWorkspaceReport || !newTxDesc || newTxAmount <= 0) {
      alert("Keterangan wajib diisi dan Jumlah transaksi harus lebih dari Rp 0.");
      return;
    }

    const finalCategory = newTxDesc.toLowerCase().includes("saldo awal") ? "Saldo Awal" : "Lain-lain";

    const newTx: PettyCashTransaction = {
      date: newTxDate || new Date().toISOString().split("T")[0],
      description: newTxDesc,
      category: finalCategory,
      amount: newTxAmount,
      worker: newTxWorker || activeWorkspaceReport.summary.workerName,
      type: newTxType,
    };

    const updatedTxs = [...activeWorkspaceReport.transactions, newTx];
    
    // Recalculate summary
    let incomeSum = 0;
    let expenseSum = 0;
    updatedTxs.forEach((t) => {
      if (t.type === TransactionType.INCOME) incomeSum += t.amount;
      else expenseSum += t.amount;
    });

    const updatedSummary = {
      ...activeWorkspaceReport.summary,
      totalIncome: incomeSum,
      totalExpense: expenseSum,
      remainingBalance: incomeSum - expenseSum,
    };

    const updatedReport = {
      ...activeWorkspaceReport,
      transactions: updatedTxs,
      summary: updatedSummary,
    };

    updateWorkspaceReportAndSync(updatedReport);

    // Reset inputs
    setNewTxDesc("");
    setNewTxAmount(0);
    setNewTxWorker("");
  };

  const handleDeleteWorkspaceTx = (index: number) => {
    if (!activeWorkspaceReport) return;
    const updatedTxs = activeWorkspaceReport.transactions.filter((_, idx) => idx !== index);

    let incomeSum = 0;
    let expenseSum = 0;
    updatedTxs.forEach((t) => {
      if (t.type === TransactionType.INCOME) incomeSum += t.amount;
      else expenseSum += t.amount;
    });

    const updatedSummary = {
      ...activeWorkspaceReport.summary,
      totalIncome: incomeSum,
      totalExpense: expenseSum,
      remainingBalance: incomeSum - expenseSum,
    };

    const updatedReport = {
      ...activeWorkspaceReport,
      transactions: updatedTxs,
      summary: updatedSummary,
    };

    updateWorkspaceReportAndSync(updatedReport);
  };

  const handleMoveWorkspaceTx = (index: number, direction: number) => {
    if (!activeWorkspaceReport) return;
    const transactions = [...activeWorkspaceReport.transactions];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= transactions.length) return;

    // Swap transactions
    const temp = transactions[index];
    transactions[index] = transactions[targetIndex];
    transactions[targetIndex] = temp;

    // Update and sync
    const updatedReport = {
      ...activeWorkspaceReport,
      transactions,
    };
    updateWorkspaceReportAndSync(updatedReport);
  };

  const handleSelectSwapRow = (index: number) => {
    if (!activeWorkspaceReport) return;
    if (swapStartIndex === null) {
      setSwapStartIndex(index);
    } else {
      if (swapStartIndex === index) {
        // Clicked the same row, cancel selection
        setSwapStartIndex(null);
        return;
      }
      
      // Swap the transactions
      const transactions = [...activeWorkspaceReport.transactions];
      const temp = transactions[swapStartIndex];
      transactions[swapStartIndex] = transactions[index];
      transactions[index] = temp;
      
      // Update and sync
      const updatedReport = {
        ...activeWorkspaceReport,
        transactions,
      };
      updateWorkspaceReportAndSync(updatedReport);
      setSwapStartIndex(null);
    }
  };

  const updateWorkspaceReportAndSync = (updatedReport: PettyCashReport) => {
    const sortedTxs = sortTransactionsWithSaldoAwalFirst(updatedReport.transactions);
    
    // Recalculate totals
    let incomeSum = 0;
    let expenseSum = 0;
    sortedTxs.forEach((t) => {
      if (t.type === TransactionType.INCOME) incomeSum += t.amount;
      else expenseSum += t.amount;
    });

    const finalReport: PettyCashReport = {
      ...updatedReport,
      transactions: sortedTxs,
      summary: {
        ...updatedReport.summary,
        totalIncome: incomeSum,
        totalExpense: expenseSum,
        remainingBalance: incomeSum - expenseSum,
      }
    };

    const updatedReports = pettyCashReports.map(r => r.id === finalReport.id ? finalReport : r);
    setActiveWorkspaceReport(finalReport);
    setPettyCashReports(updatedReports);
    localStorage.setItem("petty_cash_reports", JSON.stringify(updatedReports));

    syncStateToServer(
      workers,
      attendanceRecords,
      weeklyReports,
      updatedReports,
      attendancePin,
      signatures,
      pettyCashHolders,
      attendanceLogs,
      waMethod,
      autoReminderHour
    );
  };

  const handleDeletePettyCashReport = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Apakah Anda yakin ingin menghapus laporan petty cash ini dari riwayat?")) {
      const remainingReports = pettyCashReports.filter(r => r.id !== id);
      setPettyCashReports(remainingReports);
      localStorage.setItem("petty_cash_reports", JSON.stringify(remainingReports));
      if (activeWorkspaceReport?.id === id) {
        setActiveWorkspaceReport(remainingReports[0] || null);
      }

      syncStateToServer(
        workers,
        attendanceRecords,
        weeklyReports,
        remainingReports,
        attendancePin,
        signatures,
        pettyCashHolders,
        attendanceLogs,
        waMethod,
        autoReminderHour
      );
    }
  };

  // --- Sync Petty Cash Excel with Google Drive ---
  const handleSaveWorkspaceToGoogleDrive = async () => {
    if (!activeWorkspaceReport) return;
    if (!isDriveConnected || !googleToken) {
      alert("Hubungkan akun Google Drive Anda di panel atas terlebih dahulu.");
      return;
    }

    setCloudSyncStatus({ status: "syncing" });

    try {
      // 1. Generate Excel locally as Blob
      const { generatePettyCashExcelBlob } = await import("./lib/excelGenerator");
      const excelBlob = generatePettyCashExcelBlob(activeWorkspaceReport.transactions, activeWorkspaceReport.summary);

      // 2. Search or Create nested folders in GDrive
      const holderName = activeWorkspaceReport.summary.workerName || "Karyawan Lapangan";
      const monthFolderName = `Petty Cash - ${activeWorkspaceReport.summary.reportMonth || 'Belum Terkategori'}`;
      const monthFolderId = await getOrCreateNestedFolder(googleToken, [
        "Laporan Petty Cash Lapangan",
        holderName,
        monthFolderName
      ]);

      // 3. Save the file inside this monthly child folder
      const targetFileName = `Laporan_PettyCash_${holderName}_${(activeWorkspaceReport.summary.reportMonth || "Belum_Terkategori").replace(" ", "_")}.xlsx`;
      
      const uploadResult = await uploadFileToDrive(googleToken, monthFolderId, targetFileName, excelBlob);

      // Update state
      const updated = {
        ...activeWorkspaceReport,
        driveFileId: uploadResult.id,
        driveUrl: uploadResult.webViewLink
      };

      setActiveWorkspaceReport(updated);
      setPettyCashReports(pettyCashReports.map(r => r.id === updated.id ? updated : r));
      setCloudSyncStatus({ status: "success", msg: targetFileName });

      alert(`Sukses! Laporan petty cash berhasil diconvert menjadi Excel (.xlsx), kemudian diunggah secara aman dan otomatis tersimpan rapi ke akun Google Drive Anda dalam folder: "Laporan Petty Cash Lapangan > ${holderName} > ${monthFolderName}"`);

    } catch (err: any) {
      console.error(err);
      setCloudSyncStatus({ status: "error", msg: err.message });
      alert(`Sinkronisasi Gagal: ${err.message}. Pastikan koneksi dan kredensial token Anda valid.`);
    }
  };

  // --- Local Excel Trigger for Petty Cash ---
  const handleLocalDownloadPettyCash = () => {
    if (!activeWorkspaceReport) return;
    const cleanFileName = `PettyCash_${activeWorkspaceReport.summary.workerName || "Laporan"}_${activeWorkspaceReport.summary.reportMonth.replace(" ", "_")}.xlsx`;
    triggerExcelDownload(activeWorkspaceReport.transactions, activeWorkspaceReport.summary, cleanFileName);
  };

  // --- Workers Management Actions ---
  const handleAddWorker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkerName) return;

    const newWorker: Worker = {
      id: "W0" + (workers.length + 1),
      name: newWorkerName,
      role: "Karyawan",
      isActive: true,
      phoneNumber: newWorkerPhoneNumber || undefined,
      updatedAt: Date.now(),
    };

    setWorkers([...workers, newWorker]);
    setNewWorkerName("");
    setNewWorkerRole("");
    setNewWorkerBankName("");
    setNewWorkerBankAccount("");
    setNewWorkerPhoneNumber("");
    setNewWorkerNik("");
  };

  const handleOpenEditWorker = (worker: Worker) => {
    setEditingWorker(worker);
    setEditWorkerName(worker.name);
    setEditWorkerRole("Karyawan");
    setEditWorkerBankName("");
    setEditWorkerBankAccount("");
    setEditWorkerPhoneNumber(worker.phoneNumber || "");
    setEditWorkerNik("");
  };

  const handleSaveEditWorker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorker || !editWorkerName) return;

    setWorkers(
      workers.map((w) =>
        w.id === editingWorker.id
          ? {
              ...w,
              name: editWorkerName,
              role: "Karyawan",
              phoneNumber: editWorkerPhoneNumber || undefined,
              updatedAt: Date.now(),
            }
          : w
      )
    );

    setEditingWorker(null);
  };

  const handleToggleWorkerActive = (workerId: string) => {
    setWorkers(
      workers.map((w) => (w.id === workerId ? { ...w, isActive: !w.isActive, updatedAt: Date.now() } : w))
    );
  };

  const handleRemoveWorker = (workerId: string) => {
    if (!window.confirm("Apakah Anda yakin ingin menghapus karyawan ini?")) return;
    setWorkers(workers.filter((w) => w.id !== workerId));
    setAttendanceRecords((prev) => prev.filter((r) => r.workerId !== workerId));
  };

  const handleRemoveWeeklyReport = (reportId: string) => {
    if (!window.confirm("Apakah Anda yakin ingin menghapus riwayat laporan jumat ini? Tindakan ini tidak dapat dibatalkan.")) return;
    setWeeklyReports(weeklyReports.filter((r) => r.id !== reportId));
  };

  // --- WhatsApp Baileys Controller Handlers ---
  const handleRequestWaPairingCode = async () => {
    if (!waPairingPhone) {
      alert("Silakan masukkan nomor WhatsApp Anda terlebih dahulu.");
      return;
    }
    setWaPairingLoading(true);
    setWaPairingCode(null);
    try {
      const res = await fetch("/api/wa/pairing-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: waPairingPhone }),
      });
      const data = await res.json();
      if (res.ok && data.code) {
        setWaPairingCode(data.code);
      } else {
        alert("Gagal membuat Kode Pairing: " + (data.error || "Kesalahan server"));
      }
    } catch (err: any) {
      console.error("Failed to request pairing code:", err);
      alert("Kesalahan jaringan saat meminta kode pairing.");
    } finally {
      setWaPairingLoading(false);
    }
  };

  const handleDisconnectWa = async () => {
    if (!window.confirm("Apakah Anda yakin ingin memutuskan koneksi WhatsApp? Sesi Anda akan dihapus dan Anda harus melakukan scan QR code kembali.")) return;
    try {
      const res = await fetch("/api/wa/disconnect", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setWaBotStatus("disconnected");
        setWaBotQr(null);
        setWaBotUser(null);
        alert("Berhasil memutuskan koneksi WhatsApp. QR Code baru sedang disiapkan, mohon tunggu beberapa detik...");
      } else {
        alert("Gagal memutuskan koneksi WhatsApp: " + (data.error || "Kesalahan server"));
      }
    } catch (err: any) {
      console.error("Failed to disconnect WhatsApp:", err);
      alert("Kesalahan jaringan saat memutuskan koneksi.");
    }
  };

  const handleSendWaTest = async () => {
    if (!waTestPhone || !waTestMessage) {
      setWaTestResult({ success: false, msg: "Nomor penerima dan isi pesan wajib diisi!" });
      return;
    }
    setWaTestSending(true);
    setWaTestResult(null);
    try {
      const res = await fetch("/api/wa/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: waTestPhone, message: waTestMessage }),
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        setWaTestResult({ success: true, msg: "Pesan uji coba berhasil dikirim!" });
        setWaTestMessage("");
      } else {
        setWaTestResult({ success: false, msg: data.error || "Gagal mengirim pesan uji coba." });
      }
    } catch (err: any) {
      setWaTestResult({ success: false, msg: err.message || "Kesalahan koneksi jaringan." });
    } finally {
      setWaTestSending(false);
    }
  };

  const handleTriggerCronManual = async () => {
    setIsCronRunning(true);
    try {
      const res = await fetch("/api/cron-reminder?force=true");
      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Berhasil memproses pengingat harian!");
        fetchSharedState(true); // refresh telemetry immediately
      } else {
        alert(`Gagal memproses: ${data.message || "Kesalahan tidak dikenal."}`);
      }
    } catch (err: any) {
      alert(`Kesalahan jaringan: ${err.message || err}`);
    } finally {
      setIsCronRunning(false);
    }
  };

  // --- Google Connect Actions (Real Firebase Google Auth) ---
  const handleConnectGoogleReal = async () => {
    try {
      setCloudSyncStatus({ status: "syncing", msg: "Memulai autentikasi Google..." });
      const result = await googleSignIn();
      if (result) {
        setGoogleToken(result.accessToken);
        if (result.user.email) setGoogleUserEmail(result.user.email);
        setIsDriveConnected(true);
        setCloudSyncStatus({ status: "success", msg: "Terkoneksi ke Google Drive" });
        alert(`Berhasil login dan menghubungkan Google Drive & Google Sheets ke akun: ${result.user.email || ""}. Backup otomatis cloud sekarang aktif secara permanen!`);
        setShowTokenInput(false);
      }
    } catch (err: any) {
      console.error("Firebase Sign-In failed:", err);
      setCloudSyncStatus({ status: "error", msg: err.message || "Gagal login" });
      alert(`Gagal menghubungkan Google: ${err.message || err}. Cabut autentikasi jika perlu.`);
    }
  };

  const handleConnectToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) return;

    localStorage.setItem("g_access_token", tempToken);
    const mockEmail = googleUserEmail || "mandor.sandbox@gmail.com";
    localStorage.setItem("g_user_email", mockEmail);
    setGoogleToken(tempToken);
    setGoogleUserEmail(mockEmail);
    setIsDriveConnected(true);
    setShowTokenInput(false);
    setTempToken("");
    alert("Berhasil menghubungkan Google Drive (Sandbox)!");
  };

  const handleDisconnectGoogle = async () => {
    try {
      await googleSignOut();
      setGoogleToken("");
      setGoogleUserEmail("");
      setIsDriveConnected(false);
      setCloudSyncStatus({ status: "idle" });
      alert("Koneksi Google Drive & Google Sheets Anda telah berhasil diputuskan secara permanen.");
    } catch (err: any) {
      console.error("Firebase Sign-Out failed:", err);
      localStorage.removeItem("g_access_token");
      localStorage.removeItem("g_user_email");
      setGoogleToken("");
      setGoogleUserEmail("");
      setIsDriveConnected(false);
      setCloudSyncStatus({ status: "idle" });
    }
  };

  // --- Cumulative Stats ---
  const calculateTotalWeeklyUangMakan = () => {
    const records = attendanceRecords.filter((r) => r.attendance[weekStart] !== undefined);
    return records.reduce((sum, r) => {
      const presentDays = Object.keys(r.attendance).filter(k => r.attendance[k] && (!r.customStatus || (r.customStatus[k] !== "Meeting" && r.customStatus[k] !== "Izin" && r.customStatus[k] !== "Sakit"))).length;
      return sum + (presentDays * r.dailyAllowance);
    }, 0);
  };

  const calculateTotalAttendanceCount = () => {
    const records = attendanceRecords.filter((r) => r.attendance[weekStart] !== undefined);
    return records.reduce((sum, r) => {
      const presentDays = Object.keys(r.attendance).filter(k => r.attendance[k] && (!r.customStatus || (r.customStatus[k] !== "Meeting" && r.customStatus[k] !== "Izin" && r.customStatus[k] !== "Sakit"))).length;
      return sum + presentDays;
    }, 0);
  };

  // UI Date Navs
  const handlePrevWeek = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 7);
    setSelectedDate(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 7);
    setSelectedDate(next);
  };

  // --- CONDITIONAL RENDER: WORKER SELF-ATTENDANCE ---
  if (selfWorkerId) {
    const todayStr = getIndonesianDateStr(new Date());

    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between selection:bg-indigo-500 selection:text-white font-sans p-4 relative overflow-hidden">
        {/* Ambient background decoration */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-1/4 w-72 h-72 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>

        <header className="max-w-md w-full mx-auto pt-6 flex items-center justify-between border-b border-slate-800 pb-4 z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white rounded-xl shadow-md overflow-hidden flex items-center justify-center p-0.5 border border-slate-700">
              <img
                src="https://i.ibb.co.com/FqDNnD8W/Logo-Nusantara-Mineral-Abadi.webp"
                alt="Logo PT. Nusantara Mineral Sukses Abadi"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover rounded-lg"
              />
            </div>
            <div>
              <span className="font-bold text-xs tracking-tight font-display text-white block">PT. Nusantara Mineral Sukses Abadi</span>
              <span className="block text-[10px] text-slate-400 font-medium">Aplikasi Rekap Allowance-Meal</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
              Online
            </span>
          </div>
        </header>

        <main className="max-w-md w-full mx-auto my-auto py-8 z-10">
          <AnimatePresence>
            {!hasVerifiedProfile && selfWorker && (
              <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto" id="worker-profile-verification-overlay">
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-slate-800 border border-slate-700/80 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col font-sans"
                  id="worker-profile-verification-card"
                >
                  {/* Modal Header */}
                  <div className="bg-indigo-600 px-6 py-4 text-white flex items-center gap-3">
                    <div className="bg-indigo-700 p-2 rounded-full border border-indigo-400">
                      <FileCheck className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-white font-display text-sm tracking-tight uppercase text-left">VERIFIKASI DATA MANDIRI</h3>
                      <p className="text-indigo-100 text-[10px] font-medium text-left">Lengkapi & pastikan kebenaran data Anda</p>
                    </div>
                  </div>

                  {/* Scrollable Form Content */}
                  <div className="p-6 overflow-y-auto space-y-4 max-h-[65vh] text-left">
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-[11px] text-amber-200 leading-relaxed font-medium">
                      ⚠️ Sebelum melakukan absensi harian, harap isi seluruh data diri Anda yang masih kosong dan pastikan data yang sudah ada sudah 100% benar.
                    </div>

                    <div className="space-y-3 text-xs">
                      {/* Name */}
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Nama Lengkap Anda</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-750 rounded-lg px-3 py-2 text-white text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                          placeholder="Masukkan nama lengkap Anda"
                        />
                      </div>



                      {/* Phone Number */}
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">No. WhatsApp Aktif</label>
                        <input
                          type="text"
                          value={editPhoneNumber}
                          onChange={(e) => setEditPhoneNumber(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-750 rounded-lg px-3 py-2 text-white text-xs font-mono focus:ring-1 focus:ring-indigo-500 outline-none"
                          placeholder="Contoh: 081234567890"
                        />
                      </div>



                    </div>

                    {/* Checkbox Agreement */}
                    <div className="flex items-start gap-2.5 bg-indigo-950/40 border border-indigo-900/60 p-3 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setIsAgreedToDataVerification(!isAgreedToDataVerification)}
                        className="shrink-0 text-indigo-400 mt-0.5 cursor-pointer focus:outline-none"
                      >
                        {isAgreedToDataVerification ? (
                          <CheckSquare className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <div className="w-4 h-4 border-2 border-slate-500 rounded bg-slate-900" />
                        )}
                      </button>
                      <label className="text-[10px] text-slate-300 leading-normal font-semibold cursor-pointer select-none" onClick={() => setIsAgreedToDataVerification(!isAgreedToDataVerification)}>
                        Saya menyatakan bahwa seluruh data di atas sudah benar, akurat, dan sesuai dengan identitas asli saya.
                      </label>
                    </div>
                  </div>

                  {/* Modal Footer Action Button */}
                  <div className="p-6 bg-slate-850 border-t border-slate-750/70">
                    <button
                      type="button"
                      disabled={!isAgreedToDataVerification || profileSaveStatus === "saving"}
                      onClick={async () => {
                        if (!editName.trim()) {
                          alert("Nama lengkap wajib diisi.");
                          return;
                        }

                        try {
                          setProfileSaveStatus("saving");
                          const response = await fetch("/api/update-worker-profile", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              workerId: selfWorker.id,
                              bankName: editBankName,
                              bankAccount: editBankAccount,
                              phoneNumber: editPhoneNumber,
                              nik: editNik,
                              photoUrl: editPhotoUrl,
                              name: editName,
                              role: editRole,
                            }),
                          });
                          const result = await response.json();
                          if (response.ok) {
                             setProfileSaveStatus("success");
                             setLastInitializedWorkerId("");
                             setSelfWorker(result.worker);
                             setWorkers(workers.map(w => w.id === selfWorker.id ? result.worker : w));
                             setHasVerifiedProfile(true);
                             localStorage.setItem(`has_verified_profile_${selfWorker.id}`, "true");
                             alert("Data Anda berhasil diverifikasi!");
                          } else {
                            setProfileSaveStatus("error");
                            alert(result.error || "Gagal memverifikasi data.");
                          }
                        } catch (err: any) {
                          setProfileSaveStatus("error");
                          alert(err.message || "Kesalahan jaringan.");
                        } finally {
                          setProfileSaveStatus("idle");
                        }
                      }}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-400 text-white font-bold py-3.5 rounded-xl transition flex items-center justify-center gap-1.5 text-xs shadow-md shadow-indigo-600/15 cursor-pointer font-display uppercase tracking-wider"
                    >
                      {profileSaveStatus === "saving" ? "Menyimpan..." : "Konfirmasi & Setujui Data"}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {!selfWorker ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-slate-800/80 backdrop-blur-md border border-slate-700/60 rounded-2xl p-6 text-center shadow-xl"
            >
              <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-105">Memproses Data Karyawan...</h3>
              <p className="text-xs text-slate-400 mt-2">
                Sedang memverifikasi tautan absensi Anda. Harap tunggu beberapa saat atau hubungi admin/mandor lapangan jika terjadi kendala berkelanjutan.
              </p>
              <div className="mt-4 flex justify-center">
                <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              {/* Profile Card & Self Profiling Form */}
              <div className="bg-slate-800/80 backdrop-blur-md border border-slate-700/60 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-700/50 pb-3">
                  <div className="flex items-center gap-1.5">
                    <User className="w-4 h-4 text-indigo-400" />
                    <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest font-mono">
                      {isEditingProfile ? "Edit Data Anda" : "Data Diri Karyawan"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (isEditingProfile) {
                        setLastInitializedWorkerId("");
                      }
                      setIsEditingProfile(!isEditingProfile);
                      setProfileSaveMsg("");
                      setProfileSaveStatus("idle");
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-200 hover:text-white transition duration-150 text-[10px] font-bold cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>{isEditingProfile ? "Batal" : "Edit"}</span>
                  </button>
                </div>

                {!isEditingProfile ? (
                  /* READ-ONLY VIEW */
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      {selfWorker.photoUrl ? (
                        <img
                          src={selfWorker.photoUrl}
                          alt={selfWorker.name}
                          className="w-20 h-20 object-cover rounded-full border-2 border-indigo-500/40 shadow-md shadow-indigo-500/10 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-20 h-20 bg-indigo-500/20 text-indigo-300 rounded-full flex items-center justify-center font-bold font-display text-3xl border border-indigo-500/30 shrink-0 shadow-inner">
                          {selfWorker.name.charAt(0)}
                        </div>
                      )}
                      <div className="space-y-1">
                        <span className="text-[9px] bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded font-mono uppercase font-bold tracking-wider">
                          Terverifikasi
                        </span>
                        <h2 className="text-lg font-bold text-white leading-tight mt-1">{selfWorker.name}</h2>
                        <p className="text-xs text-slate-300 font-medium">{selfWorker.role}</p>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs pt-1">
                      <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-750/50">
                        <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">No. WhatsApp</span>
                        <span className="font-mono text-slate-200 font-semibold text-sm">{selfWorker.phoneNumber || "Belum diisi"}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* EDITING FORM VIEW */
                  <div className="space-y-4">
                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Nama Lengkap</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-750 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">No. WhatsApp</label>
                        <input
                          type="text"
                          placeholder="Contoh: 0812xxxxx"
                          value={editPhoneNumber}
                          onChange={(e) => setEditPhoneNumber(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-750 rounded-lg px-3 py-2 text-white placeholder-slate-600 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            setProfileSaveStatus("saving");
                            setProfileSaveMsg("");
                            const response = await fetch("/api/update-worker-profile", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                workerId: selfWorker.id,
                                bankName: editBankName,
                                bankAccount: editBankAccount,
                                phoneNumber: editPhoneNumber,
                                nik: editNik,
                                photoUrl: editPhotoUrl,
                                name: editName,
                                role: editRole,
                              }),
                            });
                            const result = await response.json();
                            if (response.ok) {
                             setProfileSaveStatus("success");
                             setLastInitializedWorkerId("");
                              setLastInitializedWorkerId("");
                              setProfileSaveMsg(result.message);
                              setSelfWorker(result.worker);
                              // Also update the global workers state to sync immediately
                              setWorkers(workers.map(w => w.id === selfWorker.id ? result.worker : w));
                              setHasVerifiedProfile(true);
                              localStorage.setItem(`has_verified_profile_${selfWorker.id}`, "true");
                              // Automatically switch back to read-only view on successful save!
                              setTimeout(() => {
                                setIsEditingProfile(false);
                              }, 1200);
                            } else {
                              setProfileSaveStatus("error");
                              setProfileSaveMsg(result.error || "Gagal memperbarui profil.");
                            }
                          } catch (err: any) {
                            setProfileSaveStatus("error");
                            setProfileSaveMsg(err.message || "Kesalahan jaringan.");
                          }
                        }}
                        disabled={profileSaveStatus === "saving"}
                        className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 text-white font-bold py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/15"
                      >
                        {profileSaveStatus === "saving" ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Menyimpan Profil...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Simpan Perubahan Profil</span>
                          </>
                        )}
                      </button>

                      {profileSaveMsg && (
                        <div className={`mt-2 p-2.5 rounded-xl text-[11px] font-medium text-center ${
                          profileSaveStatus === "success" 
                            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" 
                            : "bg-rose-500/10 border border-rose-500/20 text-rose-400"
                        }`}>
                          {profileSaveMsg}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Date Time Display */}
              <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4 text-center">
                <div className="text-xs text-slate-400 font-medium mb-1 flex items-center justify-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Tanggal & Waktu Server</span>
                </div>
                <div className="text-sm font-semibold text-slate-100">{todayStr}</div>
                <div className="text-3xl font-bold font-mono text-indigo-300 tracking-wider mt-1">{liveTime || "--:--:--"}</div>
              </div>

              {/* Status & Check In Action Area */}
              <div className="bg-slate-800/60 backdrop-blur-md border border-slate-700/50 rounded-2xl p-6 shadow-xl text-center space-y-4">
                {selfIsAttendedToday ? (
                  <div className="space-y-3 py-2">
                    <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/30 shadow-lg shadow-emerald-500/10">
                      <CheckCircle className="w-10 h-10" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-emerald-400">Presensi Berhasil Tercatat</h3>
                      <p className="text-xs text-slate-300 mt-1.5 max-w-xs mx-auto leading-relaxed">
                        Anda sudah melakukan absen hadir hari ini pada <strong>{todayStr}</strong>. Terima kasih atas kerja keras Anda di lapangan hari ini!
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="space-y-1">
                      <div className="text-xs text-amber-400 bg-amber-400/10 px-3 py-1 rounded-full w-fit mx-auto font-semibold border border-amber-400/20">
                        Belum Presensi Hari Ini
                      </div>
                      <p className="text-xs text-slate-300 pt-2 leading-relaxed max-w-xs mx-auto">
                        Silakan verifikasi lokasi Anda terlebih dahulu, masukkan PIN Harian dari Mandor saat briefing pagi, kemudian tekan tombol di bawah.
                      </p>
                    </div>

                    {/* GEOLOCATION VERIFICATION PANEL */}
                    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-3.5 text-left space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Verifikasi Lokasi Kerja</span>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-850 px-1.5 py-0.5 rounded">Maks. 150m</span>
                      </div>
                      
                      {geoStatus === "requesting" && (
                        <div className="flex items-center gap-2 text-xs text-indigo-300 bg-indigo-500/10 p-2 rounded-lg border border-indigo-500/20">
                          <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                          <span>Mendeteksi lokasi GPS Anda...</span>
                        </div>
                      )}

                      {geoStatus === "available" && geoDistance !== null && (
                        (() => {
                          const isNear = geoDistance <= MAX_DISTANCE_METERS;
                          return (
                            <div className="space-y-2">
                              <div className={`p-2 rounded-lg border text-xs flex items-center justify-between ${
                                isNear 
                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold" 
                                  : "bg-rose-500/10 border-rose-500/30 text-rose-400 font-semibold"
                              }`}>
                                <div className="flex items-center gap-1.5">
                                  {isNear ? <MapPin className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                                  <span>Jarak ke Kantor: ~{Math.round(geoDistance)} meter</span>
                                </div>
                                <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded-full font-mono bg-white/10">
                                  {isNear ? "Diterima ✅" : "Terlalu Jauh ❌"}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 leading-relaxed">
                                {isNear 
                                  ? "Anda berada di area kantor. Silakan masukkan PIN untuk melakukan absensi."
                                  : `Anda berada di luar radius kantor yang ditentukan (${Math.round(geoDistance)}m). Silakan mendekat ke lokasi kantor.`
                                }
                              </p>
                            </div>
                          );
                        })()
                      )}

                      {(geoStatus === "denied" || geoStatus === "error") && (
                        <div className="space-y-2">
                          <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-lg flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
                            <div className="space-y-1">
                              <p className="font-bold text-rose-400">Gagal Mengakses Lokasi</p>
                              <p className="text-[10px] text-slate-400 leading-relaxed">{geoErrorMsg}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={requestGeolocation}
                            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold py-2 rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Coba Lagi Akses GPS</span>
                          </button>
                        </div>
                      )}

                      {/* Hardcoded Office Location Context */}
                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[10px] space-y-1">
                        <div className="font-bold text-slate-300 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-rose-500" />
                          <span>Titik Kantor Default (Terkunci)</span>
                        </div>
                        <p className="text-slate-400 leading-relaxed">
                          Jl. Raya Pasar Minggu No. 2B-C, RT.2/RW.2, Pancoran, Kec. Pancoran, Jakarta Selatan (QR3V+W8 Pancoran)
                        </p>
                      </div>
                    </div>

                    {/* PIN INPUT FIELD */}
                    <div className="max-w-xs mx-auto space-y-1 text-left">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">PIN Presensi Harian</label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                          <Lock className="w-4 h-4" />
                        </span>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="Masukkan PIN"
                          value={selfInputPin}
                          disabled={geoStatus !== "available" || geoDistance === null || geoDistance > MAX_DISTANCE_METERS}
                          onChange={(e) => setSelfInputPin(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl py-2.5 pl-9 pr-4 text-sm text-center font-bold text-white tracking-widest placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>


                    <button
                      onClick={handleSelfSubmitAttendance}
                      disabled={serverSyncing || geoStatus !== "available" || geoDistance === null || geoDistance > MAX_DISTANCE_METERS}
                      className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:scale-[0.99] disabled:from-slate-800 disabled:to-slate-800/80 disabled:border-slate-700/50 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold text-sm py-3.5 px-6 rounded-xl transition duration-150 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/40"
                    >
                      {serverSyncing ? (
                        <>
                          <RefreshCw className="w-5 h-5 animate-spin" />
                          <span>Mencatat Absensi...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-5 h-5" />
                          <span>Klik untuk Absen Hadir</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* API Status Feedback */}
                {selfAttendStatus === "success" && (
                  <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-xs text-emerald-300">
                    {selfAttendMessage}
                  </div>
                )}
                {selfAttendStatus === "error" && (
                  <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2 justify-center">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{selfAttendMessage}</span>
                  </div>
                )}
              </div>

              {/* WEEKLY HISTORY CARD */}
              <div className="bg-slate-800/80 backdrop-blur-md border border-slate-700/60 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="border-b border-slate-700 pb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">Riwayat Presensi Minggu Ini</h3>
                    <p className="text-[10px] text-slate-400">Senin s/d Jumat</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                      Uang Makan: Rp {globalAllowance.toLocaleString("id-ID")}/Hari
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {(() => {
                    const record = attendanceRecords.find((r) => r.workerId === selfWorker.id);
                    let presentCount = 0;

                    return (
                      <>
                        <div className="divide-y divide-slate-800">
                          {weekDates.map((dateStr) => {
                            const isPresent = record?.attendance && record.attendance[dateStr] === true;
                            if (isPresent) presentCount++;

                            const dayNamesMap: Record<string, string> = {
                              Monday: "Senin",
                              Tuesday: "Selasa",
                              Wednesday: "Rabu",
                              Thursday: "Kamis",
                              Friday: "Jumat",
                            };
                            const dayNameEn = new Date(dateStr).toLocaleDateString("en-US", { weekday: "long" });
                            const dayNameId = dayNamesMap[dayNameEn] || dayNameEn;
                            const splitted = dateStr.split("-");
                            const displayDate = `${splitted[2]}/${splitted[1]}`;

                            return (
                              <div key={dateStr} className="py-2.5 flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="font-semibold text-slate-200">{dayNameId}</div>
                                  <div className="text-[10px] text-slate-500 font-mono">({displayDate})</div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {isPresent ? (
                                    <>
                                      <span className="text-[10px] font-bold text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                                        HADIR (+Rp {globalAllowance.toLocaleString("id-ID")})
                                      </span>
                                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-[10px] text-slate-500 font-mono bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                                        BELUM ABSEN
                                      </span>
                                      <div className="w-4 h-4 rounded-full border-2 border-slate-700"></div>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* SUM OF ALLOWANCES */}
                        <div className="pt-3 border-t border-slate-700 flex items-center justify-between text-xs font-semibold bg-slate-900/40 p-3 rounded-xl border border-slate-800">
                          <div className="text-slate-400">Total Akumulasi Uang Makan:</div>
                          <div className="text-emerald-400 font-bold font-display text-sm">
                            Rp {(presentCount * globalAllowance).toLocaleString("id-ID")}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          )}
        </main>

        <footer className="max-w-md w-full mx-auto border-t border-slate-800 pt-4 pb-6 text-center text-[10px] text-slate-500 z-10 space-y-3">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                setReportDescription("");
                setReportStatus("Sakit");
                setReportSubmitStatus("idle");
                setReportSubmitMsg("");
                setShowReportModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-300 hover:text-amber-200 transition text-[11px] font-bold cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Laporkan Situasi Absen</span>
            </button>
          </div>
          <div>
            <p>© 2026 PT. Nusantara Mineral Sukses Abadi. All Rights Reserved.</p>
            <p className="mt-1">Aplikasi Rekap Allowance-Meal &bull; Presensi Digital Lapangan</p>
          </div>
        </footer>

        {/* REPORT PROBLEM MODAL */}
        <AnimatePresence>
          {showReportModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (reportSubmitStatus !== "submitting") {
                    setShowReportModal(false);
                  }
                }}
                className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
              />

              {/* Modal Card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full relative overflow-hidden shadow-2xl z-10 text-left space-y-4"
              >
                <div className="flex items-center gap-2 text-amber-400">
                  <AlertTriangle className="w-5 h-5" />
                  <h3 className="text-base font-bold text-white tracking-tight">Laporkan Situasi Ke Admin</h3>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Silahkan tuliskan situasi anda saat ini, lalu pilih keterangan yang ingin di laporkan kepada pihak admin keuangan.
                </p>

                {reportSubmitStatus === "success" ? (
                  <div className="bg-emerald-950/40 border border-emerald-500/20 text-emerald-300 p-3.5 rounded-xl text-center space-y-2">
                    <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
                    <p className="text-xs font-bold">Laporan Situasi Terkirim! 👍</p>
                    <p className="text-[10px] text-slate-300 leading-relaxed">
                      Situasi Anda telah tercatat dan dikirimkan kepada Admin keuangan. Terima kasih atas laporannya.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowReportModal(false)}
                      className="w-full mt-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] py-2 rounded-lg transition"
                    >
                      Tutup
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!reportDescription.trim()) return;
                      setReportSubmitStatus("submitting");
                      try {
                        const res = await fetch("/api/worker-report", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            workerId: selfWorker?.id,
                            description: reportDescription,
                            status: reportStatus
                          })
                        });
                        const data = await res.json();
                        if (res.ok) {
                          setReportSubmitStatus("success");
                          setReportSubmitMsg(data.message);
                          fetchSharedState(true); // Refresh shared state
                        } else {
                          setReportSubmitStatus("error");
                          setReportSubmitMsg(data.error || "Gagal mengirim laporan.");
                        }
                      } catch (err: any) {
                        setReportSubmitStatus("error");
                        setReportSubmitMsg(err.message || "Gagal menghubungi server.");
                      }
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Keterangan Situasi</label>
                      <select
                        value={reportStatus}
                        onChange={(e) => setReportStatus(e.target.value)}
                        className="w-full bg-slate-950/60 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="Sakit" className="bg-slate-900 text-white">Sakit</option>
                        <option value="Izin" className="bg-slate-900 text-white">Izin</option>
                        <option value="Meeting di Luar" className="bg-slate-900 text-white">Meeting di Luar</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Tuliskan Situasi Anda</label>
                      <textarea
                        required
                        rows={3}
                        placeholder="Contoh: Sedang demam tinggi sejak pagi dan perlu istirahat, sudah berobat ke klinik terdekat."
                        value={reportDescription}
                        onChange={(e) => setReportDescription(e.target.value)}
                        className="w-full bg-slate-950/60 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-sans resize-none leading-relaxed"
                      />
                    </div>

                    {reportSubmitStatus === "error" && (
                      <div className="bg-rose-950/40 border border-rose-500/20 text-rose-300 p-2.5 rounded-xl text-xs text-center">
                        {reportSubmitMsg}
                      </div>
                    )}

                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        disabled={reportSubmitStatus === "submitting"}
                        onClick={() => setShowReportModal(false)}
                        className="flex-1 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={reportSubmitStatus === "submitting" || !reportDescription.trim()}
                        className="flex-1 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50 shadow-md shadow-amber-950/50"
                      >
                        {reportSubmitStatus === "submitting" ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Mengirim...</span>
                          </>
                        ) : (
                          <span>Kirim Laporan</span>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showSuccessModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSuccessModal(false)}
                className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
              />

              {/* Modal Card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                transition={{ type: "spring", duration: 0.5 }}
                className="bg-slate-900 border border-slate-750/70 rounded-3xl p-6 max-w-sm w-full text-center relative overflow-hidden shadow-2xl z-10"
              >
                {/* Visual confetti / burst accent background */}
                <div className="absolute -top-12 -left-12 w-24 h-24 bg-emerald-500/20 rounded-full blur-2xl pointer-events-none"></div>
                <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none"></div>

                <div className="w-16 h-16 bg-gradient-to-tr from-emerald-400 to-emerald-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20 mb-4 animate-bounce">
                  <Check className="w-8 h-8" />
                </div>

                <h3 className="text-xl font-bold text-white tracking-tight">Presensi Berhasil! 🎉</h3>
                
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-slate-200">
                    Terima kasih, <strong className="text-emerald-400">{selfWorker?.name}</strong>, absensi Anda hari ini sudah berhasil tercatat dengan aman.
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed bg-slate-950/40 p-3 rounded-2xl border border-slate-800 text-center">
                    Jangan lupa untuk absen lagi besok yaaa.. Semangat terus kerjanya, utamakan keselamatan kerja, dan semoga hari Anda luar biasa menyenangkan! 😄👷‍♂️☀️👍🏼
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowSuccessModal(false)}
                  className="w-full mt-5 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-bold text-xs py-3 rounded-xl transition cursor-pointer shadow-md shadow-emerald-950"
                >
                  Selesai & Tutup 👍
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // --- Petty Cash Multi-Worker Calculations ---
  // Unique list of petty cash holders (from uploaded reports)
  const existingHolders = Array.from(
    new Set(
      pettyCashReports
        .map((r) => r.summary?.workerName)
        .filter((name): name is string => typeof name === "string" && name.trim() !== "")
    )
  );

  // All registered workers as potential holders
  const registeredWorkerNames = workers.map(w => w.name);

  // Combined sorted unique list of potential holders (strictly manual petty cash holders)
  const uniqueHolders = Array.from(
    new Set(pettyCashHolders)
  ).sort();

  // Filter reports based on chosen filter (using selectedUploadHolder now)
  const filteredReports = pettyCashReports.filter((report) => {
    return report.summary?.workerName === selectedUploadHolder;
  });

  // Calculate stats for selected holder without double-counting carried-over balances
  const sortedFilteredReports = [...filteredReports].sort((a, b) => {
    return new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
  });

  let initialSaldoAwal = 0;
  let sumNewIncomes = 0;
  let sumExpenses = 0;

  if (sortedFilteredReports.length > 0) {
    // Starting balance of the oldest report of this holder
    const oldestReport = sortedFilteredReports[0];
    const oldestTxs = oldestReport.transactions || [];
    const oldestFirstTx = oldestTxs[0];
    const oldestIsSisaSaldo = oldestFirstTx && (
      oldestFirstTx.description.toLowerCase().includes("sisa") || 
      oldestFirstTx.description.toLowerCase().includes("awal") || 
      oldestFirstTx.description.toLowerCase().includes("sebelum")
    );
    initialSaldoAwal = oldestIsSisaSaldo 
      ? (oldestFirstTx.type === TransactionType.INCOME ? oldestFirstTx.amount : -oldestFirstTx.amount) 
      : 0;

    // Sum up new incomes and expenses across all of this holder's reports
    filteredReports.forEach((report) => {
      const txs = report.transactions || [];
      const firstTx = txs[0];
      const isSisaSaldo = firstTx && (
        firstTx.description.toLowerCase().includes("sisa") || 
        firstTx.description.toLowerCase().includes("awal") || 
        firstTx.description.toLowerCase().includes("sebelum")
      );

      const reportNewIncomes = txs
        .filter((_, idx) => !(idx === 0 && isSisaSaldo))
        .reduce((sum, tx) => tx.type === TransactionType.INCOME ? sum + tx.amount : sum, 0);

      const reportExpenses = txs
        .filter((_, idx) => !(idx === 0 && isSisaSaldo))
        .reduce((sum, tx) => tx.type === TransactionType.EXPENSE ? sum + tx.amount : sum, 0);

      sumNewIncomes += reportNewIncomes;
      sumExpenses += reportExpenses;
    });
  }

  const combinedIncome = initialSaldoAwal + sumNewIncomes;
  const combinedExpense = sumExpenses;
  const combinedBalance = initialSaldoAwal + sumNewIncomes - sumExpenses;

  // Calculate accumulated balances for all unique holders (non-double-counting)
  const holderBalances = uniqueHolders.map(holderName => {
    const holderReports = pettyCashReports.filter(r => r.summary?.workerName === holderName);
    
    const sortedHolderReports = [...holderReports].sort((a, b) => {
      return new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
    });

    let hInitialSaldoAwal = 0;
    let hSumNewIncomes = 0;
    let hSumExpenses = 0;

    if (sortedHolderReports.length > 0) {
      const oldestReport = sortedHolderReports[0];
      const oldestTxs = oldestReport.transactions || [];
      const oldestFirstTx = oldestTxs[0];
      const oldestIsSisaSaldo = oldestFirstTx && (
        oldestFirstTx.description.toLowerCase().includes("sisa") || 
        oldestFirstTx.description.toLowerCase().includes("awal") || 
        oldestFirstTx.description.toLowerCase().includes("sebelum")
      );
      hInitialSaldoAwal = oldestIsSisaSaldo 
        ? (oldestFirstTx.type === TransactionType.INCOME ? oldestFirstTx.amount : -oldestFirstTx.amount) 
        : 0;

      holderReports.forEach((report) => {
        const txs = report.transactions || [];
        const firstTx = txs[0];
        const isSisaSaldo = firstTx && (
          firstTx.description.toLowerCase().includes("sisa") || 
          firstTx.description.toLowerCase().includes("awal") || 
          firstTx.description.toLowerCase().includes("sebelum")
        );

        const reportNewIncomes = txs
          .filter((_, idx) => !(idx === 0 && isSisaSaldo))
          .reduce((sum, tx) => tx.type === TransactionType.INCOME ? sum + tx.amount : sum, 0);

        const reportExpenses = txs
          .filter((_, idx) => !(idx === 0 && isSisaSaldo))
          .reduce((sum, tx) => tx.type === TransactionType.EXPENSE ? sum + tx.amount : sum, 0);

        hSumNewIncomes += reportNewIncomes;
        hSumExpenses += reportExpenses;
      });
    }

    return {
      name: holderName,
      balance: hInitialSaldoAwal + hSumNewIncomes - hSumExpenses
    };
  });

  // --- Dashboard / Analytics Calculations ---
  const activeWorkersCount = workers.filter(w => w.isActive).length;
  const totalWorkersCount = workers.length;
  
  // Calculate combined stats for ALL petty cash reports
  let totalAllIncome = 0;
  let totalAllExpense = 0;
  pettyCashReports.forEach(report => {
    totalAllIncome += report.summary?.totalIncome || 0;
    totalAllExpense += report.summary?.totalExpense || 0;
  });
  const totalAllBalance = totalAllIncome - totalAllExpense;

  // Group petty cash transactions across all reports for Recharts charts
  const categoryTotals: { [cat: string]: number } = {};
  const monthlyExpenseData: { [month: string]: { income: number; expense: number } } = {};

  pettyCashReports.forEach(report => {
    const month = report.summary?.reportMonth || "Lainnya";
    if (!monthlyExpenseData[month]) {
      monthlyExpenseData[month] = { income: 0, expense: 0 };
    }
    monthlyExpenseData[month].income += report.summary?.totalIncome || 0;
    monthlyExpenseData[month].expense += report.summary?.totalExpense || 0;

    if (report.transactions) {
      report.transactions.forEach(t => {
        if (t.type === TransactionType.EXPENSE || t.type === "EXPENSE") {
          const cat = t.category || "Umum";
          categoryTotals[cat] = (categoryTotals[cat] || 0) + t.amount;
        }
      });
    }
  });

  const chartCategoryData = Object.entries(categoryTotals)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 7); // top 7 categories

  const chartMonthlyData = Object.entries(monthlyExpenseData).map(([month, data]) => ({
    month,
    income: data.income,
    expense: data.expense,
  }));

  // Average attendance rate
  let totalPossibleSlots = 0;
  let totalPresentSlots = 0;
  attendanceRecords.forEach(r => {
    if (r.attendance) {
      Object.entries(r.attendance).forEach(([dateStr, val]) => {
        totalPossibleSlots++;
        if (val === true && (!r.customStatus || (r.customStatus[dateStr] !== "Meeting" && r.customStatus[dateStr] !== "Izin" && r.customStatus[dateStr] !== "Sakit"))) {
          totalPresentSlots++;
        }
      });
    }
  });
  const averageAttendanceRate = totalPossibleSlots > 0 ? Math.round((totalPresentSlots / totalPossibleSlots) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-indigo-500 selection:text-white" id="main_container">
      
      {/* HEADER NAVBAR */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-xs" id="nav_header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden flex items-center justify-center p-0.5">
              <img
                src="https://i.ibb.co.com/FqDNnD8W/Logo-Nusantara-Mineral-Abadi.webp"
                alt="Logo PT. Nusantara Mineral Sukses Abadi"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover rounded-lg"
              />
            </div>
            <div>
              <h1 className="text-base sm:text-lg md:text-xl font-bold font-display text-slate-900 tracking-tight">PT. Nusantara Mineral Sukses Abadi</h1>
              <p className="text-xs text-slate-500 font-semibold">Aplikasi Rekap Allowance-Meal</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* PWA INSTALLATION BUTTON */}
            {showInstallBtn && (
              <button
                onClick={handleInstallPWA}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-3.5 py-2 rounded-full shadow-md hover:shadow-lg transition duration-150 cursor-pointer animate-pulse"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Pasang Aplikasi</span>
              </button>
            )}

            {/* GOOGLE INTEGRATION COMPONENT */}
            <div className="flex items-center gap-2">
              {isDriveConnected ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full text-xs text-emerald-800">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <Globe className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="font-semibold text-emerald-800">Drive Terkoneksi: {googleUserEmail || "Aktif"}</span>
                  <button onClick={handleDisconnectGoogle} className="p-0.5 hover:bg-emerald-150 rounded-full text-emerald-600 ml-1 cursor-pointer">
                    <LogOut className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setShowTokenInput(!showTokenInput)} 
                    className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 transition duration-150 border border-indigo-100 px-3 py-1.5 rounded-full text-xs text-indigo-700 font-medium cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Aktifkan Google Drive & Sheets Backup</span>
                  </button>
                </div>
              )}
            </div>

            {/* QUICK TAB SWITCHER */}
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setActiveTab("dashboard")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 cursor-pointer ${
                  activeTab === "dashboard"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5 text-indigo-600" />
                <span>Ringkasan & Analitik</span>
              </button>

              <button
                onClick={() => setActiveTab("absen")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 cursor-pointer ${
                  activeTab === "absen"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                <span>Absen Uang Makan</span>
              </button>
              
              <button
                onClick={() => setActiveTab("pettycash")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 cursor-pointer ${
                  activeTab === "pettycash"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                <span>Pembacaan Dokumen PDF</span>
              </button>

              <button
                onClick={() => setActiveTab("workers")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 cursor-pointer ${
                  activeTab === "workers"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Users className="w-3.5 h-3.5 text-amber-600" />
                <span>Kelola Karyawan</span>
              </button>
            </div>

          </div>
        </div>

        {/* Dynamic Token Authorization Overlay Form */}
        {showTokenInput && (
          <div className="bg-indigo-50 border-t border-indigo-200 px-4 sm:px-6 lg:px-8 py-4">
            <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center gap-6 justify-between">
              <div className="flex-1">
                <h3 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-indigo-600 animate-pulse" />
                  Hubungkan Google Workspace Secara Otomatis & Permanen
                </h3>
                <p className="text-[11px] text-indigo-850 mt-1 max-w-xl leading-relaxed">
                  Aplikasi ini menggunakan scope aman <b>drive.file</b> & <b>spreadsheets</b> untuk secara otomatis mengorganisir folder <b>"Laporan Petty Cash Lapangan"</b> di Google Drive Anda dan mengekspor rekap Excel & Google Sheets. Koneksi bersifat aman dan terenkripsi menggunakan Google OAuth.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch gap-3 w-full md:w-auto">
                {/* Official styled Google Sign-In Button */}
                <button
                  type="button"
                  onClick={handleConnectGoogleReal}
                  className="flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs px-4 py-2.5 border border-slate-300 rounded-lg hover:shadow-xs transition duration-150 cursor-pointer text-center"
                >
                  <svg className="w-4 h-4 mr-0.5" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  </svg>
                  <span>Login dengan Google</span>
                </button>

                {/* Sandbox / Bypass option */}
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem("g_access_token", "ACCESSTOKEN_SANDBOX_ACTIVE");
                    localStorage.setItem("g_user_email", "karyawan.proyek@gmail.com");
                    setGoogleToken("ACCESSTOKEN_SANDBOX_ACTIVE");
                    setGoogleUserEmail("karyawan.proyek@gmail.com");
                    setIsDriveConnected(true);
                    setShowTokenInput(false);
                    alert("Menggunakan mode Sandbox dengan Token Default!");
                  }}
                  className="flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2.5 rounded-lg hover:shadow-xs transition duration-150 cursor-pointer text-center"
                >
                  Gunakan Akun Sandbox
                </button>
              </div>
            </div>

            {/* Manual Token input drawer inside */}
            <details className="max-w-3xl mx-auto mt-3 border-t border-indigo-100 pt-2 text-left">
              <summary className="text-[10px] text-indigo-700 cursor-pointer hover:underline">
                Pengaturan manual / Masukkan Access Token khusus (Debugging)
              </summary>
              <form onSubmit={handleConnectToken} className="mt-2 flex flex-col sm:flex-row items-end gap-2">
                <div className="flex-1 w-full">
                  <input
                    type="password"
                    placeholder="Masukkan custom Access Token Anda..."
                    value={tempToken}
                    onChange={(e) => setTempToken(e.target.value)}
                    className="w-full bg-white text-slate-950 text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  Terapkan Token
                </button>
              </form>
            </details>
          </div>
        )}
      </header>

      {/* WORKSPACE AREA */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full" id="workspace_main">
        
        {/* TAB 0: BERANDA & ANALITIK UTAMA */}
        {activeTab === "dashboard" && (
          <div className="space-y-8" id="dashboard_tab_view">
            {/* INTRO HERO BANNER */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(99,102,241,0.15),transparent)] pointer-events-none"></div>
              <div className="space-y-2 relative z-10">
                <div className="inline-flex items-center gap-1.5 bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span>Dashboard Analitik & Anti-Fraud</span>
                </div>
                <h2 className="text-xl md:text-2xl font-bold font-display tracking-tight">Selamat Datang di Portal Manajemen Mandor</h2>
                <p className="text-xs md:text-sm text-slate-300 max-w-xl leading-relaxed">
                  Monitor seluruh kehadiran karyawan lapangan, koordinasi GPS anti-fraud secara real-time, serta pantau laporan keuangan petty cash PT. Nusantara Mineral Sukses Abadi secara otomatis di sini.
                </p>
              </div>
              <div className="relative z-10 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => fetchSharedState()}
                  className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl px-4 py-2.5 text-xs font-semibold transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${serverSyncing ? "animate-spin" : ""}`} />
                  <span>Refresh Data</span>
                </button>
              </div>
            </div>

            {/* SECTION 1: METRICS & CHARTS (ACCORDION STYLE) */}
            <div 
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" 
              id="dash_section_metrics"
              onClickCapture={() => setMetricsActivityTick(prev => prev + 1)}
            >
              <button
                type="button"
                onClick={() => setIsDashMetricsOpen(!isDashMetricsOpen)}
                className="w-full flex items-center justify-between p-4 bg-slate-50/70 hover:bg-slate-100/70 transition text-left focus:outline-none border-b border-slate-150"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    <BarChart3 className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>1. Statistik Utama & Tren Arus Kas</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                        Karyawan & Keuangan
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Pantau jumlah tenaga kerja, sisa kas, pengeluaran, dan grafik arus kas.</p>
                  </div>
                </div>
                <div className="text-slate-400">
                  {isDashMetricsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isDashMetricsOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden bg-white p-5 space-y-6"
                  >
                    {/* BENTO GRID: KEY METRICS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              
              {/* Metric 1 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tenaga Kerja Aktif</span>
                  <div className="p-2.5 bg-amber-50 rounded-xl text-amber-600">
                    <Users className="w-5 h-5" />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">{activeWorkersCount} <span className="text-xs text-slate-500 font-medium">dari {totalWorkersCount}</span></div>
                  <p className="text-[11px] text-slate-500 mt-1">Status karyawan lapangan aktif saat ini</p>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div 
                      className="bg-amber-500 h-1.5 rounded-full" 
                      style={{ width: `${totalWorkersCount > 0 ? (activeWorkersCount / totalWorkersCount) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Metric 2 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Kas Kecil</span>
                  <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600">
                    <DollarSign className="w-5 h-5" />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    Rp {totalAllBalance.toLocaleString("id-ID")}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Sisa saldo gabungan seluruh laporan</p>
                  <div className="flex items-center gap-2 mt-3 text-[10px] font-semibold text-slate-500">
                    <span className="text-emerald-600">In: Rp {totalAllIncome.toLocaleString("id-ID")}</span>
                  </div>
                </div>
              </div>

              {/* Metric 3 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Rata-rata Kehadiran</span>
                  <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600">
                    <CheckSquare className="w-5 h-5" />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {averageAttendanceRate}%
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Tingkat kehadiran kumulatif mingguan</p>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-1.5 rounded-full" 
                      style={{ width: `${averageAttendanceRate}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Metric 4 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pengeluaran Petty Cash</span>
                  <div className="p-2.5 bg-rose-50 rounded-xl text-rose-600">
                    <TrendingDown className="w-5 h-5" />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    Rp {totalAllExpense.toLocaleString("id-ID")}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Akumulasi pengeluaran operasional</p>
                  <div className="flex items-center gap-1.5 mt-3 text-[10px] text-rose-600 font-semibold">
                    <span>Terbuang dari total pemasukan</span>
                  </div>
                </div>
              </div>

            </div>

            {/* CHARTS CONTAINER: ANALYTICS VISUALIZATION */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Chart 1: Cash Flow Area Chart */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Tren Keuangan Bulanan (Arus Kas)</h3>
                    <p className="text-xs text-slate-500">Pemasukan vs Pengeluaran Petty Cash</p>
                  </div>
                  <BarChart3 className="w-4 h-4 text-slate-400" />
                </div>
                <div className="h-64">
                  {chartMonthlyData.length === 0 ? (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs text-center">
                      <p>Belum ada data bulanan dari PDF petty cash.</p>
                      <button onClick={() => setActiveTab("pettycash")} className="text-indigo-600 font-bold hover:underline mt-1">Unggah PDF Petty Cash &rarr;</button>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartMonthlyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="month" stroke="#94a3b8" fontSize={10} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `Rp ${val / 1000000}M`} />
                        <Tooltip 
                          formatter={(value: any) => [`Rp ${Number(value).toLocaleString("id-ID")}`, ""]}
                          contentStyle={{ background: "#ffffff", borderRadius: "12px", border: "1px solid #e2e8f0" }}
                        />
                        <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }} />
                        <Area type="monotone" name="Pemasukan" dataKey="income" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorIncome)" />
                        <Area type="monotone" name="Pengeluaran" dataKey="expense" stroke="#f43f5e" strokeWidth={2} fillOpacity={1} fill="url(#colorExpense)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Chart 2: Expense Categories Bar Chart */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Top Pengeluaran Berdasarkan Kategori</h3>
                    <p className="text-xs text-slate-500">Distribusi biaya operasional teratas</p>
                  </div>
                  <TrendingDown className="w-4 h-4 text-slate-400" />
                </div>
                <div className="h-64">
                  {chartCategoryData.length === 0 ? (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs text-center">
                      <p>Belum ada data pengeluaran terdeteksi.</p>
                      <button onClick={() => setActiveTab("pettycash")} className="text-indigo-600 font-bold hover:underline mt-1">Unggah PDF Petty Cash &rarr;</button>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartCategoryData} layout="vertical" margin={{ top: 5, right: 5, left: 15, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                        <XAxis type="number" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} tickFormatter={(val) => `Rp ${val/1000}k`} />
                        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={9} tickLine={false} width={80} />
                        <Tooltip 
                          formatter={(value: any) => [`Rp ${Number(value).toLocaleString("id-ID")}`, "Biaya"]}
                          contentStyle={{ background: "#ffffff", borderRadius: "12px", border: "1px solid #e2e8f0" }}
                        />
                        <Bar dataKey="value" name="Total Biaya" fill="#6366f1" radius={[0, 4, 4, 0]} maxBarSize={18}>
                          {chartCategoryData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index === 0 ? "#4f46e5" : index === 1 ? "#6366f1" : index === 2 ? "#818cf8" : "#a5b4fc"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

            </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* SECTION 2: ANTI-FRAUD PORTAL - GPS LOGS (ACCORDION STYLE) */}
            <div 
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" 
              id="dash_section_gps"
              onClickCapture={() => setGpsActivityTick(prev => prev + 1)}
            >
              <button
                type="button"
                onClick={() => setIsDashGpsOpen(!isDashGpsOpen)}
                className="w-full flex items-center justify-between p-4 bg-slate-50/70 hover:bg-slate-100/70 transition text-left focus:outline-none border-b border-slate-150"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
                    <MapPin className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>2. Portal Verifikasi Geolocation & GPS</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                        Anti-Fraud ({attendanceLogs.length} Log)
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Sistem memverifikasi jarak karyawan &lt; 150m dari kantor/site untuk mencegah absensi fiktif.</p>
                  </div>
                </div>
                <div className="text-slate-400">
                  {isDashGpsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isDashGpsOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden bg-white"
                  >
                    <div className="p-4 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-left text-xs">
                      <div className="text-[11px] bg-slate-100 border border-slate-200 text-slate-600 px-3 py-1.5 rounded-xl font-medium w-fit">
                        Titik Kantor: <b className="text-slate-800">-6.244342, 106.843073</b> (Jangkauan Maks: <b>150m</b>)
                      </div>
                    </div>

              {attendanceLogs.length === 0 ? (
                <div className="p-10 text-center flex flex-col items-center justify-center text-slate-500">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-3">
                    <MapPin className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-700">Belum Ada Log Presensi Real-Time</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-md leading-relaxed">
                    Setiap karyawan melakukan absensi mandiri, sistem browser mereka akan mendeteksi GPS koordinat dan mencatat alamat fisik riil secara otomatis menggunakan reverse geocoding open-source gratis.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 uppercase font-bold text-[10px] tracking-wider border-b border-slate-100">
                        <th className="py-3.5 px-5">Karyawan</th>
                        <th className="py-3.5 px-4">Tanggal & Waktu</th>
                        <th className="py-3.5 px-4">Akurasi GPS / Koordinat</th>
                        <th className="py-3.5 px-4">Estimasi Jarak</th>
                        <th className="py-3.5 px-4">Alamat Riil Terverifikasi (OSM)</th>
                        <th className="py-3.5 px-4">Status Absen</th>
                        <th className="py-3.5 px-5 text-right">Verifikasi Peta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {attendanceLogs.map((log: any) => {
                        const isSuccess = log.status === "BERHASIL";
                        const isPinError = log.status === "DITOLAK_PIN";
                        const isLocError = log.status === "DITOLAK_LOKASI";
                        const isTimeError = log.status === "DITOLAK_WAKTU";
                        const isReport = log.status === "LAPORAN_KENDALA";
                        
                        return (
                          <tr key={log.id} className="hover:bg-slate-50 transition">
                            <td className="py-3.5 px-5">
                              <div>
                                <div className="font-bold text-slate-900">{log.workerName}</div>
                                <div className="text-[10px] text-slate-500 font-semibold">{log.workerId}</div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="text-slate-800">{log.date}</div>
                              <div className="text-[10px] text-slate-500 font-semibold">{log.time}</div>
                            </td>
                            <td className="py-3.5 px-4 text-slate-600">
                              {isReport ? (
                                <span className="text-slate-400 font-mono text-[11px]">-</span>
                              ) : (
                                <div className="font-mono text-[11px]">{log.latitude?.toFixed(6) || "0"}, {log.longitude?.toFixed(6) || "0"}</div>
                              )}
                            </td>
                            <td className="py-3.5 px-4">
                              {isReport ? (
                                <span className="text-slate-400 font-mono text-[11px]">-</span>
                              ) : log.distance <= 150 ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                                  <span>~{log.distance} m</span>
                                  <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded-md border border-emerald-200 font-sans">OK (&lt;150m)</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                                  <span>~{log.distance} m</span>
                                  <span className="text-[10px] font-semibold bg-rose-50 text-rose-800 px-1.5 py-0.5 rounded-md border border-rose-200 font-sans">Terlalu Jauh</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 max-w-xs truncate" title={log.address}>
                              <span className="text-slate-600 leading-relaxed text-[11px]">{log.address || "Resolving address..."}</span>
                            </td>
                            <td className="py-3.5 px-4">
                              {isSuccess ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                                  <span>Hadir (Sukses)</span>
                                </span>
                              ) : isLocError ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                  <AlertCircle className="w-3 h-3 text-rose-600" />
                                  <span>Gagal Jarak</span>
                                </span>
                              ) : isTimeError ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 font-sans">
                                  <Clock className="w-3 h-3 text-amber-600" />
                                  <span>Terlambat/Tutup</span>
                                </span>
                              ) : isReport ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-150 text-red-600 border border-rose-200 font-sans animate-pulse">
                                  <AlertTriangle className="w-3 h-3 text-red-500" />
                                  <span>Kendala Link</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 font-sans">
                                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                                  <span>Gagal PIN</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-5 text-right">
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${log.latitude},${log.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 hover:text-slate-900 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition"
                              >
                                <Globe className="w-3 h-3 text-slate-500" />
                                <span>Lihat Peta</span>
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* SECTION 3: WHATSAPP BOT INTEGRATION PANEL (ACCORDION STYLE) */}
            <div 
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" 
              id="wa_gateway_panel"
              onClickCapture={() => setWaActivityTick(prev => prev + 1)}
            >
              <button
                type="button"
                onClick={() => setIsDashWaOpen(!isDashWaOpen)}
                className="w-full flex items-center justify-between p-4 bg-slate-50/70 hover:bg-slate-100/70 transition text-left focus:outline-none border-b border-slate-150"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                    <MessageSquare className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>3. Pusat Integrasi WhatsApp & Otomatisasi</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                        waBotStatus === "connected" 
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                          : waBotStatus === "qr"
                          ? "bg-amber-50 text-amber-700 border-amber-200 animate-pulse"
                          : "bg-slate-50 text-slate-600 border-slate-200"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${waBotStatus === "connected" ? "bg-emerald-500 animate-ping" : "bg-slate-400"}`} />
                        <span className="capitalize">{waBotStatus === "connected" ? "Terhubung" : waBotStatus === "qr" ? "Butuh Scan" : "Offline"}</span>
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Sambungkan nomor WhatsApp Anda untuk pengiriman pengingat harian secara gratis, aman, dan otomatis.</p>
                  </div>
                </div>
                <div className="text-slate-400">
                  {isDashWaOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isDashWaOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden bg-white"
                  >

              {/* TABS SELECTOR */}
              <div className="flex border-b border-slate-100 bg-slate-50/40">
                <button
                  type="button"
                  onClick={() => setWaPanelMode("bot")}
                  className={`flex-grow sm:flex-initial py-3.5 px-6 text-xs font-bold transition-all border-b-2 flex items-center justify-center gap-2 ${
                    waPanelMode === "bot"
                      ? "border-emerald-600 text-emerald-700 bg-white"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Zap className="w-4 h-4" />
                  <span>🤖 BOT WHATSAPP OTOMATIS (Rekomendasi)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWaPanelMode("manual")}
                  className={`flex-grow sm:flex-initial py-3.5 px-6 text-xs font-bold transition-all border-b-2 flex items-center justify-center gap-2 ${
                    waPanelMode === "manual"
                      ? "border-indigo-600 text-indigo-700 bg-white"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>📲 ASISTEN SIARAN MANUAL (Klik Link)</span>
                </button>
              </div>

              <div className="p-5 space-y-6">
                
                {/* MODE 1: SERVER-SIDE AUTOMATED BOT (BAILEYS ENGINE) */}
                {waPanelMode === "bot" && (
                  <div className="space-y-6 animate-fade-in">
                    {/* Educational / Explainer Banner */}
                    <div className="bg-emerald-50/50 border border-emerald-200/80 rounded-2xl p-4 text-xs text-slate-700 space-y-3 text-left">
                      <h4 className="font-bold text-emerald-950 flex items-center gap-1.5">
                        <CheckCircle className="w-4.5 h-4.5 text-emerald-700" />
                        <span>Cara Kerja Bot Server (Asisten Otomatis)</span>
                      </h4>
                      <p className="leading-relaxed">
                        Fitur ini menggunakan <strong>Baileys WhatsApp Web Gateway</strong> yang berjalan langsung di server Anda. Dengan menghubungkan akun WhatsApp Anda di bawah ini, server akan mengirimkan pesan pengingat <strong>secara otomatis di latar belakang</strong> pada jam kerja yang Anda tentukan, tanpa memerlukan interaksi manual lagi dari Anda!
                      </p>
                      <div className="text-[11px] bg-white/80 border border-emerald-200/60 p-3 rounded-xl space-y-1">
                        <span className="font-bold text-emerald-900 block">💡 Langkah Singkat Memulai:</span>
                        <p className="text-slate-600 leading-relaxed">
                          1. Scan Barcode (QR Code) di bawah dengan aplikasi WhatsApp di HP Anda (Pilih menu <b>Perangkat Tertaut</b> &gt; <b>Tautkan Perangkat</b>).<br />
                          2. Setelah terhubung, status akan berubah menjadi <b className="text-emerald-700">Terhubung</b>.<br />
                          3. Atur jam pengingat harian dan gunakan tautan otomatisasi di bawah untuk disambungkan ke <b>UptimeRobot</b> agar bot terus berjalan mandiri setiap hari.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* Connection Block (Status or QR Code) */}
                      <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden min-h-[340px]">
                        
                        {/* Selector if not connected */}
                        {waBotStatus !== "connected" && (
                          <div className="flex border border-slate-200 rounded-xl overflow-hidden bg-white mb-4 shrink-0 text-left">
                            <button
                              type="button"
                              onClick={() => setWaConnectMethod("qr")}
                              className={`w-1/2 py-2 text-[10px] sm:text-[11px] font-bold transition-all text-center cursor-pointer ${
                                waConnectMethod === "qr"
                                  ? "bg-slate-900 text-white font-bold"
                                  : "bg-white text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              📷 Scan Barcode
                            </button>
                            <button
                              type="button"
                              onClick={() => setWaConnectMethod("phone")}
                              className={`w-1/2 py-2 text-[10px] sm:text-[11px] font-bold transition-all text-center cursor-pointer ${
                                waConnectMethod === "phone"
                                  ? "bg-slate-900 text-white font-bold"
                                  : "bg-white text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              🔢 Kode Pairing
                            </button>
                          </div>
                        )}

                        {/* QR METHOD VIEW */}
                        {waBotStatus !== "connected" && waConnectMethod === "qr" && (
                          <>
                            {/* Connecting State */}
                            {(waBotStatus === "connecting" || (waBotStatus === "disconnected" && !waBotQr)) && (
                              <div className="my-auto flex flex-col items-center justify-center text-center p-6 space-y-4">
                                <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin" />
                                <div>
                                  <h5 className="font-bold text-slate-800 text-sm">Mempersiapkan Koneksi Bot...</h5>
                                  <p className="text-xs text-slate-500 mt-1">Mengaktifkan gateway server. Mohon tunggu beberapa detik...</p>
                                </div>
                              </div>
                            )}

                            {/* QR Code Scan State */}
                            {waBotStatus === "qr" && waBotQr && (
                              <div className="my-auto flex flex-col items-center justify-center text-center space-y-4">
                                <div className="space-y-1">
                                  <h5 className="font-bold text-slate-900 text-sm">Scan QR Code WhatsApp Anda</h5>
                                  <p className="text-[11px] text-slate-500">Masa aktif QR Code terbatas. Segera lakukan pemindaian.</p>
                                </div>
                                
                                <div className="relative p-3 bg-white rounded-2xl border border-slate-200/80 shadow-md">
                                  <img 
                                    src={waBotQr} 
                                    alt="WhatsApp QR Code Scanner" 
                                    className="w-48 h-48 block mx-auto rounded-lg"
                                    referrerPolicy="no-referrer"
                                  />
                                  <div className="absolute inset-0 border-2 border-emerald-500/20 rounded-2xl pointer-events-none animate-pulse" />
                                </div>

                                <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-medium leading-normal max-w-xs mx-auto">
                                  <span>⚠️</span>
                                  <span>Pilih <b>Perangkat Tertaut</b> di menu WhatsApp HP Anda untuk memindai barcode ini.</span>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* PHONE PAIRING METHOD VIEW */}
                        {waBotStatus !== "connected" && waConnectMethod === "phone" && (
                          <div className="my-auto flex flex-col justify-center text-left space-y-4 p-2">
                            <div className="space-y-1">
                              <h5 className="font-bold text-slate-950 text-xs sm:text-sm">Hubungkan dengan Nomor HP</h5>
                              <p className="text-[11px] text-slate-500">Dapatkan kode 8 karakter untuk dimasukkan di WhatsApp HP Anda.</p>
                            </div>

                            <div className="space-y-2">
                              <label className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">Nomor WhatsApp Bot</label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  placeholder="Contoh: 08123456789"
                                  value={waPairingPhone}
                                  onChange={(e) => setWaPairingPhone(e.target.value)}
                                  className="flex-1 bg-white text-slate-950 text-xs px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium shadow-xs"
                                />
                                <button
                                  type="button"
                                  onClick={handleRequestWaPairingCode}
                                  disabled={waPairingLoading || !waPairingPhone}
                                  className="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-[11px] px-3.5 rounded-xl transition shadow-xs flex items-center justify-center gap-1 cursor-pointer disabled:bg-slate-200 disabled:text-slate-400 disabled:pointer-events-none"
                                >
                                  {waPairingLoading ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    "Dapatkan Kode"
                                  )}
                                </button>
                              </div>
                            </div>

                            {waPairingCode && (
                              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center space-y-2">
                                <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">KODE PAIRING ANDA:</span>
                                <div className="text-xl font-black font-mono tracking-widest text-emerald-950 bg-white border border-emerald-150 py-1.5 rounded-xl shadow-xs select-all">
                                  {waPairingCode}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(waPairingCode);
                                    alert("Kode Pairing disalin!");
                                  }}
                                  className="text-[10px] text-emerald-700 hover:text-emerald-800 underline font-bold cursor-pointer"
                                >
                                  Salin Kode
                                </button>
                              </div>
                            )}

                            <div className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-[10px] text-slate-600 space-y-1 leading-relaxed">
                              <span className="font-bold text-slate-800 block">📲 Cara Memasukkan Kode di HP:</span>
                              <p>
                                1. Buka <b>WhatsApp</b> di HP Anda.<br />
                                2. Buka menu <b>Perangkat Tertaut</b> &gt; ketuk <b>Tautkan Perangkat</b>.<br />
                                3. Di bagian bawah layar pemindai kamera, ketuk <b>Tautkan dengan nomor telepon saja</b>.<br />
                                4. Masukkan kode 8 karakter di atas.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Connected State */}
                        {waBotStatus === "connected" && (
                          <div className="my-auto flex flex-col items-center justify-center text-center space-y-4 py-4">
                            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shadow-inner animate-pulse">
                              <CheckCircle className="w-10 h-10" />
                            </div>
                            
                            <div className="space-y-1">
                              <h5 className="font-bold text-slate-900 text-sm">Bot Berhasil Terhubung!</h5>
                              <p className="text-xs text-emerald-600 font-bold">Koneksi Aktif di Server</p>
                            </div>

                            <div className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs space-y-2 text-left shadow-xs">
                              <div className="flex justify-between border-b border-slate-100 pb-1.5">
                                <span className="text-slate-500">Nama Perangkat:</span>
                                <span className="font-bold text-slate-800">{waBotUser?.name || "WhatsApp Gateway"}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-100 pb-1.5">
                                <span className="text-slate-500">Nomor Telepon:</span>
                                <span className="font-mono font-bold text-slate-800">{waBotUser?.id ? waBotUser.id.split(":")[0] : "Terhubung"}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500">Status Operasional:</span>
                                <span className="text-emerald-600 font-bold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                                  <span>Aktif (Standby)</span>
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={handleDisconnectWa}
                              className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-3 py-2 rounded-xl transition font-bold border border-rose-200 bg-white cursor-pointer"
                            >
                              <LogOut className="w-3.5 h-3.5" />
                              <span>Putuskan Hubungan Bot</span>
                            </button>
                          </div>
                        )}

                        {/* Display Errors if Any */}
                        {waBotError && (
                          <div className="absolute bottom-2 left-2 right-2 bg-rose-50 border border-rose-150 p-2.5 rounded-xl text-[10px] text-rose-700 font-semibold flex flex-col items-center gap-2 shadow-sm z-10">
                            <div className="flex items-start gap-1 text-left leading-normal">
                              <span className="shrink-0 mt-0.5">⚠️</span>
                              <span>
                                {waBotError.includes("Logged out of WhatsApp") 
                                  ? "Koneksi terputus/dibatalkan oleh WhatsApp HP Anda. Silakan bersihkan sesi server lalu tautkan ulang." 
                                  : waBotError}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const res = await fetch("/api/wa/disconnect", { method: "POST" });
                                    const data = await res.json();
                                    if (data.success) {
                                      setWaBotStatus("disconnected");
                                      setWaBotQr(null);
                                      setWaBotUser(null);
                                      setWaBotError(null);
                                      alert("Sesi berhasil dibersihkan! Anda sekarang dapat mencoba menghubungkan kembali.");
                                    }
                                  } catch (e) {
                                    console.error("Gagal membersihkan sesi:", e);
                                    alert("Gagal membersihkan sesi server.");
                                  }
                                }}
                                className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-2.5 py-1 rounded-lg transition text-[9px] cursor-pointer shadow-xs"
                              >
                                Bersihkan Sesi Server
                              </button>
                              <button
                                type="button"
                                onClick={() => setWaBotError(null)}
                                className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold px-2.5 py-1 rounded-lg transition text-[9px] cursor-pointer"
                              >
                                Tutup Peringatan
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Bot Controls & Integration Tools */}
                      <div className="lg:col-span-7 space-y-5 flex flex-col justify-between">
                        
                        {/* Test Delivery Form */}
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left space-y-3.5">
                          <div className="space-y-0.5">
                            <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Uji Coba Pengiriman Pesan</h5>
                            <p className="text-[11px] text-slate-500">Kirim pesan uji coba untuk memverifikasi fungsionalitas koneksi bot Anda.</p>
                          </div>

                          <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="sm:col-span-1 space-y-1">
                                <label className="text-[11px] font-bold text-slate-700">Nomor HP</label>
                                <input
                                  type="text"
                                  placeholder="08123456789"
                                  value={waTestPhone}
                                  onChange={(e) => setWaTestPhone(e.target.value)}
                                  disabled={waBotStatus !== "connected"}
                                  className="w-full bg-white text-slate-950 text-xs px-2.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium disabled:bg-slate-100 disabled:text-slate-400"
                                />
                              </div>
                              <div className="sm:col-span-2 space-y-1">
                                <label className="text-[11px] font-bold text-slate-700">Isi Pesan Uji Coba</label>
                                <input
                                  type="text"
                                  placeholder="Halo! Ini adalah pesan uji coba dari Bot WhatsApp Absensi."
                                  value={waTestMessage}
                                  onChange={(e) => setWaTestMessage(e.target.value)}
                                  disabled={waBotStatus !== "connected"}
                                  className="w-full bg-white text-slate-950 text-xs px-2.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium disabled:bg-slate-100 disabled:text-slate-400"
                                />
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={handleSendWaTest}
                              disabled={waTestSending || waBotStatus !== "connected"}
                              className="w-full bg-slate-900 hover:bg-slate-850 active:scale-98 text-white font-bold text-xs py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:bg-slate-200 disabled:text-slate-400 disabled:pointer-events-none"
                            >
                              {waTestSending ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  <span>Mengirim Pesan...</span>
                                </>
                              ) : (
                                <>
                                  <Phone className="w-3.5 h-3.5" />
                                  <span>Kirim Pesan Uji Coba</span>
                                </>
                              )}
                            </button>

                            {/* Test Result Display */}
                            {waTestResult && (
                              <div className={`text-[11px] p-2.5 rounded-lg border font-medium ${
                                waTestResult.success 
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                                  : "bg-rose-50 border-rose-200 text-rose-800"
                              }`}>
                                {waTestResult.success ? "✓ " : "✗ "} {waTestResult.msg}
                              </div>
                            )}

                            {waBotStatus !== "connected" && (
                              <p className="text-[10px] text-amber-700 italic text-center">
                                * Hubungkan bot Anda terlebih dahulu dengan men-scan QR code di samping untuk mencoba pengiriman.
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Cron Schedule & Status Panel */}
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left space-y-3.5">
                          <div className="space-y-0.5">
                            <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Layanan Pengingat Otomatis (Cron Service)</h5>
                            <p className="text-[11px] text-slate-500">Atur jam pengiriman dan integrasikan dengan UptimeRobot untuk terus menyala.</p>
                          </div>

                          <div className="space-y-3 text-xs text-slate-700">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 border border-slate-200 rounded-xl">
                              <div className="space-y-1">
                                <span className="text-[11px] font-bold text-slate-600 block">Jadwal Pengiriman:</span>
                                <div className="flex items-center gap-1.5">
                                  <Clock className="w-3.5 h-3.5 text-indigo-500" />
                                  <select
                                    value={autoReminderHour}
                                    onChange={(e) => setAutoReminderHour(e.target.value)}
                                    className="bg-slate-50 text-slate-950 font-bold px-2 py-1 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                  >
                                    <option value="07:00">07:00 WIB</option>
                                    <option value="08:00">08:00 WIB</option>
                                    <option value="08:30">08:30 WIB</option>
                                    <option value="09:00">09:00 WIB (Standar)</option>
                                    <option value="10:00">10:00 WIB</option>
                                  </select>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={handleTriggerCronManual}
                                disabled={isCronRunning || waBotStatus !== "connected"}
                                className="bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-bold text-xs py-2 px-3 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer disabled:bg-slate-200 disabled:text-slate-400 disabled:pointer-events-none"
                              >
                                {isCronRunning ? (
                                  <>
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                    <span>Memproses...</span>
                                  </>
                                ) : (
                                  <>
                                    <Zap className="w-3 h-3" />
                                    <span>Kirim Manual Sekarang</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {/* Telemetry log blocks */}
                            <div className="bg-white p-3 border border-slate-200 rounded-xl space-y-2">
                              <div className="flex justify-between border-b border-slate-100 pb-1">
                                <span className="text-[10px] text-slate-500 font-bold uppercase">Terakhir Diping Server:</span>
                                <span className="font-mono font-semibold text-slate-800">{lastCronPing || "Belum ada riwayat ping"}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-100 pb-1">
                                <span className="text-[10px] text-slate-500 font-bold uppercase">Tanggal Pengiriman Hari Ini:</span>
                                <span className="font-mono font-semibold text-slate-800">{lastCronSentDate ? `Sukses (${lastCronSentDate})` : "Belum dikirim hari ini"}</span>
                              </div>
                              <div className="space-y-1">
                                <span className="text-[10px] text-slate-500 font-bold uppercase block">Status Log Terakhir:</span>
                                <div className="text-[11px] bg-slate-50 p-2 rounded-lg border border-slate-150 text-slate-600 leading-normal italic">
                                  {lastCronStatus || "Bot siap menerima pemicu jadwal (cron)."}
                                </div>
                              </div>
                            </div>

                            {/* UptimeRobot copy link box */}
                            <div className="bg-indigo-50/50 border border-indigo-150 p-3 rounded-xl space-y-2">
                              <div className="space-y-0.5">
                                <span className="font-bold text-indigo-950 block text-[11px]">🔗 Hubungkan ke UptimeRobot:</span>
                                <p className="text-[10px] text-slate-600 leading-relaxed">
                                  Salin tautan cron API di bawah ini ke <b>UptimeRobot</b> dengan tipe pemantauan <b>HTTP(s) GET</b> agar terus dipicu otomatis setiap 5-10 menit. Server akan menyaring jam dan hanya mengirim di jam yang Anda tentukan di atas.
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  readOnly
                                  value={`${window.location.origin}/api/cron-reminder`}
                                  className="w-full bg-white text-[10px] font-mono text-slate-700 px-2 py-1.5 border border-indigo-200 rounded-lg select-all outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/api/cron-reminder`);
                                    alert("Link cron berhasil disalin! Hubungkan link ini ke monitor UptimeRobot Anda.");
                                  }}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg transition shrink-0 cursor-pointer"
                                >
                                  Salin Link
                                </button>
                              </div>
                            </div>

                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                )}

                {/* MODE 2: CLIENT-SIDE MANUAL BROADCAST (ORIGINAL) */}
                {waPanelMode === "manual" && (
                  <div className="space-y-6 animate-fade-in">
                    {/* EDUCATIONAL / TRANSPARENCY ANSWER CARD */}
                    <div className="bg-emerald-50/50 border border-emerald-200/80 rounded-xl p-4 text-xs text-slate-700 space-y-3 text-left">
                      <h4 className="font-bold text-emerald-900 flex items-center gap-1.5 text-xs sm:text-sm">
                        <CheckCircle className="w-4.5 h-4.5 text-emerald-700" />
                        <span>Solusi Presensi WhatsApp 100% Gratis & Aman</span>
                      </h4>
                      <p className="leading-relaxed">
                        Sistem ini menggunakan metode siaran manual dengan HP atau WhatsApp Web Anda langsung. Anda tidak memerlukan token API berbayar, resmi, dan sangat aman dari risiko terblokir.
                      </p>
                      <p className="leading-relaxed font-semibold text-slate-800">
                        💡 Cara Kerja Asisten Siaran Gratis:
                      </p>
                      <ul className="list-disc pl-5 space-y-1 text-slate-600">
                        <li>Sistem menghasilkan format pesan dan tautan login unik otomatis untuk masing-masing karyawan.</li>
                        <li>Anda bisa menyalin semua pesan sekaligus, atau menggunakan <strong>Asisten Kirim Cepat</strong> untuk mengirim pesan satu per satu dalam beberapa klik secara runtut.</li>
                      </ul>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      
                      {/* CONFIGURATION */}
                      <div className="space-y-5">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider text-left">Pengaturan Pengiriman Gratis</h4>
                        
                        <div className="space-y-4">
                          {/* Provider Select */}
                          <div className="space-y-1.5 text-left">
                            <label className="text-xs font-bold text-slate-700">Metode Pengiriman WhatsApp</label>
                            <select
                              value={waMethod}
                              onChange={(e: any) => setWaMethod(e.target.value)}
                              className="w-full bg-slate-50 text-slate-950 text-xs px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium cursor-pointer"
                            >
                              <option value="desktop">Gunakan Aplikasi WhatsApp Desktop / HP (Aman & Cepat)</option>
                              <option value="web">Gunakan WhatsApp Web Browser (Buka di Tab Baru)</option>
                            </select>
                            <p className="text-[10px] text-slate-500 mt-1">
                              {waMethod === "desktop" 
                                ? "✓ Menggunakan protokol wa.me resmi untuk membuka aplikasi WhatsApp Desktop/HP Anda secara otomatis." 
                                : "✓ Membuka tab baru langsung ke web.whatsapp.com yang sudah terhubung dengan akun Anda."}
                            </p>
                          </div>

                          {/* AUTO REMINDER SYSTEM CONFIG */}
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5 text-left">
                                <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                                  <Clock className="w-4 h-4 text-indigo-500" />
                                  <span>Pengingat Kehadiran Harian (Reminder Prompt)</span>
                                </div>
                                <p className="text-[11px] text-slate-500 font-sans">Ingatkan karyawan yang belum absen menjelang jam kerja dimulai.</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setAutoReminderEnabled(!autoReminderEnabled)}
                                className={`w-11 h-6 rounded-full transition duration-200 focus:outline-none relative flex items-center ${
                                  autoReminderEnabled ? "bg-indigo-600" : "bg-slate-300"
                                }`}
                              >
                                <span 
                                  className={`w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 absolute ${
                                    autoReminderEnabled ? "translate-x-5.5" : "translate-x-0.5"
                                  }`}
                                />
                              </button>
                            </div>

                            {autoReminderEnabled && (
                              <div className="grid grid-cols-1 gap-3 pt-3 border-t border-slate-200 text-left">
                                <div className="space-y-1">
                                  <label className="text-[11px] font-bold text-slate-700">Waktu Pengingat</label>
                                  <div className="flex items-center gap-2">
                                    <select
                                      value={autoReminderHour}
                                      onChange={(e) => setAutoReminderHour(e.target.value)}
                                      className="bg-white text-slate-950 text-xs px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono font-bold cursor-pointer"
                                    >
                                      <option value="07:00">07:00 pagi</option>
                                      <option value="08:00">08:00 pagi</option>
                                      <option value="08:30">08:30 pagi</option>
                                      <option value="09:00">09:00 pagi (Standar)</option>
                                      <option value="10:00">10:00 pagi</option>
                                    </select>
                                    <span className="text-[11px] text-slate-500 font-medium">Zona waktu lokal</span>
                                  </div>
                                </div>

                                <div className="text-[11px] text-slate-500 bg-white border border-slate-200 p-2.5 rounded-lg leading-relaxed font-sans">
                                  📝 <strong>Cara Kerja:</strong> Dashboard akan memberikan indikator tanda seru merah setelah jam <strong>{autoReminderHour}</strong> jika masih ada karyawan aktif yang belum absen mandiri hari ini. Anda bisa mengklik tombol pengingat untuk meluncurkan asisten siaran kilat.
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* INFO PANEL ON BENEFITS */}
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
                        <div className="space-y-3 text-left">
                          <div className="flex items-center gap-1.5">
                            <CheckCircle className="w-4 h-4 text-indigo-500" />
                            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Keunggulan Metode Resmi Gratis</h4>
                          </div>
                          <div className="space-y-2 text-[11px] text-slate-600 leading-relaxed font-sans">
                            <div className="p-2 bg-white rounded-lg border border-slate-150 flex items-start gap-2">
                              <span className="text-emerald-600 font-bold">✓</span>
                              <span><strong>Tanpa Biaya Bulanan:</strong> Tidak perlu berlangganan pihak ketiga yang berbayar (rata-rata Rp 50.000 - Rp 150.000 per bulan).</span>
                            </div>
                            <div className="p-2 bg-white rounded-lg border border-slate-150 flex items-start gap-2">
                              <span className="text-emerald-600 font-bold">✓</span>
                              <span><strong>Sangat Aman (Anti-Banned):</strong> Menggunakan akun WhatsApp resmi Anda langsung, terverifikasi oleh aplikasi WhatsApp di HP Anda. Aman dari risiko banned.</span>
                            </div>
                            <div className="p-2 bg-white rounded-lg border border-slate-150 flex items-start gap-2">
                              <span className="text-emerald-600 font-bold">✓</span>
                              <span><strong>Mudah Digunakan:</strong> Tidak membutuhkan setup teknis yang rumit, konfigurasi webhook, server gateway, atau token sandi API yang membingungkan.</span>
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-slate-200 pt-3 mt-4 text-[10px] text-slate-500 leading-relaxed italic text-left">
                          ℹ️ Sistem siap digunakan dengan metode pengiriman resmi gratis. Silakan klik tombol di bawah untuk mulai mengirim.
                        </div>
                      </div>

                    </div>

                    {/* AUTOMATION TRIGGER BAR FOR TODAY'S ABSENT WORKERS */}
                    <div className="bg-slate-900 text-white rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="space-y-1 text-center sm:text-left">
                        <div className="inline-flex items-center gap-1 bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          <span>Asisten Kirim Gratis</span>
                        </div>
                        <h4 className="text-sm font-bold font-display">Kirim Pengingat Uang Makan Hari Ini</h4>
                        <p className="text-xs text-slate-400 max-w-lg leading-relaxed font-sans">
                          Kirim pesan pengingat berisi tautan absen mandiri unik dan PIN presensi hari ini ke seluruh karyawan aktif dengan asisten kirim gratis.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setBulkViewMode("list");
                          setShowBulkWA(true);
                        }}
                        className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-xs py-3 px-5 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-950 shrink-0"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>Luncurkan Panel Siaran Massal</span>
                      </button>
                    </div>
                  </div>
                )}

                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          </div>
        )}

        {/* TAB 1: ABSENSI UANG MAKAN HARIAN */}
        {activeTab === "absen" && (
          <div className="space-y-6" id="attendance_tab_view">
            
            {/* WEEKLY DATE FILTER & STATISTICS BAR */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              
              <div className="flex items-center gap-4">
                <button onClick={handlePrevWeek} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition cursor-pointer">
                  &larr; <span className="sr-only">Sebelumnya</span>
                </button>
                <div className="text-center md:text-left">
                  <div className="text-sm font-semibold text-slate-500">Mulai Senin s/d Jumat</div>
                  <h2 className="text-lg font-bold font-display text-slate-800 tracking-tight">
                    {new Date(weekStart).toLocaleDateString("id-ID", { day: "numeric", month: "long" })} s/d {new Date(weekEnd).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                  </h2>
                </div>
                <button onClick={handleNextWeek} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition cursor-pointer">
                  &rarr; <span className="sr-only">Berikutnya</span>
                </button>
              </div>

              {/* BENTO CUMULATIVE BOARD */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-600 rounded-lg text-white">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">Aktif Bekerja</div>
                    <div className="text-base font-bold text-indigo-950">
                      {workers.filter(w => w.isActive).length} Karyawan
                    </div>
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-600 rounded-lg text-white">
                    <CheckSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Kehadiran (Minggu Ini)</div>
                    <div className="text-base font-bold text-emerald-950">
                      {calculateTotalAttendanceCount()} Mandays
                    </div>
                  </div>
                </div>

                <div className="col-span-2 md:col-span-1 bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500 rounded-lg text-white">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Sisa Anggaran Uang Makan</div>
                    <div className="text-base font-bold text-amber-950">
                      Rp {calculateTotalWeeklyUangMakan().toLocaleString("id-ID")}
                    </div>
                  </div>
                </div>

              </div>

            </div>

            {/* MAIN ATTENDANCE TRACKER LAYOUT */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              
              <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">Daftar Kehadiran Harian Uang Makan</h3>
                  <p className="text-xs text-slate-500">Beri centang saat karyawan hadir di lapangan untuk mengkalkulasi insentif makan harian.</p>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                    Tarif Dasar: <strong className="text-slate-900">Rp {globalAllowance.toLocaleString("id-ID")}/Hari</strong>
                  </span>
                  
                  {currentWeekReportLog ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const liveRecords = attendanceRecords.filter(
                            (r) => r.attendance[weekStart] !== undefined
                          );
                          const liveReport: WeeklyReport = {
                            id: "LIVE",
                            weekStartDate: weekStart,
                            weekEndDate: weekEnd,
                            records: liveRecords,
                            isSubmitted: false,
                            submittedAt: new Date().toISOString(),
                          };
                          printWeeklyReportPDF(liveReport, workers, signatures);
                        }}
                        className="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-300 font-bold text-xs text-slate-700 px-4 py-2 rounded-lg shadow-sm hover:shadow transition duration-150 cursor-pointer"
                      >
                        <FileCheck className="w-4 h-4 text-indigo-600" />
                        <span>Cetak PDF Aktif</span>
                      </button>
                      <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-800">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <span>Minggu Ini Sudah Dilaporkan (Hari Jumat)</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const liveRecords = attendanceRecords.filter(
                            (r) => r.attendance[weekStart] !== undefined
                          );
                          const liveReport: WeeklyReport = {
                            id: "LIVE",
                            weekStartDate: weekStart,
                            weekEndDate: weekEnd,
                            records: liveRecords,
                            isSubmitted: false,
                            submittedAt: new Date().toISOString(),
                          };
                          printWeeklyReportPDF(liveReport, workers, signatures);
                        }}
                        className="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-300 font-bold text-xs text-slate-700 px-4 py-2 rounded-lg shadow-sm hover:shadow transition duration-150 cursor-pointer"
                      >
                        <FileCheck className="w-4 h-4 text-indigo-600" />
                        <span>Cetak PDF Aktif</span>
                      </button>
                      <button
                        onClick={handleSubmitFridayReport}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 font-bold text-xs text-white px-4 py-2 border border-transparent rounded-lg shadow-sm hover:shadow transition duration-150 cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        <span>Kirim Laporan Uang Makan Jumat</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* TABLE COMPONENT */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider">
                      <th className="py-3.5 px-4 w-12 text-center">No.</th>
                      <th className="py-3.5 px-4">Karyawan / Jabatan</th>
                      {weekDates.map((dateStr, idx) => {
                        const dayNameEn = new Date(dateStr).toLocaleDateString("en-US", { weekday: "long" }) as keyof typeof INDONESIAN_DAYS;
                        const dayNameId = INDONESIAN_DAYS[dayNameEn] || dayNameEn;
                        const splitted = dateStr.split("-");
                        const dateFormatted = `${splitted[2]}/${splitted[1]}`;

                        return (
                          <th key={dateStr} className="py-3.5 px-3 text-center min-w-[90px]">
                            <div>{dayNameId}</div>
                            <div className="text-[10px] text-slate-500 tracking-tight normal-case font-normal mt-0.5">{dateFormatted}</div>
                            <div className="mt-1.5 flex justify-center gap-1">
                              <button 
                                onClick={() => handleToggleAllForDay(dateStr, true)}
                                className="text-[9px] text-indigo-600 hover:underline px-1 py-0.5 bg-indigo-50 rounded"
                              >
                                All
                              </button>
                              <button 
                                onClick={() => handleToggleAllForDay(dateStr, false)}
                                className="text-[9px] text-slate-500 hover:underline px-1 py-0.5 bg-slate-100 rounded"
                              >
                                Reset
                              </button>
                            </div>
                          </th>
                        );
                      })}
                      <th className="py-3.5 px-4 text-center">Total Hadir</th>
                      <th className="py-3.5 px-4 text-right">Uang Makan</th>
                      <th className="py-3.5 px-4 text-center">Aksi Cepat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {workers.filter(w => w.isActive).length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-500 text-xs">
                          Belum ada karyawan aktif terdaftar. Silakan tambahkan karyawan baru di tab "Kelola Karyawan".
                        </td>
                      </tr>
                    ) : (
                      workers.filter(w => w.isActive).map((worker, i) => {
                        const rec = attendanceRecords.find(
                          (r) => r.workerId === worker.id && r.attendance[weekStart] !== undefined
                        );

                        // If record doesn't show yet
                        let totalDaysPresent = 0;
                        weekDates.forEach((date) => {
                          if (rec && rec.attendance[date]) totalDaysPresent++;
                        });

                        return (
                          <tr key={worker.id} className="hover:bg-slate-50/50 transition">
                            <td className="py-4 px-4 text-center text-xs font-mono text-slate-500">{i + 1}</td>
                            <td className="py-4 px-4">
                              <div className="font-semibold text-slate-900">{worker.name}</div>
                              <div className="text-xs text-slate-500">{worker.role}</div>
                            </td>
                            
                             {weekDates.map((dateStr) => {
                               const isChecked = rec ? rec.attendance[dateStr] : false;
                               const cStatus = rec?.customStatus?.[dateStr];
                               const reasonText = rec?.reasons?.[dateStr];

                               if (cStatus) {
                                 if (cStatus === "Sakit") {
                                   return (
                                     <td key={dateStr} className="py-4 px-3 text-center">
                                       <button
                                         onClick={() => setManageStatusModal({
                                           workerId: worker.id,
                                           workerName: worker.name,
                                           date: dateStr,
                                           status: "Sakit",
                                           reason: reasonText || ""
                                         })}
                                         className="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 font-extrabold flex items-center justify-center transition cursor-pointer mx-auto shadow-sm hover:scale-105 hover:bg-amber-300"
                                         title="Sakit (Klik untuk melihat detail)"
                                       >
                                        S
                                       </button>
                                     </td>
                                   );
                                 } else if (cStatus === "Izin") {
                                   return (
                                     <td key={dateStr} className="py-4 px-3 text-center">
                                       <button
                                         onClick={() => setManageStatusModal({
                                           workerId: worker.id,
                                           workerName: worker.name,
                                           date: dateStr,
                                           status: "Izin",
                                           reason: reasonText || ""
                                         })}
                                         className="w-8 h-8 rounded-xl bg-emerald-500 text-white font-extrabold flex items-center justify-center transition cursor-pointer mx-auto shadow-sm hover:scale-105 hover:bg-emerald-400"
                                         title="Izin (Klik untuk melihat detail)"
                                       >
                                        I
                                       </button>
                                     </td>
                                   );
                                 } else {
                                   // Meeting
                                   return (
                                     <td key={dateStr} className="py-4 px-3 text-center">
                                       <button
                                         onClick={() => setManageStatusModal({
                                           workerId: worker.id,
                                           workerName: worker.name,
                                           date: dateStr,
                                           status: "Meeting di Luar",
                                           reason: reasonText || ""
                                         })}
                                         className="min-w-[64px] h-8 px-2 rounded-xl bg-slate-950 text-white text-[10px] font-bold flex items-center justify-center transition cursor-pointer mx-auto shadow-sm hover:scale-105 hover:bg-slate-800"
                                         title="Meeting di Luar (Klik untuk melihat detail)"
                                       >
                                        Meeting
                                       </button>
                                     </td>
                                   );
                                 }
                               }

                               return (
                                 <td key={dateStr} className="py-4 px-3 text-center">
                                   <button
                                     onClick={() => setManageStatusModal({
                                       workerId: worker.id,
                                       workerName: worker.name,
                                       date: dateStr,
                                       status: isChecked ? "Hadir" : "Absen",
                                       reason: ""
                                     })}
                                     className={`w-8 h-8 rounded-xl border flex items-center justify-center transition cursor-pointer mx-auto ${
                                       isChecked
                                         ? "bg-emerald-600 border-transparent text-white"
                                         : "border-slate-300 hover:border-slate-400 bg-white text-slate-300 hover:text-slate-500"
                                     }`}
                                     title={`${isChecked ? 'Hadir' : 'Absen'} (Klik untuk mengubah status manual)`}
                                   >
                                     <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                       <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                     </svg>
                                   </button>
                                 </td>
                               );
                             })}

                            <td className="py-4 px-4 text-center font-bold font-display text-slate-800">
                              {totalDaysPresent} Hari
                            </td>
                            
                            <td className="py-4 px-4 text-right font-bold font-mono text-slate-900">
                              Rp {(totalDaysPresent * (rec?.dailyAllowance || globalAllowance)).toLocaleString("id-ID")}
                            </td>

                            <td className="py-4 px-4 text-center">
                              <div className="flex justify-center gap-1 text-xs">
                                <button 
                                  onClick={() => handleToggleAllForWorker(worker.id, true)}
                                  className="text-[10px] text-indigo-700 hover:bg-indigo-50 border border-indigo-100 rounded px-1.5 py-1 cursor-pointer"
                                >
                                  Penuh
                                </button>
                                <button 
                                  onClick={() => handleToggleAllForWorker(worker.id, false)}
                                  className="text-[10px] text-slate-500 hover:bg-slate-100 border border-slate-200 rounded px-1.5 py-1 cursor-pointer"
                                >
                                  Kosong
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

            </div>

            {/* PAST SUBMITTED REPORTS LOG (WEEKLY REPORTS ACCORDION) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
              <h3 className="text-base font-bold text-slate-900 font-display mb-4 flex items-center gap-1.5">
                <FileCheck className="w-5 h-5 text-indigo-600" />
                <span>Riwayat Laporan Jumat & Google Sheets Cloud Sync</span>
              </h3>
              
              {weeklyReports.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs text-balance">
                  Tidak ada riwayat submission mingguan sebelumnya. Laporan baru akan log di sini setiap Anda menekan tombol "Kirim Laporan Uang Makan Jumat".
                </div>
              ) : (
                <div className="space-y-3">
                  {weeklyReports.map((report) => {
                    const matchedWorkers = report.records.length;
                    const totalCost = report.records.reduce((sum, r) => {
                      const presentDays = Object.keys(r.attendance).filter(k => r.attendance[k] && (!r.customStatus || (r.customStatus[k] !== "Meeting" && r.customStatus[k] !== "Izin" && r.customStatus[k] !== "Sakit"))).length;
                      return sum + (presentDays * r.dailyAllowance);
                    }, 0);

                    return (
                      <div key={report.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold bg-indigo-100 text-indigo-800 px-2.5 py-1 rounded-md">{report.id}</span>
                            <span className="text-xs text-slate-500">Period: {report.weekStartDate} s/d {report.weekEndDate}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1.5">
                            Dilaporkan pada: <strong className="text-slate-800">{new Date(report.submittedAt || "").toLocaleString("id-ID")}</strong> 
                            &bull; Karyawan: <strong className="text-slate-800">{matchedWorkers} orang</strong>
                            &bull; Total Pengeluaran: <strong className="text-slate-800">Rp {totalCost.toLocaleString("id-ID")}</strong>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => printWeeklyReportPDF(report, workers, signatures)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-xs hover:shadow-sm"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Cetak PDF</span>
                          </button>

                          <button
                            onClick={() => triggerAttendanceExcelDownload(report.weekStartDate, report.weekEndDate, report.records, workers, `Rekap_Uang_Makan_${report.weekStartDate}.xlsx`)}
                            className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Excel</span>
                          </button>

                          <button
                            onClick={() => handleRemoveWeeklyReport(report.id)}
                            className="bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                            title="Hapus Laporan"
                          >
                            <Trash className="w-3.5 h-3.5 text-rose-500" />
                            <span>Hapus</span>
                          </button>

                          {report.sheetsUrl ? (
                            <a
                              href={report.sheetsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition"
                            >
                              <Globe className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Buka Google Sheets</span>
                            </a>
                          ) : (
                            isDriveConnected && (
                              <button
                                onClick={async () => {
                                  try {
                                    const sheetTitle = `Rekap Uang Makan Mingguan (${report.weekStartDate} s/d ${report.weekEndDate})`;
                                    const headers = ["No.", "Nama Karyawan", "Jabatan", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Total Hadir", "Tarif Harian (Rp)", "Total Uang Makan (Rp)"];
                                    
                                    const workerMap = new Map<string, Worker>(workers.map((w) => [w.id, w]));
                                    const rows = report.records.map((rec, index) => {
                                      const w = workerMap.get(rec.workerId);
                                      let totalHadir = 0;
                                      const dayStates = weekDates.map((date) => {
                                        const hasAtt = rec.attendance[date] || false;
                                        if (hasAtt) totalHadir++;
                                        return hasAtt ? "Hadir" : "Absen";
                                      });

                                      return [
                                        index + 1,
                                        w?.name || "Karyawan",
                                        w?.role || "-",
                                        ...dayStates,
                                        totalHadir,
                                        rec.dailyAllowance,
                                        totalHadir * rec.dailyAllowance
                                      ];
                                    });

                                    const sheetResult = await exportAttendanceToGoogleSheet(
                                      googleToken,
                                      sheetTitle,
                                      headers,
                                      rows
                                    );
                                    
                                    setWeeklyReports(weeklyReports.map(lg => lg.id === report.id ? { ...lg, sheetsUrl: sheetResult.spreadsheetUrl } : lg));
                                    alert("Sukses sinkronisasi rekap ke dokumen Google Spreadsheet baru!");
                                  } catch (err: any) {
                                    alert("Gagal sinkron: " + err.message);
                                  }
                                }}
                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <CloudUpload className="w-3.5 h-3.5" />
                                <span>Sync Drive</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {/* TAB 2: PETTY CASH PDF OCR PARSER TO EXCEL AND GOOGLE DRIVE */}
        {activeTab === "pettycash" && (
          <div className="space-y-6" id="pettycash_tab_view">
            
            {/* SUB-MENU SELECTION */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-0.5 text-left">
                <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <span>📂 Menu Analisis Dokumen AI</span>
                </h3>
                <p className="text-[11px] text-slate-500">Pilih jenis dokumen keuangan yang ingin Anda proses dan konversikan ke file Excel otomatis.</p>
              </div>
              <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setActiveSubTab("pettycash")}
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeSubTab === "pettycash"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>Petty Cash / Kas Kecil</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab("bankstatement")}
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeSubTab === "bankstatement"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Rekening Koran Bank</span>
                </button>
              </div>
            </div>

            {activeSubTab === "pettycash" && (
              <div className="space-y-6">
                {/* BRAND NEW PREMIUM PORTFOLIO DASHBOARD PANEL */}
                <div className="bg-slate-900 text-white rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                  {/* Left Side: Header & Context */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono font-extrabold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2.5 py-1 rounded-full uppercase tracking-widest">
                      Pertanggungjawaban Finansial Lapangan
                    </span>
                    <h2 className="text-xl font-extrabold font-display tracking-tight text-white mt-2">
                      Buku Pembukuan Kas Kecil (Petty Cash) Per Karyawan
                    </h2>
                    <p className="text-xs text-slate-400 max-w-xl">
                      Riwayat kwitansi & petty cash dikelompokkan secara terpisah untuk setiap pemegang dana taktis. Ubah pemegang laporan di menu panel sebelah kiri untuk menganalisis dan menghitung otomatis data masing-masing secara transparan.
                    </p>
                  </div>
                </div>

                {/* Grid stats cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-800">
                  <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-4">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Total Penerimaan Kas ({selectedUploadHolder})</span>
                    <span className="text-base font-bold text-emerald-400 block mt-1">
                      Rp {combinedIncome.toLocaleString("id-ID")}
                    </span>
                  </div>

                  <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-4">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Total Pengeluaran Kas ({selectedUploadHolder})</span>
                    <span className="text-base font-bold text-rose-400 block mt-1">
                      Rp {combinedExpense.toLocaleString("id-ID")}
                    </span>
                  </div>

                  <div className={`rounded-xl p-4 border ${combinedBalance < 0 ? 'bg-red-950/30 border-red-800/80 text-red-200' : 'bg-indigo-950/30 border-indigo-800/80 text-indigo-100'}`}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider block">Sisa Saldo Kas Terakhir ({selectedUploadHolder})</span>
                    <span className="text-lg font-extrabold block mt-1">
                      Rp {combinedBalance.toLocaleString("id-ID")}
                    </span>
                    
                    {/* Accumulated list for each holder */}
                    <div className="mt-3 pt-2.5 border-t border-slate-800/60 space-y-1.5 text-xs text-left">
                      <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Saldo Terakhir Tiap Pemegang:</div>
                      <div className="space-y-1 max-h-[100px] overflow-y-auto pr-1 scrollbar-thin">
                        {holderBalances.map(hb => (
                          <div key={hb.name} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className={`font-medium ${hb.name === selectedUploadHolder ? "text-indigo-300 font-bold" : "text-slate-300"}`}>
                              👤 {hb.name} {hb.name === selectedUploadHolder && "★"}
                            </span>
                            <span className={`font-mono font-bold ${hb.balance < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                              Rp {hb.balance.toLocaleString("id-ID")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* LEFT AREA: UPLOADER & WORKSPACE HISTORY */}
                <div className="lg:col-span-4 space-y-6">
                  
                  {/* FILE UPLOAD CARD */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                    
                    <h3 className="text-base font-bold text-slate-900 font-display mb-2 flex items-center gap-1.5">
                      <CloudUpload className="w-5 h-5 text-indigo-600" />
                      <span>Upload PDF Petty Cash</span>
                    </h3>
                    <p className="text-xs text-slate-500 mb-4 text-balance">
                      Unggah file laporan PDF atau JPG petty cash untuk membaca otomatis setiap transaksi menggunakan kecerdasan Gemini AI.
                    </p>

                    {/* Petty Cash Holder Selector */}
                    <div className="mb-4 space-y-1">
                      <label className="block text-xs font-bold text-slate-700">Pilih & Sortir Pemegang Petty Cash:</label>
                      <select
                        value={selectedUploadHolder}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedUploadHolder(val);
                          // Auto select first report of that holder if any
                          const holderReports = pettyCashReports.filter(r => r.summary?.workerName === val);
                          if (holderReports.length > 0) {
                            setActiveWorkspaceReport(holderReports[0]);
                          } else {
                            setActiveWorkspaceReport(null);
                          }
                        }}
                        className="w-full bg-slate-100 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      >
                        {pettyCashHolders.map((holder) => (
                          <option key={holder} value={holder}>👤 {holder}</option>
                        ))}
                      </select>
                    </div>
    
                    {/* Drag and Drop Zone */}
                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-indigo-500 transition relative bg-slate-50/50">
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-700">Tarik berkas ke sini atau Klik untuk memilih</p>
                      <p className="text-[10px] text-slate-500 mt-1">PDF, PNG, JPG maks 10MB</p>
                    </div>

                {fileToUpload && (
                  <div className="mt-4 p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-indigo-950 truncate max-w-[200px]">{fileToUpload.name}</div>
                      <div className="text-[10px] text-slate-500">{(fileToUpload.size / 1024).toFixed(1)} KB</div>
                    </div>
                    <button onClick={() => setFileToUpload(null)} className="text-xs text-red-500 hover:underline cursor-pointer">
                      Urung
                    </button>
                  </div>
                )}

                {parseError && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-1.5 text-xs text-red-800">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>{parseError}</div>
                  </div>
                )}

                <button
                  onClick={handleUploadAndParse}
                  disabled={isParsing || !fileToUpload}
                  className={`w-full mt-4 font-bold text-xs py-2.5 rounded-xl border flex items-center justify-center gap-2 transition duration-200 ${
                    isParsing 
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white border-transparent cursor-pointer shadow-sm shadow-indigo-100"
                  }`}
                >
                  {isParsing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Menganalisis dengan AI...</span>
                    </>
                  ) : (
                    <>
                      <FileCheck className="w-4 h-4" />
                      <span>Ekstrak Petty Cash PDF</span>
                    </>
                  )}
                </button>

                <div className="mt-4 text-[10px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-150 flex items-start gap-1.5 leading-relaxed">
                  <span>💡</span>
                  <span><strong>Tip:</strong> Pindai atau unggah struk kwitansi digital (format PDF atau Gambar JPG/PNG). AI akan mengekstrak tanggal, deskripsi, kategori, nominal, dan nama karyawan secara otomatis.</span>
                </div>

              </div>

              {/* KELOLA PEMEGANG PETTY CASH CARD */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 font-display mb-2 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-indigo-600" />
                  <span>Kelola Pemegang Petty Cash</span>
                </h3>
                <p className="text-[11px] text-slate-500 mb-4">
                  Tambahkan pemegang laporan petty cash baru untuk dikaitkan saat upload laporan PDF/Gambar kwitansi di atas.
                </p>

                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Nama pemegang baru..."
                      id="new_holder_input"
                      className="flex-1 bg-slate-50 border border-slate-250 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const target = e.currentTarget;
                          const newHolderName = target.value.trim();
                          if (newHolderName !== "") {
                            if (pettyCashHolders.includes(newHolderName)) {
                              alert("Nama pemegang ini sudah terdaftar.");
                              return;
                            }
                            setPettyCashHolders([...pettyCashHolders, newHolderName]);
                            setSelectedUploadHolder(newHolderName);
                            target.value = "";
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById("new_holder_input") as HTMLInputElement;
                        if (input && input.value.trim() !== "") {
                          const newHolderName = input.value.trim();
                          if (pettyCashHolders.includes(newHolderName)) {
                            alert("Nama pemegang ini sudah terdaftar.");
                            return;
                          }
                          setPettyCashHolders([...pettyCashHolders, newHolderName]);
                          setSelectedUploadHolder(newHolderName);
                          input.value = "";
                        }
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center justify-center shrink-0"
                    >
                      Tambah
                    </button>
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Daftar Pemegang Saat Ini:</div>
                    <div className="flex flex-wrap gap-1.5 max-h-[110px] overflow-y-auto pr-1">
                      {pettyCashHolders.map((holder) => (
                        <div key={holder} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-700 flex items-center gap-1.5">
                          <span>{holder}</span>
                          {holder !== "Suryo Pranoto" && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Hapus ${holder} dari daftar pemegang?`)) {
                                  setPettyCashHolders(pettyCashHolders.filter(h => h !== holder));
                                }
                              }}
                              className="text-slate-400 hover:text-red-500 font-bold font-sans hover:bg-slate-200 rounded px-0.5 cursor-pointer text-xs"
                            >
                              &times;
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* REPORT HISTORY LIST */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                
                <h3 className="text-sm font-bold text-slate-900 font-display mb-3">
                  Riwayat Kwitansi / Petty Cash PDF ({filteredReports.length})
                </h3>

                {filteredReports.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    Belum ada laporan petty cash untuk {selectedUploadHolder}.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {filteredReports.map((report) => (
                      <div
                        key={report.id}
                        onClick={() => setActiveWorkspaceReport(report)}
                        className={`w-full text-left p-2.5 rounded-xl border transition flex items-start gap-2.5 cursor-pointer group ${
                          activeWorkspaceReport?.id === report.id
                            ? "bg-slate-900 border-transparent text-white"
                            : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-900"
                        }`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            setActiveWorkspaceReport(report);
                          }
                        }}
                      >
                        <FileText className={`w-4 h-4 shrink-0 mt-0.5 ${activeWorkspaceReport?.id === report.id ? "text-indigo-400" : "text-indigo-600"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <div className={`text-xs font-semibold truncate ${activeWorkspaceReport?.id === report.id ? "text-white" : "text-slate-900"}`}>
                              {report.summary.workerName || "Karyawan Lapangan"}
                            </div>
                            <button
                              onClick={(e) => handleDeletePettyCashReport(report.id, e)}
                              className={`p-1 rounded-sm hover:bg-red-500/10 hover:text-red-500 transition cursor-pointer ${
                                activeWorkspaceReport?.id === report.id
                                  ? "text-slate-400 hover:text-red-400"
                                  : "text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
                              }`}
                              title="Hapus riwayat laporan"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className={`text-[10px] truncate max-w-[190px] ${activeWorkspaceReport?.id === report.id ? "text-slate-400" : "text-slate-500"}`}>
                            {report.fileName}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="text-[9px] bg-indigo-500/10 text-indigo-400 font-bold px-1.5 py-0.5 rounded">
                              {report.summary.reportMonth}
                            </span>
                            <span className={`text-[9px] ${activeWorkspaceReport?.id === report.id ? "text-slate-300" : "text-slate-500"}`}>
                              Rp {report.summary.totalExpense.toLocaleString("id-ID")}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              </div>

            </div>

            {/* RIGHT AREA: THE EXCEL & WORKSPACE COMPILER */}
            <div className="lg:col-span-8">
              {activeWorkspaceReport ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  
                  {/* WORKSPACE HEADER */}
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <div className="text-xs font-mono font-bold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-md inline-block mb-1.5">
                        WORKSPACE EDITOR : {activeWorkspaceReport.id}
                      </div>
                      <h3 className="text-lg font-bold font-display text-slate-900 tracking-tight flex items-center gap-1.5">
                        <span>Laporan Petty Cash: </span>
                        <span className="text-indigo-600 underline decoration-indigo-200">{activeWorkspaceReport.summary.reportMonth || "Semua Periode"}</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">Berkas Asal: <strong className="text-slate-700">{activeWorkspaceReport.fileName}</strong></p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {isDriveConnected ? (
                        <button
                          onClick={handleSaveWorkspaceToGoogleDrive}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-sm shadow-indigo-100"
                        >
                          <CloudUpload className="w-4 h-4" />
                          <span>Simpan ke Cloud Drive</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500 flex items-center gap-1 bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg">
                          <Globe className="w-3.5 h-3.5 text-slate-400" />
                          Google Drive Offline
                        </span>
                      )}

                      <button
                        onClick={handleLocalDownloadPettyCash}
                        className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-250 text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        <span>Unduh Excel (.xlsx)</span>
                      </button>
                    </div>
                  </div>

                  {/* SUMMARY CARDS OF EXTRACED DOC */}
                  {(() => {
                    const txs = activeWorkspaceReport.transactions;
                    const firstTx = txs[0];
                    const isSisaSaldo = firstTx && (
                      firstTx.description.toLowerCase().includes("sisa") || 
                      firstTx.description.toLowerCase().includes("awal") || 
                      firstTx.description.toLowerCase().includes("sebelum")
                    );
                    
                    const saldoAwal = isSisaSaldo 
                      ? (firstTx.type === TransactionType.INCOME ? firstTx.amount : -firstTx.amount) 
                      : 0;

                    const totalIncome = txs
                      .filter((_, idx) => !(idx === 0 && isSisaSaldo))
                      .reduce((sum, tx) => tx.type === TransactionType.INCOME ? sum + tx.amount : sum, 0);

                    const totalExpense = txs
                      .filter((_, idx) => !(idx === 0 && isSisaSaldo))
                      .reduce((sum, tx) => tx.type === TransactionType.EXPENSE ? sum + tx.amount : sum, 0);

                    const saldoAkhir = saldoAwal + totalIncome - totalExpense;

                    const verifiedTxs = txs.filter((t) => t.verified).length;
                    const totalTxs = txs.length;
                    const pctVerified = totalTxs > 0 ? Math.round((verifiedTxs / totalTxs) * 100) : 0;

                    return (
                      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 border-b border-slate-100 bg-slate-50/40">
                        {/* 1. NAMA PEKERJA */}
                        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                          <div className="text-[10px] font-semibold text-indigo-700 uppercase tracking-wider">Pemegang Pertanggungjawaban</div>
                          <select
                            value={activeWorkspaceReport.summary.workerName || ""}
                            onChange={(e) => {
                              const newName = e.target.value;
                              const updatedReport = {
                                ...activeWorkspaceReport,
                                summary: {
                                  ...activeWorkspaceReport.summary,
                                  workerName: newName
                                }
                              };
                              setActiveWorkspaceReport(updatedReport);
                              setPettyCashReports(pettyCashReports.map(r => r.id === updatedReport.id ? updatedReport : r));
                            }}
                            className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 mt-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                          >
                            <option value="">-- Pilih Pemegang Kas --</option>
                            {pettyCashHolders.map((holder) => (
                              <option key={holder} value={holder}>👤 {holder}</option>
                            ))}
                            {activeWorkspaceReport.summary.workerName && !pettyCashHolders.includes(activeWorkspaceReport.summary.workerName) && (
                              <option value={activeWorkspaceReport.summary.workerName}>👤 {activeWorkspaceReport.summary.workerName} (Ekstraksi/Lainnya)</option>
                            )}
                          </select>
                        </div>

                        {/* 2. SALDO AWAL */}
                        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                          <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1">
                            <DollarSign className="w-3.5 h-3.5 text-blue-500" />
                            <span>Saldo Awal</span>
                          </div>
                          <div className={`text-sm font-bold mt-1 ${saldoAwal < 0 ? "text-red-600" : "text-slate-900"}`}>
                            Rp {saldoAwal.toLocaleString("id-ID")}
                          </div>
                        </div>

                        {/* 3. TOTAL PEMASUKAN */}
                        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                          <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Total Pemasukan</span>
                          </div>
                          <div className="text-sm font-bold text-emerald-600 mt-1">Rp {totalIncome.toLocaleString("id-ID")}</div>
                        </div>

                        {/* 4. TOTAL PENGELUARAN */}
                        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                          <div className="text-[10px] font-semibold text-red-700 uppercase tracking-wider flex items-center gap-1">
                            <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                            <span>Total Pengeluaran</span>
                          </div>
                          <div className="text-sm font-bold text-red-600 mt-1">Rp {totalExpense.toLocaleString("id-ID")}</div>
                        </div>

                        {/* 5. SALDO AKHIR */}
                        <div className={`border rounded-xl p-3.5 shadow-2xs ${saldoAkhir < 0 ? "bg-red-50 border-red-200 text-red-900" : "bg-amber-50/50 border-amber-100 text-amber-900"}`}>
                          <div className="text-[10px] font-semibold uppercase tracking-wider">Saldo Akhir</div>
                          <div className="text-sm font-bold mt-1">
                            Rp {saldoAkhir.toLocaleString("id-ID")}
                          </div>
                        </div>

                        {/* 6. STATUS CEKLIS BON */}
                        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
                          <div>
                            <div className="text-[10px] font-semibold text-teal-700 uppercase tracking-wider flex items-center gap-1">
                              <FileCheck className="w-3.5 h-3.5 text-teal-500" />
                              <span>Pemeriksaan Bon</span>
                            </div>
                            <div className="text-xs font-bold text-slate-700 mt-1 flex items-center gap-1">
                              <span>{verifiedTxs} / {totalTxs} Cocok</span>
                              <span className="text-[10px] text-teal-600 font-mono font-normal">({pctVerified}%)</span>
                            </div>
                          </div>
                          {totalTxs > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                const allVerified = verifiedTxs === totalTxs;
                                const updated = activeWorkspaceReport.transactions.map((t) => ({
                                  ...t,
                                  verified: !allVerified,
                                }));
                                updateWorkspaceReportAndSync({
                                  ...activeWorkspaceReport,
                                  transactions: updated,
                                });
                              }}
                              className="text-[10px] font-bold text-teal-600 hover:text-teal-700 underline text-left mt-1 cursor-pointer transition-colors"
                            >
                              {verifiedTxs === totalTxs ? "Reset Semua" : "Ceklis Semua"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* EDITABLE TRANSACTIONS DATA TABLE */}
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tabel Transaksi Lapangan (Bisa Diedit/Ditambah)</h4>
                      <span className="text-[10px] text-indigo-600 bg-indigo-50 font-medium px-2 py-0.5 rounded-full">
                        {activeWorkspaceReport.transactions.length} Baris Transaksi
                      </span>
                    </div>

                    {swapStartIndex !== null && (
                      <div className="mb-4 bg-amber-50/90 border border-amber-200 text-amber-800 rounded-xl p-3 text-xs flex items-center justify-between shadow-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                            Mode Tukar Posisi Aktif:
                          </span>
                          <span>Klik tombol tukar (<ArrowUpDown className="w-3 h-3 inline" />) pada baris lain atau langsung klik baris mana saja untuk bertukar tempat dengan Baris #{swapStartIndex + 1}.</span>
                        </div>
                        <button 
                          onClick={() => setSwapStartIndex(null)} 
                          className="text-amber-700 hover:text-amber-900 font-bold px-2 py-1 bg-amber-100 hover:bg-amber-200 rounded-lg cursor-pointer transition-colors"
                        >
                          Batal
                        </button>
                      </div>
                    )}

                    {(() => {
                      // Pre-calculate running balances for all rows
                      const runningBalances: number[] = [];
                      let balanceAccumulator = 0;
                      activeWorkspaceReport.transactions.forEach((tx) => {
                        if (tx.type === TransactionType.INCOME) {
                          balanceAccumulator += tx.amount;
                        } else {
                          balanceAccumulator -= tx.amount;
                        }
                        runningBalances.push(balanceAccumulator);
                      });

                      return (
                        <div className="overflow-x-auto border border-slate-200 rounded-xl">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase">
                                <th className="p-3 w-10 text-center">No</th>
                                <th className="p-3 w-28">Tanggal</th>
                                <th className="p-3">Keterangan / Catatan Pengeluaran</th>
                                <th className="p-3 w-32 text-right text-emerald-700">Pemasukan (In)</th>
                                <th className="p-3 w-32 text-right text-red-700">Pengeluaran (Out)</th>
                                <th className="p-3 w-36 text-right">Saldo (Running)</th>
                                <th className="p-3 w-24 text-center text-slate-700">Ceklis Bon</th>
                                <th className="p-3 w-12 text-center">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-medium">
                              {activeWorkspaceReport.transactions.map((tx, index) => {
                                const rowSaldo = runningBalances[index];
                                return (
                                  <tr 
                                    key={index} 
                                    className={`hover:bg-slate-50/30 transition-colors ${
                                      swapStartIndex === index 
                                        ? "bg-amber-50/80 border-y border-amber-300 ring-1 ring-amber-300 ring-inset" 
                                        : swapStartIndex !== null
                                        ? "hover:bg-amber-50/20 cursor-pointer"
                                        : ""
                                    }`}
                                    onClick={() => {
                                      if (swapStartIndex !== null) {
                                        handleSelectSwapRow(index);
                                      }
                                    }}
                                  >
                                    <td className="p-3 text-center text-slate-400 font-mono">{index + 1}</td>
                                    <td className="p-3">
                                      <input
                                        type="text"
                                        value={tx.date}
                                        onChange={(e) => {
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { ...updated[index], date: e.target.value };
                                          updateWorkspaceReportAndSync({ ...activeWorkspaceReport, transactions: updated });
                                        }}
                                        className="w-full bg-transparent py-0.5 border-b border-transparent focus:border-slate-300 focus:outline-none"
                                      />
                                    </td>
                                    <td className="p-3">
                                      <input
                                        type="text"
                                        value={tx.description}
                                        onChange={(e) => {
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { ...updated[index], description: e.target.value };
                                          updateWorkspaceReportAndSync({ ...activeWorkspaceReport, transactions: updated });
                                        }}
                                        className="w-full bg-transparent py-0.5 border-b border-transparent focus:border-slate-300 focus:outline-none font-bold text-slate-800"
                                      />
                                    </td>

                                    
                                    {/* Column 5: Pemasukan */}
                                    <td className="p-3 text-right">
                                      <input
                                        type="number"
                                        placeholder="0"
                                        value={tx.type === TransactionType.INCOME ? (tx.amount || "") : ""}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value, 10) || 0;
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { 
                                            ...updated[index], 
                                            amount: val, 
                                            type: TransactionType.INCOME 
                                          };
                                          
                                          let inc = 0, exp = 0;
                                          updated.forEach(t => {
                                            if (t.type === TransactionType.INCOME) inc += t.amount;
                                            else exp += t.amount;
                                          });

                                          updateWorkspaceReportAndSync({
                                            ...activeWorkspaceReport,
                                            transactions: updated,
                                            summary: {
                                              ...activeWorkspaceReport.summary,
                                              totalIncome: inc,
                                              totalExpense: exp,
                                              remainingBalance: inc - exp
                                            }
                                          });
                                        }}
                                        className="w-full bg-transparent py-0.5 border-b border-transparent focus:border-emerald-300 text-right focus:outline-none font-bold text-emerald-600 font-mono"
                                      />
                                    </td>

                                    {/* Column 6: Pengeluaran */}
                                    <td className="p-3 text-right">
                                      <input
                                        type="number"
                                        placeholder="0"
                                        value={tx.type === TransactionType.EXPENSE ? (tx.amount || "") : ""}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value, 10) || 0;
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { 
                                            ...updated[index], 
                                            amount: val, 
                                            type: TransactionType.EXPENSE 
                                          };
                                          
                                          let inc = 0, exp = 0;
                                          updated.forEach(t => {
                                            if (t.type === TransactionType.INCOME) inc += t.amount;
                                            else exp += t.amount;
                                          });

                                          updateWorkspaceReportAndSync({
                                            ...activeWorkspaceReport,
                                            transactions: updated,
                                            summary: {
                                              ...activeWorkspaceReport.summary,
                                              totalIncome: inc,
                                              totalExpense: exp,
                                              remainingBalance: inc - exp
                                            }
                                          });
                                        }}
                                        className="w-full bg-transparent py-0.5 border-b border-transparent focus:border-red-300 text-right focus:outline-none font-bold text-red-600 font-mono"
                                      />
                                    </td>

                                    {/* Column 7: Saldo (Running) */}
                                    <td className={`p-3 text-right font-bold font-mono text-xs ${rowSaldo < 0 ? "text-red-600" : "text-slate-800"}`}>
                                      Rp {rowSaldo.toLocaleString("id-ID")}
                                    </td>

                                    {/* Column 8: Ceklis Bon */}
                                    <td className="p-3 text-center">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { ...updated[index], verified: !updated[index].verified };
                                          updateWorkspaceReportAndSync({ ...activeWorkspaceReport, transactions: updated });
                                        }}
                                        className={`w-6 h-6 rounded-lg flex items-center justify-center transition cursor-pointer mx-auto border ${
                                          tx.verified
                                            ? "bg-emerald-600 border-transparent text-white hover:bg-emerald-500 shadow-xs"
                                            : "border-slate-200 hover:border-slate-300 bg-white text-slate-300 hover:text-slate-500 shadow-2xs"
                                        }`}
                                        title={tx.verified ? "Bon sudah diperiksa (Klik untuk batalkan)" : "Klik untuk menandai bon sudah diperiksa"}
                                      >
                                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                                      </button>
                                    </td>

                                    <td className="p-3 text-center">
                                       <div className="flex items-center justify-center gap-1.5">
                                         <button
                                           type="button"
                                           onClick={(e) => {
                                             e.stopPropagation();
                                             handleSelectSwapRow(index);
                                           }}
                                           className={`p-1 rounded transition cursor-pointer ${
                                             swapStartIndex === index
                                               ? "bg-amber-500 text-white animate-pulse"
                                               : swapStartIndex !== null
                                               ? "bg-amber-100 text-amber-700 border border-amber-300 font-bold"
                                               : "text-slate-400 hover:text-amber-600 hover:bg-slate-100"
                                           }`}
                                           title={swapStartIndex === index ? "Batal atau klik baris lain untuk menukar posisi" : "Tukar Posisi Baris (Swap)"}
                                         >
                                           <ArrowUpDown className="w-3.5 h-3.5" />
                                         </button>
                                         <button
                                           type="button"
                                           disabled={index === 0}
                                           onClick={() => handleMoveWorkspaceTx(index, -1)}
                                           className={`p-1 rounded transition cursor-pointer ${
                                             index === 0 
                                               ? "text-slate-200 cursor-not-allowed opacity-30" 
                                               : "text-slate-400 hover:text-indigo-600 hover:bg-slate-100"
                                           }`}
                                           title="Geser ke Atas"
                                         >
                                           <ArrowUp className="w-3.5 h-3.5" />
                                         </button>
                                         <button
                                           type="button"
                                           disabled={index === activeWorkspaceReport.transactions.length - 1}
                                           onClick={() => handleMoveWorkspaceTx(index, 1)}
                                           className={`p-1 rounded transition cursor-pointer ${
                                             index === activeWorkspaceReport.transactions.length - 1 
                                               ? "text-slate-200 cursor-not-allowed opacity-30" 
                                               : "text-slate-400 hover:text-indigo-600 hover:bg-slate-100"
                                           }`}
                                           title="Geser ke Bawah"
                                         >
                                           <ArrowDown className="w-3.5 h-3.5" />
                                         </button>
                                         <button
                                           type="button"
                                           onClick={() => handleDeleteWorkspaceTx(index)}
                                           className="p-1 hover:bg-red-50 hover:text-red-650 rounded text-slate-400 transition cursor-pointer"
                                           title="Hapus"
                                         >
                                           <Trash className="w-3.5 h-3.5" />
                                         </button>
                                       </div>
                                     </td>
                                  </tr>
                                );
                              })}

                              {/* INLINE ROW TO ADD NEW TRANSACTION */}
                              <tr className="bg-indigo-50/20 font-bold">
                                <td className="p-3 text-center text-indigo-400 font-mono">+</td>
                                <td className="p-3">
                                  <input
                                    type="date"
                                    value={newTxDate}
                                    onChange={(e) => setNewTxDate(e.target.value)}
                                    className="w-full bg-white px-2 py-1 border border-slate-250 rounded text-[11px]"
                                  />
                                </td>
                                <td className="p-3">
                                  <input
                                    type="text"
                                    placeholder="Tambah baris manual (keterangan)..."
                                    value={newTxDesc}
                                    onChange={(e) => setNewTxDesc(e.target.value)}
                                    className="w-full bg-white px-2 py-1 border border-slate-250 rounded text-[11px]"
                                  />
                                </td>
                                
                                {/* Pemasukan input for New Transaction */}
                                <td className="p-3">
                                  <input
                                    type="number"
                                    placeholder="Masuk"
                                    value={newTxType === TransactionType.INCOME ? (newTxAmount || "") : ""}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10) || 0;
                                      setNewTxAmount(val);
                                      setNewTxType(TransactionType.INCOME);
                                    }}
                                    className="w-full bg-white px-2 py-1 border border-slate-250 rounded text-right text-[11px] font-bold text-emerald-600 font-mono"
                                  />
                                </td>

                                {/* Pengeluaran input for New Transaction */}
                                <td className="p-3">
                                  <input
                                    type="number"
                                    placeholder="Keluar"
                                    value={newTxType === TransactionType.EXPENSE ? (newTxAmount || "") : ""}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10) || 0;
                                      setNewTxAmount(val);
                                      setNewTxType(TransactionType.EXPENSE);
                                    }}
                                    className="w-full bg-white px-2 py-1 border border-slate-250 rounded text-right text-[11px] font-bold text-red-600 font-mono"
                                  />
                                </td>

                                {/* Readonly placeholder for cumulative Saldo in new row */}
                                <td className="p-3 text-right text-[11px] text-slate-400 font-mono">
                                  -
                                </td>

                                {/* Readonly placeholder for Ceklis Bon in new row */}
                                <td className="p-3 text-center text-[11px] text-slate-400">
                                  -
                                </td>

                                <td className="p-3 text-center">
                                  <button
                                    onClick={handleAddWorkspaceTx}
                                    className="p-1 bg-indigo-650 hover:bg-indigo-700 rounded-lg text-white transition cursor-pointer flex items-center justify-center mx-auto"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}

                    {/* GOOGLE DRIVE SYNC OUTCOME INJECTOR */}
                    {cloudSyncStatus.status !== "idle" && (
                      <div className={`mt-6 p-4 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                        cloudSyncStatus.status === "syncing" ? "bg-indigo-50 border-indigo-200 text-indigo-800" :
                        cloudSyncStatus.status === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
                        "bg-red-50 border-red-200 text-red-800"
                      }`}>
                        <div className="flex items-center gap-2">
                          <RefreshCw className={`w-4 h-4 shrink-0 ${cloudSyncStatus.status === "syncing" ? "animate-spin" : ""}`} />
                          <div>
                            {cloudSyncStatus.status === "syncing" && <p className="font-semibold">Menghubungkan ke API Google Drive & mengunggah berkas Excel...</p>}
                            {cloudSyncStatus.status === "success" && (
                              <div>
                                <p className="font-semibold">Berkas "{cloudSyncStatus.msg}" berhasil diupload!</p>
                                <p className="text-[10px] text-emerald-600">Disimpan rapi pada direktori Google Drive: "Laporan Petty Cash Lapangan &gt; Petty Cash - {activeWorkspaceReport.summary.reportMonth}"</p>
                              </div>
                            )}
                            {cloudSyncStatus.status === "error" && <p className="font-semibold">Gagal Sinkronisasi: {cloudSyncStatus.msg}</p>}
                          </div>
                        </div>

                        {activeWorkspaceReport.driveUrl && (
                          <a
                            href={activeWorkspaceReport.driveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white leading-none px-3.5 py-2 rounded-lg font-semibold transition flex items-center gap-1 shrink-0"
                          >
                            <span>Buka Excel di Drive</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    )}

                  </div>

                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs flex flex-col items-center justify-center h-full min-h-[450px]">
                  <FileText className="w-12 h-12 text-slate-300 mb-3" />
                  <h3 className="text-sm font-bold text-slate-700 tracking-tight">Belum Ada Petty Cash Workspace Aktif</h3>
                  <p className="text-xs text-slate-500 mt-2 max-w-md text-balance">
                    Unggah bungkusan struk atau laporan petty cash Anda dalam format PDF atau gambar di panel kiri. Sistem akan membaca seluruh data transaksi menggunakan kecerdasan buatan Gemini AI, kemudian mengorganisirnya ke dalam tabel interaktif untuk dikonversi menjadi file Excel dan disinkronisasikan ke Drive cloud secara otomatis.
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

        {/* SUBTAB 2: REKENING KORAN (BANK STATEMENT) */}
        {activeSubTab === "bankstatement" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="bank_statement_workspace_grid">
            
            {/* LEFT SIDE: CONTROL & HISTORY PANEL */}
            <div className="lg:col-span-4 space-y-6 text-left">
              
              {/* FILE UPLOAD CARD */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                <h3 className="text-base font-bold text-slate-900 font-display mb-2 flex items-center gap-1.5">
                  <CloudUpload className="w-5 h-5 text-indigo-600" />
                  <span>Upload Rekening Koran</span>
                </h3>
                <p className="text-xs text-slate-500 mb-4 text-balance leading-relaxed">
                  Unggah file PDF atau Gambar (PNG/JPG) rekening koran Anda. AI akan membaca nama bank, nomor rekening, pemilik, periode, dan merinci seluruh mutasi transaksi sesuai kepemilikan.
                </p>

                {/* PT & Bank Selection Fields */}
                <div className="space-y-3 mb-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Pilih Perusahaan (PT) <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedRkCompany}
                      onChange={(e) => setSelectedRkCompany(e.target.value)}
                      className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium cursor-pointer"
                    >
                      <option value="">-- Pilih PT --</option>
                      {rkCompanies.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Pilih Rekening Bank <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedRkBank}
                      onChange={(e) => setSelectedRkBank(e.target.value)}
                      className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium cursor-pointer"
                      disabled={!selectedRkCompany}
                    >
                      <option value="">-- Pilih Bank --</option>
                      {((rkCompanies.find(c => c.name === selectedRkCompany))?.banks || []).map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Drag and Drop Zone */}
                <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-indigo-500 transition relative bg-slate-50/50">
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    disabled={!selectedRkCompany || !selectedRkBank}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setBankStatementFile(e.target.files[0]);
                        setBankStatementParseError(null);
                      }
                    }}
                    className={`absolute inset-0 w-full h-full opacity-0 ${(!selectedRkCompany || !selectedRkBank) ? "cursor-not-allowed" : "cursor-pointer"}`}
                  />
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">Tarik berkas ke sini atau Klik untuk memilih</p>
                  <p className="text-[10px] text-slate-500 mt-1">PDF, PNG, JPG maks 10MB</p>
                  {(!selectedRkCompany || !selectedRkBank) && (
                    <div className="absolute inset-0 bg-slate-100/80 rounded-xl flex items-center justify-center p-4">
                      <p className="text-xs font-bold text-slate-600 text-center">Silakan pilih PT & Bank terlebih dahulu di atas</p>
                    </div>
                  )}
                </div>

                {bankStatementFile && (
                  <div className="mt-4 p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-indigo-950 truncate max-w-[180px]">{bankStatementFile.name}</div>
                      <div className="text-[10px] text-slate-500">{(bankStatementFile.size / 1024).toFixed(1)} KB</div>
                    </div>
                    <button onClick={() => setBankStatementFile(null)} className="text-xs text-red-500 hover:underline cursor-pointer">
                      Urung
                    </button>
                  </div>
                )}

                {bankStatementParseError && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-1.5 text-xs text-red-800">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>{bankStatementParseError}</div>
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleBankStatementUploadAndParse}
                    disabled={isParsingBankStatement || !bankStatementFile || !selectedRkCompany || !selectedRkBank}
                    className={`flex-1 font-bold text-xs py-2.5 rounded-xl border flex items-center justify-center gap-2 transition duration-200 ${
                      (isParsingBankStatement || !bankStatementFile || !selectedRkCompany || !selectedRkBank)
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white border-transparent cursor-pointer shadow-sm shadow-indigo-100"
                    }`}
                  >
                    {isParsingBankStatement ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Membaca dengan AI...</span>
                      </>
                    ) : (
                      <>
                        <FileCheck className="w-4 h-4" />
                        <span>Mulai Pembacaan AI</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleLoadDemoBankStatement}
                    disabled={isParsingBankStatement || !selectedRkCompany || !selectedRkBank}
                    title="Muat contoh demo rekening koran instan"
                    className={`font-bold text-xs px-3 rounded-xl transition flex items-center justify-center ${
                      (!selectedRkCompany || !selectedRkBank)
                        ? "bg-slate-50 text-slate-300 border border-slate-200 cursor-not-allowed"
                        : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 cursor-pointer"
                    }`}
                  >
                    <span>Demo ⚡</span>
                  </button>
                </div>

                <div className="mt-4 text-[10px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-150 flex items-start gap-1.5 leading-relaxed">
                  <span>💡</span>
                  <span><strong>Tip:</strong> Pilih Perusahaan (PT) dan bank yang sesuai sebelum memindai rekening koran Anda. AI akan mengelompokkan riwayat file persis pada area PT & Bank terpilih.</span>
                </div>

              </div>

              {/* KELOLA PERUSAHAAN & BANK REKENING KORAN */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 font-display mb-2 flex items-center gap-1.5">
                  <Building className="w-4 h-4 text-indigo-600" />
                  <span>Kelola Perusahaan & Bank</span>
                </h3>
                <p className="text-[11px] text-slate-500 mb-4">
                  Tambahkan daftar Perusahaan (PT) baru atau rekening bank baru di bawah naungan PT tersebut.
                </p>

                <div className="space-y-4">
                  {/* Tambah Perusahaan */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tambah PT Baru:</div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Nama PT Baru..."
                        value={newRkCompanyName}
                        onChange={(e) => setNewRkCompanyName(e.target.value)}
                        className="flex-1 bg-slate-50 border border-slate-250 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAddCompany();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleAddCompany}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center justify-center shrink-0"
                      >
                        Tambah PT
                      </button>
                    </div>
                  </div>

                  {/* Tambah Bank ke PT Terpilih */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Tambah Bank ke {selectedRkCompany.length > 25 ? selectedRkCompany.substring(0, 25) + "..." : selectedRkCompany || "PT"}:
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Contoh: BCA, BNI, Mandiri..."
                        value={newRkBankName}
                        onChange={(e) => setNewRkBankName(e.target.value)}
                        className="flex-1 bg-slate-50 border border-slate-250 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAddBank();
                          }
                        }}
                        disabled={!selectedRkCompany}
                      />
                      <button
                        type="button"
                        onClick={handleAddBank}
                        disabled={!selectedRkCompany}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Tambah Bank
                      </button>
                    </div>
                  </div>

                  {/* Daftar PT & Bank Terdaftar */}
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Daftar PT & Bank Aktif:</div>
                    <div className="space-y-1.5 max-h-[150px] overflow-y-auto pr-1">
                      {rkCompanies.map((comp) => (
                        <div key={comp.name} className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                          <div className="flex items-center justify-between gap-1.5 font-bold text-slate-800">
                            <span className="truncate">{comp.name}</span>
                            {rkCompanies.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeleteCompany(comp.name)}
                                className="text-slate-400 hover:text-red-500 font-sans font-bold text-xs shrink-0 cursor-pointer"
                                title="Hapus PT ini"
                              >
                                &times;
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {comp.banks.map((b) => (
                              <div key={b} className="bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 flex items-center gap-1">
                                <span>{b}</span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteBank(comp.name, b)}
                                  className="text-slate-400 hover:text-red-500 font-sans hover:bg-slate-100 rounded px-0.5 shrink-0 cursor-pointer"
                                  title="Hapus Bank ini"
                                >
                                  &times;
                                </button>
                              </div>
                            ))}
                            {comp.banks.length === 0 && (
                              <span className="text-[10px] text-slate-400 italic">Belum ada bank</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* BANK STATEMENT LIST / HISTORY CARD */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 font-display mb-1 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <span>Riwayat Rekening Koran ({filteredBankStatements.length})</span>
                </h3>
                <p className="text-[10px] text-slate-500 mb-3 truncate font-medium">
                  {selectedRkCompany || "Semua PT"} - {selectedRkBank || "Semua Bank"}
                </p>

                {filteredBankStatements.length === 0 ? (
                  <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <p className="text-xs text-slate-400">Belum ada dokumen untuk kombinasi ini.</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                    {filteredBankStatements.map((report) => (
                      <div
                        key={report.id}
                        onClick={() => setActiveBankStatement(report)}
                        className={`p-3 rounded-xl border transition text-left cursor-pointer flex items-center justify-between gap-2 ${
                          activeBankStatement?.id === report.id
                            ? "bg-indigo-50/70 border-indigo-200 text-indigo-950"
                            : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold truncate">{report.summary.bankName || "Rekening Koran"}</p>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">{report.fileName}</p>
                          <p className="text-[9px] text-slate-400 font-mono mt-1">
                            {new Date(report.uploadedAt).toLocaleDateString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteBankStatement(report.id, e)}
                          className="text-slate-400 hover:text-red-500 p-1.5 hover:bg-red-50 rounded-lg transition"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* RIGHT SIDE: VIEWPORT & LIVE WORKSPACE */}
            <div className="lg:col-span-8 space-y-6 text-left">
              {activeBankStatement ? (
                <div className="space-y-6">
                  
                  {/* BANK STATEMENT METADATA CARD */}
                  <div className="bg-slate-900 text-white rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div className="space-y-2 text-left">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[9px] font-mono font-extrabold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2.5 py-1 rounded-full uppercase tracking-widest">
                            HASIL PEMBACAAN REKENING KORAN
                          </span>
                          <span className="text-[9px] font-mono font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-full uppercase tracking-widest">
                            {activeBankStatement.companyName || "PT. Nusantara Mineral Sukses Abadi"}
                          </span>
                          <span className="text-[9px] font-mono font-extrabold bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2.5 py-1 rounded-full uppercase tracking-widest">
                            {activeBankStatement.bankName || activeBankStatement.summary.bankName || "BNI"}
                          </span>
                        </div>
                        <h2 className="text-lg font-extrabold font-display tracking-tight text-white mt-1.5 flex items-center gap-2">
                          <span>🏦 {activeBankStatement.summary.bankName}</span>
                        </h2>
                        <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                          Sistem berhasil mengenali format dokumen bank dan memisahkan mutasi debet/kredit secara aman untuk perusahaan <strong>{activeBankStatement.companyName || "PT. Nusantara Mineral Sukses Abadi"}</strong>.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {isDriveConnected ? (
                          <button
                            onClick={handleSaveBankStatementToGoogleDrive}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition shadow-md shadow-indigo-950/40 cursor-pointer flex items-center gap-1.5"
                          >
                            <CloudUpload className="w-4 h-4" />
                            <span>Simpan ke Cloud Drive</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 flex items-center gap-1 bg-slate-800 border border-slate-700 px-3.5 py-2.5 rounded-xl">
                            <Globe className="w-3.5 h-3.5 text-slate-500" />
                            Google Drive Offline
                          </span>
                        )}

                        <button
                          onClick={handleLocalDownloadBankStatement}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition shadow-md shadow-emerald-950/40 cursor-pointer flex items-center gap-1.5 animate-bounce"
                        >
                          <Download className="w-4 h-4" />
                          <span>Unduh Excel (.xlsx)</span>
                        </button>
                      </div>
                    </div>

                    {/* Metadata grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t border-slate-800 text-left">
                      <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3.5">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Nomor Rekening</span>
                        <span className="text-xs font-bold text-slate-200 block mt-1 truncate">
                          {activeBankStatement.summary.accountNumber || "Tidak Terdeteksi"}
                        </span>
                      </div>

                      <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3.5">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Pemilik Rekening</span>
                        <span className="text-xs font-bold text-slate-200 block mt-1 truncate">
                          {activeBankStatement.summary.accountHolder || "Tidak Terdeteksi"}
                        </span>
                      </div>

                      <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3.5">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Periode Laporan</span>
                        <span className="text-xs font-bold text-indigo-300 block mt-1 truncate">
                          {activeBankStatement.summary.period || "Seluruh Periode"}
                        </span>
                      </div>
                    </div>

                    {/* Financial stats row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 text-left">
                      <div className="bg-indigo-950/40 border border-indigo-500/20 rounded-xl p-3.5">
                        <span className="text-[10px] font-medium text-indigo-300 uppercase tracking-wider block">Saldo Awal</span>
                        <span className="text-sm font-extrabold text-white block mt-1">
                          Rp {activeBankStatement.summary.startingBalance ? activeBankStatement.summary.startingBalance.toLocaleString("id-ID") : "-"}
                        </span>
                      </div>

                      <div className="bg-emerald-950/40 border border-emerald-500/20 rounded-xl p-3.5">
                        <span className="text-[10px] font-medium text-emerald-300 uppercase tracking-wider block">Total Kredit (In)</span>
                        <span className="text-sm font-extrabold text-emerald-400 block mt-1">
                          Rp {activeBankStatement.summary.totalCredit.toLocaleString("id-ID")}
                        </span>
                      </div>

                      <div className="bg-rose-950/40 border border-rose-500/20 rounded-xl p-3.5">
                        <span className="text-[10px] font-medium text-rose-300 uppercase tracking-wider block">Total Debet (Out)</span>
                        <span className="text-sm font-extrabold text-rose-400 block mt-1">
                          Rp {activeBankStatement.summary.totalDebit.toLocaleString("id-ID")}
                        </span>
                      </div>

                      <div className="bg-indigo-950/40 border border-indigo-500/20 rounded-xl p-3.5">
                        <span className="text-[10px] font-medium text-indigo-300 uppercase tracking-wider block">Saldo Akhir</span>
                        <span className="text-sm font-extrabold text-indigo-300 block mt-1">
                          Rp {activeBankStatement.summary.endingBalance ? activeBankStatement.summary.endingBalance.toLocaleString("id-ID") : "-"}
                        </span>
                      </div>
                    </div>

                  </div>

                  {/* MUTASI TRANSAKSI TABLE */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 text-left">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Database className="w-4 h-4 text-indigo-600" />
                        <span>Daftar Transaksi Hasil Ekstraksi ({activeBankStatement.transactions.length})</span>
                      </h3>
                    </div>

                    <div className="overflow-x-auto border border-slate-150 rounded-xl">
                      <table className="w-full text-xs text-left text-slate-600">
                        <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase font-mono border-b border-slate-150">
                          <tr>
                            <th className="px-4 py-3 font-semibold">No</th>
                            <th className="px-4 py-3 font-semibold">Tanggal</th>
                            <th className="px-4 py-3 font-semibold">Transaksi</th>
                            <th className="px-4 py-3 font-semibold">Keterangan / Mutasi</th>
                            <th className="px-4 py-3 font-semibold text-right">Debet (Out)</th>
                            <th className="px-4 py-3 font-semibold text-right">Kredit (In)</th>
                            <th className="px-4 py-3 font-semibold text-right">Balance</th>
                            <th className="px-4 py-3 font-semibold min-w-[200px]">Pemakaian (Rekening Penerima)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeBankStatement.transactions.map((tx, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 transition">
                              <td className="px-4 py-3 font-mono text-[10px] text-slate-400">{idx + 1}</td>
                              <td className="px-4 py-3 font-semibold whitespace-nowrap text-slate-700">{tx.date}</td>
                              <td className="px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">{tx.transaksi || (tx.type === "DEBIT" ? "DEBET" : "KREDIT")}</td>
                              <td className="px-4 py-3 font-medium text-slate-800 leading-relaxed min-w-[200px]">{tx.description}</td>
                              <td className="px-4 py-3 font-bold text-right whitespace-nowrap text-rose-600">
                                {tx.type === "DEBIT" ? `Rp ${tx.amount.toLocaleString("id-ID")}` : "-"}
                              </td>
                              <td className="px-4 py-3 font-bold text-right whitespace-nowrap text-emerald-600">
                                {tx.type === "CREDIT" ? `Rp ${tx.amount.toLocaleString("id-ID")}` : "-"}
                              </td>
                              <td className="px-4 py-3 font-medium text-right text-slate-500 whitespace-nowrap">
                                {tx.balance ? `Rp ${tx.balance.toLocaleString("id-ID")}` : "-"}
                              </td>
                              <td className="px-4 py-3 min-w-[200px]">
                                <input
                                  type="text"
                                  placeholder="Masukkan pemakaian..."
                                  value={tx.pemakaian || ""}
                                  onChange={(e) => handleUpdateTransactionPemakaian(activeBankStatement.id, idx, e.target.value)}
                                  className="w-full bg-slate-50 border border-slate-250 rounded-lg px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 font-medium placeholder:text-slate-400 placeholder:italic transition-all"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs flex flex-col items-center justify-center h-full min-h-[450px]">
                  <CreditCard className="w-12 h-12 text-slate-300 mb-3 animate-pulse" />
                  <h3 className="text-sm font-bold text-slate-700 tracking-tight">Belum Ada Rekening Koran Aktif</h3>
                  <p className="text-xs text-slate-500 mt-2 max-w-md text-balance leading-relaxed">
                    Unggah file PDF rekening koran di panel kiri atau klik "Demo ⚡" untuk melihat demonstrasi instan pemisahan mutasi uang masuk (Kredit) dan uang keluar (Debet) otomatis menggunakan AI.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}

          </div>
        )}

        {/* TAB 3: WORKERS LIST & DEFAULTS MANAGER */}
        {activeTab === "workers" && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8" id="workers_tab_view">
            
            {/* MANAGE WORKERS LIST */}
            <div className="md:col-span-12 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
              
              <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between border-b border-slate-100 pb-4 mb-6 gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-base font-bold text-slate-900 tracking-tight font-display">Daftar Karyawan Lapangan</h3>
                    <button
                      onClick={() => setShowAddWorkerModal(true)}
                      className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-bold text-xs px-3 py-1.5 rounded-xl transition cursor-pointer shadow-md shadow-indigo-600/10"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Tambah Karyawan</span>
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm("Apakah Anda yakin ingin menghapus seluruh data karyawan? Tindakan ini tidak dapat dibatalkan.")) {
                          setWorkers([]);
                          localStorage.setItem("karyawan_uang_makan", JSON.stringify([]));
                        }
                      }}
                      className="flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs px-3 py-1.5 rounded-xl transition cursor-pointer border border-rose-200"
                      title="Kosongkan seluruh data karyawan lapangan"
                    >
                      <Trash className="w-3.5 h-3.5" />
                      <span>Bersihkan Semua</span>
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Daftar karyawan aktif yang berhak mendapatkan jatah uang makan harian.</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* GLOBAL ALLOWANCE CONFIG */}
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-1.5">
                    <label className="text-[11px] font-semibold text-slate-600">Meal Allowance (Rp/Hari):</label>
                    <input
                      type="number"
                      value={globalAllowance}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        setGlobalAllowance(val);
                        // Update active allowance records
                        setAttendanceRecords(attendanceRecords.map(r => 
                          r.attendance[weekStart] !== undefined ? { ...r, dailyAllowance: val } : r
                        ));
                      }}
                      className="w-24 bg-white border border-slate-250 rounded-lg px-2 py-0.5 text-xs text-center font-bold text-slate-800 font-mono focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  {/* DAILY ATTENDANCE PIN CONFIG */}
                  <div className="flex items-center gap-2 bg-indigo-50/60 border border-indigo-100 rounded-xl px-3 py-1.5">
                    <Lock className="w-3.5 h-3.5 text-indigo-500" />
                    <label className="text-[11px] font-semibold text-slate-600">PIN Harian:</label>
                    <input
                      type="text"
                      maxLength={6}
                      value={attendancePin}
                      onChange={(e) => setAttendancePin(e.target.value.replace(/\D/g, ""))}
                      className="w-16 bg-white border border-indigo-200 rounded-lg px-2 py-0.5 text-xs text-center font-bold text-indigo-700 font-mono focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      onClick={() => {
                        const randPin = String(Math.floor(1000 + Math.random() * 9000));
                        setAttendancePin(randPin);
                      }}
                      className="p-0.5 text-indigo-600 hover:text-indigo-800 transition rounded hover:bg-indigo-100/50"
                      title="Acak PIN Baru"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* MASS WA BROADCAST BUTTON */}
                  <button
                    onClick={() => setShowBulkWA(true)}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-xs px-3.5 py-2 rounded-xl transition cursor-pointer shadow-md shadow-emerald-600/10"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Bagikan Link Massal (WA)</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200">
                      <th className="py-3 px-4">Nama Karyawan</th>
                      <th className="py-3 px-4">No. Telepon / WA</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {workers.map((worker) => (
                      <tr key={worker.id} className="hover:bg-slate-50/50">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            {worker.photoUrl ? (
                              <img
                                src={worker.photoUrl}
                                alt={worker.name}
                                className="w-10 h-10 object-cover rounded-full border border-slate-200 shrink-0"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center font-bold text-indigo-500 text-xs shrink-0">
                                {worker.name.charAt(0)}
                              </div>
                            )}
                            <div>
                              <div className="font-bold text-slate-900">{worker.name}</div>
                              <div className="flex flex-col gap-0.5 mt-0.5">
                                <span className="text-[10px] font-mono text-slate-500 font-medium">ID: {worker.id}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {worker.phoneNumber && (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const customMsg = `Halo *${worker.name}*, silakan klik link berikut untuk melakukan absen mandiri uang makan *PT. Nusantara Mineral Sukses Abadi* hari ini:\n${window.location.origin}/?id=${worker.id}&pin=${attendancePin}\n\nYuk, langsung diklik link-nya ya! Pastikan untuk mengaktifkan dan menyetujui izin lokasi (GPS) di HP Anda, kemudian langsung tekan tombol check-in di dalam aplikasi.\n\nSetelah berhasil, Anda akan menerima pesan pop-up konfirmasi sukses. Selamat bekerja hari ini, dan besok jangan lupa untuk absen kembali ya agar uang makannya selalu lancar! Semangat terus dan jaga keselamatan kerja! 😊✨`;
                                    setSendingBotMsgId(worker.id);
                                    try {
                                      const res = await fetch("/api/wa/send-test", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          phone: worker.phoneNumber,
                                          message: customMsg,
                                        }),
                                      });
                                      const data = await res.json();
                                      if (data.success) {
                                        alert(`Pesan absensi berhasil dikirim secara otomatis oleh Bot ke ${worker.name}!`);
                                      } else {
                                        alert(`Gagal mengirim via Bot WA: ${data.error || "Pastikan Bot WhatsApp sudah terhubung di tab Ringkasan & Analitik."}`);
                                      }
                                    } catch (err) {
                                      console.error("Gagal mengirim pesan via Bot:", err);
                                      alert("Terjadi kesalahan jaringan saat mencoba mengirim pesan.");
                                    } finally {
                                      setSendingBotMsgId(null);
                                    }
                                  }}
                                  disabled={sendingBotMsgId === worker.id}
                                  className="text-[9px] bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-350 text-white px-1.5 py-0.5 rounded transition flex items-center gap-1 font-bold cursor-pointer"
                                  title="Kirim pesan absensi langsung menggunakan Bot WhatsApp Server"
                                >
                                  {sendingBotMsgId === worker.id ? (
                                    <div className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <Cpu className="w-2.5 h-2.5" />
                                  )}
                                  <span>{sendingBotMsgId === worker.id ? "Mengirim..." : "Kirim via Bot"}</span>
                                </button>

                                {(() => {
                                  const isSentToday = !!bulkSentStatus[worker.id];
                                  const customMsg = `Halo *${worker.name}*, silakan klik link berikut untuk melakukan absen mandiri uang makan *PT. Nusantara Mineral Sukses Abadi* hari ini:\n${window.location.origin}/?id=${worker.id}&pin=${attendancePin}\n\nYuk, langsung diklik link-nya ya! Pastikan untuk mengaktifkan dan menyetujui izin lokasi (GPS) di HP Anda, kemudian langsung tekan tombol check-in di dalam aplikasi.\n\nSetelah berhasil, Anda akan menerima pesan pop-up konfirmasi sukses. Selamat bekerja hari ini, dan besok jangan lupa untuk absen kembali ya agar uang makannya selalu lancar! Semangat terus dan jaga keselamatan kerja! 😊✨`;
                                  const encodedMsg = encodeURIComponent(customMsg);
                                  let phoneClean = worker.phoneNumber?.replace(/[^0-9]/g, "") || "";
                                  if (phoneClean.startsWith("0")) {
                                    phoneClean = "62" + phoneClean.slice(1);
                                  }
                                  const waUrl = waMethod === "desktop"
                                    ? `whatsapp://send?phone=${phoneClean}&text=${encodedMsg}`
                                    : `https://api.whatsapp.com/send?phone=${phoneClean}&text=${encodedMsg}`;

                                  if (isSentToday) {
                                    return (
                                      <span 
                                        className="text-[9px] bg-slate-100 text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded font-bold cursor-not-allowed select-none"
                                        title="Pengingat manual sudah dikirim hari ini (maksimal 1x per hari)"
                                      >
                                        ✓ Sudah Dikirim
                                      </span>
                                    );
                                  }

                                  return (
                                    <a
                                      href={waUrl}
                                      target={waMethod === "desktop" ? "_self" : "_blank"}
                                      rel="noreferrer"
                                      onClick={() => {
                                        setBulkSentStatus(prev => ({ ...prev, [worker.id]: true }));
                                      }}
                                      className="text-[9px] bg-emerald-600 hover:bg-emerald-700 text-white px-1.5 py-0.5 rounded transition flex items-center gap-1 font-bold cursor-pointer"
                                      title="Kirim pengingat secara manual via HP atau WhatsApp Web Anda"
                                    >
                                      <MessageSquare className="w-2.5 h-2.5" />
                                      <span>WA Manual</span>
                                    </a>
                                  );
                                })()}
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => handleToggleWorkerActive(worker.id)}
                            className={`px-3 py-1 text-xs font-semibold rounded-full cursor-pointer transition ${
                              worker.isActive
                                ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                            }`}
                          >
                            {worker.isActive ? "Aktif" : "Non-aktif"}
                          </button>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleOpenEditWorker(worker)}
                              className="p-1 text-slate-400 hover:text-indigo-600 transition cursor-pointer"
                              title="Edit Data Karyawan"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleRemoveWorker(worker.id)}
                              className="p-1 text-slate-400 hover:text-red-500 transition cursor-pointer"
                              title="Hapus Karyawan"
                            >
                              <Trash className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>

          </div>
        )}

        {/* MANAGE STATUS MODAL */}
        <AnimatePresence>
          {manageStatusModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden"
              >
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 font-display text-base">Atur Status Absen</h3>
                    <p className="text-xs text-slate-500 mt-0.5 font-sans">Ubah status manual untuk karyawan.</p>
                  </div>
                  <button 
                    onClick={() => setManageStatusModal(null)}
                    className="text-slate-400 hover:text-slate-600 font-semibold text-xs px-2.5 py-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer"
                  >
                    Batal
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Nama Karyawan</span>
                    <p className="text-sm font-semibold text-slate-900">{manageStatusModal.workerName}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Tanggal</span>
                      <p className="text-xs font-mono font-medium text-slate-800">{manageStatusModal.date}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Status Saat Ini</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {manageStatusModal.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {manageStatusModal.reason && (
                    <div className="space-y-1 pt-2 border-t border-slate-100">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Alasan Tertulis</span>
                      <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100 italic leading-relaxed whitespace-pre-wrap">
                        {manageStatusModal.reason}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2 pt-2 border-t border-slate-100">
                     <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1 block">Ubah Status Menjadi</span>
                     <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            const updated = attendanceRecords.map((r) => {
                              if (r.workerId === manageStatusModal.workerId && r.attendance[weekStart] !== undefined) {
                                const newCustomStatus = { ...(r.customStatus || {}) };
                                const newReasons = { ...(r.reasons || {}) };
                                delete newCustomStatus[manageStatusModal.date];
                                delete newReasons[manageStatusModal.date];
                                return { ...r, attendance: { ...r.attendance, [manageStatusModal.date]: true }, customStatus: newCustomStatus, reasons: newReasons };
                              }
                              return r;
                            });
                            setAttendanceRecords(updated);
                            setManageStatusModal(null);
                          }}
                          className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Hadir
                        </button>
                        <button
                          onClick={() => {
                            const updated = attendanceRecords.map((r) => {
                              if (r.workerId === manageStatusModal.workerId && r.attendance[weekStart] !== undefined) {
                                const newCustomStatus = { ...(r.customStatus || {}) };
                                const newReasons = { ...(r.reasons || {}) };
                                delete newCustomStatus[manageStatusModal.date];
                                delete newReasons[manageStatusModal.date];
                                return { ...r, attendance: { ...r.attendance, [manageStatusModal.date]: false }, customStatus: newCustomStatus, reasons: newReasons };
                              }
                              return r;
                            });
                            setAttendanceRecords(updated);
                            setManageStatusModal(null);
                          }}
                          className="w-full bg-slate-300 hover:bg-slate-400 text-slate-800 text-xs font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Absen
                        </button>
                        <button
                          onClick={() => {
                            const updated = attendanceRecords.map((r) => {
                              if (r.workerId === manageStatusModal.workerId && r.attendance[weekStart] !== undefined) {
                                const newCustomStatus = { ...(r.customStatus || {}) };
                                const newReasons = { ...(r.reasons || {}) };
                                newCustomStatus[manageStatusModal.date] = "Sakit";
                                newReasons[manageStatusModal.date] = "Diatur oleh admin";
                                return { ...r, attendance: { ...r.attendance, [manageStatusModal.date]: false }, customStatus: newCustomStatus, reasons: newReasons };
                              }
                              return r;
                            });
                            setAttendanceRecords(updated);
                            setManageStatusModal(null);
                          }}
                          className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 text-xs font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Sakit
                        </button>
                        <button
                          onClick={() => {
                            const updated = attendanceRecords.map((r) => {
                              if (r.workerId === manageStatusModal.workerId && r.attendance[weekStart] !== undefined) {
                                const newCustomStatus = { ...(r.customStatus || {}) };
                                const newReasons = { ...(r.reasons || {}) };
                                newCustomStatus[manageStatusModal.date] = "Izin";
                                newReasons[manageStatusModal.date] = "Diatur oleh admin";
                                return { ...r, attendance: { ...r.attendance, [manageStatusModal.date]: false }, customStatus: newCustomStatus, reasons: newReasons };
                              }
                              return r;
                            });
                            setAttendanceRecords(updated);
                            setManageStatusModal(null);
                          }}
                          className="w-full bg-emerald-300 hover:bg-emerald-400 text-emerald-900 text-xs font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Izin
                        </button>
                        <button
                          onClick={() => {
                            const updated = attendanceRecords.map((r) => {
                              if (r.workerId === manageStatusModal.workerId && r.attendance[weekStart] !== undefined) {
                                const newCustomStatus = { ...(r.customStatus || {}) };
                                const newReasons = { ...(r.reasons || {}) };
                                newCustomStatus[manageStatusModal.date] = "Meeting";
                                newReasons[manageStatusModal.date] = "Diatur oleh admin";
                                return { ...r, attendance: { ...r.attendance, [manageStatusModal.date]: false }, customStatus: newCustomStatus, reasons: newReasons };
                              }
                              return r;
                            });
                            setAttendanceRecords(updated);
                            setManageStatusModal(null);
                          }}
                          className="w-full col-span-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Meeting di Luar
                        </button>
                     </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ADD WORKER MODAL */}
        <AnimatePresence>
          {showAddWorkerModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-2xl max-w-md w-full shadow-xl border border-slate-200 overflow-hidden"
              >
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-150 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 font-display text-base">Tambah Karyawan Lapangan Baru</h3>
                    <p className="text-xs text-slate-500 mt-0.5 font-sans">Daftarkan karyawan lapangan baru untuk pencatatan uang makan.</p>
                  </div>
                  <button 
                    onClick={() => setShowAddWorkerModal(false)}
                    className="text-slate-400 hover:text-slate-600 font-semibold text-sm p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                  >
                    Batal
                  </button>
                </div>

                <form 
                  onSubmit={(e) => {
                    handleAddWorker(e);
                    setShowAddWorkerModal(false);
                  }} 
                  className="p-6 space-y-4"
                >
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Nama Lengkap Karyawan</label>
                    <input
                      type="text"
                      required
                      placeholder="Contoh: Ahmad Solihin"
                      value={newWorkerName}
                      onChange={(e) => setNewWorkerName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-250 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Nomor Telepon / WA</label>
                    <input
                      type="text"
                      placeholder="Contoh: 0812345678"
                      value={newWorkerPhoneNumber}
                      onChange={(e) => setNewWorkerPhoneNumber(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-250 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-100"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Daftarkan Karyawan Baru</span>
                  </button>
                </form>

              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* EDIT WORKER MODAL */}
        <AnimatePresence>
          {editingWorker && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-2xl max-w-md w-full shadow-xl border border-slate-200 overflow-hidden"
              >
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-150 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 font-display text-base">Edit Data Karyawan</h3>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono">ID: {editingWorker.id}</p>
                  </div>
                  <button 
                    onClick={() => setEditingWorker(null)}
                    className="text-slate-400 hover:text-slate-600 font-medium text-sm p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                  >
                    Batal
                  </button>
                </div>

                <form onSubmit={handleSaveEditWorker} className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Nama Lengkap</label>
                    <input
                      type="text"
                      required
                      value={editWorkerName}
                      onChange={(e) => setEditWorkerName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-250 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Nomor Telepon / WhatsApp</label>
                    <input
                      type="text"
                      placeholder="Contoh: 0812345678"
                      value={editWorkerPhoneNumber}
                      onChange={(e) => setEditWorkerPhoneNumber(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-250 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingWorker(null)}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg font-bold text-xs transition cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-100"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>Simpan Perubahan</span>
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* BULK WA SHARING OVERLAY MODAL */}
        <AnimatePresence>
          {showBulkWA && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden"
              >
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-150 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 font-display text-base">Bagikan Link Presensi Massal (WhatsApp)</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Kirim link absen mandiri harian ke seluruh karyawan aktif sekaligus.</p>
                  </div>
                  <button 
                    onClick={() => setShowBulkWA(false)}
                    className="text-slate-400 hover:text-slate-600 font-semibold text-xs py-1 px-2.5 bg-slate-100 hover:bg-slate-200 transition rounded-lg cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto text-left font-sans">
                  {/* Mode Selector */}
                  <div className="flex bg-slate-100 rounded-xl p-1 border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setBulkViewMode("list")}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all text-center cursor-pointer ${
                        bulkViewMode === "list"
                          ? "bg-white text-slate-900 shadow-sm border border-slate-250"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Daftar Semua Karyawan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkViewMode("step");
                        setCurrentStepIndex(0);
                      }}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
                        bulkViewMode === "step"
                          ? "bg-white text-slate-900 shadow-sm border border-slate-250"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <span>⚡ Mode Asisten Kirim Cepat</span>
                    </button>
                  </div>

                  {bulkViewMode === "step" ? (
                    (() => {
                      const activeWorkers = workers.filter(w => w.isActive);
                      if (activeWorkers.length === 0) {
                        return (
                          <div className="text-center py-8 text-slate-500 text-sm">
                            Tidak ada karyawan aktif yang perlu dikirimi pesan.
                          </div>
                        );
                      }
                      
                      const currentWorker = activeWorkers[currentStepIndex];
                      const link = `${window.location.origin}/?id=${currentWorker.id}&pin=${attendancePin}`;
                      const customMsg = `Halo *${currentWorker.name}*, silakan klik link berikut untuk melakukan absen mandiri uang makan *PT. Nusantara Mineral Sukses Abadi* hari ini:\n${link}\n\nYuk, langsung diklik link-nya ya! Pastikan untuk mengaktifkan dan menyetujui izin lokasi (GPS) di HP Anda, kemudian langsung tekan tombol check-in di dalam aplikasi.\n\nSetelah berhasil, Anda akan menerima pesan pop-up konfirmasi sukses. Selamat bekerja hari ini, dan besok jangan lupa untuk absen kembali ya agar uang makannya selalu lancar! Semangat terus dan jaga keselamatan kerja! 😊✨`;
                      const encodedMsg = encodeURIComponent(customMsg);
                      
                      let phoneClean = currentWorker.phoneNumber?.replace(/[^0-9]/g, "") || "";
                      if (phoneClean.startsWith("0")) {
                        phoneClean = "62" + phoneClean.slice(1);
                      }
                      
                      const waUrl = waMethod === "desktop"
                        ? `whatsapp://send?phone=${phoneClean}&text=${encodedMsg}`
                        : `https://api.whatsapp.com/send?phone=${phoneClean}&text=${encodedMsg}`;
                        
                      const isSent = !!bulkSentStatus[currentWorker.id];
                      
                      const handleSendAndNext = () => {
                        // Mark as sent
                        setBulkSentStatus(prev => ({ ...prev, [currentWorker.id]: true }));
                        // Open WhatsApp
                        if (currentWorker.phoneNumber) {
                          window.open(waUrl, waMethod === "desktop" ? "_self" : "_blank");
                        }
                        // Advance to next after a brief delay
                        if (currentStepIndex < activeWorkers.length - 1) {
                          setTimeout(() => {
                            setCurrentStepIndex(prev => prev + 1);
                          }, 350);
                        }
                      };
                      
                      const handleCopyAndNext = () => {
                        navigator.clipboard.writeText(customMsg);
                        setCopiedWorkerMsgId(currentWorker.id);
                        setBulkSentStatus(prev => ({ ...prev, [currentWorker.id]: true }));
                        setTimeout(() => {
                          setCopiedWorkerMsgId(null);
                          if (currentStepIndex < activeWorkers.length - 1) {
                            setCurrentStepIndex(prev => prev + 1);
                          }
                        }, 1200);
                      };

                      return (
                        <div className="space-y-6">
                          {/* Progress bar */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-semibold text-slate-600">Progres Pengiriman:</span>
                              <span className="font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full font-mono">
                                Karyawan {currentStepIndex + 1} dari {activeWorkers.length}
                              </span>
                            </div>
                            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                              <div 
                                className="bg-indigo-600 h-full transition-all duration-300"
                                style={{ width: `${((currentStepIndex + 1) / activeWorkers.length) * 100}%` }}
                              ></div>
                            </div>
                          </div>

                          {/* Worker Detail Card */}
                          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 md:p-6 space-y-4">
                            <div className="flex justify-between items-start">
                              <div className="space-y-1">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Sedang Diproses:</span>
                                <h4 className="text-base font-bold text-slate-950 font-display">{currentWorker.name}</h4>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md font-medium">
                                    {currentWorker.role}
                                  </span>
                                  {currentWorker.phoneNumber ? (
                                    <span className="text-[11px] font-mono text-slate-600 flex items-center gap-1">
                                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                                      {currentWorker.phoneNumber}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded italic font-medium">No HP Kosong</span>
                                  )}
                                </div>
                              </div>
                              
                              <div>
                                {isSent ? (
                                  <span className="text-[10px] font-bold text-emerald-750 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    Sudah Dikirim
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
                                    Belum Dikirim
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Message Preview */}
                            <div className="space-y-1.5">
                              <span className="text-[10px] text-slate-400 font-bold uppercase block">Pratinjau Pesan WA:</span>
                              <div className="bg-white border border-slate-250 rounded-xl p-3 text-[11px] font-mono text-slate-700 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
                                {customMsg}
                              </div>
                            </div>

                            {/* Method Switcher within Assist Card */}
                            <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                              <span className="font-semibold text-slate-500">Kirim Lewat:</span>
                              <div className="flex bg-slate-200/80 rounded-lg p-0.5 border border-slate-300/40">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWaMethod("desktop");
                                    localStorage.setItem("wa_method", "desktop");
                                  }}
                                  className={`px-2.5 py-0.5 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                                    waMethod === "desktop"
                                      ? "bg-white text-slate-900 shadow-xs"
                                      : "text-slate-500 hover:text-slate-850"
                                  }`}
                                >
                                  Aplikasi PC
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWaMethod("web");
                                    localStorage.setItem("wa_method", "web");
                                  }}
                                  className={`px-2.5 py-0.5 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                                    waMethod === "web"
                                      ? "bg-white text-slate-900 shadow-xs"
                                      : "text-slate-500 hover:text-slate-850"
                                  }`}
                                >
                                  WA Web
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Main Step Buttons */}
                          <div className="flex flex-col sm:flex-row gap-3">
                            <button
                              type="button"
                              onClick={handleCopyAndNext}
                              className="flex-1 py-3 px-4 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2 border border-slate-250 shadow-xs"
                            >
                              {copiedWorkerMsgId === currentWorker.id ? (
                                <Check className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <Copy className="w-4 h-4 text-slate-500" />
                              )}
                              <span>
                                {copiedWorkerMsgId === currentWorker.id ? "Pesan Berhasil Tersalin!" : "Salin Pesan & Lanjut"}
                              </span>
                            </button>

                            {currentWorker.phoneNumber ? (
                              <button
                                type="button"
                                onClick={handleSendAndNext}
                                className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-emerald-100"
                              >
                                <MessageSquare className="w-4 h-4" />
                                <span>Kirim WA & Lanjut</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="flex-1 py-3 px-4 bg-slate-100 text-slate-400 font-bold text-xs rounded-xl flex items-center justify-center gap-2 border border-slate-200 cursor-not-allowed"
                              >
                                <MessageSquare className="w-4 h-4" />
                                <span>Kirim WA (No HP Kosong)</span>
                              </button>
                            )}
                          </div>

                          {/* Step Navigation Controls */}
                          <div className="flex justify-between items-center pt-3 border-t border-slate-150 text-xs">
                            <button
                              type="button"
                              onClick={() => {
                                if (currentStepIndex > 0) {
                                  setCurrentStepIndex(prev => prev - 1);
                                }
                              }}
                              disabled={currentStepIndex === 0}
                              className={`py-1.5 px-3 rounded-lg border font-bold transition cursor-pointer ${
                                currentStepIndex === 0
                                  ? "text-slate-300 border-slate-100 cursor-not-allowed"
                                  : "text-slate-600 border-slate-250 hover:bg-slate-50"
                              }`}
                            >
                              Sebelumnya
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setBulkSentStatus({});
                                setCurrentStepIndex(0);
                                alert("Status progres berhasil di-reset!");
                              }}
                              className="text-slate-400 hover:text-slate-600 font-semibold cursor-pointer text-[11px]"
                            >
                              Reset Progres
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (currentStepIndex < activeWorkers.length - 1) {
                                  setCurrentStepIndex(prev => prev + 1);
                                }
                              }}
                              disabled={currentStepIndex === activeWorkers.length - 1}
                              className={`py-1.5 px-3 rounded-lg border font-bold transition cursor-pointer ${
                                currentStepIndex === activeWorkers.length - 1
                                  ? "text-slate-300 border-slate-100 cursor-not-allowed"
                                  : "text-slate-600 border-slate-250 hover:bg-slate-50"
                              }`}
                            >
                              Lewati / Selanjutnya
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <>
                      {/* Info Warning */}
                      <div className="p-4 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-800 space-y-2">
                        <div className="font-bold flex items-center gap-1.5 text-amber-900">
                          <AlertCircle className="w-4.5 h-4.5 text-amber-600" />
                          <span>Sistem Keamanan PIN Aktif & Pilihan Metode Pengiriman</span>
                        </div>
                        <p className="leading-relaxed">
                          Link absensi di bawah ini membutuhkan PIN Harian <strong className="font-mono text-amber-950 bg-amber-100 px-1.5 py-0.5 rounded">{attendancePin}</strong> agar karyawan dapat melakukan check-in.
                        </p>
                        <p className="leading-relaxed bg-white/60 p-2.5 rounded-lg border border-amber-100 text-[11px] text-slate-700">
                          💡 <strong>Tips Hemat Waktu:</strong> Pilih <strong>Aplikasi PC</strong> di bawah ini agar saat tombol diklik, browser tidak membuka tab baru melainkan langsung meluncurkan aplikasi WhatsApp Desktop Anda. Atau, gunakan tombol <strong>Salin Pesan</strong> untuk menyalin teks penuh beserta tautannya dan langsung menempelkannya (paste) ke WhatsApp tanpa membuka tab baru sama sekali!
                        </p>
                      </div>

                      {/* Actions Bar & Settings */}
                      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-slate-50 p-4 rounded-xl border border-slate-150">
                        <div>
                          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Total Karyawan Aktif</span>
                          <div className="text-xl font-bold text-slate-900">
                            {workers.filter(w => w.isActive).length} Orang
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5">
                          {/* Segmented Control in Modal */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">Metode Kirim WA:</span>
                            <div className="flex items-center gap-1 bg-slate-200/80 rounded-xl p-1 border border-slate-300/40">
                              <button
                                type="button"
                                onClick={() => {
                                  setWaMethod("desktop");
                                  localStorage.setItem("wa_method", "desktop");
                                }}
                                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                                  waMethod === "desktop"
                                    ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                                    : "text-slate-500 hover:text-slate-800"
                                }`}
                              >
                                Aplikasi PC
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setWaMethod("web");
                                  localStorage.setItem("wa_method", "web");
                                }}
                                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                                  waMethod === "web"
                                    ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                                    : "text-slate-500 hover:text-slate-800"
                                }`}
                              >
                                WA Web
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-transparent select-none font-bold block">Action:</span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  const activeWorkers = workers.filter(w => w.isActive);
                                  const compiled = activeWorkers.map(w => {
                                    const link = `${window.location.origin}/?id=${w.id}&pin=${attendancePin}`;
                                    return `Halo *${w.name}*, silakan klik link berikut untuk melakukan absen mandiri uang makan *PT. Nusantara Mineral Sukses Abadi* hari ini:\n${link}\n\nYuk, langsung diklik link-nya ya! Pastikan untuk mengaktifkan dan menyetujui izin lokasi (GPS) di HP Anda, kemudian langsung tekan tombol check-in di dalam aplikasi.\n\nSetelah berhasil, Anda akan menerima pesan pop-up konfirmasi sukses. Selamat bekerja hari ini, dan besok jangan lupa untuk absen kembali ya agar uang makannya selalu lancar! Semangat terus dan jaga keselamatan kerja! 😊✨`;
                                  }).join("\n\n-------------------------\n\n");
                                  navigator.clipboard.writeText(compiled);
                                  alert("Semua format pesan WhatsApp karyawan berhasil disalin ke clipboard!");
                                }}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 px-4 rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-100 cursor-pointer"
                              >
                                <FileCheck className="w-4 h-4" />
                                <span>Salin Semua Format</span>
                              </button>

                              {/* WhatsApp Quick Send Button */}
                              <button
                                onClick={() => {
                                  setBulkViewMode("step");
                                  setCurrentStepIndex(0);
                                }}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-4 rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-100 cursor-pointer"
                              >
                                <Zap className="w-4 h-4 text-amber-300" />
                                <span>Gunakan Asisten Kirim Cepat</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* List of Workers */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Daftar Pengiriman</h4>
                        <div className="border border-slate-150 rounded-xl overflow-hidden divide-y divide-slate-100">
                          {workers.filter(w => w.isActive).map((w) => {
                                    const link = `${window.location.origin}/?id=${w.id}&pin=${attendancePin}`;
                                    const customMsg = `Halo *${w.name}*, silakan klik link berikut untuk melakukan absen mandiri uang makan *PT. Nusantara Mineral Sukses Abadi* hari ini:\n${link}\n\nYuk, langsung diklik link-nya ya! Pastikan untuk mengaktifkan dan menyetujui izin lokasi (GPS) di HP Anda, kemudian langsung tekan tombol check-in di dalam aplikasi.\n\nSetelah berhasil, Anda akan menerima pesan pop-up konfirmasi sukses. Selamat bekerja hari ini, dan besok jangan lupa untuk absen kembali ya agar uang makannya selalu lancar! Semangat terus dan jaga keselamatan kerja! 😊✨`;
                            const encodedMsg = encodeURIComponent(customMsg);
                            
                            // Sanitize phone number (remove non-digits and replace leading '0' with '62' if necessary)
                            let phoneClean = w.phoneNumber?.replace(/[^0-9]/g, "") || "";
                            if (phoneClean.startsWith("0")) {
                              phoneClean = "62" + phoneClean.slice(1);
                            }
                            
                            const waUrl = waMethod === "desktop"
                              ? `whatsapp://send?phone=${phoneClean}&text=${encodedMsg}`
                              : `https://api.whatsapp.com/send?phone=${phoneClean}&text=${encodedMsg}`;
                            const isSent = !!bulkSentStatus[w.id];

                            return (
                              <div key={w.id} className="p-3.5 bg-white hover:bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-xs text-slate-900">{w.name}</span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                                    <Phone className="w-3 h-3 text-slate-400" />
                                    <span>{w.phoneNumber || "No HP Kosong"}</span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                                  {isSent ? (
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-lg">
                                      Sudah Dikirim
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg">
                                      Belum Dikirim
                                    </span>
                                  )}

                                  {/* Copy custom message */}
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(customMsg);
                                      setCopiedWorkerMsgId(w.id);
                                      setTimeout(() => setCopiedWorkerMsgId(null), 2000);
                                      setBulkSentStatus(prev => ({ ...prev, [w.id]: true }));
                                    }}
                                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] px-3 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer border border-slate-200"
                                    title="Salin pesan beserta link ke clipboard"
                                  >
                                    {copiedWorkerMsgId === w.id ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                                    )}
                                    <span>{copiedWorkerMsgId === w.id ? "Pesan Tersalin!" : "Salin Pesan"}</span>
                                  </button>

                                  {isSent ? (
                                    <span
                                      className="bg-slate-100 text-slate-400 border border-slate-200 font-bold text-[11px] px-3 py-1.5 rounded-lg select-none cursor-not-allowed"
                                      title="Pengingat manual sudah dikirim hari ini (maksimal 1x per hari)"
                                    >
                                      ✓ Sudah Dikirim
                                    </span>
                                  ) : w.phoneNumber ? (
                                    <a
                                      href={waUrl}
                                      target={waMethod === "desktop" ? "_self" : "_blank"}
                                      rel="noreferrer"
                                      onClick={() => {
                                        setBulkSentStatus(prev => ({ ...prev, [w.id]: true }));
                                      }}
                                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer"
                                    >
                                      <MessageSquare className="w-3.5 h-3.5" />
                                      <span>{waMethod === "desktop" ? "Kirim WA (App)" : "Kirim WA (Web)"}</span>
                                    </a>
                                  ) : (
                                    <span className="text-[11px] text-slate-400 italic">No HP Kosong</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* REKENING KORAN DELETE CONFIRMATION MODAL */}
        <AnimatePresence>
          {isDeleteConfirmModalOpen && (
            <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-4 z-50" id="delete_bank_statement_confirm_backdrop">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl max-w-md w-full shadow-2xl border-2 border-red-500 overflow-hidden"
                id="delete_bank_statement_confirm_modal"
              >
                {/* Header Warning */}
                <div className="bg-red-600 px-6 py-5 text-white flex items-center gap-3">
                  <div className="bg-red-700/80 p-2 rounded-full border border-red-400">
                    <AlertTriangle className="w-6 h-6 text-white animate-bounce" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-white font-display text-lg tracking-tight uppercase text-left">⚠️ PERINGATAN KERAS</h3>
                    <p className="text-red-100 text-[11px] font-medium text-left">Tindakan ini bersifat permanen!</p>
                  </div>
                </div>

                <div className="p-6 space-y-4 text-left font-sans">
                  <p className="text-slate-800 text-xs font-semibold leading-relaxed">
                    Apakah Anda yakin ingin menghapus data hasil analisis rekening koran ini dari riwayat?
                  </p>

                  {/* Document metadata block */}
                  {(() => {
                    const doc = bankStatements.find(s => s.id === bankStatementToDelete);
                    if (!doc) return null;
                    return (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] space-y-1 font-mono">
                        <div className="flex justify-between text-slate-500">
                          <span>📂 Berkas:</span>
                          <span className="font-bold text-slate-800 text-right truncate max-w-[200px]">{doc.fileName}</span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                          <span>🏦 Bank:</span>
                          <span className="font-bold text-indigo-700 text-right">{doc.summary.bankName}</span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                          <span>👤 Pemilik:</span>
                          <span className="font-bold text-slate-800 text-right">{doc.summary.accountHolder || "-"}</span>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-red-800 leading-relaxed font-semibold">
                      Tindakan ini akan menghapus seluruh rekaman analisis, data ringkasan bank, dan riwayat mutasi transaksi ini <strong>secara permanen</strong> dari penyimpanan browser lokal Anda. Data yang dihapus tidak dapat dipulihkan atau dikembalikan dengan cara apa pun.
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsDeleteConfirmModalOpen(false);
                        setBankStatementToDelete(null);
                      }}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl font-bold text-xs transition cursor-pointer border border-slate-250 text-center"
                    >
                      Batalkan
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmDeleteBankStatement}
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-red-100 text-center"
                    >
                      <Trash className="w-4 h-4" />
                      <span>Ya, Hapus Permanen</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </main>

      {/* FOOTER */}
      <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 mt-12 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center sm:text-left flex flex-col sm:flex-row justify-between items-center gap-4">
          <div>
            <div className="font-bold font-display text-white text-sm">PT. Nusantara Mineral Sukses Abadi</div>
            <p className="text-xs text-slate-500 mt-1">&copy; 2026 PT. Nusantara Mineral Sukses Abadi. Hak Cipta Dilindungi.</p>
          </div>
          <div className="text-xs text-slate-500 leading-relaxed max-w-sm sm:text-right">
            Disinkronisasikan otomatis dengan Google Cloud Workspace melalui API aman. Uang makan divalidasi berkala setiap Jumat siang.
          </div>
        </div>
      </footer>

    </div>
  );
}
