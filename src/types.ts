export enum TransactionType {
  EXPENSE = "EXPENSE",
  INCOME = "INCOME",
}

export interface Worker {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  bankName?: string;
  bankAccount?: string;
  phoneNumber?: string;
  nik?: string;
  photoUrl?: string;
  updatedAt?: number;
}

export interface DailyAttendance {
  date: string; // YYYY-MM-DD
  isPresent: boolean;
  notes?: string;
}

export interface AttendanceRecord {
  workerId: string;
  attendance: { [date: string]: boolean }; // date -> present status
  dailyAllowance: number; // e.g. Rp 50.000
  customStatus?: { [date: string]: "Sakit" | "Izin" | "Meeting" };
  reasons?: { [date: string]: string };
}

export interface WeeklyReport {
  id: string;
  weekStartDate: string; // Monday
  weekEndDate: string; // Friday
  records: AttendanceRecord[];
  isSubmitted: boolean;
  submittedAt?: string;
  sheetsUrl?: string; // If exported to Google Sheets
}

export interface PettyCashTransaction {
  date: string;
  description: string;
  category: string;
  amount: number;
  worker: string;
  type: TransactionType;
  verified?: boolean;
}

export interface PettyCashSummary {
  totalIncome: number;
  totalExpense: number;
  remainingBalance: number;
  workerName: string;
  reportMonth: string;
}

export interface PettyCashReport {
  id: string;
  fileName: string;
  uploadedAt: string;
  summary: PettyCashSummary;
  transactions: PettyCashTransaction[];
  driveFileId?: string; // If saved to Google Drive
  driveUrl?: string;
}

export interface BankStatementTransaction {
  date: string;
  transaksi?: string;
  description: string;
  rekeningPenerima?: string;
  amount: number;
  type: "DEBIT" | "CREDIT";
  balance?: number;
  pemakaian?: string;
}

export interface BankStatementSummary {
  bankName: string;
  accountNumber?: string;
  accountHolder?: string;
  period?: string;
  totalDebit: number;
  totalCredit: number;
  startingBalance?: number;
  endingBalance?: number;
}

export interface BankStatementReport {
  id: string;
  fileName: string;
  uploadedAt: string;
  summary: BankStatementSummary;
  transactions: BankStatementTransaction[];
  driveFileId?: string; // If saved to Google Drive
  driveUrl?: string;
  companyName?: string;
  bankName?: string;
}

