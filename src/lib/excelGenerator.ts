import * as XLSX from "xlsx";
import { PettyCashTransaction, PettyCashSummary, BankStatementTransaction, BankStatementSummary } from "../types";

export function generatePettyCashExcelBlob(
  transactions: PettyCashTransaction[],
  summary: PettyCashSummary
): Blob {
  // Sort with Saldo Awal first (using a copy to prevent in-place mutation concerns)
  const isSaldoAwal = (t: PettyCashTransaction) => 
    (t.category === "Saldo Awal" || 
     t.description.toLowerCase().includes("saldo awal"));

  const sorted = [...transactions];
  const saldoAwalTxs = sorted.filter(isSaldoAwal);
  const otherTxs = sorted.filter(t => !isSaldoAwal(t));
  
  otherTxs.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (isNaN(dateA)) return 1;
    if (isNaN(dateB)) return -1;
    return dateA - dateB;
  });
  
  const finalTxs = [...saldoAwalTxs, ...otherTxs];

  // Build rows using Array of Arrays (aoa) for complete control over formatting
  const data: any[][] = [
    ["PERTANGGUNG JAWABAN PETTY CASH LAPANGAN", "", "", "", "", "", ""],
    [`NAMA PEKERJA: ${summary.workerName || "Karyawan Lapangan"}`, "", "", "", "", "", ""],
    [`BULAN / PERIODE: ${summary.reportMonth || "-"}`, "", "", "", "", "", ""],
    ["", "", "", "", "", "", ""], // Empty row spacer
    ["No.", "Tanggal", "Catatan Pengeluaran", "Pemasukan (In)", "Pengeluaran (Out)", "Saldo (Running)", "Pemeriksaan (Ceklis)"]
  ];

  let runningBalance = 0;
  let totalIncome = 0;
  let totalExpense = 0;

  finalTxs.forEach((t, idx) => {
    const income = t.type === "INCOME" ? t.amount : 0;
    const expense = t.type === "EXPENSE" ? t.amount : 0;
    
    runningBalance += (income - expense);
    totalIncome += income;
    totalExpense += expense;

    data.push([
      idx + 1,
      t.date,
      t.description,
      income || "",
      expense || "",
      runningBalance,
      t.verified ? "✓" : ""
    ]);
  });

  // Add Totals Footer Row
  data.push(["", "", "TOTAL", totalIncome, totalExpense, runningBalance, ""]);

  // Create sheet
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set merges
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, // Row 0 merged across 7 columns
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }, // Row 1 merged across 7 columns
    { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }  // Row 2 merged across 7 columns
  ];

  // Set column widths
  const maxCols = [
    { wch: 6 },  // No
    { wch: 15 }, // Tanggal
    { wch: 45 }, // Catatan Pengeluaran
    { wch: 18 }, // Pemasukan
    { wch: 18 }, // Pengeluaran
    { wch: 20 }, // Saldo
    { wch: 18 }, // Pemeriksaan (Ceklis)
  ];
  ws["!cols"] = maxCols;

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Laporan Petty Cash");

  // Write file as binary buffer
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  
  // Return blob
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function triggerExcelDownload(
  transactions: PettyCashTransaction[],
  summary: PettyCashSummary,
  fileName: string = "Laporan_Petty_Cash.xlsx"
) {
  const blob = generatePettyCashExcelBlob(transactions, summary);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export function generateBankStatementExcelBlob(
  transactions: BankStatementTransaction[],
  summary: BankStatementSummary
): Blob {
  // Format data for sheet Row structure exactly matching user requested layout:
  // TANGGAL | TRANSAKSI | KETERANGAN | REKENING PENERIMA | DEBET | KREDIT | BALANCE
  const rows = transactions.map((t) => ({
    "TANGGAL": t.date,
    "TRANSAKSI": t.transaksi || (t.type === "DEBIT" ? "DEBET" : "KREDIT"),
    "KETERANGAN": t.description,
    "REKENING PENERIMA": t.pemakaian || t.rekeningPenerima || "",
    "DEBET": t.type === "DEBIT" ? t.amount : "",
    "KREDIT": t.type === "CREDIT" ? t.amount : "",
    "BALANCE": t.balance || "",
  }));

  // Create sheet
  const ws = XLSX.utils.json_to_sheet(rows);

  // Set column widths
  const maxCols = [
    { wch: 15 }, // TANGGAL
    { wch: 18 }, // TRANSAKSI
    { wch: 50 }, // KETERANGAN
    { wch: 30 }, // REKENING PENERIMA (Repurposed for Pemakaian/Usage)
    { wch: 18 }, // DEBET
    { wch: 18 }, // KREDIT
    { wch: 18 }, // BALANCE
  ];
  ws["!cols"] = maxCols;

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Mutasi Transaksi");

  // Create metadata / summary sheet
  const summaryRows = [
    ["HASIL PEMBACAAN REKENING KORAN", ""],
    ["", ""],
    ["Nama Bank:", summary.bankName],
    ["Nomor Rekening:", summary.accountNumber || "-"],
    ["Pemilik Rekening:", summary.accountHolder || "-"],
    ["Periode Laporan:", summary.period || "-"],
    ["", ""],
    ["TOTAL DEBET (PENGELUARAN):", summary.totalDebit],
    ["TOTAL KREDIT (PEMASUKAN):", summary.totalCredit],
    ["SALDO AWAL:", summary.startingBalance || "-"],
    ["SALDO AKHIR:", summary.endingBalance || "-"],
    ["Dibuat Tanggal:", new Date().toLocaleDateString("id-ID")],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary["!cols"] = [{ wch: 30 }, { wch: 35 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan Rekening");

  // Write file as binary buffer
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  
  // Return blob
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function triggerBankStatementExcelDownload(
  transactions: BankStatementTransaction[],
  summary: BankStatementSummary,
  fileName: string = "Hasil_Pembacaan_Rekening_Koran.xlsx"
) {
  const blob = generateBankStatementExcelBlob(transactions, summary);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

