"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexManager", {
  getState: () => ipcRenderer.invoke("manager:get-state"),
  refresh: () => ipcRenderer.invoke("manager:refresh"),
  captureCurrent: () => ipcRenderer.invoke("manager:capture-current"),
  launchLogin: () => ipcRenderer.invoke("manager:launch-login"),
  switchAccount: (accountKey) => ipcRenderer.invoke("manager:switch-account", accountKey),
  setApiUsage: (enabled) => ipcRenderer.invoke("manager:set-api-usage", enabled),
  setAutoSwitch: (enabled) => ipcRenderer.invoke("manager:set-auto-switch", enabled),
});
