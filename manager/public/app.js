const api = window.codexManager || {
  getState: () => fetch("/api/state").then((res) => res.json()),
  refresh: () => fetch("/api/actions/refresh", { method: "POST" }).then((res) => res.json()),
  captureCurrent: () => fetch("/api/actions/capture-current", { method: "POST" }).then((res) => res.json()),
  launchLogin: () => fetch("/api/actions/launch-login", { method: "POST" }).then((res) => res.json()),
  switchAccount: (accountKey) => fetch(`/api/accounts/${encodeURIComponent(accountKey)}/switch`, { method: "POST" }).then((res) => res.json()),
  setApiUsage: (enabled) => fetch("/api/config/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).then((res) => res.json()),
  setAutoSwitch: (enabled) => fetch("/api/config/auto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).then((res) => res.json()),
};

const elements = {
  navItems: Array.from(document.querySelectorAll(".nav-item")),
  panels: Array.from(document.querySelectorAll(".tab-panel")),
  topbarTitle: document.getElementById("topbarTitle"),
  topbarSubtitle: document.getElementById("topbarSubtitle"),
  refreshButton: document.getElementById("refreshButton"),
  captureButton: document.getElementById("captureButton"),
  launchLoginButton: document.getElementById("launchLoginButton"),
  warningBanner: document.getElementById("warningBanner"),
  statsRow: document.getElementById("statsRow"),
  currentPanel: document.getElementById("currentPanel"),
  bestPanel: document.getElementById("bestPanel"),
  planPanel: document.getElementById("planPanel"),
  pathPanel: document.getElementById("pathPanel"),
  searchInput: document.getElementById("searchInput"),
  planFilters: document.getElementById("planFilters"),
  showAllButton: document.getElementById("showAllButton"),
  showLowQuotaButton: document.getElementById("showLowQuotaButton"),
  accountsTable: document.getElementById("accountsTable"),
  apiToggle: document.getElementById("apiToggle"),
  autoToggle: document.getElementById("autoToggle"),
  runtimePanel: document.getElementById("runtimePanel"),
  settingsLaunchLoginButton: document.getElementById("settingsLaunchLoginButton"),
  settingsCaptureButton: document.getElementById("settingsCaptureButton"),
  settingsRefreshButton: document.getElementById("settingsRefreshButton"),
  toast: document.getElementById("toast"),
};

const tabMeta = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Current state, quota health, and best next account.",
  },
  accounts: {
    title: "Accounts",
    subtitle: "Search, filter, and switch between imported Codex identities.",
  },
  settings: {
    title: "Settings",
    subtitle: "Control quota refresh mode and background switching behavior.",
  },
  "how-to-use": {
    title: "How to use",
    subtitle: "Step-by-step guidance for login, importing sessions, switching, and quota controls.",
  },
};

let currentState = null;
let currentTab = "dashboard";
let selectedPlan = "ALL";
let lowQuotaOnly = false;
let toastTimer = null;

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.style.borderColor = isError ? "rgba(255, 115, 115, 0.28)" : "rgba(79, 140, 255, 0.28)";
  elements.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 3200);
}

function quotaTone(value) {
  if (typeof value !== "number") return "mid";
  if (value >= 70) return "good";
  if (value >= 30) return "mid";
  return "low";
}

function statCard(label, value, copy) {
  return `
    <article class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-copy">${copy}</div>
    </article>
  `;
}

function quotaLine(label, bucket) {
  const remaining = typeof bucket?.remaining === "number" ? bucket.remaining : 0;
  const tone = quotaTone(bucket?.remaining);
  return `
    <div class="quota-item">
      <div>${label}</div>
      <div class="quota-bar"><div class="quota-fill ${tone}" style="width:${remaining}%"></div></div>
      <div class="quota-reset">${typeof bucket?.remaining === "number" ? `${bucket.remaining}%` : "--"} · ${bucket?.resetLabel || "-"}</div>
    </div>
  `;
}

function renderDashboard(state) {
  const active = state.overview.activeAccount;
  const recommended = state.overview.recommendedAccount;

  elements.statsRow.innerHTML = [
    statCard("Total Accounts", state.insights.totalAccounts, "Imported snapshots in the local registry."),
    statCard("Fleet Avg. 5h", state.overview.average5hRemaining != null ? `${state.overview.average5hRemaining}%` : "--", "Average remaining 5h quota across all saved account snapshots."),
    statCard("Fleet Avg. Weekly", state.overview.averageWeeklyRemaining != null ? `${state.overview.averageWeeklyRemaining}%` : "--", "Average weekly headroom across all saved account snapshots."),
    statCard("Low Quota Accounts", String(state.insights.lowQuotaCount), "Accounts below 20% in either tracked window."),
  ].join("");

  elements.currentPanel.innerHTML = active
    ? `
      <div class="panel-title">Current Account</div>
      <div class="account-focus">
        <div class="focus-line">
          <div>
            <div class="focus-email">${active.email}</div>
            <div class="focus-meta">${active.alias || active.plan} · ${active.authMode}</div>
          </div>
          <span class="pill active">Current</span>
        </div>
        <div class="quota-list">
          ${quotaLine("5h Window", active.usage5h)}
          ${quotaLine("Weekly", active.usageWeekly)}
        </div>
        <div class="focus-meta">Last used: ${active.lastUsedAtLabel}</div>
      </div>
    `
    : `
      <div class="panel-title">Current Account</div>
      <div class="empty-state">No active account found yet. Sign in and capture a session.</div>
    `;

  elements.bestPanel.innerHTML = recommended
    ? `
      <div class="panel-title">Best Account</div>
      <div class="best-candidate">
        <div class="best-card">
          <div class="best-email">${recommended.email}</div>
          <div class="best-score">5h ${recommended.usage5h.remaining ?? "--"}% · Weekly ${recommended.usageWeekly.remaining ?? "--"}%</div>
          <div class="focus-meta">${recommended.plan} plan · Last activity ${recommended.freshnessLabel}</div>
        </div>
        <button class="button button-primary" data-switch-dashboard="${encodeURIComponent(recommended.accountKey)}" ${recommended.isActive ? "disabled" : ""}>
          ${recommended.isActive ? "Already Active" : "Switch to Best"}
        </button>
      </div>
    `
    : `
      <div class="panel-title">Best Account</div>
      <div class="empty-state">No account candidates available yet.</div>
    `;

  elements.planPanel.innerHTML = `
    <div class="panel-title">Plan Breakdown</div>
    <div class="stats-list">
      ${state.insights.planStats.length
        ? state.insights.planStats.map((item) => `<div class="stat-line"><span>${item.plan}</span><strong>${item.count}</strong></div>`).join("")
        : '<div class="empty-state">No plan data available.</div>'}
    </div>
  `;

  elements.pathPanel.innerHTML = `
    <div class="panel-title">Runtime Paths</div>
    <div class="meta-list">
      <div class="meta-line"><span>Codex home</span><strong>${state.codexHome}</strong></div>
      <div class="meta-line"><span>Registry</span><strong>${state.registryPath}</strong></div>
      <div class="meta-line"><span>Service</span><strong>${state.status.service}</strong></div>
      <div class="meta-line"><span>Thresholds</span><strong>${state.status.thresholds || "-"}</strong></div>
    </div>
  `;
}

function renderPlanFilters(state) {
  const plans = ["ALL", ...state.insights.planStats.map((item) => item.plan)];
  elements.planFilters.innerHTML = plans
    .map((plan) => `
      <button class="button button-chip ${selectedPlan === plan ? "active" : ""}" data-plan-filter="${plan}">
        ${plan}
      </button>
    `)
    .join("");
}

function renderAccounts(state) {
  renderPlanFilters(state);
  const query = elements.searchInput.value.trim().toLowerCase();

  const filtered = state.accounts.filter((account) => {
    if (selectedPlan !== "ALL" && String(account.plan || "unknown").toUpperCase() !== selectedPlan) return false;
    if (lowQuotaOnly) {
      const isLow = (account.usage5h.remaining ?? 100) < 20 || (account.usageWeekly.remaining ?? 100) < 20;
      if (!isLow) return false;
    }
    if (!query) return true;
    return account.email.toLowerCase().includes(query) || account.alias.toLowerCase().includes(query);
  });

  if (!filtered.length) {
    elements.accountsTable.innerHTML = '<div class="empty-state">No accounts matched the current filters.</div>';
    return;
  }

  elements.accountsTable.innerHTML = filtered.map((account) => {
    const tone5h = quotaTone(account.usage5h.remaining);
    const toneWeekly = quotaTone(account.usageWeekly.remaining);
    return `
      <article class="table-row ${account.isActive ? "active" : ""}">
        <div class="email-cell">
          <div class="email-primary">${account.email}</div>
          <div class="email-secondary">${account.alias || account.authMode} ${account.isActive ? "· current" : ""}</div>
        </div>
        <div>
          <span class="pill ${account.isActive ? "active" : ""}">${account.plan}</span>
        </div>
        <div class="quota-stack">
          <div class="quota-badge">
            <span>5h · ${account.usage5h.resetLabel}</span>
            <span class="value ${tone5h}">${account.usage5h.remaining ?? "--"}%</span>
          </div>
          <div class="quota-badge">
            <span>Weekly · ${account.usageWeekly.resetLabel}</span>
            <span class="value ${toneWeekly}">${account.usageWeekly.remaining ?? "--"}%</span>
          </div>
        </div>
        <div class="email-secondary">${account.lastUsedAtLabel}</div>
        <div class="actions-cell">
          <button class="button button-subtle" data-switch="${encodeURIComponent(account.accountKey)}" ${account.isActive ? "disabled" : ""}>
            ${account.isActive ? "Active" : "Switch"}
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function renderSettings(state) {
  elements.apiToggle.textContent = state.settings.api.usage ? "Disable API Usage" : "Enable API Usage";
  elements.autoToggle.textContent = state.settings.autoSwitch.enabled ? "Disable Auto Switch" : "Enable Auto Switch";

  elements.runtimePanel.innerHTML = `
    <div class="panel-title">Runtime Status</div>
    <div class="meta-list">
      <div class="meta-line"><span>Usage mode</span><strong>${state.status.usageMode}</strong></div>
      <div class="meta-line"><span>Auto switch</span><strong>${state.status.autoSwitch}</strong></div>
      <div class="meta-line"><span>Service</span><strong>${state.status.service}</strong></div>
      <div class="meta-line"><span>Thresholds</span><strong>${state.status.thresholds || "-"}</strong></div>
    </div>
  `;
}

function render(state) {
  currentState = state;

  elements.warningBanner.classList.toggle("hidden", state.warnings.length === 0);
  elements.warningBanner.textContent = state.warnings.join(" ");

  renderDashboard(state);
  renderAccounts(state);
  renderSettings(state);
}

function setTab(tabName) {
  currentTab = tabName;
  for (const item of elements.navItems) {
    item.classList.toggle("active", item.dataset.tab === tabName);
  }
  for (const panel of elements.panels) {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  }
  elements.topbarTitle.textContent = tabMeta[tabName].title;
  elements.topbarSubtitle.textContent = tabMeta[tabName].subtitle;
}

async function withButton(button, action, successMessage) {
  const original = button.textContent;
  button.disabled = true;
  try {
    const result = await action();
    if (result && result.accounts) {
      render(result);
    } else if (result && result.message) {
      showToast(result.message);
    } else if (successMessage) {
      showToast(successMessage);
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function loadState(showSuccess = false) {
  try {
    const state = await api.getState();
    render(state);
    if (showSuccess) showToast("State refreshed.");
  } catch (error) {
    showToast(error.message, true);
  }
}

for (const navItem of elements.navItems) {
  navItem.addEventListener("click", () => setTab(navItem.dataset.tab));
}

elements.refreshButton.addEventListener("click", () => withButton(elements.refreshButton, () => api.refresh(), "Quota refreshed."));
elements.captureButton.addEventListener("click", () => withButton(elements.captureButton, () => api.captureCurrent(), "Current session captured."));
elements.launchLoginButton.addEventListener("click", () => withButton(elements.launchLoginButton, () => api.launchLogin(), "Login terminal opened."));
elements.settingsRefreshButton.addEventListener("click", () => withButton(elements.settingsRefreshButton, () => api.refresh(), "Quota refreshed."));
elements.settingsCaptureButton.addEventListener("click", () => withButton(elements.settingsCaptureButton, () => api.captureCurrent(), "Current session captured."));
elements.settingsLaunchLoginButton.addEventListener("click", () => withButton(elements.settingsLaunchLoginButton, () => api.launchLogin(), "Login terminal opened."));

elements.apiToggle.addEventListener("click", () => {
  const next = !(currentState && currentState.settings.api.usage);
  withButton(elements.apiToggle, () => api.setApiUsage(next), `Usage API ${next ? "enabled" : "disabled"}.`);
});

elements.autoToggle.addEventListener("click", () => {
  const next = !(currentState && currentState.settings.autoSwitch.enabled);
  withButton(elements.autoToggle, () => api.setAutoSwitch(next), `Auto switch ${next ? "enabled" : "disabled"}.`);
});

elements.searchInput.addEventListener("input", () => {
  if (currentState) renderAccounts(currentState);
});

elements.planFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-plan-filter]");
  if (!button) return;
  selectedPlan = button.dataset.planFilter;
  if (currentState) renderAccounts(currentState);
});

elements.showAllButton.addEventListener("click", () => {
  lowQuotaOnly = false;
  elements.showAllButton.classList.add("active");
  elements.showLowQuotaButton.classList.remove("active");
  if (currentState) renderAccounts(currentState);
});

elements.showLowQuotaButton.addEventListener("click", () => {
  lowQuotaOnly = true;
  elements.showLowQuotaButton.classList.add("active");
  elements.showAllButton.classList.remove("active");
  if (currentState) renderAccounts(currentState);
});

document.body.addEventListener("click", (event) => {
  const switchButton = event.target.closest("[data-switch]");
  if (switchButton) {
    const accountKey = decodeURIComponent(switchButton.dataset.switch);
    withButton(switchButton, () => api.switchAccount(accountKey), "Account switched.");
    return;
  }

  const bestButton = event.target.closest("[data-switch-dashboard]");
  if (bestButton) {
    const accountKey = decodeURIComponent(bestButton.dataset.switchDashboard);
    withButton(bestButton, () => api.switchAccount(accountKey), "Switched to best account.");
  }
});

setTab("dashboard");
loadState();
