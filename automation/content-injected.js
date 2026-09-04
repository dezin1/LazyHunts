// automation/content-injected.js
//
// Preload script anexado a cada <webview> (uma por conta) via o atributo
// "preload" — roda em DOCUMENT-START, bem antes de a SPA do Huntera montar,
// então nenhuma leitura de DOM aqui pode assumir que os elementos do jogo já
// existem (por isso `waitFor` é usado pra praticamente tudo, igual na
// extensão Chrome).
//
// v0.4.0: o painel flutuante que ficava DENTRO da tela do jogo foi embora —
// André pediu pra controlar a automação pelo menu lateral do próprio app,
// não misturado com a interface do Huntera. No lugar do painel, esse
// arquivo agora fala com o host (`renderer.js`) por IPC:
//   - reporta o estado (rodando? status, caçada/tier/limiar configurados,
//     log, contas de caçadas/tiers quando pedidas) via
//     `ipcRenderer.sendToHost("hm:state", payload)`;
//   - recebe comandos (ligar, desligar, mudar configuração, atualizar lista
//     de caçadas/tiers) via `ipcRenderer.on("hm:command", handler)` — o
//     host manda esses comandos com `webview.send("hm:command", msg)`.
// A LÓGICA da automação em si (ciclo sair/vender/voltar, monitor de
// capacidade, seleção de caçada/tier) é a mesma de sempre, só a parte de
// "onde mora a interface" mudou. `require("electron")` funciona aqui
// porque o preload de um <webview> roda sem sandbox por padrão (tem acesso
// a Node/Electron mesmo com a página do jogo isolada).
//
// Troca de personagem, expedição da guild e fraqueza elemental (automações
// #2 e #3 da extensão) ainda NÃO estão aqui — ficam pra uma próxima versão.

(function () {
  "use strict";

  let ipcRenderer = null;
  try {
    ipcRenderer = require("electron").ipcRenderer;
  } catch (err) {
    // Não deveria acontecer (preload de webview sem sandbox tem acesso ao
    // módulo electron), mas se faltar por algum motivo a automação em si
    // continua rodando — só não reporta estado pro host nem recebe comando.
  }

  function sendToHost(channel, payload) {
    if (!ipcRenderer) return;
    try {
      ipcRenderer.sendToHost(channel, payload);
    } catch (err) {
      // host pode ainda não estar ouvindo (ex: bem no início do boot) —
      // não é motivo pra travar a automação.
    }
  }

  const STORAGE_KEY = "hm_automation_v1";

  const SEL = {
    capacityValue: ".inventory-capacity strong",
    capacityContainer: ".inventory-capacity",
    huntDetailsBtn: 'button[aria-label="Detalhes da caçada"]',
    huntHeadingText: ".hunt-detail-info .hunt-heading h3",
    leaveHuntBtn: 'button[aria-label="Sair da caçada"]',
    huntWindow: ".hunt-window",
    huntSearchInput: 'input[aria-label="Buscar uma caçada ou criatura"]',
    huntEntries: ".hunt-list button.hunt-entry",
    huntEntryName: "strong",
    huntTiers: ".hunt-tiers .hunt-tier",
    quickSellTownBtn: 'button[aria-label^="Venda rápida"]',
    quickSellConfirmBtn: ".quick-sell-confirm",
    quickSellCancelBtn: ".quick-sell-cancel",
    closeModalBtn: 'button[aria-label="Fechar"]',
    // v0.5.0 — mesmo seletor confirmado ao vivo na extensão Chrome
    // (huntera-automacao/content.js): relógio "H:MMh" de stamina restante.
    staminaClock: ".hud-stamina-clock",
  };

  // Fica pra referência de quem for montar o <select> de tier no host — os
  // tiers de verdade de cada caçada são lidos ao vivo (peekHuntTiers), isso
  // aqui é só a lista conhecida de nomes possíveis no jogo.
  const PULL_LEVELS = ["Cautious", "Bold", "Reckless", "Suicidal"];
  const DEFAULT_STATE = {
    huntName: "",
    pullLevel: "Reckless",
    capacityThreshold: 100,
    // v0.5.0 — cada personagem tem até 12h (720min) de stamina, que só
    // esgota caçando e recarrega enquanto fora de caçada. O jogo tira o
    // personagem sozinho da caçada quando a stamina zera; sem esse limiar,
    // o monitor tentava re-entrar imediatamente (com 0 de stamina) a cada
    // tick de 4s, entrando e saindo sem sentido. 60min = espera acumular
    // pelo menos 1h de stamina antes de voltar a caçar.
    staminaResumeThreshold: 60,
    running: false,
    cycles: 0,
    log: [],
  };

  let running = false;
  let isBusy = false;
  let consecutiveErrors = 0;
  let observer = null;
  let pollTimer = null;
  let currentHuntNameCache = null;
  let logEntries = [];
  let statusText = "Parado";
  // v0.5.0 — o monitor roda a cada 4s (pollTimer); sem isso, esperar
  // stamina regenerar geraria um log novo a cada 4s até bater o limiar.
  let lastStaminaLogAt = 0;
  const STAMINA_LOG_INTERVAL_MS = 5 * 60 * 1000; // loga de novo no máximo a cada 5min enquanto espera

  // ---------- storage: localStorage da própria conta (já isolado) ----------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch (err) {
      return { ...DEFAULT_STATE };
    }
  }

  function saveState(partial) {
    const next = { ...loadState(), ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      // storage cheio/bloqueado — não trava a automação por causa disso
    }
    return next;
  }

  // ---------- reporta estado pro host (substitui o painel flutuante) ----------

  function sendState(extra) {
    const cfg = loadState();
    sendToHost("hm:state", {
      running,
      status: statusText,
      huntName: cfg.huntName,
      pullLevel: cfg.pullLevel,
      capacityThreshold: cfg.capacityThreshold,
      staminaResumeThreshold: cfg.staminaResumeThreshold,
      staminaLeft: getStaminaRemainingMinutes(),
      cycles: cfg.cycles,
      log: logEntries,
      ...extra,
    });
  }

  // ---------- utilidades (idênticas à extensão Chrome) ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs = 5000, intervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = fn();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function findButtonByExactText(root, text) {
    return (
      Array.from(root.querySelectorAll("button")).find(
        (b) => b.textContent.trim() === text
      ) || null
    );
  }

  function parseCapacity(text) {
    if (!text) return null;
    const match = text.replace(",", ".").match(/[\d.]+/);
    return match ? parseFloat(match[0]) : null;
  }

  // v0.5.0 — formato "3:42h" (H:MMh) → minutos restantes de stamina. Mesma
  // lógica confirmada ao vivo na extensão Chrome (huntera-automacao).
  function parseStaminaClock(text) {
    if (!text) return null;
    const match = text.match(/(\d+):(\d{2})h/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }

  function formatStaminaMinutes(mins) {
    if (mins === null || mins === undefined) return "?";
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
  }

  // Mesma ressalva documentada na extensão: o Angular do jogo nunca remove
  // do DOM os elementos de barra de ação/modais quando "fecham", só esconde
  // via CSS — toda checagem de ESTADO usa isVisible()/queryVisible().
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === "function") {
      try {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch (e) {
        // cai pro fallback abaixo
      }
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function queryVisible(root, selector) {
    const el = (root || document).querySelector(selector);
    return isVisible(el) ? el : null;
  }

  const LOG_HISTORY_MAX = 30;

  function log(message) {
    logEntries = [...logEntries, { message, at: Date.now() }].slice(-LOG_HISTORY_MAX);
    saveState({ log: logEntries });
    console.log(`[Huntera Multiconta] ${message}`);
    sendState();
  }

  // ---------- leitura de estado do jogo ----------

  function getCapacityRemaining() {
    const el = document.querySelector(SEL.capacityValue);
    return el ? parseCapacity(el.textContent) : null;
  }

  function getStaminaRemainingMinutes() {
    const el = document.querySelector(SEL.staminaClock);
    return el ? parseStaminaClock(el.textContent) : null;
  }

  function isHunting() {
    return !!queryVisible(document, SEL.leaveHuntBtn);
  }

  function closeNearestModal(fromEl) {
    let node = fromEl;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      const btn = node.querySelector(SEL.closeModalBtn);
      if (btn) {
        btn.click();
        return true;
      }
      node = node.parentElement;
      depth++;
    }
    return false;
  }

  async function getCurrentHuntName() {
    const detailsBtn = queryVisible(document, SEL.huntDetailsBtn);
    if (!detailsBtn) return null;
    detailsBtn.click();
    const heading = await waitFor(() => queryVisible(document, SEL.huntHeadingText), 3000);
    const name = heading ? heading.textContent.trim() : null;
    if (heading) closeNearestModal(heading);
    return name;
  }

  // ---------- seletor de caçadas ----------

  function getHuntPickerOpenButton() {
    const candidates = Array.from(document.querySelectorAll("button.nav-labeled"));
    return (
      candidates.find((b) => {
        const label = (b.getAttribute("aria-label") || b.title || "").trim();
        return label === "Caçadas" || label === "Iniciar caçada";
      }) || null
    );
  }

  async function ensureHuntWindowOpen() {
    if (queryVisible(document, SEL.huntWindow)) return true;
    // O script roda quase assim que a página começa a carregar — bem antes
    // da SPA em Angular do jogo terminar de montar a barra de navegação (ou
    // até antes do login acontecer, se a conta ainda não estava logada).
    // Por isso espera de verdade o botão aparecer em vez de checar só uma
    // vez — cobre tanto "ainda carregando" quanto "acabou de logar agora".
    const openBtn = await waitFor(() => getHuntPickerOpenButton(), 20000);
    if (!openBtn) return false;
    openBtn.click();
    return !!(await waitFor(() => queryVisible(document, SEL.huntWindow), 4000));
  }

  function findHuntEntry(win, huntName) {
    const entries = Array.from(win.querySelectorAll(SEL.huntEntries));
    return (
      entries.find((b) => {
        const nameEl = b.querySelector(SEL.huntEntryName);
        const name = nameEl ? nameEl.textContent.trim() : "";
        return name === huntName;
      }) || null
    );
  }

  function clickHuntEntry(win, huntName) {
    const match = findHuntEntry(win, huntName);
    if (match) {
      match.click();
      return true;
    }
    return false;
  }

  function selectPullTier(win, pullLevel) {
    const tiers = Array.from(win.querySelectorAll(SEL.huntTiers));
    if (!tiers.length) return false;
    const match = tiers.find(
      (b) => b.textContent.trim().toLowerCase() === pullLevel.toLowerCase()
    );
    if (match) {
      match.click();
      return true;
    }
    return false;
  }

  function clickConfirmButton(win) {
    const btn =
      findButtonByExactText(win, "Iniciar caçada") ||
      findButtonByExactText(win, "Trocar de caçada");
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  async function pickAndStartHunt(huntName, pullLevel) {
    const opened = await ensureHuntWindowOpen();
    if (!opened) throw new Error("Não consegui abrir o seletor de caçadas.");
    const win = document.querySelector(SEL.huntWindow);
    const search = win.querySelector(SEL.huntSearchInput);
    if (!search) throw new Error("Campo de busca de caçada não encontrado.");

    setInputValue(search, huntName);
    await sleep(400);

    const clicked = await waitFor(() => clickHuntEntry(win, huntName), 4000);
    if (!clicked) throw new Error(`Caçada "${huntName}" não encontrada na busca.`);

    await waitFor(() => win.querySelector(SEL.huntTiers), 4000);
    const tierFound = selectPullTier(win, pullLevel);
    if (!tierFound) {
      log(`Aviso: tier "${pullLevel}" não existe em "${huntName}" — segui com o tier padrão.`);
    }
    await sleep(200);

    const confirmed = clickConfirmButton(win);
    if (!confirmed) throw new Error('Botão "Iniciar caçada"/"Trocar de caçada" não encontrado.');
  }

  async function ensureHunting(cfg, forcedHuntName) {
    const targetName = forcedHuntName || cfg.huntName;
    if (!targetName) {
      throw new Error("Nenhuma caçada configurada — escolha uma no menu lateral.");
    }
    if (isHunting()) {
      const current = await getCurrentHuntName();
      if (current && current === targetName) {
        currentHuntNameCache = current;
        return;
      }
    }
    await pickAndStartHunt(targetName, cfg.pullLevel);
    const started = await waitFor(() => isHunting(), 25000);
    if (!started) throw new Error(`Não consegui confirmar que a caçada "${targetName}" iniciou.`);
    currentHuntNameCache = targetName;
  }

  function closeHuntWindow() {
    const win = document.querySelector(SEL.huntWindow);
    if (!win) return;
    const btn = win.querySelector(SEL.closeModalBtn);
    if (btn) btn.click();
  }

  // ---------- sair da caçada + vender ----------

  async function leaveHunt() {
    const btn = queryVisible(document, SEL.leaveHuntBtn);
    if (btn) btn.click();
    const arrived = await waitFor(() => queryVisible(document, SEL.quickSellTownBtn), 20000);
    if (!arrived) {
      throw new Error(
        "Cliquei em Sair da caçada, mas não confirmei ter chegado na cidade (Venda rápida não apareceu em 20s)."
      );
    }
    await sleep(500);
  }

  async function sellInTown() {
    const sellBtn = await waitFor(() => queryVisible(document, SEL.quickSellTownBtn), 10000);
    if (!sellBtn) throw new Error('Botão "Venda rápida" não apareceu na cidade.');
    sellBtn.click();

    const confirmBtn = await waitFor(() => queryVisible(document, SEL.quickSellConfirmBtn), 5000);
    if (!confirmBtn) {
      const cancelBtn = queryVisible(document, SEL.quickSellCancelBtn);
      if (cancelBtn) cancelBtn.click();
      return null;
    }

    const saleText = confirmBtn.textContent.trim();
    confirmBtn.click();
    await waitFor(() => !queryVisible(document, SEL.quickSellConfirmBtn), 5000);
    return saleText;
  }

  async function runSellAndReturnCycle(cfg) {
    log("Capacidade no limite configurado — saindo da caçada...");
    updatePanelStatus("Saindo da caçada");
    const huntBeforeLeaving = (await getCurrentHuntName()) || currentHuntNameCache || cfg.huntName;

    await leaveHunt();

    updatePanelStatus("Vendendo loot");
    log("Vendendo loot na cidade (Venda rápida)...");
    const saleText = await sellInTown();
    log(saleText ? `Loot vendido: ${saleText}.` : "Nada pra vender neste ciclo.");

    updatePanelStatus("Iniciando caçada");
    log(`Retomando caçada: ${huntBeforeLeaving}...`);
    await ensureHunting(cfg, huntBeforeLeaving);

    saveState({ cycles: (loadState().cycles || 0) + 1 });
    updatePanelStatus("Caçando");
    log(`De volta caçando "${huntBeforeLeaving}".`);
  }

  // ---------- monitor ----------

  // v0.5.0 — true se já dá pra tentar (re)entrar na caçada: ou não deu pra
  // ler a stamina (elemento pode não existir fora de certas telas — nesse
  // caso não trava por causa disso, segue como antes), ou ela já bateu o
  // limiar configurado. false = ainda precisa esperar regenerar.
  function hasEnoughStaminaToHunt(cfg) {
    const staminaLeft = getStaminaRemainingMinutes();
    if (staminaLeft === null) return true;
    return staminaLeft >= cfg.staminaResumeThreshold;
  }

  function logStaminaWaitingThrottled(cfg) {
    const now = Date.now();
    if (now - lastStaminaLogAt < STAMINA_LOG_INTERVAL_MS) return;
    lastStaminaLogAt = now;
    const staminaLeft = getStaminaRemainingMinutes();
    log(
      `Sem stamina suficiente pra voltar a caçar (${formatStaminaMinutes(staminaLeft)} de ${formatStaminaMinutes(cfg.staminaResumeThreshold)} mínimo) — aguardando regenerar...`
    );
  }

  async function monitorTick() {
    if (!running || isBusy) return;
    isBusy = true;
    try {
      const cfg = loadState();

      if (!isHunting()) {
        // v0.5.0 — o jogo tira o personagem sozinho da caçada quando a
        // stamina zera. Sem essa checagem, o monitor tentava re-entrar a
        // cada tick de 4s com a stamina ainda em 0, entrando e saindo sem
        // sentido (mesma classe de bug já resolvida no Auto Bestiary da
        // extensão Chrome, v0.17.5 — ver huntera-automacao/CLAUDE.md).
        if (!hasEnoughStaminaToHunt(cfg)) {
          updatePanelStatus(`Aguardando stamina (${formatStaminaMinutes(getStaminaRemainingMinutes())})`);
          logStaminaWaitingThrottled(cfg);
          return;
        }
        updatePanelStatus("Iniciando caçada");
        log("Personagem não está caçando e já tem stamina suficiente — retomando a caçada configurada...");
        await ensureHunting(cfg);
        updatePanelStatus("Caçando");
        log(`De volta caçando "${currentHuntNameCache || cfg.huntName}". Monitorando capacidade e stamina...`);
        consecutiveErrors = 0;
        lastStaminaLogAt = 0;
        return;
      }

      const remaining = getCapacityRemaining();
      if (remaining === null || remaining > cfg.capacityThreshold) return;

      await runSellAndReturnCycle(cfg);
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      log(`Erro: ${err.message}`);
      updatePanelStatus("Erro");
      if (consecutiveErrors >= 3) {
        log("3 erros seguidos — desligando a automação por segurança. Confira a conta e ligue de novo.");
        stopBot();
      }
    } finally {
      isBusy = false;
    }
  }

  function tryAttachCapacityObserver() {
    if (observer) return;
    const container = document.querySelector(SEL.capacityContainer);
    if (!container) return;
    observer = new MutationObserver(() => monitorTick());
    observer.observe(container, { childList: true, characterData: true, subtree: true });
  }

  function startMonitoring() {
    stopMonitoring();
    tryAttachCapacityObserver();
    pollTimer = setInterval(() => {
      tryAttachCapacityObserver();
      monitorTick();
    }, 4000);
    monitorTick();
  }

  function stopMonitoring() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function startBot() {
    if (running) return;
    const cfg = loadState();
    if (!cfg.huntName) {
      log("Configure uma caçada antes de ligar a automação (menu lateral).");
      return;
    }
    running = true;
    consecutiveErrors = 0;
    saveState({ running: true });
    updatePanelRunning(true);
    isBusy = true;
    try {
      // v0.5.0 — se já estava sem stamina no momento de ligar (ex: religou
      // o app com o personagem parado, sem stamina), não força entrada na
      // caçada — deixa `startMonitoring()`/`monitorTick()` esperarem o
      // limiar sozinhos, do jeito normal.
      if (!hasEnoughStaminaToHunt(cfg)) {
        updatePanelStatus(`Aguardando stamina (${formatStaminaMinutes(getStaminaRemainingMinutes())})`);
        log(
          `Automação ligada, mas sem stamina suficiente ainda (mínimo configurado: ${formatStaminaMinutes(cfg.staminaResumeThreshold)}) — vai entrar na caçada assim que regenerar.`
        );
      } else {
        updatePanelStatus("Iniciando caçada");
        log("Automação ligada. Garantindo que a caçada configurada está ativa...");
        await ensureHunting(cfg);
        updatePanelStatus("Caçando");
        log(`Caçando "${currentHuntNameCache || cfg.huntName}". Monitorando capacidade e stamina...`);
      }
      startMonitoring();
    } catch (err) {
      log(`Erro ao iniciar: ${err.message}`);
      updatePanelStatus("Erro");
      running = false;
      saveState({ running: false });
      updatePanelRunning(false);
    } finally {
      isBusy = false;
    }
  }

  function stopBot() {
    running = false;
    stopMonitoring();
    saveState({ running: false });
    updatePanelRunning(false);
    updatePanelStatus("Parado");
    log("Automação desligada.");
  }

  // ---------- leitura de caçadas/tiers (pra alimentar os selects no host) ----------

  async function scrapeHuntNames() {
    const alreadyOpen = !!queryVisible(document, SEL.huntWindow);
    const opened = await ensureHuntWindowOpen();
    if (!opened) throw new Error("Não consegui abrir o seletor de caçadas.");
    const win = document.querySelector(SEL.huntWindow);
    const search = win.querySelector(SEL.huntSearchInput);
    if (search) setInputValue(search, "");
    await sleep(250);
    const entries = Array.from(win.querySelectorAll(SEL.huntEntries));
    const names = entries
      .map((b) => {
        const nameEl = b.querySelector(SEL.huntEntryName);
        return nameEl ? nameEl.textContent.trim() : null;
      })
      .filter(Boolean);
    if (!alreadyOpen) closeHuntWindow();
    return names;
  }

  async function peekHuntTiers(huntName) {
    const alreadyOpen = !!queryVisible(document, SEL.huntWindow);
    const opened = await ensureHuntWindowOpen();
    if (!opened) throw new Error("Não consegui abrir o seletor de caçadas.");
    const win = document.querySelector(SEL.huntWindow);
    const search = win.querySelector(SEL.huntSearchInput);
    if (search) setInputValue(search, huntName);
    await sleep(400);
    const clicked = await waitFor(() => clickHuntEntry(win, huntName), 4000);
    if (!clicked) {
      if (!alreadyOpen) closeHuntWindow();
      throw new Error(`Caçada "${huntName}" não encontrada.`);
    }
    await waitFor(() => win.querySelector(SEL.huntTiers), 4000);
    const tiers = Array.from(win.querySelectorAll(SEL.huntTiers)).map((b) => b.textContent.trim());
    if (!alreadyOpen) closeHuntWindow();
    return tiers;
  }

  async function refreshHuntsAndSend() {
    sendState({ huntsLoading: true });
    try {
      const names = await scrapeHuntNames();
      sendState({ huntNames: names, huntsLoading: false });
    } catch (err) {
      // Causa mais comum: pedido antes de a conta estar logada (ou a SPA do
      // jogo ainda não tinha montado a barra de navegação a tempo). O host
      // deixa tentar de novo manualmente (botão ↻), sem precisar recarregar
      // a conta inteira.
      log(`Aviso: não consegui ler a lista de caçadas ainda (${err.message}). Se a conta já está logada, tente de novo.`);
      sendState({ huntNames: [], huntsLoading: false, huntsError: true });
    }
  }

  async function requestTiersAndSend(huntName) {
    if (!huntName) return;
    sendState({ tiersLoading: true });
    try {
      const tiers = await peekHuntTiers(huntName);
      sendState({ tiers, tiersLoading: false });
    } catch (err) {
      log(`Aviso: não consegui ler os tiers de "${huntName}" (${err.message}).`);
      sendState({ tiers: [], tiersLoading: false });
    }
  }

  // ---------- reporte de status/estado (substitui as funções que antes
  // mexiam direto no DOM do painel flutuante) ----------

  function updatePanelStatus(text) {
    statusText = text;
    sendState();
  }

  function updatePanelRunning(isRunning) {
    running = isRunning;
    statusText = isRunning ? "Caçando" : "Parado";
    sendState();
  }

  // ---------- comandos vindos do host (menu lateral) ----------

  function applyConfig(partial) {
    const next = {};
    if (typeof partial.huntName === "string") next.huntName = partial.huntName;
    if (typeof partial.pullLevel === "string") next.pullLevel = partial.pullLevel;
    if (partial.capacityThreshold !== undefined) {
      const n = Number(partial.capacityThreshold);
      if (!Number.isNaN(n)) next.capacityThreshold = n;
    }
    if (partial.staminaResumeThreshold !== undefined) {
      const n = Number(partial.staminaResumeThreshold);
      if (!Number.isNaN(n)) next.staminaResumeThreshold = n;
    }
    saveState(next);
    sendState();
  }

  async function handleCommand(msg) {
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "start":
        startBot();
        break;
      case "stop":
        stopBot();
        break;
      case "setConfig":
        applyConfig(msg.payload || {});
        break;
      case "refreshHunts":
        await refreshHuntsAndSend();
        break;
      case "requestTiers":
        await requestTiersAndSend(msg.payload && msg.payload.huntName);
        break;
      default:
        break;
    }
  }

  // ---------- boot ----------

  function boot() {
    if (window.__hunteraMulticontaAutomationLoaded) return;
    window.__hunteraMulticontaAutomationLoaded = true;

    if (ipcRenderer) {
      ipcRenderer.on("hm:command", (_event, msg) => {
        handleCommand(msg);
      });
    }

    // O preload roda em document-start, bem antes de a SPA do jogo montar —
    // espera existir pelo menos um <body> antes de reportar/começar a
    // religar sozinha se estava ligada.
    waitFor(() => document.body, 15000).then((body) => {
      const cfg = loadState();
      logEntries = cfg.log || [];
      statusText = cfg.running ? "Caçando" : "Parado";
      sendState();
      if (!body) return;
      // Se a automação estava ligada quando a página recarregou de verdade
      // (não troca de rota interna — isso não recarrega a página, só um F5
      // ou reabrir o app), religa sozinha em vez de deixar parada.
      if (cfg.running) startBot();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
