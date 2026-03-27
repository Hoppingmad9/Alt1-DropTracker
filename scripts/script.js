A1lib.identifyApp("appconfig.json");

window.setTimeout(function () {
  const appColor = A1lib.mixColor(255, 199, 0);
  const timestampRegex = /\[\d{2}:\d{2}:\d{2}\]/;
  const maxHistoryLines = 100;
  const pollIntervalMs = 250;

  const storageKeys = {
    selectedChat: "dropWatcher.chatIndex",
    settings: "dropWatcher.settings",
    history: "dropWatcher.history",
    trackedDrops: "dropWatcher.trackedDrops",
  };

  const defaultSettings = {
    trackEnabled: true,
    trackMode: "all", // "all" | "watchlist"
    watchlistItems: [],
    alertSeconds: 8,
    playSound: true,
    showResolved: true,
  };

  let reader = new Chatbox.default();
  reader.readargs = {
    colors: [
      A1lib.mixColor(255, 255, 255), // white text
      A1lib.mixColor(60, 183, 30), // green text
      A1lib.mixColor(245, 151, 0), // gold/yellow drop text
    ],
    backwards: true,
  };

  let trackingTimer = null;
  let findChatTimer = null;
  let pendingDrops = new Map(); // id -> pending drop
  let trackedDrops = loadTrackedDrops();
  let settings = loadSettings();

  const els = {
    statusText: document.getElementById("statusText"),
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    openSettingsBtn: document.getElementById("openSettingsBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    saveSettingsBtn: document.getElementById("saveSettingsBtn"),
    refreshChatsBtn: document.getElementById("refreshChatsBtn"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    chatSelect: document.getElementById("chatSelect"),
    chatPanel: document.getElementById("chatPanel"),
    dropsPanel: document.getElementById("dropsPanel"),
    dropsTableBody: document.getElementById("dropsTableBody"),
    emptyState: document.getElementById("emptyState"),
    dropsTable: document.getElementById("dropsTable"),
    pendingDropCount: document.getElementById("pendingDropCount"),
    alertedDropCount: document.getElementById("alertedDropCount"),
    watchModeSummary: document.getElementById("watchModeSummary"),
    settingsModal: document.getElementById("settingsModal"),
    trackEnabled: document.getElementById("trackEnabled"),
    trackModeAll: document.getElementById("trackModeAll"),
    trackModeWatchlist: document.getElementById("trackModeWatchlist"),
    watchlistItems: document.getElementById("watchlistItems"),
    alertSeconds: document.getElementById("alertSeconds"),
    playSound: document.getElementById("playSound"),
    showResolved: document.getElementById("showResolved"),
  };

  init();

  function init() {
    setStatus("Searching for chatboxes...");
    wireEvents();
    renderSettingsForm();
    renderSummary();
    renderTrackedDrops();
    updateRunningUi();
    findChats();
  }

  function wireEvents() {
    els.startBtn.addEventListener("click", startTracking);
    els.stopBtn.addEventListener("click", stopTracking);
    els.openSettingsBtn.addEventListener("click", openSettings);
    els.closeSettingsBtn.addEventListener("click", closeSettings);
    els.saveSettingsBtn.addEventListener("click", saveSettingsFromForm);
    els.refreshChatsBtn.addEventListener("click", refreshChats);
    els.clearHistoryBtn.addEventListener("click", clearHistory);

    els.chatSelect.addEventListener("change", function () {
      const index = parseInt(this.value, 10);
      if (!Number.isNaN(index) && reader.pos && reader.pos.boxes[index]) {
        reader.pos.mainbox = reader.pos.boxes[index];
        localStorage.setItem(storageKeys.selectedChat, String(index));
        showSelectedChat(reader.pos);
        setStatus(`Selected chat ${index}.`);
      }
    });

    els.settingsModal.addEventListener("click", function (event) {
      if (event.target === els.settingsModal) {
        closeSettings();
      }
    });
  }

  function findChats() {
    clearInterval(findChatTimer);
    safeClearReader();
    reader.find();

    findChatTimer = setInterval(function () {
      if (reader.pos === null) {
        reader.find();
        return;
      }

      clearInterval(findChatTimer);
      populateChatSelect(reader.pos.boxes);

      const savedIndex = parseInt(
        localStorage.getItem(storageKeys.selectedChat),
        10,
      );
      if (!Number.isNaN(savedIndex) && reader.pos.boxes[savedIndex]) {
        reader.pos.mainbox = reader.pos.boxes[savedIndex];
      } else {
        reader.pos.mainbox = reader.pos.boxes[0];
      }

      const activeIndex = reader.pos.boxes.indexOf(reader.pos.mainbox);
      els.chatSelect.value = String(activeIndex);
      showSelectedChat(reader.pos);
      setStatus("Ready.");
    }, 1000);
  }

  function updateRunningUi() {
    const isRunning = !!trackingTimer;

    els.chatPanel.style.display = isRunning ? "none" : "block";
    els.dropsPanel.style.display = isRunning ? "block" : "none";

    els.startBtn.disabled = isRunning;
    els.stopBtn.disabled = !isRunning;
  }

  function refreshChats() {
    els.chatSelect.innerHTML = '<option value="">Select Chat</option>';
    setStatus("Refreshing chatboxes...");
    findChats();
  }

  function populateChatSelect(boxes) {
    els.chatSelect.innerHTML = '<option value="">Select Chat</option>';

    boxes.forEach(function (_box, index) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `Chat ${index}`;
      els.chatSelect.appendChild(option);
    });
  }

  function showSelectedChat(chat) {
    try {
      alt1.overLayRect(
        appColor,
        chat.mainbox.rect.x,
        chat.mainbox.rect.y,
        chat.mainbox.rect.width,
        chat.mainbox.rect.height,
        2000,
        5,
      );
    } catch (error) {
      // overlay not available
    }
  }

  function startTracking() {
    if (trackingTimer) {
      return;
    }

    if (!reader.pos || !reader.pos.mainbox) {
      setStatus("No chatbox selected.");
      return;
    }

    trackingTimer = setInterval(readChatbox, pollIntervalMs);
    setStatus("Tracking drops...");
    updateRunningUi();
  }

  function stopTracking() {
    if (trackingTimer) {
      clearInterval(trackingTimer);
      trackingTimer = null;
    }
    setStatus("Stopped.");
    updateRunningUi();
  }

  function readChatbox() {
    const opts = reader.read() || [];
    let chatStr = "";

    if (!opts.length) {
      return;
    }

    for (let i = 0; i < opts.length; i++) {
      const text = opts[i].text || "";

      if (!timestampRegex.test(text) && i === 0) {
        continue;
      }

      if (timestampRegex.test(text)) {
        if (chatStr.length > 0) {
          chatStr += "\n";
        }
        chatStr += text + " ";
      } else {
        chatStr += text;
      }
    }

    if (!chatStr.trim()) {
      return;
    }

    const chatArr = chatStr.trim().split("\n");

    chatArr.forEach(function (rawLine) {
      const line = rawLine.trim();
      if (!line) {
        return;
      }

      console.log("CHAT LINE:", line);

      if (isInHistory(line)) {
        console.log("↳ Skipped (in history)");
        return;
      }

      const parsed = parseChatLine(line);

      if (!parsed) {
        console.log("↳ No match");
        return;
      }

      console.log("↳ MATCH:", parsed);

      if (parsed.kind === "beam") {
        console.log("↳ Detected BEAM drop");
        handleBeamDrop(parsed, line);
        return;
      }

      if (parsed.kind === "pet") {
        console.log("↳ Detected PET pickup");
        handlePetPickup(parsed, line);
      }
    });

    updateChatHistory(chatArr);
  }

  function parseChatLine(line) {
    const beamMatch = line.match(
      /^\[(\d{2}:\d{2}:\d{2})\]\s+A golden beam shines over one of your items\.\s+You receive:\s+(\d+)(?:\s*x)?\s+(.+?)\.?$/i,
    );

    if (beamMatch) {
      return {
        kind: "beam",
        timestamp: beamMatch[1],
        amount: parseInt(beamMatch[2], 10),
        itemName: cleanItemName(beamMatch[3]),
      };
    }

    const petMatch = line.match(
      /^\[(\d{2}:\d{2}:\d{2})\]\s+Your legendary pet finds:\s+(.+?)(?:\s+x\s+(\d+)|\s*\((\d+)\))?\.?$/i,
    );

    if (petMatch) {
      return {
        kind: "pet",
        timestamp: petMatch[1],
        itemName: cleanItemName(petMatch[2]),
        amount: petMatch[3]
          ? parseInt(petMatch[3], 10)
          : petMatch[4]
            ? parseInt(petMatch[4], 10)
            : null,
      };
    }
    console.log("PARSE FAILED:", JSON.stringify(line));
    return null;
  }

  function handleBeamDrop(parsed, rawLine) {
    if (!settings.trackEnabled) {
      return;
    }

    if (!shouldWatchItem(parsed.itemName)) {
      return;
    }

    const id = createDropId(parsed);
    const now = Date.now();

    const entry = {
      id: id,
      itemName: parsed.itemName,
      normalizedItemName: normalizeItemName(parsed.itemName),
      amount: parsed.amount,
      seenAt: parsed.timestamp,
      source: "Golden beam",
      status: "Waiting for pet",
      createdAt: now,
      resolvedAt: null,
      alertedAt: null,
      rawBeamLine: rawLine,
      rawPetLine: null,
      timerId: null,
    };

    entry.timerId = window.setTimeout(
      function () {
        markDropAlerted(entry.id);
      },
      Math.max(1, Number(settings.alertSeconds)) * 1000,
    );

    pendingDrops.set(entry.id, entry);
    trackedDrops.unshift(stripTimer(entry));
    persistTrackedDrops();
    renderSummary();
    renderTrackedDrops();
  }

  function handlePetPickup(parsed, rawLine) {
    const normalizedName = normalizeItemName(parsed.itemName);

    let candidates = Array.from(pendingDrops.values()).filter(function (entry) {
      return entry.normalizedItemName === normalizedName;
    });

    if (parsed.amount !== null && parsed.amount !== undefined) {
      const amountMatches = candidates.filter(function (entry) {
        return Number(entry.amount) === Number(parsed.amount);
      });

      if (amountMatches.length) {
        candidates = amountMatches;
      }
    }
    console.log("PET PARSED:", parsed);
    console.log("PENDING DROPS:", Array.from(pendingDrops.values()));
    const match = candidates.sort(function (a, b) {
      return a.createdAt - b.createdAt;
    })[0];

    if (!match) {
      console.log("↳ PET pickup found no pending match for:", parsed);
      return;
    }

    if (match.timerId) {
      clearTimeout(match.timerId);
    }

    match.status = "Picked up";
    match.resolvedAt = parsed.timestamp;
    match.rawPetLine = rawLine;
    pendingDrops.delete(match.id);

    updateTrackedDrop(match.id, {
      status: match.status,
      resolvedAt: match.resolvedAt,
      rawPetLine: match.rawPetLine,
    });

    persistTrackedDrops();
    renderSummary();
    renderTrackedDrops();
  }

  function markDropAlerted(id) {
    const entry = pendingDrops.get(id);
    if (!entry) {
      return;
    }

    entry.status = "Alerted - not picked up";
    entry.alertedAt = new Date().toLocaleTimeString("en-GB", { hour12: false });
    pendingDrops.delete(id);

    updateTrackedDrop(id, {
      status: entry.status,
      alertedAt: entry.alertedAt,
    });

    sendAlert(entry);
    persistTrackedDrops();
    renderSummary();
    renderTrackedDrops();
  }

  function sendAlert(entry) {
    setStatus(`Missed pickup: ${entry.itemName}`);

    try {
      alt1.overLayTextEx(
        `MISSed PICKUP: ${entry.itemName}`,
        A1lib.mixColor(255, 60, 60),
        22,
        200,
        200,
        4000,
      );
    } catch (error) {
      // overlay text not available
    }

    if (settings.playSound) {
      playAlertSound();
    }
  }

  function playAlertSound() {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return;
      }

      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.08;

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start();

      window.setTimeout(function () {
        oscillator.stop();
        ctx.close();
      }, 250);
    } catch (error) {
      // sound unsupported
    }
  }

  function shouldWatchItem(itemName) {
    if (settings.trackMode === "all") {
      return true;
    }

    const normalizedName = normalizeItemName(itemName);
    return settings.watchlistItems.some(function (entry) {
      return normalizeItemName(entry) === normalizedName;
    });
  }

  function createDropId(parsed) {
    return [
      parsed.timestamp,
      normalizeItemName(parsed.itemName),
      parsed.amount,
      Date.now(),
      Math.floor(Math.random() * 10000),
    ].join("|");
  }

  function cleanItemName(itemName) {
    return itemName.replace(/\.$/, "").trim();
  }

  function normalizeItemName(itemName) {
    return itemName.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function markDropManuallyPickedUp(id) {
    const drop = trackedDrops.find(function (entry) {
      return entry.id === id;
    });

    if (!drop) {
      return;
    }

    if (drop.status !== "Alerted - not picked up") {
      return;
    }

    pendingDrops.delete(id);

    updateTrackedDrop(id, {
      status: "Picked up (manual)",
      resolvedAt: new Date().toLocaleTimeString("en-GB", { hour12: false }),
    });

    persistTrackedDrops();
    renderSummary();
    renderTrackedDrops();
    setStatus(`Marked as picked up: ${drop.itemName}`);
  }

  function updateTrackedDrop(id, patch) {
    trackedDrops = trackedDrops.map(function (drop) {
      if (drop.id !== id) {
        return drop;
      }
      return Object.assign({}, drop, patch);
    });
  }

  function stripTimer(entry) {
    return {
      id: entry.id,
      itemName: entry.itemName,
      normalizedItemName: entry.normalizedItemName,
      amount: entry.amount,
      seenAt: entry.seenAt,
      source: entry.source,
      status: entry.status,
      createdAt: entry.createdAt,
      resolvedAt: entry.resolvedAt,
      alertedAt: entry.alertedAt,
      rawBeamLine: entry.rawBeamLine,
      rawPetLine: entry.rawPetLine,
    };
  }

  function renderTrackedDrops() {
    const rows = trackedDrops.filter(function (drop) {
      if (settings.showResolved) {
        return true;
      }
      return drop.status !== "Picked up";
    });

    els.dropsTableBody.innerHTML = "";

    if (!rows.length) {
      els.emptyState.style.display = "block";
      els.dropsTable.style.display = "none";
      return;
    }

    els.emptyState.style.display = "none";
    els.dropsTable.style.display = "table";

    rows.forEach(function (drop) {
      const tr = document.createElement("tr");
      const isAlerted = drop.status === "Alerted - not picked up";

      tr.innerHTML = `
        <td>${escapeHtml(drop.seenAt || "")}</td>
        <td>${escapeHtml(drop.itemName || "")}</td>
        <td>${escapeHtml(String(drop.amount || ""))}</td>
        <td>${escapeHtml(drop.status || "")}</td>
        <td>${escapeHtml(drop.source || "")}</td>
      `;

      if (isAlerted) {
        tr.classList.add("clickable-alert-row");
        tr.title = "Click to mark as picked up";

        tr.addEventListener("click", function () {
          markDropManuallyPickedUp(drop.id);
        });
      }

      els.dropsTableBody.appendChild(tr);
    });
  }

  function renderSummary() {
    const pendingCount = trackedDrops.filter(function (drop) {
      return drop.status === "Waiting for pet";
    }).length;

    const alertedCount = trackedDrops.filter(function (drop) {
      return drop.status === "Alerted - not picked up";
    }).length;

    els.pendingDropCount.textContent = String(pendingCount);
    els.alertedDropCount.textContent = String(alertedCount);
    els.watchModeSummary.textContent =
      settings.trackMode === "all"
        ? "All drops"
        : `${settings.watchlistItems.length} watched drop(s)`;
  }

  function openSettings() {
    renderSettingsForm();
    els.settingsModal.classList.remove("hidden");
  }

  function closeSettings() {
    els.settingsModal.classList.add("hidden");
  }

  function renderSettingsForm() {
    els.trackEnabled.checked = !!settings.trackEnabled;
    els.trackModeAll.checked = settings.trackMode === "all";
    els.trackModeWatchlist.checked = settings.trackMode === "watchlist";
    els.watchlistItems.value = settings.watchlistItems.join("\n");
    els.alertSeconds.value = String(settings.alertSeconds);
    els.playSound.checked = !!settings.playSound;
    els.showResolved.checked = !!settings.showResolved;
  }

  function saveSettingsFromForm() {
    settings = {
      trackEnabled: els.trackEnabled.checked,
      trackMode: els.trackModeWatchlist.checked ? "watchlist" : "all",
      watchlistItems: els.watchlistItems.value
        .split(/\r?\n/)
        .map(function (item) {
          return item.trim();
        })
        .filter(Boolean),
      alertSeconds: clampNumber(parseInt(els.alertSeconds.value, 10), 1, 60, 8),
      playSound: els.playSound.checked,
      showResolved: els.showResolved.checked,
    };

    localStorage.setItem(storageKeys.settings, JSON.stringify(settings));
    renderSummary();
    renderTrackedDrops();
    closeSettings();
    setStatus("Settings saved.");
  }

  function clearHistory() {
    pendingDrops.forEach(function (entry) {
      if (entry.timerId) {
        clearTimeout(entry.timerId);
      }
    });

    pendingDrops.clear();
    trackedDrops = [];
    sessionStorage.removeItem(storageKeys.history);
    localStorage.removeItem(storageKeys.trackedDrops);

    renderSummary();
    renderTrackedDrops();
    setStatus("History cleared.");
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(storageKeys.settings);
      if (!raw) {
        localStorage.setItem(
          storageKeys.settings,
          JSON.stringify(defaultSettings),
        );
        return Object.assign({}, defaultSettings);
      }

      const parsed = JSON.parse(raw);
      return Object.assign({}, defaultSettings, parsed, {
        watchlistItems: Array.isArray(parsed.watchlistItems)
          ? parsed.watchlistItems
          : [],
      });
    } catch (error) {
      return Object.assign({}, defaultSettings);
    }
  }

  function loadTrackedDrops() {
    try {
      const raw = localStorage.getItem(storageKeys.trackedDrops);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }

  function persistTrackedDrops() {
    localStorage.setItem(
      storageKeys.trackedDrops,
      JSON.stringify(trackedDrops),
    );
  }

  function updateChatHistory(chatArr) {
    let history = [];
    const raw = sessionStorage.getItem(storageKeys.history);

    if (raw) {
      history = raw.split("\n");
    }

    chatArr.forEach(function (line) {
      history.push(line.trim());
    });

    while (history.length > maxHistoryLines) {
      history.shift();
    }

    sessionStorage.setItem(storageKeys.history, history.join("\n"));
  }

  function isInHistory(chatLine) {
    const raw = sessionStorage.getItem(storageKeys.history);
    if (!raw) {
      return false;
    }

    return raw.split("\n").some(function (line) {
      return line.trim() === chatLine.trim();
    });
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }

  function clampNumber(value, min, max, fallback) {
    if (Number.isNaN(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeClearReader() {
    if (trackingTimer) {
      clearInterval(trackingTimer);
      trackingTimer = null;
    }
  }
}, 50);
