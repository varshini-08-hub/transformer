const API = "";
const state = { settings: null, latest: null, readings: [], alerts: [], charts: {}, sparks: {}, lastAlertCount: 0 };
const $ = (id) => document.getElementById(id);
const fmt = (v, digits=1) => Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : "—";
const dateTime = (value) => value ? new Date(value).toLocaleString() : "—";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path, options={}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function toast(message, error=false) {
  const el = document.createElement("div");
  el.className = `toast${error ? " error" : ""}`;
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
function statusClass(status) { return String(status || "UNKNOWN").toLowerCase(); }
function severityBadge(s) { return `<span class="severity ${esc(s)}">${esc(s)}</span>`; }
function setConnection(online, connected) {
  const el = $("connection");
  el.className = `connection ${connected ? "online" : "offline"}`;
  el.innerHTML = `<span class="dot"></span>${online ? (connected ? "Wokwi connected" : "API online · waiting for data") : "API offline"}`;
}
function initIcons() { if (window.lucide) window.lucide.createIcons(); }
function createLineChart(canvasId, color, spark=false) {
  const canvas = $(canvasId);
  if (!canvas || !window.Chart) return null;
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: [], datasets: [{ data: [], borderColor: color, backgroundColor: `${color}20`, fill: !spark, borderWidth: spark ? 1.7 : 2, tension: .36, pointRadius: 0, pointHoverRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: !spark, backgroundColor: "#15283c", titleColor: "#dcecff", bodyColor: "#9bb2c9", borderColor: "#34516b", borderWidth: 1 } },
      scales: spark ? { x: { display: false }, y: { display: false } } : {
        x: { grid: { display: false }, ticks: { color: "#6f849a", maxTicksLimit: 5, font: { size: 9 } }, border: { display: false } },
        y: { grid: { color: "#203146" }, ticks: { color: "#6f849a", maxTicksLimit: 5, font: { size: 9 } }, border: { display: false } }
      }
    }
  });
  return chart;
}
function initCharts() {
  state.charts.voltage = createLineChart("voltageChart", "#4c8dff");
  state.charts.current = createLineChart("currentChart", "#35c6d8");
  state.charts.temperature = createLineChart("temperatureChart", "#ffad55");
  state.sparks.voltage = createLineChart("voltageSpark", "#4c8dff", true);
  state.sparks.current = createLineChart("currentSpark", "#35c6d8", true);
  state.sparks.temperature = createLineChart("temperatureSpark", "#ffad55", true);
}
function updateChart(chart, readings, key) {
  if (!chart) return;
  chart.data.labels = readings.map(r => new Date(r.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}));
  chart.data.datasets[0].data = readings.map(r => Number(r[key]));
  chart.update("none");
}
function metricState(value, key, s) {
  if (value == null || !s) return "Waiting for data";
  if (key === "voltage") {
    if (value < s.voltageCriticalLow || value > s.voltageCriticalHigh) return "Critical threshold";
    if (value < s.voltageWarningLow || value > s.voltageWarningHigh) return "Outside warning range";
  } else if (key === "current") {
    if (value >= s.currentCritical) return "Critical threshold";
    if (value >= s.currentWarning) return "Warning threshold";
  } else {
    if (value >= s.temperatureCritical) return "Critical threshold";
    if (value >= s.temperatureWarning) return "Warning threshold";
  }
  return "Within configured limits";
}
function updateMetrics(r) {
  const keys = ["voltage","current","temperature"];
  const digits = {voltage:1,current:2,temperature:1};
  keys.forEach(key => {
    $(key+"Value").textContent = r ? fmt(r[key], digits[key]) : "—";
    const node = $(key+"State");
    node.textContent = r ? metricState(Number(r[key]), key, state.settings) : "Waiting for data";
    node.style.color = !r ? "" : (node.textContent.includes("Critical") ? "var(--red)" : node.textContent.includes("warning") || node.textContent.includes("Warning") ? "var(--orange)" : "var(--green)");
  });
  const status = r?.status || "UNKNOWN";
  $("overallStatus").className = `status-pill ${statusClass(status)}`;
  $("overallStatus").textContent = status;
  $("healthValue").textContent = status;
  $("healthSub").textContent = r ? `Source: ${r.source || "WOKWI"}` : "No recent reading";
  $("healthFoot").textContent = r ? "Rule-based assessment" : "Waiting for data";
  $("healthRing").className = `health-ring ${statusClass(status)}`;
  $("lastUpdate").textContent = r ? `Updated ${new Date(r.createdAt).toLocaleTimeString()}` : "Last update —";
  const banner = $("statusBanner");
  banner.className = `banner ${statusClass(status)==="unknown" ? "" : statusClass(status)}`;
  $("bannerTitle").textContent = status === "NORMAL" ? "All monitored values are within configured limits" : status === "WARNING" ? "Warning condition detected" : status === "CRITICAL" ? "Critical condition detected" : "Waiting for sensor data";
  $("bannerText").textContent = r ? `Last packet received ${dateTime(r.createdAt)} · ${r.source === "DEMO" ? "DEMO MODE" : "Wokwi simulation"}` : "Start Wokwi or send a demo reading to begin monitoring.";
  $("liveStatus").className = `status-pill ${statusClass(status)}`;
  $("liveStatus").textContent = status;
  $("liveSource").textContent = r ? `${r.deviceId} · ${r.source === "DEMO" ? "DEMO MODE" : "WOKWI DEVICE"}` : "No data source detected";
  $("liveSourceText").textContent = r ? `Last packet: ${dateTime(r.createdAt)}` : "Send readings to the API to start monitoring.";
  $("latestJson").textContent = r ? JSON.stringify(r, null, 2) : "Waiting for a reading…";
  const liveMetrics = $("liveMetrics");
  if (liveMetrics) liveMetrics.innerHTML = keys.map(key => `<article class="metric-card"><div class="metric-head"><span>${key[0].toUpperCase()+key.slice(1)}</span></div><div class="metric-value"><strong>${r ? fmt(r[key],digits[key]) : "—"}</strong><span>${key==="voltage"?"V":key==="current"?"A":"°C"}</span></div><div class="metric-foot"><span class="mini-state">${esc(r ? metricState(Number(r[key]),key,state.settings) : "Waiting for data")}</span></div></article>`).join("");
}
function renderRecentAlerts() {
  const alerts = state.alerts.slice(0,5);
  $("recentAlerts").innerHTML = alerts.length ? alerts.map(a => `<tr><td>${severityBadge(a.severity)}</td><td>${esc(a.type)} — ${esc(a.message)}</td><td>${fmt(a.value,2)}</td><td>${dateTime(a.createdAt)}</td><td>${a.acknowledged ? '<span class="ack-pill">Acknowledged</span>' : '<span class="unack-pill">Open</span>'}</td></tr>`).join("") : '<tr><td colspan="5" class="empty">No alerts yet. Try the demo generator or turn a Wokwi potentiometer.</td></tr>';
  $("alertBadge").textContent = state.alerts.filter(a => !a.acknowledged).length;
}
function renderAlerts() {
  const filter = $("severityFilter")?.value || "";
  const alerts = state.alerts.filter(a => !filter || a.severity === filter);
  $("alertsTable").innerHTML = alerts.length ? alerts.map(a => `<tr><td>${severityBadge(a.severity)}</td><td><strong>${esc(a.type)}</strong><br><span class="muted">${esc(a.message)}</span></td><td>${fmt(a.value,2)}</td><td>${fmt(a.threshold,2)}</td><td>${dateTime(a.createdAt)}</td><td>${dateTime(a.lastSeenAt)}</td><td>${a.acknowledged ? '<span class="ack-pill">Acknowledged</span>' : `<button class="outline-btn ack-btn" data-id="${a.id}">Acknowledge</button>`}</td></tr>`).join("") : '<tr><td colspan="7" class="empty">No matching alerts.</td></tr>';
}
function renderHistory() {
  const readings = state.readings;
  const key = $("historySensor").value;
  $("historyCount").textContent = `${readings.length} records`;
  $("historyTable").innerHTML = readings.length ? readings.slice().reverse().map(r => `<tr><td>${dateTime(r.createdAt)}</td><td>${esc(r.deviceId)}</td><td>${fmt(r.voltage,1)} V</td><td>${fmt(r.current,2)} A</td><td>${fmt(r.temperature,1)} °C</td><td>${severityBadge(r.status)}</td><td><span class="code-tag">${esc(r.source || "WOKWI")}</span></td></tr>`).join("") : '<tr><td colspan="7" class="empty">No readings saved yet.</td></tr>';
  if (key) {
    updateChart(state.charts[key], readings, key);
  } else {
    ["voltage","current","temperature"].forEach(k => updateChart(state.charts[k], readings, k));
  }
  ["voltage","current","temperature"].forEach(k => updateChart(state.sparks[k], readings.slice(-20), k));
}
async function loadSettings() {
  const result = await api("/api/settings");
  state.settings = result.settings;
  fillForm($("settingsForm"), result.settings);
  fillForm($("transformerForm"), result.settings);
}
function fillForm(form, obj) {
  if (!form) return;
  Object.entries(obj).forEach(([k,v]) => {
    const field = form.elements[k];
    if (field) {
      if (field.type === "checkbox") field.checked = Boolean(v);
      else field.value = v;
    }
  });
}
async function refresh() {
  try {
    const [health, latest, history, alerts] = await Promise.all([
      api("/api/health"), api("/api/readings/latest"), api(`/api/readings/history?limit=${encodeURIComponent($("historyLimit")?.value || 100)}`), api("/api/alerts?limit=100")
    ]);
    state.latest = latest.reading;
    state.readings = history.readings || [];
    state.alerts = alerts.alerts || [];
    setConnection(true, health.deviceConnected);
    updateMetrics(state.latest);
    renderRecentAlerts(); renderAlerts(); renderHistory();
    if (state.latest && state.latest.source === "WOKWI") $("connection").innerHTML = '<span class="dot"></span> Wokwi connected';
    else if (state.latest && state.latest.source === "DEMO") $("connection").innerHTML = '<span class="dot"></span> Demo data received';
    else if (health.ok) $("connection").innerHTML = '<span class="dot"></span> API online · waiting for data';
  } catch (e) {
    setConnection(false, false);
    $("bannerTitle").textContent = "Backend is not reachable";
    $("bannerText").textContent = "Start the Node.js server and refresh. Existing readings are not replaced with fake data.";
    $("statusBanner").className = "banner critical";
  }
}
function goTo(page) {
  document.querySelectorAll(".page").forEach(el => el.classList.toggle("active", el.id === `page-${page}`));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  const titles = {overview:"Overview",live:"Live monitoring",alerts:"Alerts",history:"Sensor history",transformer:"Transformer info",settings:"Settings"};
  $("pageTitle").textContent = titles[page] || "Overview";
  if (page === "alerts") renderAlerts();
  if (page === "history") renderHistory();
  window.scrollTo({top:0,behavior:"smooth"});
}
function downloadCsv() {
  const rows = state.readings;
  const headers = ["createdAt","deviceId","voltage","current","temperature","status","source","voltage_raw","current_raw","temperature_raw"];
  const csv = [headers.join(","), ...rows.map(r => headers.map(k => `"${String(r[k] ?? "").replace(/"/g,'""')}"`).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8;"}));
  const a = document.createElement("a"); a.href = url; a.download = "transformerguard-sensor-history.csv"; a.click(); URL.revokeObjectURL(url);
}
async function submitSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {};
  new FormData(form).forEach((v,k) => body[k] = Number(v));
  body.audibleAlerts = form.elements.audibleAlerts.checked;
  try {
    const result = await api("/api/settings", {method:"PUT", body:JSON.stringify(body)});
    state.settings = result.settings; fillForm(form,result.settings);
    toast("Monitoring settings saved."); await refresh();
  } catch(e) { toast(e.message, true); }
}
async function submitTransformer(event) {
  event.preventDefault();
  const form = event.currentTarget, body = {};
  new FormData(form).forEach((v,k) => body[k] = ["ratedVoltage","ratedCurrent"].includes(k) ? Number(v) : v);
  try {
    const result = await api("/api/settings", {method:"PUT",body:JSON.stringify(body)});
    state.settings = result.settings; toast("Transformer details saved.");
  } catch(e) { toast(e.message,true); }
}
async function acknowledge(id) {
  try { await api(`/api/alerts/${id}/acknowledge`,{method:"PATCH"}); toast("Alert acknowledged."); await refresh(); }
  catch(e) { toast(e.message,true); }
}
async function sendDemo() {
  // Deliberately explicit DEMO MODE. This is never presented as Wokwi telemetry.
  const demo = { voltage:220, current:4.5, temperature:42 };
  const choice = prompt("DEMO MODE only. Enter a scenario: normal, warning, or critical", "normal");
  if (choice === null) return;
  if (choice.toLowerCase() === "warning") { demo.current=9; demo.temperature=75; }
  else if (choice.toLowerCase() === "critical") { demo.current=14; demo.temperature=95; }
  else if (choice.toLowerCase() !== "normal") { toast("Choose normal, warning, or critical.",true); return; }
  try { await api("/api/demo/reading",{method:"POST",body:JSON.stringify(demo)}); toast(`DEMO MODE reading sent: ${choice.toUpperCase()}.`); await refresh(); }
  catch(e) { toast(e.message,true); }
}
document.addEventListener("click", e => {
  const nav = e.target.closest("[data-page]"); if (nav) goTo(nav.dataset.page);
  const goto = e.target.closest("[data-goto]"); if (goto) goTo(goto.dataset.goto);
  const ack = e.target.closest(".ack-btn"); if (ack) acknowledge(ack.dataset.id);
});
$("refreshBtn").addEventListener("click", () => refresh().then(()=>toast("Dashboard refreshed.")));
$("reloadAlerts").addEventListener("click", refresh);
$("severityFilter").addEventListener("change", renderAlerts);
$("historySensor").addEventListener("change", renderHistory);
$("historyLimit").addEventListener("change", refresh);
$("exportCsv").addEventListener("click", downloadCsv);
$("settingsForm").addEventListener("submit", submitSettings);
$("transformerForm").addEventListener("submit", submitTransformer);
$("clock").textContent = new Date().toLocaleString();
setInterval(() => { $("clock").textContent = new Date().toLocaleString(); }, 1000);
initIcons(); initCharts();
(async function start() {
  try { await loadSettings(); } catch(e) { toast("Could not load settings. Is the backend running?",true); }
  await refresh();
  setInterval(refresh, Math.max(2000, Number(state.settings?.refreshInterval || 2000)));
})();