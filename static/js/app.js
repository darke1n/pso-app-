const DEFAULT_TRIGGERS = [
  "Сахар / сладкое",
  "Молочное",
  "Глютен",
  "Алкоголь",
  "Острое / копчёное",
  "Кофеин",
  "Сухой воздух",
  "Холод / мороз",
  "Перепад погоды",
  "Жара / потливость",
  "Недосып",
  "УФ / солнце",
];

let availableTriggers = [...DEFAULT_TRIGGERS];
let selectedTriggers = new Set();
let chartInstance = null;
let currentHistoryDays = 14;
let currentModalPhotoId = null;

// Helpers
const $ = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split("T")[0];
}

function formatDateRu(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2800);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Ошибка сервера");
  }
  return data;
}

// Navigation
function switchTab(tabName) {
  document.querySelectorAll(".tab-panel").forEach((el) => {
    el.classList.toggle("active", el.id === `tab-${tabName}`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  if (tabName === "photos") loadPhotos();
  if (tabName === "history") loadHistory();
  if (tabName === "analytics") loadAnalytics();
}

// Check-in Form & Triggers
function renderTriggerChips() {
  const grid = $("triggersGrid");
  grid.innerHTML = "";
  availableTriggers.forEach((trig) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip ${selectedTriggers.has(trig) ? "selected" : ""}`;
    btn.textContent = trig;
    btn.addEventListener("click", () => {
      if (selectedTriggers.has(trig)) {
        selectedTriggers.delete(trig);
      } else {
        selectedTriggers.add(trig);
      }
      renderTriggerChips();
    });
    grid.appendChild(btn);
  });
}

function syncSliderLabels() {
  $("skinScoreVal").textContent = `${$("skinScore").value} / 10`;
  $("stressLevelVal").textContent = `${$("stressLevel").value} / 10`;
  $("sleepQualityVal").textContent = `${$("sleepQuality").value} / 10`;
}

async function loadCheckinForDate(dateStr) {
  try {
    const { item } = await apiFetch(`/api/checkins/by-date/${dateStr}`);
    if (item) {
      $("skinScore").value = item.skin_score;
      $("stressLevel").value = item.stress_level;
      $("sleepQuality").value = item.sleep_quality;
      $("checkinNote").value = item.note || "";
      selectedTriggers = new Set(item.triggers || []);
      (item.triggers || []).forEach((t) => {
        if (!availableTriggers.includes(t)) availableTriggers.push(t);
      });
      $("existingBadge").classList.remove("hidden");
      $("saveCheckinBtn").textContent = "Обновить чек-ин";
    } else {
      $("skinScore").value = 7;
      $("stressLevel").value = 4;
      $("sleepQuality").value = 7;
      $("checkinNote").value = "";
      selectedTriggers.clear();
      $("existingBadge").classList.add("hidden");
      $("saveCheckinBtn").textContent = "Сохранить чек-ин";
    }
    syncSliderLabels();
    renderTriggerChips();
  } catch (err) {
    console.error(err);
  }
}

function initCheckinTab() {
  $("checkinDate").value = todayISO();
  renderTriggerChips();
  syncSliderLabels();
  loadCheckinForDate($("checkinDate").value);

  ["skinScore", "stressLevel", "sleepQuality"].forEach((id) => {
    $(id).addEventListener("input", syncSliderLabels);
  });

  $("checkinDate").addEventListener("change", (e) => {
    if (e.target.value) loadCheckinForDate(e.target.value);
  });

  $("addCustomTriggerBtn").addEventListener("click", () => {
    const input = $("customTriggerInput");
    const val = input.value.trim();
    if (!val) return;
    if (!availableTriggers.includes(val)) {
      availableTriggers.push(val);
    }
    selectedTriggers.add(val);
    input.value = "";
    renderTriggerChips();
  });

  $("customTriggerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("addCustomTriggerBtn").click();
    }
  });

  $("checkinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("saveCheckinBtn");
    btn.disabled = true;
    try {
      const payload = {
        date: $("checkinDate").value,
        skin_score: Number($("skinScore").value),
        stress_level: Number($("stressLevel").value),
        sleep_quality: Number($("sleepQuality").value),
        triggers: Array.from(selectedTriggers),
        note: $("checkinNote").value,
      };
      const res = await apiFetch("/api/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      $("existingBadge").classList.remove("hidden");
      $("saveCheckinBtn").textContent = "Обновить чек-ин";
      showToast(res.action === "updated" ? "Чек-ин обновлён" : "Чек-ин сохранён");
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

// Photos Tab
function initPhotosTab() {
  $("photoDate").value = todayISO();

  $("photoFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      $("photoPreview").src = ev.target.result;
      $("photoPreview").classList.remove("hidden");
      $("uploadPlaceholder").classList.add("hidden");
    };
    reader.readAsDataURL(file);
  });

  $("photoZoneFilter").addEventListener("change", loadPhotos);

  $("photoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fileInput = $("photoFile");
    if (!fileInput.files.length) {
      showToast("Выберите фото");
      return;
    }

    const btn = $("uploadPhotoBtn");
    btn.disabled = true;
    try {
      const formData = new FormData();
      formData.append("date", $("photoDate").value);
      formData.append("skin_zone", $("skinZone").value);
      formData.append("note", $("photoNote").value);
      formData.append("file", fileInput.files[0]);

      await apiFetch("/api/photos", {
        method: "POST",
        body: formData,
      });

      $("photoForm").reset();
      $("photoDate").value = todayISO();
      $("photoPreview").classList.add("hidden");
      $("uploadPlaceholder").classList.remove("hidden");
      showToast("Фото загружено");
      loadPhotos();
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Modal controls
  $("closeModalBtn").addEventListener("click", closePhotoModal);
  $("modalBackdrop").addEventListener("click", closePhotoModal);
  $("modalDeleteBtn").addEventListener("click", async () => {
    if (!currentModalPhotoId) return;
    try {
      await apiFetch(`/api/photos/${currentModalPhotoId}`, { method: "DELETE" });
      closePhotoModal();
      showToast("Фото удалено");
      loadPhotos();
    } catch (err) {
      showToast(err.message);
    }
  });
}

async function loadPhotos() {
  const zone = $("photoZoneFilter").value;
  const query = zone && zone !== "Все" ? `?zone=${encodeURIComponent(zone)}` : "";
  try {
    const { items } = await apiFetch(`/api/photos${query}`);
    const grid = $("photosGrid");
    if (!items.length) {
      grid.innerHTML = `<p class="empty-hint" style="grid-column: 1 / -1;">Фотографий пока нет.</p>`;
      return;
    }
    grid.innerHTML = "";
    items.forEach((photo) => {
      const card = document.createElement("div");
      card.className = "photo-card";
      card.innerHTML = `
        <img src="${photo.file_path}" alt="${photo.skin_zone}" loading="lazy" />
        <div class="photo-card-body">
          <span class="photo-zone-tag">${photo.skin_zone}</span>
          <span class="photo-date">${formatDateRu(photo.date)}</span>
        </div>
      `;
      card.addEventListener("click", () => openPhotoModal(photo));
      grid.appendChild(card);
    });
  } catch (err) {
    showToast(err.message);
  }
}

function openPhotoModal(photo) {
  currentModalPhotoId = photo.id;
  $("modalImg").src = photo.file_path;
  $("modalZone").textContent = photo.skin_zone;
  $("modalDate").textContent = formatDateRu(photo.date);
  $("modalNote").textContent = photo.note || "Без комментария";
  $("photoModal").classList.remove("hidden");
}

function closePhotoModal() {
  currentModalPhotoId = null;
  $("photoModal").classList.add("hidden");
}

// History & Chart Tab
function initHistoryTab() {
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentHistoryDays = Number(btn.dataset.days);
      loadHistory();
    });
  });
}

async function loadHistory() {
  try {
    const [{ items }, { items: allItems }] = await Promise.all([
      apiFetch(`/api/checkins?days=${currentHistoryDays}`),
      apiFetch("/api/checkins"),
    ]);

    renderChart(items);
    renderHistoryList(allItems);
  } catch (err) {
    showToast(err.message);
  }
}

function renderChart(items) {
  const emptyMsg = $("chartEmptyMsg");
  const canvas = $("trendChart");

  if (!items.length) {
    emptyMsg.classList.remove("hidden");
    canvas.classList.add("hidden");
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    return;
  }

  emptyMsg.classList.add("hidden");
  canvas.classList.remove("hidden");

  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => formatDateRu(r.date).slice(0, 5));
  const skinData = sorted.map((r) => r.skin_score);
  const stressData = sorted.map((r) => r.stress_level);
  const sleepData = sorted.map((r) => r.sleep_quality);

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Кожа (1–10)",
          data: skinData,
          borderColor: "#0d9488",
          backgroundColor: "rgba(13, 148, 136, 0.12)",
          borderWidth: 3,
          tension: 0.32,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: "#0d9488",
        },
        {
          label: "Стресс (1–10)",
          data: stressData,
          borderColor: "#f97316",
          backgroundColor: "transparent",
          borderWidth: 2.5,
          tension: 0.32,
          pointRadius: 3.5,
          pointBackgroundColor: "#f97316",
        },
        {
          label: "Сон (1–10)",
          data: sleepData,
          borderColor: "#6366f1",
          backgroundColor: "transparent",
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.32,
          pointRadius: 3,
          hidden: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        y: {
          min: 1,
          max: 10,
          ticks: { stepSize: 1 },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
        x: {
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            boxWidth: 8,
          },
        },
      },
    },
  });
}

function renderHistoryList(items) {
  $("historyCount").textContent = `${items.length} записей`;
  const list = $("historyList");
  if (!items.length) {
    list.innerHTML = `<p class="empty-hint">Записей пока нет. Заполните первый чек-ин!</p>`;
    return;
  }

  list.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "history-item";

    const triggersHtml = (item.triggers || [])
      .map((t) => `<span class="trigger-tag">${escapeHtml(t)}</span>`)
      .join("");

    card.innerHTML = `
      <div class="history-top">
        <span class="history-date">${formatDateRu(item.date)}</span>
        <div class="history-actions">
          <button type="button" class="icon-btn edit-btn">Изменить</button>
          <button type="button" class="icon-btn del-btn">Удалить</button>
        </div>
      </div>
      <div class="metrics-row">
        <span class="mini-badge pill-teal">Кожа: ${item.skin_score}/10</span>
        <span class="mini-badge pill-coral">Стресс: ${item.stress_level}/10</span>
        <span class="mini-badge pill-indigo">Сон: ${item.sleep_quality}/10</span>
      </div>
      ${triggersHtml ? `<div class="history-triggers">${triggersHtml}</div>` : ""}
      ${item.note ? `<p class="history-note">${escapeHtml(item.note)}</p>` : ""}
    `;

    card.querySelector(".edit-btn").addEventListener("click", () => {
      $("checkinDate").value = item.date;
      loadCheckinForDate(item.date);
      switchTab("checkin");
    });

    card.querySelector(".del-btn").addEventListener("click", async () => {
      try {
        await apiFetch(`/api/checkins/${item.id}`, { method: "DELETE" });
        showToast("Запись удалена");
        loadHistory();
      } catch (err) {
        showToast(err.message);
      }
    });

    list.appendChild(card);
  });
}

// Analytics Tab
async function loadAnalytics() {
  try {
    const data = await apiFetch("/api/analytics");
    const s = data.summary;

    $("statAvgSkin").textContent = s.avg_skin_score !== null ? `${s.avg_skin_score}` : "—";
    $("statAvgStress").textContent = s.avg_stress_level !== null ? `${s.avg_stress_level}` : "—";
    $("statAvgSleep").textContent = s.avg_sleep_quality !== null ? `${s.avg_sleep_quality}` : "—";

    const trendEl = $("statTrend");
    if (s.trend_delta === null) {
      trendEl.textContent = "—";
      trendEl.className = "stat-value";
    } else if (s.trend_delta > 0) {
      trendEl.textContent = `+${s.trend_delta}`;
      trendEl.className = "stat-value text-teal";
    } else if (s.trend_delta < 0) {
      trendEl.textContent = `${s.trend_delta}`;
      trendEl.className = "stat-value text-danger";
    } else {
      trendEl.textContent = "0.0";
      trendEl.className = "stat-value";
    }

    const corrList = $("correlationsList");
    if (!data.trigger_correlations.length) {
      corrList.innerHTML = `<p class="empty-hint">Недостаточно данных с триггерами. Отмечайте триггеры в ежедневных чек-инах.</p>`;
    } else {
      corrList.innerHTML = "";
      data.trigger_correlations.forEach((c) => {
        const deltaClass =
          c.impact_delta < 0 ? "delta-neg" : c.impact_delta > 0 ? "delta-pos" : "delta-neutral";
        const deltaSign = c.impact_delta > 0 ? `+${c.impact_delta}` : `${c.impact_delta}`;

        const el = document.createElement("div");
        el.className = "corr-item";
        el.innerHTML = `
          <div class="corr-top">
            <span class="corr-name">${escapeHtml(c.trigger)}</span>
            <span class="corr-delta ${deltaClass}">${deltaSign} балла</span>
          </div>
          <div class="corr-meta">
            <span>Дней: <b>${c.count}</b></span>
            <span>Кожа с триггером: <b>${c.avg_skin_with}</b> (без: ${c.avg_skin_without})</span>
            <span>Совпало с ухудшением: <b>${c.worsening_rate}%</b></span>
          </div>
          <div class="corr-bar-bg">
            <div class="corr-bar-fill" style="width: ${c.worsening_rate}%; background: ${
          c.impact_delta < 0 ? "#ef4444" : "#0d9488"
        };"></div>
          </div>
        `;
        corrList.appendChild(el);
      });
    }

    const factorList = $("factorInsightsList");
    if (!data.factor_insights.length) {
      factorList.innerHTML = `<p class="empty-hint">Нужно больше разнообразных дней (высокий/низкий стресс и сон) для сравнения.</p>`;
    } else {
      factorList.innerHTML = "";
      data.factor_insights.forEach((f) => {
        const deltaClass =
          f.impact_delta < 0 ? "delta-neg" : f.impact_delta > 0 ? "delta-pos" : "delta-neutral";
        const deltaSign = f.impact_delta > 0 ? `+${f.impact_delta}` : `${f.impact_delta}`;
        const el = document.createElement("div");
        el.className = "corr-item";
        el.innerHTML = `
          <div class="corr-top">
            <span class="corr-name">${escapeHtml(f.factor)}</span>
            <span class="corr-delta ${deltaClass}">${deltaSign} балла</span>
          </div>
          <div class="corr-meta">
            <span>Дней с фактором: <b>${f.days_count}</b></span>
            <span>Средняя кожа: <b>${f.avg_skin_with}</b> против <b>${f.avg_skin_without}</b></span>
          </div>
        `;
        factorList.appendChild(el);
      });
    }
  } catch (err) {
    showToast(err.message);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Init App
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("demoSeedBtn").addEventListener("click", async () => {
    try {
      const res = await apiFetch("/api/demo-seed", { method: "POST" });
      showToast(
        res.inserted > 0
          ? `Добавлено ${res.inserted} демо-записей`
          : "Демо-данные за эти даты уже есть"
      );
      loadCheckinForDate($("checkinDate").value);
      if ($("tab-history").classList.contains("active")) loadHistory();
      if ($("tab-analytics").classList.contains("active")) loadAnalytics();
    } catch (err) {
      showToast(err.message);
    }
  });

  initCheckinTab();
  initPhotosTab();
  initHistoryTab();
});
