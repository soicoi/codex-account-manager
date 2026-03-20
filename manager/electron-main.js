"use strict";

const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const core = require("./core");

let mainWindow = null;
const windowIcon = path.join(__dirname, "assets", "app-icon.ico");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1180,
    minHeight: 780,
    backgroundColor: "#11161d",
    autoHideMenuBar: true,
    title: "Codex Account Manager",
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  app.setName("Codex Account Manager");
  if (process.platform === "win32") {
    app.setAppUserModelId("com.kendy.codex-account-manager");
  }

  ipcMain.handle("manager:get-state", () => core.loadState());
  ipcMain.handle("manager:refresh", () => core.refreshUsage());
  ipcMain.handle("manager:capture-current", () => core.triggerQuickCapture());
  ipcMain.handle("manager:launch-login", () => core.launchLoginTerminal());
  ipcMain.handle("manager:switch-account", (_event, accountKey) => core.switchAccount(accountKey));
  ipcMain.handle("manager:set-api-usage", (_event, enabled) => core.setApiUsage(Boolean(enabled)));
  ipcMain.handle("manager:set-auto-switch", (_event, enabled) => core.setAutoSwitch(Boolean(enabled)));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
