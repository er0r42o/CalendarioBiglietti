const STORAGE_KEY = "vatican-ticket-planner-v1";
const ROME_TIME_ZONE = "Europe/Rome";

const STATUS_META = {
  bought: { label: "Bought", className: "status-bought" },
  partial: { label: "Partial", className: "status-partial" },
  pending: { label: "To buy", className: "status-pending" },
  missed: { label: "Missed", className: "status-missed" },
  "not-needed": { label: "No need", className: "status-not-needed" },
  closed: { label: "Closed", className: "status-closed" },
  due: { label: "Due", className: "status-due" },
  overdue: { label: "Overdue", className: "status-overdue" },
  upcoming: { label: "Upcoming", className: "status-upcoming" }
};

const state = {
  settings: {
    releaseTime: "12:00",
    leadDays: 60
  },
  tickets: [],
  visibleMonth: "",
  selectedVisitDate: "",
  lastNotificationDate: ""
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  loadState();
  hydrateSettings();
  wireEvents();
  setInitialDates();
  renderAll();
  window.setInterval(renderClockAndReminder, 1000);
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
    "statusMessage",
    "reminderButton",
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
    "deleteButton",
    "csvButton",
    "calendarGrid",
    "monthLabel",
    "prevMonth",
    "nextMonth",
    "recordsBody",
    "emptyState",
    "searchRecords",
    "statusFilter",
    "todayButton",
    "exportButton",
    "importFile"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    state.settings = normalizeSettings(saved.settings || {});
    state.tickets = Array.isArray(saved.tickets)
      ? saved.tickets.map(normalizeImportedTicket).filter((ticket) => ticket.visitDate)
      : [];
    state.lastNotificationDate = saved.lastNotificationDate || "";
  } catch {
    setStatusMessage("Saved data could not be read.");
  }
}

function normalizeSettings(savedSettings = {}) {
  const legacyDays =
    Number.isFinite(Number(savedSettings.offsetMonths)) && !Number.isFinite(Number(savedSettings.leadDays))
      ? Number(savedSettings.offsetMonths) * 30
      : undefined;
  const leadDays = Number(savedSettings.leadDays ?? legacyDays ?? 60);

  return {
    releaseTime: savedSettings.releaseTime || "12:00",
    leadDays: Number.isFinite(leadDays) ? clamp(Math.round(leadDays), 1, 365) : 60
  };
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      settings: state.settings,
      tickets: state.tickets,
      lastNotificationDate: state.lastNotificationDate
    })
  );
}

function hydrateSettings() {
  els.releaseTime.value = state.settings.releaseTime;
  els.leadDays.value = String(state.settings.leadDays);
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

  els.clearFormButton.addEventListener("click", () => {
    resetForm(state.selectedVisitDate || getTodayTargetDate());
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

  els.todayButton.addEventListener("click", () => {
    const visitDate = getTodayTargetDate();
    pickVisitDate(visitDate);
    state.visibleMonth = getMonthKey(fromISO(visitDate));
    renderAll();
  });

  els.exportButton.addEventListener("click", exportJson);
  els.csvButton.addEventListener("click", exportCsv);
  els.importFile.addEventListener("change", importJson);

  els.reminderButton.addEventListener("click", requestReminderPermission);
}

function setInitialDates() {
  const targetDate = getTodayTargetDate();
  state.visibleMonth = getMonthKey(fromISO(targetDate));
  state.selectedVisitDate = targetDate;
  resetForm(targetDate);
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
    maybeNotify(romeDate, currentTargetDate);
  } else {
    els.releaseCountdown.textContent = `Opens in ${formatDuration(
      releaseInstant.getTime() - now.getTime()
    )}`;
  }
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
  const filter = els.statusFilter.value;
  const query = els.searchRecords.value.trim().toLowerCase();
  const rows = state.tickets
    .slice()
    .sort((a, b) => {
      const dateCompare = a.visitDate.localeCompare(b.visitDate);
      if (dateCompare !== 0) return dateCompare;
      return String(a.purchaseDateTime || "").localeCompare(String(b.purchaseDateTime || ""));
    })
    .filter((ticket) => filter === "all" || ticket.status === filter)
    .filter((ticket) => {
      if (!query) return true;
      return [
        ticket.visitDate,
        getReleaseDateForVisit(ticket.visitDate),
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
    });

  els.recordsBody.innerHTML = "";
  els.emptyState.classList.toggle("is-visible", rows.length === 0);

  rows.forEach((ticket) => {
    const tr = document.createElement("tr");
    const releaseDate = getReleaseDateForVisit(ticket.visitDate);
    tr.dataset.recordId = ticket.id;
    tr.innerHTML = `
      <td>${formatDate(ticket.visitDate)}</td>
      <td>${formatShortDate(releaseDate)}</td>
      <td>${renderPillHtml(ticket.status)}</td>
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
      if (event.target.closest("a, button")) return;
      openPurchaseRecord(ticket);
    });
    els.recordsBody.appendChild(tr);
  });

  els.recordsBody.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = state.tickets.find((ticket) => ticket.id === button.dataset.edit);
      if (record) openPurchaseRecord(record);
    });
  });

  refreshIcons();
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
  renderAll();
}

function openPurchaseRecord(record) {
  state.selectedVisitDate = record.visitDate;
  state.visibleMonth = getMonthKey(fromISO(record.visitDate));
  fillForm(record);
  renderAll();
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
  els.searchRecords.value = visitDate;
  els.statusFilter.value = "all";

  if (summary.records.length > 0) {
    fillForm(summary.records[0]);
    setStatusMessage(`Opened ${summary.records.length} records for ${formatDate(visitDate)}.`);
  } else {
    resetForm(visitDate);
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
  if (releaseDate < today) return "overdue";
  if (releaseDate === today) return "due";
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
  if (boughtRecords.length > 0 && pendingRecords.length > 0) return "partial";
  if (boughtRecords.length > 0) return "bought";
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

  Notification.requestPermission().then((permission) => {
    if (permission === "granted") setStatusMessage("Reminder enabled while this page is open.");
    else setStatusMessage("Reminder permission was not enabled.");
  });
}

function maybeNotify(romeDate, visitDate) {
  if (state.lastNotificationDate === romeDate) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  state.lastNotificationDate = romeDate;
  saveState();
  new Notification("Vatican tickets are open", {
    body: `Buy tickets for ${formatDate(visitDate)} now.`
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

function exportCsv() {
  const header = [
    "Visit date",
    "Release date",
    "Status",
    "Account",
    "Bought at",
    "Quantity",
    "Entry time",
    "Confirmation",
    "Total cost",
    "Booking link",
    "Notes"
  ];
  const rows = state.tickets
    .slice()
    .sort((a, b) => a.visitDate.localeCompare(b.visitDate))
    .map((ticket) => [
      ticket.visitDate,
      getReleaseDateForVisit(ticket.visitDate),
      ticket.status,
      ticket.accountName || "",
      ticket.purchaseDateTime || "",
      normalizeQuantity(ticket.quantity),
      ticket.visitTime || "",
      ticket.confirmation || "",
      ticket.totalCost || "",
      ticket.bookingLink || "",
      ticket.notes || ""
    ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  downloadText(`vatican-ticket-records-${getRomeDateISO()}.csv`, csv, "text/csv");
  setStatusMessage("CSV exported.");
}

function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result));
      if (!Array.isArray(imported.tickets)) {
        throw new Error("Missing tickets array");
      }
      state.settings = normalizeSettings(imported.settings || {});
      state.tickets = imported.tickets.map(normalizeImportedTicket).filter((ticket) => ticket.visitDate);
      hydrateSettings();
      saveState();
      setInitialDates();
      renderAll();
      setStatusMessage("Backup imported.");
    } catch {
      setStatusMessage("Import failed. Choose a planner JSON backup.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function normalizeImportedTicket(ticket) {
  return {
    id: ticket.id || makeId(),
    visitDate: ticket.visitDate,
    status: STATUS_META[ticket.status] ? ticket.status : "bought",
    accountName: ticket.accountName || "",
    purchaseDateTime: ticket.purchaseDateTime || "",
    quantity: normalizeQuantity(ticket.quantity),
    visitTime: ticket.visitTime || "",
    confirmation: ticket.confirmation || "",
    totalCost: ticket.totalCost || "",
    bookingLink: ticket.bookingLink || "",
    notes: ticket.notes || "",
    createdAt: ticket.createdAt || new Date().toISOString(),
    updatedAt: ticket.updatedAt || new Date().toISOString()
  };
}

function renderPillHtml(status) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return `<span class="status-pill ${meta.className}">${meta.label}</span>`;
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

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
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
