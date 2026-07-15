import * as XLSX from "xlsx";
import { AttendanceRecord, Worker, WeeklyReport } from "../types";

function formatLocalYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getSafeDates(startDateStr: string): string[] {
  const dates: string[] = [];
  const parts = startDateStr.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  const current = new Date(year, month, day);
  for (let i = 0; i < 5; i++) {
    dates.push(formatLocalYYYYMMDD(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export function printWeeklyReportPDF(report: WeeklyReport, workers: Worker[], signatures?: { [workerId: string]: string }) {
  const dates = getSafeDates(report.weekStartDate);
  const dayNames = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];
  const workerMap = new Map(workers.map((w) => [w.id, w]));

  // Fix duplicated validRecords by grabbing the first one for each workerId
  const uniqueRecordsMap = new Map();
  report.records.forEach((r) => {
    if (workerMap.has(r.workerId)) {
      if (!uniqueRecordsMap.has(r.workerId)) {
        uniqueRecordsMap.set(r.workerId, { ...r });
      } else {
        // Merge attendance and customStatus just in case they were split across multiple records
        const existing = uniqueRecordsMap.get(r.workerId);
        existing.attendance = { ...existing.attendance, ...r.attendance };
        existing.customStatus = { ...existing.customStatus, ...r.customStatus };
      }
    }
  });
  const validRecords = Array.from(uniqueRecordsMap.values());

  const totalCost = validRecords.reduce((sum, r) => {
    let presentDaysForThisWeek = 0;
    dates.forEach((d) => {
      if (r.attendance[d] === true && (!r.customStatus || (r.customStatus[d] !== "Meeting" && r.customStatus[d] !== "Izin" && r.customStatus[d] !== "Sakit"))) presentDaysForThisWeek++;
    });
    return sum + (presentDaysForThisWeek * r.dailyAllowance);
  }, 0);

  const tableRows = validRecords.map((record: any, index) => {
    const worker = workerMap.get(record.workerId);
    let totalAttendance = 0;
    
    const dayCells = dates.map((date) => {
      const customVal = record.customStatus?.[date];
      if (customVal) {
        if (customVal === "Sakit") {
          return `<td class="text-center font-bold" style="color: #ea580c; font-size: 8px; background-color: #fdf8f6;">Sakit</td>`;
        } else if (customVal === "Izin") {
          return `<td class="text-center font-bold" style="color: #0284c7; font-size: 8px; background-color: #f0f9ff;">Izin</td>`;
        } else if (customVal === "Meeting") {
          return `<td class="text-center font-bold" style="color: #0f172a; font-size: 8px; background-color: #f8fafc;">Meeting</td>`;
        }
      }

      const status = record.attendance[date] as any;
      if (status === true) {
        totalAttendance++;
        return `<td class="text-center font-bold" style="color: #16a34a; font-size: 8px;">Hadir</td>`;
      } else if (status === "Sakit") {
        return `<td class="text-center font-bold" style="color: #ea580c; font-size: 8px; background-color: #fdf8f6;">Sakit</td>`;
      } else if (status === "Izin") {
        return `<td class="text-center font-bold" style="color: #0284c7; font-size: 8px; background-color: #f0f9ff;">Izin</td>`;
      } else {
        return `<td class="text-center" style="color: #94a3b8; font-size: 8px;">-</td>`;
      }
    }).join("");

    const totalAllowance = totalAttendance * record.dailyAllowance;

    const workerSignatureUrl = signatures?.[record.workerId];
    let signatureContent = "";
    if (workerSignatureUrl) {
      signatureContent = `
        <div style="display: flex; flex-direction: column; align-items: ${index % 2 === 0 ? 'flex-start' : 'flex-end'}; padding: 1px 4px;">
          <span style="font-size: 6.5px; color: #64748b; font-weight: bold; margin-bottom: 1px;">${index + 1}. Paraf</span>
          <img src="${workerSignatureUrl}" style="max-height: 24px; max-width: 80px; object-fit: contain; background: transparent; mix-blend-mode: multiply;" />
        </div>
      `;
    } else {
      signatureContent = index % 2 === 0 
        ? `<div style="text-align: left; padding-left: 4px; font-size: 7.5px; font-weight: bold; color: #475569;">${index + 1}. .............</div>`
        : `<div style="text-align: right; padding-right: 4px; font-size: 7.5px; font-weight: bold; color: #475569;">${index + 1}. .............</div>`;
    }

    return `
      <tr>
        <td class="text-center font-mono" style="color: #64748b; font-size: 8px; padding: 4px 2px;">${index + 1}</td>
        <td style="padding: 4px 6px;">
          <div style="font-weight: bold; color: #0f172a; font-size: 8.5px; line-height: 1.1;">${worker?.name || "Karyawan Tidak Dikenal"}</div>
          <div style="font-size: 7.5px; color: #64748b; margin-top: 1px;">${worker?.role || "-"}</div>
        </td>
        ${dayCells}
        <td class="text-center font-bold" style="background-color: #f8fafc; font-size: 8.5px; padding: 4px 2px;">${totalAttendance} H</td>
        <td class="text-right font-mono" style="font-size: 8px; padding: 4px 4px;">${record.dailyAllowance.toLocaleString("id-ID")}</td>
        <td class="text-right font-mono font-bold" style="background-color: #f8fafc; font-size: 8.5px; padding: 4px 4px;">${totalAllowance.toLocaleString("id-ID")}</td>
        <td style="width: 100px; vertical-align: middle; padding: 2px; background-color: #fff;">
          ${signatureContent}
        </td>
      </tr>
    `;
  }).join("");

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Gagal membuka jendela cetak. Pastikan pop-up browser tidak diblokir.");
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>Rekap Uang Makan Mingguan - ${report.weekStartDate}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #1e293b;
            padding: 0;
            margin: 0;
            font-size: 9px;
            line-height: 1.35;
            background-color: #fff;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 15px;
            margin-bottom: 12px;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 8px;
            text-align: left;
          }
          .logo {
            height: 52px;
            width: auto;
            object-fit: contain;
          }
          .header-text {
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .header h1 {
            margin: 0 0 2px 0;
            font-size: 13px;
            color: #1e3a8a;
            font-weight: 800;
            letter-spacing: 0.3px;
            line-height: 1.2;
          }
          .header h2 {
            margin: 0;
            font-size: 10px;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            line-height: 1.2;
          }
          .meta-container {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px 12px;
          }
          .meta-table {
            border-collapse: collapse;
            width: 48%;
          }
          .meta-table td {
            padding: 2px 0;
            font-size: 9px;
            vertical-align: top;
          }
          .meta-label {
            font-weight: 600;
            width: 120px;
            color: #475569;
          }
          .meta-value {
            color: #0f172a;
          }
          .report-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          .report-table th {
            background-color: #f1f5f9;
            border: 1px solid #cbd5e1;
            padding: 5px 3px;
            font-weight: 700;
            font-size: 8px;
            text-transform: uppercase;
            color: #334155;
            text-align: center;
          }
          .report-table td {
            border: 1px solid #cbd5e1;
            padding: 4px 4px;
            font-size: 8px;
            vertical-align: middle;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .font-bold { font-weight: bold; }
          .font-mono { font-family: monospace; }
          
          .signature-container {
            display: flex;
            justify-content: space-between;
            margin-top: 25px;
            page-break-inside: avoid;
            padding: 0 10px;
          }
          .signature-box {
            width: 220px;
            text-align: center;
          }
          .signature-title {
            font-size: 8.5px;
            margin-bottom: 45px;
            color: #475569;
            font-weight: 500;
          }
          .signature-name {
            font-weight: bold;
            font-size: 9px;
            color: #0f172a;
            border-bottom: 1px solid #000;
            display: inline-block;
            padding: 0 10px;
            padding-bottom: 1px;
          }
          .signature-role {
            font-size: 8px;
            color: #64748b;
            margin-top: 2px;
          }
          
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="https://i.ibb.co.com/FqDNnD8W/Logo-Nusantara-Mineral-Abadi.webp" alt="Logo PT" class="logo" />
          <div class="header-text">
            <h1>PT. NUSANTARA MINERAL SUKSES ABADI</h1>
            <h2>Laporan Absensi & Uang Makan Mingguan Karyawan</h2>
          </div>
        </div>
        
        <div class="meta-container">
          <table class="meta-table">
            <tr>
              <td class="meta-label">Periode Mingguan</td>
              <td class="meta-value">: &nbsp; <strong>${report.weekStartDate} s/d ${report.weekEndDate}</strong></td>
            </tr>
            <tr>
              <td class="meta-label">Jumlah Karyawan Aktif</td>
              <td class="meta-value">: &nbsp; ${validRecords.length} Orang</td>
            </tr>
            <tr>
              <td class="meta-label">Hari Operasional</td>
              <td class="meta-value">: &nbsp; Senin - Jumat</td>
            </tr>
          </table>
          
          <table class="meta-table">
            <tr>
              <td class="meta-label">Total Uang Makan</td>
              <td class="meta-value" style="font-size: 10px;">: &nbsp; <strong style="color: #1e3a8a;">Rp ${totalCost.toLocaleString("id-ID")}</strong></td>
            </tr>
            <tr>
              <td class="meta-label">Tanggal Cetak</td>
              <td class="meta-value">: &nbsp; ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</td>
            </tr>
          </table>
        </div>
        
        <table class="report-table">
          <thead>
            <tr>
              <th style="width: 20px;">No</th>
              <th style="width: 140px; text-align: left;">Nama Karyawan / Jabatan</th>
              <th style="width: 38px;">Senin</th>
              <th style="width: 38px;">Selasa</th>
              <th style="width: 38px;">Rabu</th>
              <th style="width: 38px;">Kamis</th>
              <th style="width: 38px;">Jumat</th>
              <th style="width: 38px;">Hadir</th>
              <th style="width: 60px; text-align: right;">Tarif (Rp)</th>
              <th style="width: 75px; text-align: right;">Total (Rp)</th>
              <th style="width: 100px;">Paraf Karyawan</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        
        <div class="signature-container">
          <div class="signature-box">
            <div class="signature-title">Diterima & Diperiksa Oleh,</div>
            <div class="signature-name" style="text-decoration: none; border-bottom: 1.2px solid #000; padding-bottom: 1px;">Andi Dhiya Salsabila</div>
            <div class="signature-role">Keuangan</div>
          </div>
          <div class="signature-box">
            <div class="signature-title">Diserahkan & Dilaporkan Oleh,</div>
            <div class="signature-name" style="text-decoration: none; border-bottom: 1.2px solid #000; padding-bottom: 1px;">Nur Wahyudi</div>
            <div class="signature-role">Staff Keuangan</div>
          </div>
        </div>
        
        <script>
          window.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
              window.print();
            }, 500);
          });
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

export function generateAttendanceExcelBlob(
  weekStartDate: string,
  weekEndDate: string,
  records: AttendanceRecord[],
  workers: Worker[]
): Blob {
  const dates = getSafeDates(weekStartDate);
  const dayNames = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];

  // Helper mapping
  const workerMap = new Map(workers.map((w) => [w.id, w]));

  const validRecords = records.filter((r) => workerMap.has(r.workerId));

  // Fix duplicated validRecords by grabbing the first one for each workerId
  const uniqueRecordsMap = new Map();
  records.forEach((r) => {
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
  const uniqueValidRecords = Array.from(uniqueRecordsMap.values());

  const rows = uniqueValidRecords.map((record: any, index) => {
    const worker = workerMap.get(record.workerId);
    const row: any = {
      "No.": index + 1,
      Karyawan: worker?.name || "Karyawan Tidak Dikenal",
      Jabatan: worker?.role || "-",
    };

    let totalAttendance = 0;
    dates.forEach((date, dIdx) => {
      const isPresent = record.attendance[date] || false;
      const customVal = record.customStatus?.[date];
      if (customVal) {
        if (customVal === "Sakit") row[dayNames[dIdx]] = "Sakit (S)";
        else if (customVal === "Izin") row[dayNames[dIdx]] = "Izin (I)";
        else if (customVal === "Meeting") {
          row[dayNames[dIdx]] = "Meeting";
        }
      } else {
        row[dayNames[dIdx]] = isPresent ? "Hadir" : "Absen";
        if (isPresent) totalAttendance++;
      }
    });

    row["Total Kehadiran"] = totalAttendance;
    row["Tarif Uang Makan (Harian)"] = record.dailyAllowance;
    row["Total Uang Makan (Mingguan)"] = totalAttendance * record.dailyAllowance;

    return row;
  });

  // Create sheet
  const ws = XLSX.utils.json_to_sheet(rows);

  ws["!cols"] = [
    { wch: 6 },   // No
    { wch: 25 },  // Karyawan
    { wch: 20 },  // Jabatan
    { wch: 12 },  // Senin
    { wch: 12 },  // Selasa
    { wch: 12 },  // Rabu
    { wch: 12 },  // Kamis
    { wch: 12 },  // Jumat
    { wch: 15 },  // Total Kehadiran
    { wch: 25 },  // Tarif
    { wch: 25 },  // Total
  ];

  // Create Workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rekap Uang Makan");

  // Title sheet
  const titleData = [
    ["LAPORAN ABSENSI & UANG MAKAN HARIAN", ""],
    ["Periode Mingguan:", `${weekStartDate} s/d ${weekEndDate}`],
    ["Jumlah Karyawan:", uniqueValidRecords.length],
    ["Total Pengeluaran Uang Makan:", uniqueValidRecords.reduce((sum, r) => {
      const presentDays = Object.keys(r.attendance).filter(k => r.attendance[k] && (!r.customStatus || (r.customStatus[k] !== "Meeting" && r.customStatus[k] !== "Izin" && r.customStatus[k] !== "Sakit"))).length;
      return sum + (presentDays * r.dailyAllowance);
    }, 0)],
    ["Status Laporan:", "Dilaporkan hari Jumat"],
    ["Dibuat Pada:", new Date().toLocaleDateString("id-ID")],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(titleData);
  wsSummary["!cols"] = [{ wch: 28 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan Absensi");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function triggerAttendanceExcelDownload(
  weekStartDate: string,
  weekEndDate: string,
  records: AttendanceRecord[],
  workers: Worker[],
  fileName: string = "Rekap_Uang_Makan_Mingguan.xlsx"
) {
  const blob = generateAttendanceExcelBlob(weekStartDate, weekEndDate, records, workers);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
