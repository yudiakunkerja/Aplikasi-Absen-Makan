import jsPDF from "jspdf";
import "jspdf-autotable";
import { WeeklyReport, Worker } from "../types";

export function generateWeeklyReportPDFBlob(report: WeeklyReport, workers: Worker[]): Blob {
  const doc = new jsPDF("l", "pt", "a4");

  // Title
  doc.setFontSize(16);
  doc.text("PT. NUSANTARA MINERAL SUKSES ABADI", 40, 40);
  doc.setFontSize(12);
  doc.text("Laporan Absensi & Uang Makan Mingguan Karyawan", 40, 60);

  // Table
  const workerMap = new Map(workers.map((w) => [w.id, w]));
  
  const uniqueRecordsMap = new Map();
  report.records.forEach((r) => {
    if (workerMap.has(r.workerId)) {
      if (!uniqueRecordsMap.has(r.workerId)) {
        uniqueRecordsMap.set(r.workerId, { ...r });
      } else {
        const existing = uniqueRecordsMap.get(r.workerId);
        existing.attendance = { ...existing.attendance, ...r.attendance };
        existing.customStatus = { ...existing.customStatus, ...r.customStatus };
      }
    }
  });
  const validRecords = Array.from(uniqueRecordsMap.values());

  // Meta
  doc.setFontSize(10);
  doc.text(`Periode: ${report.weekStartDate} s/d ${report.weekEndDate}`, 40, 90);
  doc.text(`Jumlah Karyawan: ${validRecords.length} Orang`, 40, 105);

  const totalCost = validRecords.reduce((sum, r) => {
    const presentDays = Object.keys(r.attendance).filter(k => r.attendance[k] && (!r.customStatus || (r.customStatus[k] !== "Meeting" && r.customStatus[k] !== "Izin" && r.customStatus[k] !== "Sakit"))).length;
    return sum + (presentDays * r.dailyAllowance);
  }, 0);

  doc.text(`Total Uang Makan: Rp ${totalCost.toLocaleString("id-ID")}`, 40, 120);

  const tableData = validRecords.map((r: any, index) => {
    const worker = workerMap.get(r.workerId);
    const presentDays = Object.keys(r.attendance).filter(k => r.attendance[k] && (!r.customStatus || (r.customStatus[k] !== "Meeting" && r.customStatus[k] !== "Izin" && r.customStatus[k] !== "Sakit"))).length;

    const getStatusTextForDay = (rec: any, idx: number) => {
      const keys = Object.keys(rec.attendance || {});
      const dateKey = keys[idx];
      if (!dateKey) return "Absen";
      
      const customVal = rec.customStatus?.[dateKey];
      if (customVal) {
        if (customVal === "Sakit") return "Sakit (S)";
        if (customVal === "Izin") return "Izin (I)";
        if (customVal === "Meeting") return "Meeting";
      }
      return rec.attendance[dateKey] ? "Hadir" : "Absen";
    };

    return [
      index + 1,
      worker?.name || "Karyawan Tidak Dikenal",
      worker?.role || "-",
      getStatusTextForDay(r, 0),
      getStatusTextForDay(r, 1),
      getStatusTextForDay(r, 2),
      getStatusTextForDay(r, 3),
      getStatusTextForDay(r, 4),
      presentDays,
      `Rp ${r.dailyAllowance.toLocaleString("id-ID")}`,
      `Rp ${(presentDays * r.dailyAllowance).toLocaleString("id-ID")}`
    ];
  });

  (doc as any).autoTable({
    startY: 140,
    head: [['No', 'Nama', 'Jabatan', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Hadir', 'Tarif', 'Total']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 4 }
  });

  return doc.output('blob');
}
