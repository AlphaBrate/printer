const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
const os = require("os");

const app = express();
const PORT = 3111;
const MAIN_SERV_VERSION = "Beta 0.1.1";

/**
 * 1. SYSTEM PERSISTENCE (Lid-Closed Support)
 * This prevents the system from entering sleep mode while the script is active.
 */
function preventSleep() {
    if (os.platform() === "win32") {
        // 'SOV_SYSTEM' tells Windows the system is required to stay functional
        exec("powercfg /request SOV_SYSTEM REQUIRED", (err) => {
            if (err) console.error("PowerCfg Error:", err);
            else console.log(">>> System Sleep Prevention: ACTIVE");
        });
    }
}
preventSleep();

// Find local IP addresses for network access
const interfaces = os.networkInterfaces();
const addresses = [];
for (const name in interfaces) {
    for (const iface of interfaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) {
            addresses.push(iface.address);
        }
    }
}

// Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

/**
 * 2. STORAGE CONFIGURATION
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const randomName = crypto.randomBytes(8).toString("hex");
        const ext = path.extname(file.originalname) || ".pdf";
        cb(null, `${randomName}${ext}`);
    },
});

const upload = multer({ storage: storage });

/**
 * 3. MIDDLEWARE & STATIC FILES
 */
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

/**
 * 4. ROUTES
 */
app.get("/urls.json", (req, res) => {
    const addressList = addresses.map((address) => `http://${address}:${PORT}`);
    res.json(addressList);
});

app.get("/version", (req, res) => {
    res.send(MAIN_SERV_VERSION);
});

// API Endpoint to handle high-quality print
app.post("/upload", upload.array("files"), (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files received" });
    }

    console.log(`\n[Job Received] ${new Date().toLocaleTimeString()}`);

    files.forEach((file) => {
        const absolutePath = path.resolve(file.path);

        /**
         * POWERSHELL EXECUTION
         * -Verb Print: Uses the default Windows app to print.
         * -WindowStyle Hidden: Minimizes UI disruption while lid is closed.
         */
        const psCommand = `Start-Process -FilePath "${absolutePath}" -Verb Print -WindowStyle Hidden -ErrorAction SilentlyContinue`;

        exec(`powershell -Command "${psCommand}"`, (error) => {
            if (error) {
                console.error(`Print Error (${file.filename}):`, error.message);
            } else {
                console.log(`Successfully spooled: ${file.filename}`);
            }

            // CLEANUP: 60s delay to ensure the spooler has finished reading the file
            setTimeout(() => {
                fs.unlink(absolutePath, (err) => {
                    if (err) console.error(`Cleanup failed:`, err);
                    else console.log(`Deleted temp file: ${file.filename}`);
                });
            }, 60000);
        });
    });

    res.json({
        success: true,
        message: "Files sent to printer spooler.",
        jobCount: files.length,
    });
});

app.post("/kill", (req, res) => {
    console.log("Server shutting down.");
    res.send("Server shutting down.");
    process.exit(0);
});

/**
 * 5. START SERVER
 */
app.listen(PORT, () => {
    console.log(`-----------------------------------------`);
    console.log(`Printer Server v${MAIN_SERV_VERSION}`);
    console.log(`Local Access: http://localhost:${PORT}`);
    addresses.forEach((address) => {
        console.log(`Network Access: http://${address}:${PORT}`);
    });
    console.log(`-----------------------------------------`);
    console.log(`REMINDER: Set "Lid Close Action" to "Do Nothing" in Windows Power Settings.`);
});

// Windows Power Options: Go to Control Panel > Power Options > Choose what closing the lid does > Set to Do nothing.

// Wi-Fi Settings: Go to Device Manager > Network Adapters > [Your Wi-Fi Card] > Properties > Power Management > Uncheck "Allow the computer to turn off this device to save power."