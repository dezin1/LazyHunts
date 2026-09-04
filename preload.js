// preload.js — a única ponte entre o renderer (renderer.js, sem acesso a
// Node) e o processo principal (main.js, com acesso total). contextIsolation
// está ligado na janela principal, então o renderer NÃO enxerga
// `require`/`ipcRenderer` diretamente — só o que a gente expõe aqui, de
// propósito, via contextBridge. Mantém a superfície pequena: só o
// necessário pra carregar/salvar a lista de abas e saber a URL do jogo.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hunteraFarm", {
  loadTabs: () => ipcRenderer.invoke("tabs:load"),
  saveTabs: (tabs) => ipcRenderer.invoke("tabs:save", tabs),
  getGameUrl: () => ipcRenderer.invoke("game:url"),
  getAutomationPreloadPath: () => ipcRenderer.invoke("automation:preloadPath"),
  getAutoLaunch: () => ipcRenderer.invoke("app:getAutoLaunch"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("app:setAutoLaunch", enabled),
});
