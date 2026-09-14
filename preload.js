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
  // v0.7.0 — Notificações no Telegram (config global, uma só pro app
  // inteiro — ver comentário em renderer.js).
  // v0.11.10 — detector de spawn seco (config global).
  loadSpawnConfig: () => ipcRenderer.invoke("spawn:load"),
  saveSpawnConfig: (cfg) => ipcRenderer.invoke("spawn:save", cfg),
  loadTelegramConfig: () => ipcRenderer.invoke("telegram:load"),
  saveTelegramConfig: (cfg) => ipcRenderer.invoke("telegram:save", cfg),
  testTelegram: (cfg) => ipcRenderer.invoke("telegram:test", cfg),
  // v0.9.16 — catálogo de caçadas (nomes + tamanhos de pull) salvo em disco,
  // compartilhado por todas as contas.
  loadHuntCatalog: () => ipcRenderer.invoke("huntCatalog:load"),
  saveHuntCatalog: (patch) => ipcRenderer.invoke("huntCatalog:save", patch),
  // v0.9.23 — histórico do analyzer (por dia, por personagem).
  loadStats: () => ipcRenderer.invoke("stats:load"),
  addStats: (payload) => ipcRenderer.invoke("stats:add", payload),
  // v0.7.3 — botão manual de checar atualização.
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  // v0.11.0 — login/"dias de uso" do Swag (conta do PRODUTO, nada a ver com
  // as contas do jogo nos webviews). `onStatusChanged` devolve uma função de
  // cancelamento, mesmo padrão de qualquer listener exposto por contextBridge.
  swagLogin: (email, password) => ipcRenderer.invoke("swag:login", { email, password }),
  swagLogout: () => ipcRenderer.invoke("swag:logout"),
  swagGetStatus: () => ipcRenderer.invoke("swag:getStatus"),
  swagRefreshStatus: () => ipcRenderer.invoke("swag:refreshStatus"),
  onSwagStatusChanged: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("swag:statusChanged", handler);
    return () => ipcRenderer.removeListener("swag:statusChanged", handler);
  },
  // v0.11.3 — ponte com o painel remoto (swag-site): o renderer é quem sabe
  // o estado real de cada conta (automationState) e quem manda comando pra
  // cada <webview>; o main.js é quem fala com o Supabase. Isto aqui é o elo
  // entre os dois, nos dois sentidos.
  swagPushState: (snapshot) => ipcRenderer.invoke("swag:pushState", snapshot),
  onSwagRemoteCommand: (callback) => {
    const handler = (_event, cmd) => callback(cmd);
    ipcRenderer.on("swag:remoteCommand", handler);
    return () => ipcRenderer.removeListener("swag:remoteCommand", handler);
  },
  swagCommandResult: (result) => ipcRenderer.invoke("swag:commandResult", result),
  // v0.11.7 — link "criar conta" na tela de login, abre o site no navegador
  // padrão (não dentro do app).
  swagOpenSignupPage: () => ipcRenderer.invoke("swag:openSignupPage"),
});
