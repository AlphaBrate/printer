const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
const os = require("os");

const app = express();
const PORT = 3111;

const MAIN_SERV_VERSION = "Beta 0.1.0";

// find local ip
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

// 1. Configure Randomized Storage
const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, UPLOAD_DIR);
	},
	filename: (req, file, cb) => {
		// Create a unique hex name for every file received
		const randomName = crypto.randomBytes(8).toString("hex");
		const ext = path.extname(file.originalname) || ".pdf";
		cb(null, `${randomName}${ext}`);
	},
});

const upload = multer({ storage: storage });

// 2. Serve Static Files
// This serves your public/index.html, index.js, and style.css
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", "*"); // Allows all origins
	res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.header("Access-Control-Allow-Headers", "Content-Type");

	// Handle the "preflight" request the browser sends before a POST
	if (req.method === "OPTIONS") {
		return res.sendStatus(200);
	}
	next();
});

app.get("/urls.json", (req, res) => {
	const addressList = addresses.map((address) => `http://${address}:${PORT}`);
	res.json(addressList);
});

app.get("/version", (req, res) => {
	res.send(MAIN_SERV_VERSION);
});

// 3. API Endpoint to handle high-quality print
app.post("/upload", upload.array("files"), (req, res) => {
	const files = req.files;
	const printCommandLog = req.body.printCommand;

	if (!files || files.length === 0) {
		return res.status(400).json({ error: "No files received" });
	}

	console.log(`\n[Job Received] ${new Date().toLocaleTimeString()}`);
	console.log(`Command Log: ${printCommandLog}`);

	files.forEach((file) => {
		const absolutePath = path.resolve(file.path);

		/**
		 * POWERSHELL EXECUTION
		 * Uses the 'Print' verb. This is a native Windows feature.
		 * It will briefly open the default PDF viewer (Edge/Acrobat) to spool.
		 */
		const psCommand = `Start-Process -FilePath "${absolutePath}" -Verb Print -WindowStyle Hidden`;

		exec(`powershell -Command "${psCommand}"`, (error) => {
			if (error) {
				console.error(
					`PowerShell Error for ${file.filename}:`,
					error.message,
				);
			} else {
				console.log(`Successfully spooled: ${file.filename}`);
			}

			// CLEANUP: Delete file after 60 seconds to allow the printer spooler to finish reading it
			setTimeout(() => {
				fs.unlink(absolutePath, (err) => {
					if (err)
						console.error(
							`Cleanup failed for ${file.filename}:`,
							err,
						);
					else console.log(`Deleted temp file: ${file.filename}`);
				});
			}, 60000);
		});
	});

	res.json({
		success: true,
		message: "Files received and sent to printer.",
		jobCount: files.length,
	});
});

app.post("/kill", (req, res) => {
	// Kill self
	console.log("Server is shutting down.");
	res.send("Server shutting down.");
	process.exit(0);
});

app.post("/start-updater", (req, res) => {
	// node updater.js
	exec("node updater.js", (err, stdout, stderr) => {
		if (err) {
			console.error("Error starting updater:", err);
			return res.status(500).send("Error starting updater");
		}
		console.log("Updater started:", stdout);
		res.send("Updater started.");
	});
});

app.post("/update-updater", (req, res) => {
	// fetch localhost:3123/kill
	fetch("http://localhost:3123/kill", { method: "POST" })
		.then(() => {
			console.log("Updater killed, proceeding with update...");
			// Then, update the updater.js file
			const updaterPath = path.join(__dirname, "updater.js");

			fetch("https://alphabrate.github.io/code/print/updater.js")
				.then((response) => response.text())
				.then((newUpdaterCode) => {
					fs.writeFile(updaterPath, newUpdaterCode, (err) => {
						if (err) {
							console.error("Failed to update updater.js:", err);
							return res
								.status(500)
								.send("Failed to update updater.js");
						}
						console.log(
							"updater.js updated successfully. Restarting updater...",
						);
						// After updating, restart the updater use node updater.js at the same dir

						exec("node updater.js", (err, stdout, stderr) => {
							if (err) {
								console.error(
									"Failed to restart updater:",
									err,
								);
								return res
									.status(500)
									.send("Failed to restart updater");
							}
							console.log("Updater restarted:", stdout);
						});

						res.send("Updater updated and ready for restart.");
					});
				})
				.catch((error) => {
					console.error("Failed to fetch new updater code:", error);
					res.status(500).send("Failed to fetch new updater code");
				});
		})
		.catch((error) => {
			console.error("Failed to kill updater:", error);
			res.status(500).send("Failed to kill updater for update");
		});
});

// 4. Start Server
app.listen(PORT, () => {
	console.log(`-----------------------------------------`);
	console.log(`Printer Server Active: http://localhost:${PORT}`);
	console.log(`Serving Frontend from: ./public`);
	console.log(`Temporary Storage: ./uploads`);
	addresses.forEach((address) => {
		console.log(`           http://${address}:${PORT}`);
	});
	console.log(`-----------------------------------------`);
});
