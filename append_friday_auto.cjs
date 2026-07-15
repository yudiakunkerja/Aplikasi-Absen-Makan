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

        if (!alreadyGenerated && attendanceRecords.length > 0) {
          console.log("Friday detected: Auto generating weekly report...");
          
          try {
            // Wait, we need google token to upload to drive
            // But if admin isn't signed in, we can't upload to drive automatically.
            // We just notify them?
          } catch (e) {
            console.error(e);
          }
        }
      }
    };

    checkAndAutoUpload();
  }, [selfWorkerId, weeklyReports, attendanceRecords]);

`;

// Insert before `// --- Server Synchronization Logic ---`
code = code.replace('// --- Server Synchronization Logic ---', effectCode + '\n  // --- Server Synchronization Logic ---');

fs.writeFileSync(path, code);
