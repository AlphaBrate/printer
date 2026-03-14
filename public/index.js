const PRINTERS = [
	{
		showName: "HP LaserJet Professional P1102",
		sysName: "HP_LASER_JET_P1102",
		papers: ["A4"],
		colors: ["mono"],
	},
];

// Absolute Layout Engine Constants - Matched to perfect Portrait Aspect Ratio (1 : 1.414)
const CARD_WIDTH = 268;
const CARD_HEIGHT = 380;
const CARD_GAP = 32;
const CARD_STEP = CARD_HEIGHT + CARD_GAP;

let pages = [];
let dragInfo = null;
// Global map to store raw file data for high-quality printing
const rawFileData = new Map();

const dropZone = document.getElementById("dropZone");
const emptyState = document.getElementById("emptyState");
pdfjsLib.GlobalWorkerOptions.workerSrc =
	"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

document.addEventListener("DOMContentLoaded", () => {
	const select = document.getElementById("printerSelect");
	if (select) {
		select.innerHTML = '<option value="">Select Target Device...</option>';
		PRINTERS.forEach((p) => {
			const opt = document.createElement("option");
			opt.value = p.sysName;
			opt.innerText = p.showName;
			select.appendChild(opt);
		});
	}

	updatePrinterCapabilities();
});

function updatePrinterCapabilities() {
	const printerSelect = document.getElementById("printerSelect");
	if (!printerSelect) return;

	const sysName = printerSelect.value;
	const printer = PRINTERS.find((p) => p.sysName === sysName);

	const sysNameLabel = document.getElementById("printerSystemName");
	const paperSelect = document.getElementById("paperSize");
	const colorSelect = document.getElementById("colorMode");

	if (!printer) {
		if (sysNameLabel) sysNameLabel.innerText = "Not Selected";
		updateUI();
		return;
	}

	if (sysNameLabel) sysNameLabel.innerText = printer.sysName;

	Array.from(paperSelect.options).forEach((opt) => {
		const isSupported = printer.papers.includes(opt.value);
		opt.disabled = !isSupported;
		if (!isSupported && paperSelect.value === opt.value) {
			paperSelect.value = printer.papers[0];
		}
	});

	Array.from(colorSelect.options).forEach((opt) => {
		const isSupported = printer.colors.includes(opt.value);
		opt.disabled = !isSupported;
		if (!isSupported && colorSelect.value === opt.value) {
			colorSelect.value = printer.colors[0];
		}
	});

	updateUI();
}

// --- Dynamic Text Color based on background brightness ---
function getBottomBrightness(imgSrc) {
	return new Promise((resolve) => {
		if (!imgSrc) return resolve("dark");
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d");
			canvas.width = 64;
			canvas.height = 16;

			ctx.drawImage(
				img,
				0,
				img.height * 0.8,
				img.width,
				img.height * 0.2,
				0,
				0,
				64,
				16,
			);

			try {
				const data = ctx.getImageData(0, 0, 64, 16).data;
				let rSum = 0,
					gSum = 0,
					bSum = 0;
				const pixelCount = 64 * 16;

				for (let i = 0; i < data.length; i += 4) {
					const alpha = data[i + 3] / 255;
					rSum += data[i] * alpha + 255 * (1 - alpha);
					gSum += data[i + 1] * alpha + 255 * (1 - alpha);
					bSum += data[i + 2] * alpha + 255 * (1 - alpha);
				}

				const r = rSum / pixelCount;
				const g = gSum / pixelCount;
				const b = bSum / pixelCount;

				const brightness = Math.sqrt(
					0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b),
				);
				resolve(brightness > 140 ? "dark" : "light");
			} catch (e) {
				resolve("dark");
			}
		};
		img.onerror = () => resolve("dark");
		img.src = imgSrc;
	});
}

["dragenter", "dragover", "dragleave", "drop"].forEach((e) =>
	dropZone.addEventListener(e, (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
	}),
);

dropZone.addEventListener("dragover", (e) => {
	if (e.dataTransfer.types.includes("Files"))
		dropZone.classList.add("drop-zone-active");
});

dropZone.addEventListener("dragleave", () =>
	dropZone.classList.remove("drop-zone-active"),
);

dropZone.addEventListener("drop", (e) => {
	dropZone.classList.remove("drop-zone-active");
	if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
});

async function handleFiles(files) {
	for (const file of files) {
		if (file.type === "application/pdf") {
			await processPDF(file);
		} else if (file.type.startsWith("image/")) {
			// Store original image for printing
			const fileId = Date.now() + Math.random();
			rawFileData.set(fileId, file);

			const reader = new FileReader();
			reader.onload = async (e) =>
				await addPage(e.target.result, file.name, "Image", fileId, 1);
			reader.readAsDataURL(file);
		} else {
			await addPage(null, file.name, file.type || "Document");
		}
	}
}

async function processPDF(file) {
	const arrayBuffer = await file.arrayBuffer();
	// Store the original buffer using a unique ID for high-quality printing
	const fileId = Date.now() + Math.random();
	rawFileData.set(fileId, file);

	const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
	for (let i = 1; i <= pdf.numPages; i++) {
		const page = await pdf.getPage(i);
		const viewport = page.getViewport({ scale: 1.5 }); // Higher scale for UI preview
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		canvas.height = viewport.height;
		canvas.width = viewport.width;

		await page.render({ canvasContext: context, viewport: viewport })
			.promise;

		// The preview still uses the canvas, but we link it to the raw fileId and specific page number
		await addPage(
			canvas.toDataURL(),
			`${file.name} (Page ${i})`,
			"PDF Page",
			fileId,
			i,
		);
	}
}

async function addPage(src, name, type, rawId, pageNum) {
	const id = Date.now() + Math.random();
	let textColor = "dark";
	if (src) {
		textColor = await getBottomBrightness(src);
	}
	// Include rawId and pageNum in the page object for the final print job
	pages.push({
		id,
		enabled: true,
		src,
		name,
		type,
		textColor,
		rawId,
		pageNum,
	});
	renderFullList();
}

function togglePage(id, state) {
	const page = pages.find((p) => p.id == id);
	if (page) page.enabled = state;
	renderFullList();
}

function renderFullList() {
	const container = document.getElementById("previewList");

	if (pages.length === 0) {
		emptyState.style.opacity = "1";
		emptyState.style.transform = "scale(1) translateX(-5%)";
	} else {
		emptyState.style.opacity = "0";
		emptyState.style.transform = "scale(0.95) translateX(-5%)";
	}

	container.style.height = `${pages.length * CARD_STEP + 40}px`;

	pages.forEach((page, index) => {
		let card = document.getElementById(`card-${page.id}`);

		if (!card) {
			card = document.createElement("div");
			card.className = `preview-card ${!page.enabled ? "disabled" : ""}`;
			card.id = `card-${page.id}`;
			card.dataset.id = page.id;
			card.setAttribute(
				"oncontextmenu",
				`showContextMenu(event, ${page.id})`,
			);

			card.addEventListener("pointerdown", handleDragStart);

			card.innerHTML = `
                    <div class="paper-element mx-auto relative bg-white shadow-xl overflow-hidden transition-all duration-500 origin-center rounded-lg" style="width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px;">
                        ${
							page.src
								? `<img src="${page.src}" class="preview-img absolute inset-0 w-full h-full object-contain bg-white pointer-events-none transition-all duration-500" draggable="false">`
								: `
                            <div class="absolute inset-0 flex flex-col items-center justify-center bg-white">
                                <div class="text-5xl opacity-20 transition-transform duration-500 hover:scale-110">📄</div>
                                <div class="text-sm opacity-50 font-semibold mt-3 text-black">${page.type}</div>
                            </div>
                        `
						}
                        <div class="absolute top-4 right-4 z-30 p-1.5 rounded-full bg-white/70 dark:bg-black/50 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.1)] border border-black/5 dark:border-white/10 opacity-90 hover:opacity-100 transition-opacity duration-300">
                            <label class="switch cursor-pointer block">
                                <input type="checkbox" ${page.enabled ? "checked" : ""} onchange="togglePage(${page.id}, this.checked)">
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="absolute bottom-0 left-0 right-0 h-[100px] pointer-events-none z-10 progressive-blur-layer"></div>
                    </div>
                `;
			container.appendChild(card);

			card.style.opacity = "0";
			card.style.transform = `translateY(${index * CARD_STEP + 30}px)`;

			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					card.style.opacity = "1";
					if (!card.classList.contains("dragging")) {
						card.style.transform = `translateY(${index * CARD_STEP}px)`;
					}
				});
			});
		} else {
			card.className = `preview-card ${!page.enabled ? "disabled" : ""} ${card.classList.contains("dragging") ? "dragging" : ""}`;
			const checkbox = card.querySelector('input[type="checkbox"]');
			if (checkbox) checkbox.checked = page.enabled;
			if (!card.classList.contains("dragging")) {
				card.style.transform = `translateY(${index * CARD_STEP}px)`;
			}
		}
	});

	Array.from(container.children).forEach((child) => {
		if (child.classList.contains("preview-card")) {
			const id = parseFloat(child.dataset.id);
			if (!pages.find((p) => p.id === id)) {
				child.style.transform = `translateY(${index * CARD_STEP}px) scale(0.9)`;
				child.style.opacity = "0";
				child.style.pointerEvents = "none";
				setTimeout(() => child.remove(), 400);
			}
		}
	});

	updateUI();
}

function handleDragStart(e) {
	if (e.target.closest(".switch") || e.target.closest("button")) return;
	if (e.pointerType === "mouse" && e.button !== 0) return;

	e.preventDefault();

	const card = e.currentTarget;
	const id = parseFloat(card.dataset.id);
	const startIndex = pages.findIndex((p) => p.id === id);

	card.classList.add("dragging");
	card.setPointerCapture(e.pointerId);

	dragInfo = {
		card,
		id,
		startIndex,
		currentIndex: startIndex,
		startY: e.clientY,
		startTranslateY: startIndex * CARD_STEP,
	};

	card.addEventListener("pointermove", handleDragMove);
	card.addEventListener("pointerup", handleDragEnd);
	card.addEventListener("pointercancel", handleDragEnd);
}

function handleDragMove(e) {
	if (!dragInfo) return;
	e.preventDefault();

	const deltaY = e.clientY - dragInfo.startY;
	let newTranslateY = dragInfo.startTranslateY + deltaY;

	dragInfo.card.style.transform = `translateY(${newTranslateY}px)`;

	let newIndex = Math.round(newTranslateY / CARD_STEP);
	newIndex = Math.max(0, Math.min(pages.length - 1, newIndex));

	if (newIndex !== dragInfo.currentIndex) {
		const movedPage = pages.splice(dragInfo.currentIndex, 1)[0];
		pages.splice(newIndex, 0, movedPage);

		pages.forEach((p, index) => {
			if (p.id === dragInfo.id) return;
			const card = document.getElementById(`card-${p.id}`);
			if (card) {
				card.style.transform = `translateY(${index * CARD_STEP}px)`;
			}
		});

		dragInfo.currentIndex = newIndex;
		updateUI();
	}
}

function handleDragEnd(e) {
	if (!dragInfo) return;
	const card = dragInfo.card;
	card.releasePointerCapture(e.pointerId);
	card.classList.remove("dragging");
	card.style.transform = `translateY(${dragInfo.currentIndex * CARD_STEP}px)`;
	card.removeEventListener("pointermove", handleDragMove);
	card.removeEventListener("pointerup", handleDragEnd);
	card.removeEventListener("pointercancel", handleDragEnd);
	dragInfo = null;
	updateUI();
}

let contextTargetId = null;
const contextMenu = document.getElementById("customContextMenu");

function hideContextMenu() {
	if (!contextMenu) return;
	contextMenu.classList.add(
		"opacity-0",
		"pointer-events-none",
		"scale-95",
		"blur-[6px]",
	);
	contextMenu.classList.remove(
		"opacity-100",
		"pointer-events-auto",
		"scale-100",
		"blur-0",
	);
}

function showContextMenu(e, id) {
	e.preventDefault();
	if (!contextMenu) return;
	contextTargetId = id;

	let x = e.clientX;
	let y = e.clientY;

	const menuRect = contextMenu.getBoundingClientRect();
	if (x + 190 > window.innerWidth) x -= 190;
	if (y + 140 > window.innerHeight) y -= 140;

	contextMenu.style.left = `${x}px`;
	contextMenu.style.top = `${y}px`;

	contextMenu.classList.remove(
		"opacity-0",
		"pointer-events-none",
		"scale-95",
		"blur-[6px]",
	);
	contextMenu.classList.add(
		"opacity-100",
		"pointer-events-auto",
		"scale-100",
		"blur-0",
	);
}

document.addEventListener("click", (e) => {
	if (contextMenu && !contextMenu.contains(e.target)) {
		hideContextMenu();
	}
});

function deleteTargetPage() {
	if (!contextTargetId) return;
	hideContextMenu();
	pages = pages.filter((p) => p.id !== contextTargetId);
	renderFullList();
}

function duplicateTargetPage() {
	if (!contextTargetId) return;
	hideContextMenu();
	const idx = pages.findIndex((p) => p.id === contextTargetId);
	if (idx !== -1) {
		const srcPage = pages[idx];
		const newPage = {
			...srcPage,
			id: Date.now() + Math.random(),
			name: srcPage.name + " (Copy)",
		};
		pages.splice(idx + 1, 0, newPage);
		renderFullList();
	}
}

function toggleTargetPageMenuAction() {
	if (!contextTargetId) return;
	hideContextMenu();
	const page = pages.find((p) => p.id === contextTargetId);
	if (page) {
		togglePage(contextTargetId, !page.enabled);
	}
}

function getDynamicTextWidth(text, sourceElement) {
	const span = document.createElement("span");
	const computed = window.getComputedStyle(sourceElement);
	span.style.fontFamily = computed.fontFamily;
	span.style.fontSize = computed.fontSize;
	span.style.fontWeight = computed.fontWeight;
	span.style.letterSpacing = computed.letterSpacing;
	span.style.visibility = "hidden";
	span.style.position = "absolute";
	span.style.whiteSpace = "nowrap";
	span.innerText = text;
	document.body.appendChild(span);
	const width = span.getBoundingClientRect().width;
	document.body.removeChild(span);
	return width + 0.5;
}

function updateUI() {
	const printerSelect = document.getElementById("printerSelect");
	if (!printerSelect) return;

	const printer = printerSelect.value;
	const rangeType = document.querySelector(
		'input[name="pageRange"]:checked',
	).value;
	const color = document.getElementById("colorMode").value;
	const scaleBase =
		(parseInt(document.getElementById("scaling").value) || 100) / 100;

	const fromVal = parseInt(document.getElementById("rangeFrom").value) || 1;
	const toVal = parseInt(document.getElementById("rangeTo").value) || 1;

	const enabledPages = pages.filter((p) => p.enabled);
	const totalEnabled = enabledPages.length;

	const rangeFromInput = document.getElementById("rangeFrom");
	const rangeToInput = document.getElementById("rangeTo");
	rangeFromInput.disabled = rangeType !== "range";
	rangeToInput.disabled = rangeType !== "range";
	rangeFromInput.max = totalEnabled;
	rangeToInput.max = totalEnabled;

	let printedCount = 0;
	let rangeError = false;

	pages.forEach((page) => {
		const card = document.getElementById(`card-${page.id}`);
		if (!card) return;

		const logicalIdx = enabledPages.indexOf(page) + 1;
		let isOutOfRange = false;
		if (rangeType === "range" && page.enabled) {
			if (logicalIdx < fromVal || logicalIdx > toVal) isOutOfRange = true;
		}

		card.classList.toggle("out-of-range", isOutOfRange);
		card.classList.toggle("disabled", !page.enabled);

		const paper = card.querySelector(".paper-element");
		if (paper) paper.style.transform = `scale(${scaleBase})`;

		const img = card.querySelector(".preview-img");
		if (img) {
			img.style.filter =
				color === "mono" ? "grayscale(1) contrast(1.1)" : "none";
		}

		if (page.enabled && !isOutOfRange) printedCount++;
	});

	const warningEl = document.getElementById("rangeWarning");
	if (rangeType === "range" && fromVal > toVal) {
		rangeError = true;
		if (warningEl) warningEl.style.opacity = "1";
	} else {
		if (warningEl) warningEl.style.opacity = "0";
	}

	const numberEl = document.getElementById("summaryNumber");
	const labelEl = document.getElementById("summaryLabel");
	const numContainer = document.getElementById("numContainer");
	const labelContainer = document.getElementById("labelContainer");

	if (numberEl && labelEl && numContainer && labelContainer) {
		const newNumberText =
			printedCount === 0 ? "No" : printedCount.toString();
		const newLabelText = printedCount <= 1 ? "Page" : "Pages";

		if (!numContainer.style.width)
			numContainer.style.width =
				getDynamicTextWidth(numberEl.innerText, numberEl) + "px";
		if (!labelContainer.style.width)
			labelContainer.style.width =
				getDynamicTextWidth(labelEl.innerText, labelEl) + "px";

		if (numberEl.innerText !== newNumberText) {
			numContainer.style.width =
				getDynamicTextWidth(newNumberText, numberEl) + "px";
			animateSlot(numberEl, newNumberText);
		}

		if (labelEl.innerText !== newLabelText) {
			labelContainer.style.width =
				getDynamicTextWidth(newLabelText, labelEl) + "px";
			animateSlot(labelEl, newLabelText);
		}
	}

	document.getElementById("printBtn").disabled =
		printedCount === 0 || printer === "" || rangeError;
}

function animateSlot(el, newText) {
	el.style.transition = "all 0.15s cubic-bezier(0.4, 0, 0.2, 1)";
	el.style.transform = "translateY(-10px)";
	el.style.opacity = "0";
	el.style.filter = "blur(4px)";

	setTimeout(() => {
		el.innerText = newText;
		el.style.transition = "none";
		el.style.transform = "translateY(10px)";
		void el.offsetWidth;
		el.style.transition = "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.15)";
		el.style.transform = "translateY(0)";
		el.style.opacity = "1";
		el.style.filter = "blur(0)";
	}, 150);
}

async function executePrint() {
	const sysName = document.getElementById("printerSelect").value;
	const printerObj = PRINTERS.find((p) => p.sysName === sysName);
	const copies = document.getElementById("copies").value;
	const orientation = "portrait";
	const color =
		document.getElementById("colorMode").value === "mono"
			? "/grayscale"
			: "/color";
	const scaling = document.getElementById("scaling").value;
	const paper = document.getElementById("paperSize").value;
	const rangeType = document.querySelector(
		'input[name="pageRange"]:checked',
	).value;
	const from = parseInt(document.getElementById("rangeFrom").value);
	const to = parseInt(document.getElementById("rangeTo").value);

	const enabledPages = pages.filter((p) => p.enabled);
	const finalSelection =
		rangeType === "all" ? enabledPages : enabledPages.slice(from - 1, to);

	const cmd = `print --printer "${printerObj.showName} [${sysName}]" --copies ${copies} --paper ${paper} --orientation ${orientation} ${color} --scale ${scaling}% --files "${finalSelection.map((p) => p.name).join(", ")}"`;

	console.log(
		"%c>>> SYSTEM PRINT COMMAND EXECUTED <<<",
		"color: #007aff; font-weight: bold; font-size: 14px;",
	);
	console.log(cmd);

	const formData = new FormData();
	formData.append("printCommand", cmd);

	// 1. Group the selected pages by their source file (rawId)
	const selectionByFile = {};
	finalSelection.forEach((page) => {
		if (page.rawId) {
			if (!selectionByFile[page.rawId]) {
				selectionByFile[page.rawId] = [];
			}
			selectionByFile[page.rawId].push(page.pageNum);
		}
	});

	// 2. Append each unique file only ONCE
	Object.keys(selectionByFile).forEach((rawId) => {
		const originalFile = rawFileData.get(parseFloat(rawId));
		if (originalFile) {
			// Send the file and the specific pages needed from it
			formData.append("files", originalFile);
			formData.append("pageRanges", selectionByFile[rawId].join(","));
		}
	});

	const btn = document.getElementById("printBtn");
	const oldText = btn.innerText;

	try {
		const response = await fetch("/upload", {
			method: "POST",
			body: formData,
		});

		if (response.ok) {
			console.log("Print successful");
			btn.innerText = "Command Dispatched";
			btn.style.backgroundColor = "#34c759";
			btn.style.boxShadow = "0 6px 16px rgba(52, 199, 89, 0.4)";
		} else {
			console.error("Server returned an error:", response.status);
			btn.innerText = "Error Occurred";
			btn.style.backgroundColor = "#ff3b30";
		}
	} catch (error) {
		console.error("Communication error with Node server:", error);
		btn.innerText = "Connection Failed";
		btn.style.backgroundColor = "#ff3b30";
	} finally {
		setTimeout(() => {
			btn.innerText = oldText;
			btn.style.backgroundColor = "";
			btn.style.boxShadow = "";
		}, 2500);
	}
}
