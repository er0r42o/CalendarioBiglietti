const STORAGE_KEY = "vatican-ticket-planner-v1";
const ENCRYPTED_DATA_URL = "data/vatican-ticket-planner.enc.json";
const ROME_TIME_ZONE = "Europe/Rome";

const STATUS_META = {
  bought: { label: "Bought", className: "status-bought" },
  partial: { label: "Partial", className: "status-partial" },
  pending: { label: "To buy", className: "status-pending" },
  "sell-online": { label: "Sell online", className: "status-sell-online" },
  "sold-out": { label: "Sold out", className: "status-sold-out" },
  missed: { label: "Missed", className: "status-missed" },
  "not-needed": { label: "No need", className: "status-not-needed" },
  closed: { label: "Closed", className: "status-closed" },
  due: { label: "Due", className: "status-due" },
  upcoming: { label: "Upcoming", className: "status-upcoming" }
};

const MANUAL_STATUS_OPTIONS = [
  "bought",
  "pending",
  "sell-online",
  "sold-out",
  "missed",
  "not-needed",
  "closed"
];

const state = {
  settings: {
    releaseTime: "12:00",
    leadDays: 60,
    reminderOffsets: [60, 30]
  },
  tickets: [],
  visibleMonth: "",
  selectedVisitDate: "",
  lastNotificationDate: "",
  notifiedReminders: {}
};

const els = {};
let appStarted = false;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  wireAuthEvents();
  refreshIcons();
});

function cacheElements() {
  [
    "romeTime",
    "releaseCountdown",
    "todayTarget",
    "todayTargetStatus",
    "boughtCount",
    "ticketCount",
    "selectedDateCount",
    "selectedDateInfo",
    "releaseTime",
    "leadDays",
    "reminder60",
    "reminder30",
    "statusMessage",
    "reminderButton",
    "actionToggle",
    "actionContext",
    "plannerPanel",
    "ticketForm",
    "recordId",
    "visitDate",
    "releaseDate",
    "ticketStatus",
    "accountName",
    "purchaseDateTime",
    "ticketQuantity",
    "visitTime",
    "confirmation",
    "totalCost",
    "bookingLink",
    "notes",
    "clearFormButton",
    "closeFormButton",
    "deleteButton",
    "calendarGrid",
    "monthLabel",
    "prevMonth",
    "nextMonth",
    "recordsBody",
    "emptyState",
    "searchRecords",
    "statusFilter",
    "exportStartDate",
    "exportEndDate",
    "exportFormat",
    "reportExportButton",
    "todayButton",
    "exportButton"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  ["authScreen", "appShell", "passwordInput", "unlockButton", "authMessage"].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function wireAuthEvents() {
  els.unlockButton.addEventListener("click", unlockApp);
  els.passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") unlockApp();
  });
}

async function unlockApp() {
  const password = els.passwordInput.value;
  if (!password) {
    els.authMessage.textContent = "Enter the password.";
    return;
  }

  els.unlockButton.disabled = true;
  els.authMessage.textContent = "";

  try {
    loadState();
    await loadSharedData(password);

    if (!appStarted) {
      hydrateSettings();
      wireEvents();
      setInitialDates();
      window.setInterval(renderClockAndReminder, 1000);
      appStarted = true;
    }

    renderAll();
    els.authScreen.classList.add("is-unlocked");
    els.appShell.classList.remove("is-locked");
    els.passwordInput.value = "";
  } catch (error) {
    console.error(error);
    els.authMessage.textContent = getUnlockErrorMessage(error);
    els.unlockButton.disabled = false;
  }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    state.settings = normalizeSettings(saved.settings || {});
    state.tickets = Array.isArray(saved.tickets)
      ? mergeTickets([], saved.tickets).filter((ticket) => ticket.visitDate)
      : [];
    state.lastNotificationDate = saved.lastNotificationDate || "";
    state.notifiedReminders = saved.notifiedReminders || {};
  } catch {
    setStatusMessage("Saved data could not be read.");
  }
}

async function loadSharedData(password) {
  if (window.location.protocol === "file:") {
    throw new Error("open-with-server");
  }

  let response;
  try {
    response = await fetch(`${ENCRYPTED_DATA_URL}?v=${Date.now()}`, {
      cache: "no-store"
    });
  } catch {
    throw new Error("shared-data-unavailable");
  }

  if (!response.ok) throw new Error("shared-data-missing");

  let encryptedPayload;
  try {
    encryptedPayload = await response.json();
  } catch {
    throw new Error("shared-data-invalid");
  }

  let shared;
  try {
    shared = await decryptSharedPayload(encryptedPayload, password);
  } catch {
    throw new Error("wrong-password");
  }

  if (!Array.isArray(shared.tickets)) throw new Error("Invalid shared data");

  const sharedSettings = normalizeSettings(shared.settings || {});
  const sharedTickets = shared.tickets
    .map(normalizeImportedTicket)
    .filter((ticket) => ticket.visitDate);

  state.settings = {
    ...state.settings,
    releaseTime: sharedSettings.releaseTime,
    leadDays: sharedSettings.leadDays
  };
  state.tickets = mergeTickets(state.tickets, sharedTickets);
  saveState();
}

function getUnlockErrorMessage(error) {
  if (error.message === "wrong-password") return "Wrong password.";
  if (error.message === "open-with-server") {
    return "Open this from GitHub Pages or the local server, not by double-clicking index.html.";
  }
  if (error.message === "shared-data-missing") {
    return "Encrypted data file is missing. Upload the data folder with the site.";
  }
  if (error.message === "shared-data-invalid" || error.message === "Invalid shared data") {
    return "Encrypted data file is damaged or not the right file.";
  }
  if (error.message === "shared-data-unavailable") {
    return "Encrypted data could not load. Check the site link or connection.";
  }
  return "Could not unlock the dashboard.";
}

function normalizeSettings(savedSettings = {}) {
  const legacyDays =
    Number.isFinite(Number(savedSettings.offsetMonths)) && !Number.isFinite(Number(savedSettings.leadDays))
      ? Number(savedSettings.offsetMonths) * 30
      : undefined;
  const leadDays = Number(savedSettings.leadDays ?? legacyDays ?? 60);

  return {
    releaseTime: savedSettings.releaseTime || "12:00",
    leadDays: Number.isFinite(leadDays) ? clamp(Math.round(leadDays), 1, 365) : 60,
    reminderOffsets: normalizeReminderOffsets(savedSettings.reminderOffsets)
  };
}

function normalizeReminderOffsets(offsets) {
  const savedOffsets = Array.isArray(offsets) ? offsets.map(Number) : [60, 30];
  return savedOffsets
    .filter((offset) => [60, 30].includes(offset))
    .sort((a, b) => b - a);
}

function getSelectedReminderOffsets() {
  return [
    els.reminder60.checked ? 60 : null,
    els.reminder30.checked ? 30 : null
  ].filter(Boolean);
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      settings: state.settings,
      tickets: state.tickets,
      lastNotificationDate: state.lastNotificationDate,
      notifiedReminders: state.notifiedReminders
    })
  );
}

function hydrateSettings() {
  els.releaseTime.value = state.settings.releaseTime;
  els.leadDays.value = String(state.settings.leadDays);
  els.reminder60.checked = state.settings.reminderOffsets.includes(60);
  els.reminder30.checked = state.settings.reminderOffsets.includes(30);
}

function wireEvents() {
  els.releaseTime.addEventListener("change", () => {
    state.settings.releaseTime = els.releaseTime.value || "12:00";
    saveState();
    renderAll();
  });

  els.leadDays.addEventListener("change", () => {
    const nextValue = Number.parseInt(els.leadDays.value, 10);
    state.settings.leadDays = Number.isFinite(nextValue) ? clamp(nextValue, 1, 365) : 60;
    els.leadDays.value = String(state.settings.leadDays);
    saveState();
    updateReleaseField();
    renderAll();
  });

  [els.reminder60, els.reminder30].forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      state.settings.reminderOffsets = getSelectedReminderOffsets();
      saveState();
      renderAll();
    });
  });

  els.visitDate.addEventListener("change", () => {
    els.recordId.value = "";
    els.ticketStatus.value = isClosedVisitDate(els.visitDate.value) ? "closed" : "bought";
    state.selectedVisitDate = els.visitDate.value;
    updateReleaseField();
    renderCalendar();
  });

  els.ticketForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveTicketFromForm();
  });

  els.actionToggle.addEventListener("click", () => {
    startNewPurchase(state.selectedVisitDate || getTodayTargetDate());
  });

  els.clearFormButton.addEventListener("click", () => {
    startNewPurchase(state.selectedVisitDate || getTodayTargetDate());
  });

  els.closeFormButton.addEventListener("click", () => {
    collapsePurchaseForm();
  });

  els.deleteButton.addEventListener("click", () => {
    deleteCurrentRecord();
  });

  els.prevMonth.addEventListener("click", () => {
    state.visibleMonth = shiftMonthKey(state.visibleMonth, -1);
    renderCalendar();
  });

  els.nextMonth.addEventListener("click", () => {
    state.visibleMonth = shiftMonthKey(state.visibleMonth, 1);
    renderCalendar();
  });

  els.searchRecords.addEventListener("input", renderRecords);
  els.statusFilter.addEventListener("change", renderRecords);
  els.exportStartDate.addEventListener("change", renderRecords);
  els.exportEndDate.addEventListener("change", renderRecords);

  els.todayButton.addEventListener("click", () => {
    const visitDate = getTodayTargetDate();
    pickVisitDate(visitDate);
    state.visibleMonth = getMonthKey(fromISO(visitDate));
    renderAll();
  });

  els.exportButton.addEventListener("click", exportJson);
  els.reportExportButton.addEventListener("click", exportReport);

  els.reminderButton.addEventListener("click", requestReminderPermission);
}

function setInitialDates() {
  const targetDate = getTodayTargetDate();
  state.visibleMonth = getMonthKey(fromISO(targetDate));
  state.selectedVisitDate = targetDate;
  resetForm(targetDate);
  collapsePurchaseForm();
}

function renderAll() {
  renderClockAndReminder();
  renderOverview();
  renderCalendar();
  renderRecords();
  refreshIcons();
}

function renderClockAndReminder() {
  const now = new Date();
  const romeDate = getRomeDateISO(now);
  const releaseTime = state.settings.releaseTime;
  const releaseInstant = zonedTimeToDate(ROME_TIME_ZONE, romeDate, releaseTime);
  const currentTargetDate = getTodayTargetDate();
  const currentSummary = getDateSummary(currentTargetDate);
  const timeText = new Intl.DateTimeFormat("en-GB", {
    timeZone: ROME_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(now);

  els.romeTime.textContent = timeText;

  if (isClosedVisitDate(currentTargetDate)) {
    els.releaseCountdown.textContent = `No Sunday tickets for ${formatDate(currentTargetDate)}`;
  } else if (currentSummary.boughtQuantity > 0) {
    els.releaseCountdown.textContent = `${currentSummary.boughtQuantity} tickets recorded for today`;
  } else if (now >= releaseInstant) {
    els.releaseCountdown.textContent = `Open now for ${formatDate(currentTargetDate)}`;
  } else {
    els.releaseCountdown.textContent = `Opens in ${formatDuration(
      releaseInstant.getTime() - now.getTime()
    )}`;
  }

  maybeNotify(romeDate, currentTargetDate, releaseInstant, now);
}

function renderOverview() {
  const todayTarget = getTodayTargetDate();
  const todaySummary = getDateSummary(todayTarget);
  const selectedDate = state.selectedVisitDate || todayTarget;
  const selectedSummary = getDateSummary(selectedDate);
  const boughtRecords = state.tickets.filter((ticket) => ticket.status === "bought");
  const boughtAdmissions = boughtRecords.reduce(
    (sum, ticket) => sum + normalizeQuantity(ticket.quantity),
    0
  );
  els.todayTarget.textContent = formatDate(todayTarget);
  els.todayTargetStatus.innerHTML = renderPillHtml(todaySummary.status);
  els.boughtCount.textContent = String(boughtRecords.length);
  els.ticketCount.textContent = `${boughtAdmissions} total admissions`;
  els.selectedDateCount.textContent = String(selectedSummary.records.length);
  els.selectedDateInfo.textContent = selectedSummary.records.length
    ? `${formatDate(selectedDate)} · ${selectedSummary.totalQuantity} tickets`
    : `${formatDate(selectedDate)} · no records`;
  els.actionContext.textContent = `Selected: ${formatDate(selectedDate)}`;
}

function renderCalendar() {
  const first = fromISO(`${state.visibleMonth}-01`);
  const year = first.getFullYear();
  const month = first.getMonth();
  const label = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric"
  }).format(first);
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  els.monthLabel.textContent = label;
  els.calendarGrid.innerHTML = "";

  weekdays.forEach((weekday) => {
    const cell = document.createElement("div");
    cell.className = "weekday";
    cell.textContent = weekday;
    els.calendarGrid.appendChild(cell);
  });

  for (let i = 0; i < startOffset; i += 1) {
    const blank = document.createElement("div");
    blank.className = "blank-cell";
    els.calendarGrid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const visitDate = toISO(new Date(year, month, day));
    const summary = getDateSummary(visitDate);
    const status = summary.status;
    const weekdayLabel = formatWeekday(visitDate);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = [
      "day-cell",
      `is-${status}`,
      state.selectedVisitDate === visitDate ? "is-selected" : ""
    ]
      .filter(Boolean)
      .join(" ");
    cell.innerHTML = `
      <div class="day-number">
        <span>${day}</span>
        <span class="day-weekday">${weekdayLabel}</span>
      </div>
      ${renderPillHtml(status)}
      <div class="day-details">
        ${renderCalendarDetails(summary)}
      </div>
    `;
    cell.addEventListener("click", () => pickVisitDate(visitDate));
    els.calendarGrid.appendChild(cell);
  }
}

function renderRecords() {
  const rows = getFilteredRecords();

  els.recordsBody.innerHTML = "";
  els.emptyState.classList.toggle("is-visible", rows.length === 0);

  rows.forEach((ticket) => {
    const tr = document.createElement("tr");
    const releaseDate = getReleaseDateForVisit(ticket.visitDate);
    tr.dataset.recordId = ticket.id;
    tr.innerHTML = `
      <td>${formatDate(ticket.visitDate)}</td>
      <td>${formatShortDate(releaseDate)}</td>
      <td>${renderStatusSelectHtml(ticket)}</td>
      <td>${escapeHtml(ticket.accountName || "--")}</td>
      <td>${normalizeQuantity(ticket.quantity)}</td>
      <td>${formatDateTime(ticket.purchaseDateTime)}</td>
      <td>${ticket.visitTime || "--"}</td>
      <td>${escapeHtml(ticket.confirmation || "--")}</td>
      <td>${formatMoney(ticket.totalCost)}</td>
      <td>
        <div class="row-actions">
          ${
            ticket.bookingLink
              ? `<a class="icon-button" href="${escapeAttribute(ticket.bookingLink)}" target="_blank" rel="noreferrer" title="Open booking link"><i data-lucide="external-link"></i></a>`
              : ""
          }
          <button class="icon-button" type="button" data-edit="${ticket.id}" title="Edit record"><i data-lucide="pencil"></i></button>
        </div>
      </td>
    `;
    tr.addEventListener("click", (event) => {
      if (event.target.closest("a, button, select")) return;
      openPurchaseRecord(ticket);
    });
    els.recordsBody.appendChild(tr);
  });

  els.recordsBody.querySelectorAll("[data-status-id]").forEach((select) => {
    select.addEventListener("change", () => {
      updateTicketStatus(select.dataset.statusId, select.value);
    });
  });

  els.recordsBody.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = state.tickets.find((ticket) => ticket.id === button.dataset.edit);
      if (record) openPurchaseRecord(record);
    });
  });

  refreshIcons();
}

function updateTicketStatus(id, nextStatus) {
  const record = state.tickets.find((ticket) => ticket.id === id);
  if (!record) return;

  const status = isClosedVisitDate(record.visitDate) ? "closed" : nextStatus;
  record.status = STATUS_META[status] ? status : "pending";
  record.updatedAt = new Date().toISOString();
  saveState();
  setStatusMessage(`${formatDate(record.visitDate)} marked ${getStatusLabel(record.status).toLowerCase()}.`);
  renderAll();
}

function saveTicketFromForm() {
  const visitDate = els.visitDate.value;
  if (!visitDate) return;
  const status = isClosedVisitDate(visitDate) ? "closed" : els.ticketStatus.value;

  const existingById = state.tickets.find((ticket) => ticket.id === els.recordId.value);
  const current = existingById;
  const now = new Date().toISOString();
  const ticket = {
    id: current?.id || makeId(),
    visitDate,
    status,
    accountName: els.accountName.value.trim(),
    purchaseDateTime: els.purchaseDateTime.value,
    quantity: normalizeQuantity(els.ticketQuantity.value),
    visitTime: els.visitTime.value,
    confirmation: els.confirmation.value.trim(),
    totalCost: els.totalCost.value,
    bookingLink: els.bookingLink.value.trim(),
    notes: els.notes.value.trim(),
    createdAt: current?.createdAt || now,
    updatedAt: now
  };

  state.tickets = state.tickets.filter((item) => item.id !== current?.id);
  state.tickets.push(ticket);

  state.selectedVisitDate = visitDate;
  state.visibleMonth = getMonthKey(fromISO(visitDate));
  saveState();
  fillForm(ticket);
  setStatusMessage(`Saved purchase for ${formatDate(visitDate)}.`);
  collapsePurchaseForm();
  renderAll();
}

function openPurchaseRecord(record) {
  state.selectedVisitDate = record.visitDate;
  state.visibleMonth = getMonthKey(fromISO(record.visitDate));
  fillForm(record);
  expandPurchaseForm();
  renderAll();
}

function startNewPurchase(visitDate) {
  resetForm(visitDate);
  expandPurchaseForm();
}

function expandPurchaseForm() {
  els.plannerPanel.classList.remove("is-collapsed");
  els.actionToggle.setAttribute("aria-expanded", "true");
}

function collapsePurchaseForm() {
  els.plannerPanel.classList.add("is-collapsed");
  els.actionToggle.setAttribute("aria-expanded", "false");
}

function deleteCurrentRecord() {
  const id = els.recordId.value;
  if (!id) {
    resetForm();
    return;
  }

  const record = state.tickets.find((ticket) => ticket.id === id);
  if (!record) return;

  const confirmed = window.confirm(`Delete the record for ${formatDate(record.visitDate)}?`);
  if (!confirmed) return;

  state.tickets = state.tickets.filter((ticket) => ticket.id !== id);
  saveState();
  resetForm(record.visitDate);
  setStatusMessage(`Deleted ${formatDate(record.visitDate)}.`);
  renderAll();
}

function resetForm(visitDate = getTodayTargetDate()) {
  els.ticketForm.reset();
  els.recordId.value = "";
  els.visitDate.value = visitDate;
  els.ticketStatus.value = isClosedVisitDate(visitDate) ? "closed" : "bought";
  els.accountName.value = "";
  els.purchaseDateTime.value = toDateTimeLocalValue(new Date());
  els.ticketQuantity.value = "2";
  els.totalCost.value = "";
  state.selectedVisitDate = visitDate;
  updateReleaseField();
  renderCalendar();
}

function fillForm(ticket) {
  els.recordId.value = ticket.id;
  els.visitDate.value = ticket.visitDate;
  els.ticketStatus.value = isClosedVisitDate(ticket.visitDate) ? "closed" : ticket.status || "bought";
  els.accountName.value = ticket.accountName || "";
  els.purchaseDateTime.value = ticket.purchaseDateTime || "";
  els.ticketQuantity.value = normalizeQuantity(ticket.quantity);
  els.visitTime.value = ticket.visitTime || "";
  els.confirmation.value = ticket.confirmation || "";
  els.totalCost.value = ticket.totalCost || "";
  els.bookingLink.value = ticket.bookingLink || "";
  els.notes.value = ticket.notes || "";
  state.selectedVisitDate = ticket.visitDate;
  updateReleaseField();
  renderCalendar();
}

function pickVisitDate(visitDate) {
  const summary = getDateSummary(visitDate);
  state.selectedVisitDate = visitDate;
  state.visibleMonth = getMonthKey(fromISO(visitDate));
  els.searchRecords.value = "";
  els.statusFilter.value = "all";
  setExportRange(visitDate, visitDate);
  collapsePurchaseForm();

  if (summary.records.length > 0) {
    setStatusMessage(`Opened ${summary.records.length} records for ${formatDate(visitDate)}.`);
  } else {
    setStatusMessage(`No saved records for ${formatDate(visitDate)}.`);
  }

  renderAll();
  document.querySelector(".records-panel")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function updateReleaseField() {
  if (!els.visitDate.value) {
    els.releaseDate.value = "";
    return;
  }
  if (isClosedVisitDate(els.visitDate.value)) {
    els.releaseDate.value = "Closed Sunday (no tickets)";
    return;
  }
  els.releaseDate.value = formatDate(getReleaseDateForVisit(els.visitDate.value));
}

function getComputedStatus(visitDate) {
  if (isClosedVisitDate(visitDate)) return "closed";
  const releaseDate = getReleaseDateForVisit(visitDate);
  const today = getRomeDateISO();
  if (releaseDate <= today) return "due";
  return "upcoming";
}

function getTodayTargetDate() {
  return addDaysISO(getRomeDateISO(), state.settings.leadDays);
}

function getReleaseDateForVisit(visitDate) {
  return addDaysISO(visitDate, -state.settings.leadDays);
}

function getTicketsByVisitDate(visitDate) {
  return state.tickets.filter((ticket) => ticket.visitDate === visitDate);
}

function getDateSummary(visitDate) {
  const records = getTicketsByVisitDate(visitDate);
  const boughtRecords = records.filter((ticket) => ticket.status === "bought");
  const pendingRecords = records.filter((ticket) => ticket.status === "pending");
  const boughtQuantity = boughtRecords.reduce(
    (sum, ticket) => sum + normalizeQuantity(ticket.quantity),
    0
  );
  const totalQuantity = records.reduce(
    (sum, ticket) => sum + normalizeQuantity(ticket.quantity),
    0
  );
  const status = getAggregateStatus(visitDate, records, boughtRecords, pendingRecords);

  return {
    visitDate,
    records,
    boughtRecords,
    boughtQuantity,
    totalQuantity,
    status,
    accounts: uniqueTexts(records.map((ticket) => ticket.accountName)),
    entryTimes: uniqueTexts(records.map((ticket) => ticket.visitTime))
  };
}

function getAggregateStatus(visitDate, records, boughtRecords, pendingRecords) {
  if (isClosedVisitDate(visitDate)) return "closed";
  if (records.length === 0) return getComputedStatus(visitDate);
  const recordStatuses = new Set(records.map((ticket) => ticket.status));
  if (boughtRecords.length > 0 && recordStatuses.size > 1) return "partial";
  if (boughtRecords.length > 0) return "bought";
  if (recordStatuses.has("sell-online")) return "sell-online";
  if (recordStatuses.has("sold-out")) return "sold-out";
  if (pendingRecords.length > 0) return "pending";
  if (records.some((ticket) => ticket.status === "missed")) return "missed";
  if (records.every((ticket) => ticket.status === "not-needed")) return "not-needed";
  return getComputedStatus(visitDate);
}

function isClosedVisitDate(visitDate) {
  return fromISO(visitDate).getDay() === 0;
}

function requestReminderPermission() {
  if (!("Notification" in window)) {
    setStatusMessage("Browser notifications are not available.");
    return;
  }

  state.settings.reminderOffsets = getSelectedReminderOffsets();
  saveState();

  if (state.settings.reminderOffsets.length === 0) {
    setStatusMessage("Choose at least one reminder time.");
    return;
  }

  Notification.requestPermission().then((permission) => {
    if (permission === "granted") setStatusMessage("Reminders enabled.");
    else setStatusMessage("Reminder permission was not enabled.");
  });
}

function maybeNotify(romeDate, visitDate, releaseInstant, now) {
  if (isClosedVisitDate(visitDate)) return;
  if (getDateSummary(visitDate).boughtQuantity > 0) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!state.settings.reminderOffsets.length) return;

  const reminderWindowMs = 5 * 60 * 1000;
  state.settings.reminderOffsets.forEach((offsetMinutes) => {
    const remindAt = new Date(releaseInstant.getTime() - offsetMinutes * 60 * 1000);
    const reminderKey = `${romeDate}:${offsetMinutes}`;
    const isDue = now >= remindAt && now < new Date(remindAt.getTime() + reminderWindowMs);

    if (!isDue || state.notifiedReminders[reminderKey]) return;

    state.notifiedReminders[reminderKey] = true;
    saveState();
    new Notification(`Vatican release in ${formatReminderOffset(offsetMinutes)}`, {
      body: `Visit date: ${formatDate(visitDate)}.`
    });
  });
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    tickets: state.tickets
  };
  downloadText(
    `vatican-ticket-planner-${getRomeDateISO()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json"
  );
  setStatusMessage("Backup exported.");
}

function exportReport() {
  const records = getFilteredRecords();
  if (!records.length) {
    setStatusMessage("No records in the selected range.");
    return;
  }

  const range = getSelectedExportRange();
  if (els.exportFormat.value === "pdf") {
    exportPdfReport(records, range);
    return;
  }

  exportExcelReport(records, range);
}

function getFilteredRecords() {
  const filter = els.statusFilter.value;
  const query = els.searchRecords.value.trim().toLowerCase();
  const range = getSelectedExportRange();

  return sortTickets(state.tickets)
    .filter((ticket) => isTicketInRange(ticket, range))
    .filter((ticket) => filter === "all" || ticket.status === filter)
    .filter((ticket) => matchesRecordQuery(ticket, query));
}

function sortTickets(tickets) {
  return tickets.slice().sort((a, b) => {
    const dateCompare = a.visitDate.localeCompare(b.visitDate);
    if (dateCompare !== 0) return dateCompare;
    return String(a.purchaseDateTime || "").localeCompare(String(b.purchaseDateTime || ""));
  });
}

function matchesRecordQuery(ticket, query) {
  if (!query) return true;
  return [
    ticket.visitDate,
    getReleaseDateForVisit(ticket.visitDate),
    getStatusLabel(ticket.status),
    ticket.status,
    ticket.accountName,
    ticket.purchaseDateTime,
    ticket.confirmation,
    ticket.notes,
    ticket.bookingLink,
    ticket.visitTime
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function getSelectedExportRange() {
  const start = els.exportStartDate.value;
  const end = els.exportEndDate.value;
  if (start && end && start > end) {
    return { start: end, end: start };
  }
  return { start, end };
}

function setExportRange(start, end = start) {
  els.exportStartDate.value = start || "";
  els.exportEndDate.value = end || "";
}

function isTicketInRange(ticket, range) {
  if (range.start && ticket.visitDate < range.start) return false;
  if (range.end && ticket.visitDate > range.end) return false;
  return true;
}

function exportExcelReport(records, range) {
  const reportHtml = buildReportDocument(records, range, { printable: false });
  downloadText(
    `maxel-ticket-report-${getRangeSlug(range)}.xls`,
    `\ufeff${reportHtml}`,
    "application/vnd.ms-excel;charset=utf-8"
  );
  setStatusMessage(`Excel exported with ${records.length} records.`);
}

function exportPdfReport(records, range) {
  const reportWindow = window.open("", "_blank", "width=1100,height=800");
  if (!reportWindow) {
    setStatusMessage("Allow pop-ups to create the PDF report.");
    return;
  }

  reportWindow.document.open();
  reportWindow.document.write(buildReportDocument(records, range, { printable: true }));
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.setTimeout(() => reportWindow.print(), 450);
  setStatusMessage(`PDF report opened with ${records.length} records.`);
}

function buildReportDocument(records, range, options = {}) {
  const totals = getReportTotals(records);
  const logoSrc = new URL("assets/maxel-tour-logo.png", window.location.href).href;
  const rowsHtml = records
    .map(
      (ticket) => `
        <tr>
          <td>${escapeHtml(formatDate(ticket.visitDate))}</td>
          <td>${escapeHtml(formatDate(getReleaseDateForVisit(ticket.visitDate)))}</td>
          <td>${escapeHtml(getStatusLabel(ticket.status))}</td>
          <td>${escapeHtml(ticket.accountName || "--")}</td>
          <td>${normalizeQuantity(ticket.quantity)}</td>
          <td>${escapeHtml(formatDateTime(ticket.purchaseDateTime))}</td>
          <td>${escapeHtml(ticket.visitTime || "--")}</td>
          <td>${escapeHtml(ticket.confirmation || "--")}</td>
          <td>${escapeHtml(formatMoney(ticket.totalCost))}</td>
          <td>${ticket.bookingLink ? `<a href="${escapeAttribute(ticket.bookingLink)}">${escapeHtml(ticket.bookingLink)}</a>` : "--"}</td>
          <td>${escapeHtml(ticket.notes || "--")}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Maxel Tour Ticket Report</title>
    <style>
      body {
        margin: 24px;
        color: #102329;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12px;
      }
      .report-head {
        display: flex;
        align-items: center;
        gap: 18px;
        margin-bottom: 18px;
      }
      .report-head img {
        width: ${options.printable ? "130px" : "0"};
        height: auto;
        ${options.printable ? "" : "display: none;"}
      }
      h1 {
        margin: 0 0 5px;
        font-size: 24px;
      }
      p {
        margin: 0;
        color: #65757a;
      }
      .summary {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin: 0 0 16px;
      }
      .summary span {
        padding: 7px 9px;
        border: 1px solid #c7d5d8;
        border-radius: 6px;
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: 8px 9px;
        border: 1px solid #dde6e8;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #e5f7f8;
        color: #102329;
      }
      a {
        color: #0d6f7b;
      }
      @media print {
        body {
          margin: 14mm;
        }
        .summary span {
          break-inside: avoid;
        }
        tr {
          break-inside: avoid;
        }
      }
    </style>
  </head>
  <body>
    <div class="report-head">
      <img src="${escapeAttribute(logoSrc)}" alt="Maxel Tour" />
      <div>
        <h1>Ticket Report</h1>
        <p>${escapeHtml(getRangeLabel(range))}</p>
      </div>
    </div>
    <div class="summary">
      <span>Orders: ${records.length}</span>
      <span>Admissions: ${totals.quantity}</span>
      <span>Total value: ${escapeHtml(totals.costLabel)}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Visit</th>
          <th>Release</th>
          <th>Status</th>
          <th>Account</th>
          <th>Qty</th>
          <th>Bought</th>
          <th>Entry</th>
          <th>Confirmation</th>
          <th>Total</th>
          <th>Booking link</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </body>
</html>`;
}

function getReportTotals(records) {
  const quantity = records.reduce((sum, ticket) => sum + normalizeQuantity(ticket.quantity), 0);
  const costs = records
    .map((ticket) => Number(ticket.totalCost))
    .filter((value) => Number.isFinite(value));
  const cost = costs.reduce((sum, value) => sum + value, 0);

  return {
    quantity,
    costLabel: costs.length ? formatMoney(cost) : "--"
  };
}

function getRangeLabel(range) {
  if (range.start && range.end && range.start === range.end) return formatDate(range.start);
  if (range.start && range.end) return `${formatDate(range.start)} to ${formatDate(range.end)}`;
  if (range.start) return `From ${formatDate(range.start)}`;
  if (range.end) return `Until ${formatDate(range.end)}`;
  return "All records";
}

function getRangeSlug(range) {
  if (range.start && range.end && range.start === range.end) return range.start;
  if (range.start && range.end) return `${range.start}_to_${range.end}`;
  if (range.start) return `from_${range.start}`;
  if (range.end) return `until_${range.end}`;
  return "all";
}

function getStatusLabel(status) {
  return STATUS_META[status]?.label || status || "";
}

function normalizeImportedTicket(ticket = {}) {
  const source = ticket && typeof ticket === "object" ? ticket : {};
  const normalized = {
    id: "",
    visitDate: source.visitDate || "",
    status: STATUS_META[source.status] ? source.status : "bought",
    accountName: source.accountName || "",
    purchaseDateTime: source.purchaseDateTime || "",
    quantity: normalizeQuantity(source.quantity),
    visitTime: source.visitTime || "",
    confirmation: source.confirmation || "",
    totalCost: source.totalCost || "",
    bookingLink: source.bookingLink || "",
    notes: source.notes || "",
    createdAt: source.createdAt || new Date().toISOString(),
    updatedAt: source.updatedAt || new Date().toISOString()
  };

  normalized.id = normalizeKeyPart(source.id) || makeStableTicketId(normalized);
  return normalized;
}

function renderPillHtml(status) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return `<span class="status-pill ${meta.className}">${meta.label}</span>`;
}

function renderStatusSelectHtml(ticket) {
  const status = STATUS_META[ticket.status] ? ticket.status : "pending";
  return `
    <select class="status-select ${STATUS_META[status].className}" data-status-id="${escapeAttribute(ticket.id)}" title="Update status">
      ${renderStatusOptions(status)}
    </select>
  `;
}

function renderStatusOptions(selectedStatus) {
  return MANUAL_STATUS_OPTIONS.map((status) => {
    const selected = status === selectedStatus ? " selected" : "";
    return `<option value="${escapeAttribute(status)}"${selected}>${escapeHtml(getStatusLabel(status))}</option>`;
  }).join("");
}

function renderCalendarDetails(summary) {
  if (isClosedVisitDate(summary.visitDate)) {
    return "<span><b>Sunday</b> closed</span><span>No tickets to buy</span>";
  }

  const details = [];

  if (summary.records.length === 0) {
    details.push("<span>No purchases</span>");
    return details.join("");
  }

  details.push(`<span><b>Tickets</b> ${summary.totalQuantity}</span>`);
  details.push(`<span><b>Orders</b> ${summary.records.length}</span>`);
  details.push(`<span><b>Status</b> ${escapeHtml(joinShort(uniqueTexts(summary.records.map((ticket) => getStatusLabel(ticket.status))), 26))}</span>`);
  if (summary.entryTimes.length) details.push(`<span><b>Entry</b> ${escapeHtml(joinShort(summary.entryTimes, 24))}</span>`);
  if (summary.accounts.length) details.push(`<span><b>Acct</b> ${escapeHtml(joinShort(summary.accounts, 26))}</span>`);

  return details.join("");
}

function setStatusMessage(message) {
  els.statusMessage.textContent = message;
  if (!message) return;
  window.clearTimeout(setStatusMessage.timer);
  setStatusMessage.timer = window.setTimeout(() => {
    els.statusMessage.textContent = "";
  }, 4500);
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatDate(iso) {
  if (!iso) return "--";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(fromISO(iso));
}

function formatShortDate(iso) {
  if (!iso) return "--";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short"
  }).format(fromISO(iso));
}

function formatWeekday(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short"
  }).format(fromISO(iso));
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function formatMoney(value) {
  if (value === "" || value === undefined || value === null) return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return escapeHtml(String(value));
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR"
  }).format(number);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatReminderOffset(minutes) {
  if (minutes === 60) return "1 hour";
  return `${minutes} minutes`;
}

function addDaysISO(iso, days) {
  const date = fromISO(iso);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

function fromISO(iso) {
  return new Date(`${iso}T00:00:00`);
}

function toISO(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function toDateTimeLocalValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function shiftMonthKey(monthKey, shift) {
  const date = fromISO(`${monthKey}-01`);
  date.setMonth(date.getMonth() + shift);
  return getMonthKey(date);
}

function getRomeDateISO(date = new Date()) {
  const parts = getZonedParts(date, ROME_TIME_ZONE);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function zonedTimeToDate(timeZone, isoDate, time) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute || 0);
  let guess = new Date(targetUtc);

  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedParts(guess, timeZone);
    const guessAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    );
    guess = new Date(guess.getTime() + targetUtc - guessAsUtc);
  }

  return guess;
}

function normalizeQuantity(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function uniqueTexts(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function joinShort(values, maxLength) {
  return shorten(values.join(", "), maxLength);
}

async function decryptSharedPayload(payload, password) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable");
  }

  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const tag = base64ToBytes(payload.tag);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const encryptedBytes = concatBytes(ciphertext, tag);
  const passwordBytes = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: payload.iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128
    },
    key,
    encryptedBytes
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function concatBytes(first, second) {
  const result = new Uint8Array(first.length + second.length);
  result.set(first);
  result.set(second, first.length);
  return result;
}

function mergeTickets(existingTickets, sharedTickets) {
  const byId = new Map();

  [...existingTickets, ...sharedTickets].forEach((ticket) => {
    const normalized = normalizeImportedTicket(ticket);
    const current = byId.get(normalized.id);
    if (shouldReplaceTicket(current, normalized)) {
      byId.set(normalized.id, normalized);
    }
  });

  const byIdentity = new Map();

  byId.forEach((ticket) => {
    const identityKey = getTicketIdentityKey(ticket);
    const current = byIdentity.get(identityKey);
    if (shouldReplaceTicket(current, ticket)) {
      byIdentity.set(identityKey, ticket);
    }
  });

  return [...byIdentity.values()];
}

function shouldReplaceTicket(current, candidate) {
  if (!current) return true;

  const candidateTime = getTicketTimestamp(candidate);
  const currentTime = getTicketTimestamp(current);
  if (candidateTime !== currentTime) return candidateTime > currentTime;

  const candidateStable = isStableImportedId(candidate.id);
  const currentStable = isStableImportedId(current.id);
  if (candidateStable !== currentStable) return candidateStable;

  return getTicketCompletenessScore(candidate) >= getTicketCompletenessScore(current);
}

function getTicketTimestamp(ticket) {
  const timestamp = Date.parse(ticket.updatedAt || ticket.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getTicketCompletenessScore(ticket) {
  return [
    ticket.visitDate,
    ticket.status,
    ticket.accountName,
    ticket.purchaseDateTime,
    ticket.quantity,
    ticket.visitTime,
    ticket.confirmation,
    ticket.totalCost,
    ticket.bookingLink,
    ticket.notes
  ].filter((value) => normalizeKeyPart(value)).length;
}

function makeStableTicketId(ticket) {
  return `imported-${hashString(getTicketIdentityKey(ticket))}`;
}

function isStableImportedId(id) {
  return String(id || "").startsWith("imported-");
}

function getTicketIdentityKey(ticket) {
  const visitDate = normalizeKeyPart(ticket.visitDate);
  const confirmation = normalizeKeyPart(ticket.confirmation).toLowerCase();
  const bookingLink = normalizeKeyPart(ticket.bookingLink).toLowerCase();

  if (visitDate && confirmation) return `confirmation:${visitDate}:${confirmation}`;
  if (visitDate && bookingLink) return `booking:${visitDate}:${bookingLink}`;

  const accountName = normalizeKeyPart(ticket.accountName).toLowerCase();
  const purchaseDateTime = normalizeKeyPart(ticket.purchaseDateTime);
  const visitTime = normalizeKeyPart(ticket.visitTime);

  if (visitDate && accountName) {
    return `record:${visitDate}:${accountName}:${purchaseDateTime}:${visitTime}`;
  }

  if (visitDate && purchaseDateTime && visitTime) {
    return `timed:${visitDate}:${purchaseDateTime}:${visitTime}:${normalizeQuantity(ticket.quantity)}:${normalizeKeyPart(ticket.totalCost)}`;
  }

  return `content:${getTicketContentKey(ticket)}`;
}

function getTicketContentKey(ticket) {
  return JSON.stringify([
    normalizeKeyPart(ticket.visitDate),
    STATUS_META[ticket.status] ? ticket.status : "bought",
    normalizeKeyPart(ticket.accountName).toLowerCase(),
    normalizeKeyPart(ticket.purchaseDateTime),
    normalizeQuantity(ticket.quantity),
    normalizeKeyPart(ticket.visitTime),
    normalizeKeyPart(ticket.confirmation).toLowerCase(),
    normalizeKeyPart(ticket.totalCost),
    normalizeKeyPart(ticket.bookingLink).toLowerCase(),
    normalizeKeyPart(ticket.notes)
  ]);
}

function normalizeKeyPart(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function hashString(value) {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function makeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `ticket-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shorten(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}
