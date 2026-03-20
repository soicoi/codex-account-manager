"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const codexHome = path.join(os.homedir(), ".codex");
const accountsDir = path.join(codexHome, "accounts");
const registryPath = path.join(accountsDir, "registry.json");
const activeAuthPath = path.join(codexHome, "auth.json");
const codexAuthBin = resolveCodexAuthBinary();
const bundledCodexLaunchCommand = resolveBundledCodexLaunchCommand();
const windowsCmd = resolveWindowsCmd();

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function filesEqual(leftPath, rightPath) {
  try {
    const [left, right] = await Promise.all([
      fsp.readFile(leftPath),
      fsp.readFile(rightPath),
    ]);
    return left.equals(right);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function backupTimestamp() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

async function nextBackupPath(baseName) {
  await fsp.mkdir(accountsDir, { recursive: true });
  const stamp = backupTimestamp();
  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : `.${index}`;
    const candidate = path.join(accountsDir, `${baseName}.bak.${stamp}${suffix}`);
    try {
      await fsp.access(candidate, fs.constants.F_OK);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

async function pruneBackups(baseName, keep = 5) {
  let names = [];
  try {
    names = await fsp.readdir(accountsDir);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  const prefix = `${baseName}.bak.`;
  const backups = names
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => b.localeCompare(a));

  for (const name of backups.slice(keep)) {
    await fsp.rm(path.join(accountsDir, name), { force: true });
  }
}

async function backupIfChanged(baseName, currentPath, nextPath) {
  try {
    await fsp.access(currentPath, fs.constants.F_OK);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  if (await filesEqual(currentPath, nextPath)) return;
  const backupPath = await nextBackupPath(baseName);
  await fsp.copyFile(currentPath, backupPath);
  await pruneBackups(baseName, 5);
}

async function backupExistingFile(baseName, currentPath) {
  try {
    await fsp.access(currentPath, fs.constants.F_OK);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  const backupPath = await nextBackupPath(baseName);
  await fsp.copyFile(currentPath, backupPath);
  await pruneBackups(baseName, 5);
}

function fileKeyNeedsEncoding(key) {
  if (!key || key === "." || key === "..") return true;
  return /[^A-Za-z0-9._-]/.test(key);
}

function toBase64Url(raw) {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function accountSnapshotFileName(accountKey) {
  const fileKey = fileKeyNeedsEncoding(accountKey) ? toBase64Url(accountKey) : accountKey;
  return `${fileKey}.auth.json`;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function runCodexAuth(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexAuthBin, args, {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      const error = new Error(stderr.trim() || stdout.trim() || `codex-auth exited with ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function parseStatus(rawStatus) {
  const result = {
    autoSwitch: null,
    service: "unknown",
    usageMode: "unknown",
    thresholds: null,
  };

  for (const line of rawStatus.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "auto-switch") result.autoSwitch = value;
    if (key === "service") result.service = value;
    if (key === "usage") result.usageMode = value;
    if (key === "thresholds") result.thresholds = value;
  }

  return result;
}

function resolveWindow(snapshot, minutes, fallbackKey) {
  if (!snapshot) return null;
  if (snapshot.primary && snapshot.primary.window_minutes === minutes) return snapshot.primary;
  if (snapshot.secondary && snapshot.secondary.window_minutes === minutes) return snapshot.secondary;
  return snapshot[fallbackKey] || null;
}

function remainingPercent(window) {
  if (!window || typeof window.used_percent !== "number") return null;
  return Math.floor(Math.max(0, Math.min(100, 100 - window.used_percent)));
}

function formatReset(window) {
  if (!window || !window.resets_at) return "-";
  const resetDate = new Date(window.resets_at * 1000);
  const now = new Date();
  if (Number.isNaN(resetDate.getTime())) return "-";
  if (resetDate.getTime() <= Date.now()) return "Reset";

  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(resetDate);
  const sameDay = resetDate.toDateString() === now.toDateString();
  if (sameDay) return timeLabel;
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(resetDate);
  return `${timeLabel} ${dateLabel}`;
}

function formatAbsolute(unixSeconds) {
  if (!unixSeconds) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

function formatRelativeTime(unixSeconds) {
  if (!unixSeconds) return "Never";
  const deltaMs = Date.now() - (unixSeconds * 1000);
  const minutes = Math.round(deltaMs / 60000);
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function scoreAccount(account) {
  const values = [account.usage5h.remaining, account.usageWeekly.remaining].filter((value) => typeof value === "number");
  if (values.length === 0) return 100;
  return Math.min(...values);
}

function buildPlanStats(accounts) {
  const buckets = new Map();
  for (const account of accounts) {
    const key = String(account.plan || "unknown").toUpperCase();
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return Array.from(buckets.entries()).map(([plan, count]) => ({ plan, count }));
}

function buildInsights(accounts, active, recommended) {
  return {
    totalAccounts: accounts.length,
    activeAccount: active,
    recommendedAccount: recommended,
    lowQuotaCount: accounts.filter((account) => (account.usage5h.remaining ?? 100) < 20 || (account.usageWeekly.remaining ?? 100) < 20).length,
    planStats: buildPlanStats(accounts),
  };
}

async function loadState() {
  const [registry, statusOutput] = await Promise.all([
    readJson(registryPath, {
      schema_version: 3,
      active_account_key: null,
      active_account_activated_at_ms: null,
      auto_switch: {
        enabled: false,
        threshold_5h_percent: 10,
        threshold_weekly_percent: 5,
      },
      api: {
        usage: true,
      },
      accounts: [],
    }),
    runCodexAuth(["status"]).catch(() => ({ stdout: "" })),
  ]);

  const accounts = (registry.accounts || []).map((account) => {
    const usage5hWindow = resolveWindow(account.last_usage, 300, "primary");
    const weeklyWindow = resolveWindow(account.last_usage, 10080, "secondary");
    return {
      accountKey: account.account_key,
      email: account.email,
      alias: account.alias || "",
      label: account.alias ? `${account.alias} (${account.email})` : account.email,
      plan: account.plan || account.last_usage?.plan_type || "unknown",
      authMode: account.auth_mode || "unknown",
      isActive: registry.active_account_key === account.account_key,
      createdAt: account.created_at || null,
      createdAtLabel: formatAbsolute(account.created_at),
      lastUsedAt: account.last_used_at || null,
      lastUsedAtLabel: formatAbsolute(account.last_used_at),
      lastUsageAt: account.last_usage_at || null,
      freshnessLabel: formatRelativeTime(account.last_usage_at || account.last_used_at),
      snapshotFile: accountSnapshotFileName(account.account_key),
      usage5h: {
        remaining: remainingPercent(usage5hWindow),
        resetLabel: formatReset(usage5hWindow),
      },
      usageWeekly: {
        remaining: remainingPercent(weeklyWindow),
        resetLabel: formatReset(weeklyWindow),
      },
    };
  });

  const recommended = [...accounts].sort((left, right) => scoreAccount(right) - scoreAccount(left))[0] || null;
  const active = accounts.find((account) => account.isActive) || null;

  const average = accounts.reduce((summary, account) => {
    if (typeof account.usage5h.remaining === "number") {
      summary.total5h += account.usage5h.remaining;
      summary.count5h += 1;
    }
    if (typeof account.usageWeekly.remaining === "number") {
      summary.totalWeekly += account.usageWeekly.remaining;
      summary.countWeekly += 1;
    }
    return summary;
  }, { total5h: 0, count5h: 0, totalWeekly: 0, countWeekly: 0 });

  return {
    codexHome,
    registryPath,
    status: parseStatus(statusOutput.stdout || ""),
    settings: {
      autoSwitch: registry.auto_switch || { enabled: false, threshold_5h_percent: 10, threshold_weekly_percent: 5 },
      api: registry.api || { usage: true },
    },
    overview: {
      totalAccounts: accounts.length,
      activeAccount: active,
      recommendedAccount: recommended,
      average5hRemaining: average.count5h ? Math.round(average.total5h / average.count5h) : null,
      averageWeeklyRemaining: average.countWeekly ? Math.round(average.totalWeekly / average.countWeekly) : null,
    },
    warnings: registry.api?.usage
      ? ["Usage refresh is using the ChatGPT usage API. More current data, but higher account risk."]
      : [],
    insights: buildInsights(accounts, active, recommended),
    accounts,
  };
}

async function switchAccount(accountKey) {
  const registry = await readJson(registryPath);
  if (!registry) throw new Error("registry.json was not found");

  const target = (registry.accounts || []).find((account) => account.account_key === accountKey);
  if (!target) throw new Error("Account not found");

  const snapshotPath = path.join(accountsDir, accountSnapshotFileName(accountKey));
  await fsp.access(snapshotPath, fs.constants.F_OK);

  await backupIfChanged("auth.json", activeAuthPath, snapshotPath);
  await backupExistingFile("registry.json", registryPath);
  await fsp.copyFile(snapshotPath, activeAuthPath);

  registry.active_account_key = accountKey;
  registry.active_account_activated_at_ms = Date.now();
  const nowSeconds = Math.floor(Date.now() / 1000);
  registry.accounts = (registry.accounts || []).map((account) => {
    if (account.account_key === accountKey) {
      return { ...account, last_used_at: nowSeconds };
    }
    return account;
  });

  await writeJson(registryPath, registry);
  await pruneBackups("registry.json", 5);
  await runCodexAuth(["list"]).catch(() => {});
  return loadState();
}

async function triggerQuickCapture() {
  await fsp.access(activeAuthPath, fs.constants.F_OK);
  await runCodexAuth(["import", activeAuthPath]);
  await runCodexAuth(["list"]);
  return loadState();
}

async function refreshUsage() {
  await runCodexAuth(["list"]);
  return loadState();
}

async function setApiUsage(enabled) {
  await runCodexAuth(["config", "api", enabled ? "enable" : "disable"]);
  return loadState();
}

async function setAutoSwitch(enabled) {
  await runCodexAuth(["config", "auto", enabled ? "enable" : "disable"]);
  return loadState();
}

async function launchLoginTerminal() {
  const loginCommand = resolveLoginCommand();
  const child = spawn(windowsCmd, ["/c", "start", "", "/d", repoRoot, windowsCmd, "/k", loginCommand], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return {
    ok: true,
    message: `A login terminal was opened with: ${loginCommand}`,
  };
}

function resolveLoginCommand() {
  if (process.env.CODEX_LOGIN_COMMAND && process.env.CODEX_LOGIN_COMMAND.trim()) {
    return process.env.CODEX_LOGIN_COMMAND.trim();
  }

  if (bundledCodexLaunchCommand) {
    return bundledCodexLaunchCommand;
  }

  if (process.platform === "win32") {
    // Avoid the Windows App execution alias because it returns "Access is denied" on some systems.
    return "npx.cmd -y @openai/codex login";
  }

  return "npx -y @openai/codex login";
}

function resolveCodexAuthBinary() {
  const binaryName = process.platform === "win32" ? "codex-auth.exe" : "codex-auth";
  const packageName = platformPackageName("@loongphy/codex-auth");
  if (packageName) {
    try {
      const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
      return toUnpackedPath(path.join(packageRoot, "bin", binaryName));
    } catch {
      // fall through to dev path
    }
  }

  return process.platform === "win32"
    ? path.join(repoRoot, "node_modules", "@loongphy", "codex-auth-win32-x64", "bin", binaryName)
    : path.join(repoRoot, "node_modules", ".bin", binaryName);
}

function platformPackageName(prefix) {
  if (prefix === "@loongphy/codex-auth") {
    if (process.platform === "win32" && process.arch === "x64") return "@loongphy/codex-auth-win32-x64";
    if (process.platform === "darwin" && process.arch === "x64") return "@loongphy/codex-auth-darwin-x64";
    if (process.platform === "darwin" && process.arch === "arm64") return "@loongphy/codex-auth-darwin-arm64";
    if (process.platform === "linux" && process.arch === "x64") return "@loongphy/codex-auth-linux-x64";
  }
  if (prefix === "@openai/codex") {
    if (process.platform === "win32" && process.arch === "x64") return "@openai/codex-win32-x64";
  }
  return null;
}

function toUnpackedPath(filePath) {
  return filePath
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    .replace("/app.asar/", "/app.asar.unpacked/");
}

function resolveBundledCodexLaunchCommand() {
  const packageName = platformPackageName("@openai/codex");
  if (!packageName) return null;

  try {
    const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
    const triple = process.platform === "win32" && process.arch === "x64"
      ? "x86_64-pc-windows-msvc"
      : null;
    if (!triple) return null;

    const vendorRoot = toUnpackedPath(path.join(packageRoot, "vendor", triple));
    const binaryPath = path.join(vendorRoot, "codex", process.platform === "win32" ? "codex.exe" : "codex");
    const pathDir = path.join(vendorRoot, "path");
    if (!fs.existsSync(binaryPath)) return null;

    if (process.platform === "win32") {
      if (fs.existsSync(pathDir)) {
        return `set "PATH=${pathDir};%PATH%" && "${binaryPath}" login`;
      }
      return `"${binaryPath}" login`;
    }

    return `"${binaryPath}" login`;
  } catch {
    return null;
  }
}

function resolveWindowsCmd() {
  if (process.platform !== "win32") return "cmd";

  const comspec = process.env.ComSpec || process.env.COMSPEC;
  if (comspec && fs.existsSync(comspec)) {
    return comspec;
  }

  const windowsRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return path.join(windowsRoot, "System32", "cmd.exe");
}

module.exports = {
  activeAuthPath,
  codexHome,
  loadState,
  refreshUsage,
  registryPath,
  resolveLoginCommand,
  runCodexAuth,
  setApiUsage,
  setAutoSwitch,
  switchAccount,
  triggerQuickCapture,
  launchLoginTerminal,
};
