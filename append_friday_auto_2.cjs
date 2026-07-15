const fs = require('fs');

const path = 'src/App.tsx';
let code = fs.readFileSync(path, 'utf8');

const effectCode = `
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
              createdAt: Date.now(),
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
              
              const fileName = \`Rekap_Uang_Makan_\${monday}_\${friday}.pdf\`;
              const folderId = await getOrCreateFolder(googleToken, "Laporan_Uang_Makan_Mingguan");
              await uploadFileToDrive(googleToken, pdfBlob, fileName, folderId, "application/pdf");
              
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

`;

code = code.replace(/  \/\/ Auto-generate and upload Weekly Report on Friday for Admin[\s\S]*?checkAndAutoUpload\(\);\n  }, \[selfWorkerId, weeklyReports, attendanceRecords\]\);\n/, effectCode);

fs.writeFileSync(path, code);
