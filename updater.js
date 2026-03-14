const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3123; // Port for the updater service

const UPDATE_SERV_VERSION = "Beta 0.1.0";

app.use(express.json());
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

app.get("/version", (req, res) => {
	res.send(UPDATE_SERV_VERSION);
});

app.post("/kill", (req, res) => {
	console.log("Updater service received kill command. Shutting down...");
	res.send("Updater shutting down.");
	process.exit(0);
});

app.post("/update", async (req, res) => {
	console.log("Update request received.");

	try {
		// 1. Kill the main printer server
		console.log(
			"Attempting to kill main printer server (http://localhost:3111/kill)...",
		);
		await fetch("http://localhost:3111/kill", { method: "POST" });
		console.log("Main printer server kill command sent.");

		// Give the main server a moment to shut down
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// 2. Fetch the latest code for index.js
		console.log("Fetching latest index.js from GitHub...");
		const indexJsUrl = "https://alphabrate.github.io/code/print/index.js";
		const response = await fetch(indexJsUrl);
		if (!response.ok) {
			throw new Error(`Failed to fetch index.js: ${response.statusText}`);
		}
		const newIndexJsCode = await response.text();
		const indexPath = path.join(__dirname, "index.js");

		// 3. Overwrite the existing index.js
		console.log("Writing new index.js to file system...");
		fs.writeFileSync(indexPath, newIndexJsCode);
		console.log("index.js updated successfully.");

		// 4. Restart the main printer server
		console.log("Restarting main printer server...");
		exec("node index.js", (error, stdout, stderr) => {
			if (error) {
				console.error(`Error restarting main server: ${error.message}`);
				return;
			}
			if (stderr) {
				console.error(`Main server stderr: ${stderr}`);
			}
			console.log(`Main server stdout: ${stdout}`);
		});

		res.status(200).send("Main server updated and restarted.");
	} catch (error) {
		console.error("Updater service error during update:", error);
		res.status(500).send(`Update failed: ${error.message}`);
	}
});

app.post("/update-file", async (req, res) => {
	const { filePath, githubUrl } = req.body; // Expect filePath relative to updater.js and GitHub URL
	if (!filePath || !githubUrl) {
		return res
			.status(400)
			.send("Missing filePath or githubUrl in request body.");
	}

	console.log(
		`Update request received for file: ${filePath} from ${githubUrl}`,
	);

	try {
		// Fetch the latest code for the specified file
		console.log(`Fetching latest code for ${filePath} from GitHub...`);
		const response = await fetch(githubUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch ${filePath}: ${response.statusText}`,
			);
		}
		const newFileCode = await response.text();
		const absoluteFilePath = path.join(__dirname, filePath);

		// Overwrite the existing file
		console.log(`Writing new code to ${absoluteFilePath}...`);
		fs.writeFileSync(absoluteFilePath, newFileCode);
		console.log(`${filePath} updated successfully.`);

		res.status(200).send(`${filePath} updated successfully.`);
	} catch (error) {
		console.error(
			`Updater service error during file update for ${filePath}:`,
			error,
		);
		res.status(500).send(`Update failed for ${filePath}: ${error.message}`);
	}
});

app.listen(PORT, () => {
	console.log(`Updater service listening on port ${PORT}`);
});
