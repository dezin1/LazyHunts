// renderer.js — barra lateral de contas (estilo "gerenciador multi-conta",
// inspirado no visual do Multi Idle Manager / multidl.online que o André
// mostrou) + os <webview> de cada uma.
//
// A peça central continua sendo a partição de cada webview: partition=
// "persist:<id-da-aba>". O Electron trata cada valor de partição diferente
// como um "perfil" separado de armazenamento (cookies, localStorage,
// sessionStorage, IndexedDB) — é a mesma ideia de perfis separados do
// Chrome, só que dentro de um app só. Por isso dá pra logar até 4 contas
// diferentes do Huntera ao mesmo tempo sem uma derrubar a sessão da outra.
//
// v0.3.0: reescrita da interface (trilha de ícones + barra lateral com
// avatar/status/tempo por conta + barra de ferramentas tipo navegador com
// URL/zoom/voltar/avançar) — a LÓGICA de isolamento por partição e a
// automação injetada em cada webview (automation/content-injected.js) não
// mudam nada aqui, só a casca visual em volta.

const MAX_TABS = 4;
// O jogo não é responsivo pra caber numa célula de 1/4 da tela — no modo
// grade, sem isso, a UI fica pequena/cortada demais pra ler. Zoom de página
// de verdade (não CSS transform) faz o Chromium REFLUIR o layout, então
// texto/ícones ficam legíveis em vez de só "encolhidos" com corte de
// conteúdo. 1.0 = tamanho normal (modo de uma conta só); ajuste
// ZOOM_GRID se ainda estiver pequeno/grande demais depois de testar.
const ZOOM_NORMAL = 1.0;
const ZOOM_GRID = 0.5;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;

// Paleta de cores dos avatares — só pra dar variedade visual entre contas,
// escolhida a partir de um hash simples do id da aba (mesma conta sempre
// cai na mesma cor, sem precisar guardar nada extra).
const AVATAR_COLORS = ["#e0ac4c", "#5fb0e8", "#7ad19a", "#c98be0", "#e88b6a", "#6ad1c9"];

const tabsEl = document.getElementById("tabs");
const containerEl = document.getElementById("webviewContainer");
const addTabBtn = document.getElementById("addTabBtn");
const railGridBtn = document.getElementById("railGridBtn");
const railAutomationBtn = document.getElementById("railAutomationBtn");
const groupHeaderToggle = document.getElementById("groupHeaderToggle");
const groupCountEl = document.getElementById("groupCount");
const sidebarFooterReloadBtn = document.getElementById("reloadAllBtn");
const autoLaunchToggle = document.getElementById("autoLaunchToggle");

const accountsGroupEl = document.getElementById("accountsGroup");
const automationPanelEl = document.getElementById("automationPanel");
const automationBackBtn = document.getElementById("automationBackBtn");
const automationAvatarEl = document.getElementById("automationAvatar");
const automationTitleEl = document.getElementById("automationTitle");
const automationDotEl = document.getElementById("automationDot");
const automationStatusTextEl = document.getElementById("automationStatusText");
const automationCyclesEl = document.getElementById("automationCycles");
const automationStaminaEl = document.getElementById("automationStamina");
const automationRefreshBtn = document.getElementById("automationRefreshBtn");
const automationHuntSelect = document.getElementById("automationHuntSelect");
const automationTierSelect = document.getElementById("automationTierSelect");
const automationCapacityInput = document.getElementById("automationCapacityInput");
const automationStaminaInput = document.getElementById("automationStaminaInput");
const automationToggleBtn = document.getElementById("automationToggleBtn");
const automationLogEl = document.getElementById("automationLog");

const navGroupEl = document.getElementById("navGroup");
const navBackBtn = document.getElementById("navBackBtn");
const navFwdBtn = document.getElementById("navFwdBtn");
const navReloadBtn = document.getElementById("navReloadBtn");
const urlBar = document.getElementById("urlBar");
const urlGoBtn = document.getElementById("urlGoBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomLabel = document.getElementById("zoomLabel");
const statusPill = document.getElementById("statusPill");

let tabs = []; // [{ id, label, createdAt }]
let activeTabId = null;
let gridMode = false;
let gameUrl = "https://huntera.com.br/game";
let gameHost = "huntera.com.br";
// v0.2.0: Automação #1 (vender/voltar), anexada em cada webview via
// atributo "preload" — ver automation/content-injected.js.
let automationPreloadPath = "";

// Zoom manual e status de carregamento — só em memória, não precisa
// persistir. `manualZoom` guarda o zoom de cada conta no modo NORMAL (uma
// conta em foco); `gridZoomOverride` é um valor ÚNICO compartilhado pelas 4
// contas quando o modo grade está ligado (ajustar o zoom lá afeta todas de
// uma vez, já que é assim que a grade faz sentido — não daria pra ver 4
// contas em tamanhos diferentes ao mesmo tempo de forma útil).
const manualZoom = new Map(); // tabId -> fator (modo normal)
let gridZoomOverride = null; // fator ou null = usa ZOOM_GRID
const loadedTabs = new Set(); // tabId -> já teve pelo menos 1 dom-ready

// v0.4.0 — automação controlada pelo menu lateral, não mais por um painel
// dentro da tela do jogo. v0.4.1: o painel de automação virou uma tela
// DEDICADA que troca de lugar com a lista de contas (não expande mais
// dentro da linha — André achou horrível, empurrava as outras contas e
// ficava espremido). `automationState` guarda o último estado que CADA
// conta reportou (via IPC — ver ensureWebview()); `guestReady` marca quais
// contas já mandaram pelo menos 1 estado (só depois disso dá pra mandar
// comando pra elas, `webview.send()` antes disso não tem garantia de
// chegar); `selectedAutomationTabId` é a conta cujo painel está aberto no
// momento (null = mostrando a lista de contas normal).
const automationState = new Map(); // tabId -> { running, status, huntName, pullLevel, capacityThreshold, staminaResumeThreshold, staminaLeft, cycles, log, huntNames, huntsLoading, tiers, tiersLoading }
const guestReady = new Set();
let selectedAutomationTabId = null;

function sendAutomationCommand(tabId, msg) {
  if (!guestReady.has(tabId)) return;
  const wv = getWebview(tabId);
  if (!wv) return;
  try {
    wv.send("hm:command", msg);
  } catch (err) {
    // conta pode ter fechado/recarregado bem nesse instante — não é motivo
    // pra travar o resto da interface.
  }
}

function nextTabId() {
  let n = 1;
  const used = new Set(tabs.map((t) => t.id));
  while (used.has(`conta-${n}`)) n++;
  return `conta-${n}`;
}

function partitionFor(id) {
  return `persist:${id}`;
}

function getWebview(id) {
  return containerEl.querySelector(`webview[data-tab-id="${id}"]`);
}

function avatarColorFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// Cria o <webview> de uma aba na primeira vez que ela é vista, e nunca mais
// mexe na partição/src depois disso — trocar o valor de "partition" depois
// de o elemento já estar no DOM não tem efeito nenhum no Electron (a
// partição é fixada na criação do webview), então cada aba precisa manter o
// MESMO id (e portanto a mesma partição) pra sempre, do contrário perderia
// o login já feito nela.
function ensureWebview(tab) {
  let wv = getWebview(tab.id);
  if (wv) return wv;
  wv = document.createElement("webview");
  wv.setAttribute("data-tab-id", tab.id);
  wv.setAttribute("partition", partitionFor(tab.id));
  wv.setAttribute("src", gameUrl);
  wv.setAttribute("allowpopups", "false");
  // v0.4.2 — reforça, já na criação do webview, o mesmo ajuste feito no
  // processo principal (main.js, "web-contents-created"): desliga o
  // throttling de timers do Chromium pra esse webview específico, pra o
  // jogo não cair quando o app fica minimizado/em segundo plano.
  wv.setAttribute("webpreferences", "backgroundThrottling=no");
  if (automationPreloadPath) wv.setAttribute("preload", automationPreloadPath);
  // setZoomFactor só funciona depois que o webview terminou de anexar de
  // verdade — chamar antes disso é ignorado silenciosamente. "dom-ready"
  // dispara toda vez que uma página termina de carregar dentro do webview
  // (login, troca de personagem, etc.), então também garante que o zoom
  // não "reseta" sozinho depois de uma navegação interna do jogo.
  wv.addEventListener("dom-ready", () => {
    applyZoom(wv);
    loadedTabs.add(tab.id);
    updateStatusDot(tab.id);
    if (tab.id === activeTabId) updateToolbarState();
  });
  wv.addEventListener("did-navigate", () => {
    if (tab.id === activeTabId) updateToolbarState();
  });
  wv.addEventListener("did-navigate-in-page", () => {
    if (tab.id === activeTabId) updateToolbarState();
  });
  // Ponte de automação (v0.4.0): a conta (automation/content-injected.js)
  // manda o estado dela por "sendToHost" sempre que algo muda (ligou,
  // desligou, log novo, lista de caçadas carregou, etc) — a gente só
  // atualiza o painel daquela linha na hora, sem precisar redesenhar a
  // barra lateral inteira.
  wv.addEventListener("ipc-message", (e) => {
    if (e.channel !== "hm:state") return;
    const prev = automationState.get(tab.id) || {};
    automationState.set(tab.id, { ...prev, ...e.args[0] });
    guestReady.add(tab.id);
    updateAutoIndicator(tab.id);
    if (tab.id === selectedAutomationTabId) syncAutomationPanel();
  });
  containerEl.appendChild(wv);
  return wv;
}

function applyZoom(wv) {
  if (typeof wv.setZoomFactor !== "function") return;
  const tabId = wv.getAttribute("data-tab-id");
  const factor = gridMode ? gridZoomOverride ?? ZOOM_GRID : manualZoom.get(tabId) ?? ZOOM_NORMAL;
  wv.setZoomFactor(factor);
  if (tabId === activeTabId) updateZoomLabel(factor);
}

function clampZoom(v) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +v.toFixed(2)));
}

function applyZoomToAll() {
  tabs.forEach((tab) => {
    const wv = getWebview(tab.id);
    if (wv) applyZoom(wv);
  });
}

function updateZoomLabel(factor) {
  zoomLabel.textContent = `${Math.round(factor * 100)}%`;
}

function updateStatusDot(tabId) {
  const dot = tabsEl.querySelector(`.acct[data-tab-id="${tabId}"] .acctStatusDot`);
  if (dot) dot.classList.toggle("online", loadedTabs.has(tabId));
}

// Só acende/apaga o raiozinho ⚡ de UMA linha da lista (indica "automação
// ligada nessa conta" de relance, sem precisar abrir o painel dela).
function updateAutoIndicator(tabId) {
  const btn = tabsEl.querySelector(`.acct[data-tab-id="${tabId}"] .acctAutoBtn`);
  if (btn) btn.classList.toggle("on", !!automationState.get(tabId)?.running);
}

function formatUptime(createdAt) {
  if (!createdAt) return "";
  const ms = Date.now() - createdAt;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return `${hours}h ${remMin}m`;
  const days = Math.floor(hours / 24);
  const remHour = hours % 24;
  return `${days}d ${remHour}h`;
}

function updateUptimeLabels() {
  tabs.forEach((tab) => {
    const el = tabsEl.querySelector(`.acct[data-tab-id="${tab.id}"] .acctUptime`);
    if (el) el.textContent = formatUptime(tab.createdAt);
  });
}

function renderTabs() {
  tabsEl.innerHTML = "";
  tabs.forEach((tab) => {
    const el = document.createElement("div");
    el.className = "acct" + (tab.id === activeTabId ? " active" : "");
    el.setAttribute("data-tab-id", tab.id);
    const initial = (tab.label.trim()[0] || "?").toUpperCase();
    el.innerHTML = `
      <div class="acctRow">
        <div class="acctAvatar" style="background:${avatarColorFor(tab.id)}">
          ${escapeHtml(initial)}
          <span class="acctStatusDot${loadedTabs.has(tab.id) ? " online" : ""}"></span>
        </div>
        <div class="acctInfo">
          <div class="acctTopRow">
            <span class="acctLabel" contenteditable="true" spellcheck="false">${escapeHtml(tab.label)}</span>
            <button type="button" class="acctAutoBtn${automationState.get(tab.id)?.running ? " on" : ""}" title="Automação">⚡</button>
            <button type="button" class="acctClose" title="Fechar conta">×</button>
          </div>
          <div class="acctSubRow">
            <span class="acctDomain">${escapeHtml(gameHost)}</span>
            <span class="acctUptime">${formatUptime(tab.createdAt)}</span>
          </div>
        </div>
      </div>
    `;
    el.addEventListener("click", (e) => {
      if (e.target.closest(".acctClose") || e.target.closest(".acctLabel") || e.target.closest(".acctAutoBtn"))
        return;
      setActiveTab(tab.id);
    });
    el.querySelector(".acctClose").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    const labelEl = el.querySelector(".acctLabel");
    labelEl.addEventListener("blur", () => {
      tab.label = labelEl.textContent.trim() || tab.label;
      persistTabs();
    });
    labelEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        labelEl.blur();
      }
    });
    el.querySelector(".acctAutoBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      openAutomationPanel(tab.id);
    });

    tabsEl.appendChild(el);
  });
  addTabBtn.disabled = tabs.length >= MAX_TABS;
  groupCountEl.textContent = `${tabs.length} conta${tabs.length === 1 ? "" : "s"}`;
}

// ---------- painel de automação DEDICADO (v0.4.1) ----------
// Troca de conteúdo com a lista de contas dentro do próprio menu lateral —
// nunca fica sobreposto na tela do jogo, e nunca mais "espremido" dentro
// da linha da conta (era assim na v0.4.0, o André não curtiu).

function openAutomationPanel(tabId) {
  selectedAutomationTabId = tabId;
  const tab = tabs.find((t) => t.id === tabId);
  automationAvatarEl.style.background = avatarColorFor(tabId);
  automationAvatarEl.textContent = (tab?.label.trim()[0] || "?").toUpperCase();
  automationTitleEl.textContent = tab?.label || "";
  accountsGroupEl.hidden = true;
  automationPanelEl.hidden = false;
  railAutomationBtn.classList.add("on");
  // primeira vez abrindo essa conta — pede a lista de caçadas dela.
  if (!automationState.get(tabId)?.huntNames) {
    sendAutomationCommand(tabId, { type: "refreshHunts" });
  }
  syncAutomationPanel();
}

function closeAutomationPanel() {
  selectedAutomationTabId = null;
  automationPanelEl.hidden = true;
  accountsGroupEl.hidden = false;
  railAutomationBtn.classList.remove("on");
}

// v0.4.3 — André apontou especificamente pra essa barrinha ("a barrinha
// onde você altera a visualização de multi janela", ou seja, o iconRail
// onde já mora o botão de grade ⊞) como o lugar certo pro bot. O ⚡ de cada
// linha continua existindo (atalho rápido pra abrir a automação já
// naquela conta direto), mas agora o iconRail também tem um botão próprio
// (🤖) que abre/fecha o painel pra conta ATIVA no momento — mesmo padrão
// visual/comportamental do botão de grade ao lado dele (acende em âmbar
// quando ligado).
railAutomationBtn.addEventListener("click", () => {
  if (!automationPanelEl.hidden) {
    closeAutomationPanel();
    return;
  }
  if (!activeTabId) return;
  openAutomationPanel(activeTabId);
});

automationBackBtn.addEventListener("click", closeAutomationPanel);
automationHuntSelect.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  const huntName = automationHuntSelect.value;
  sendAutomationCommand(selectedAutomationTabId, { type: "setConfig", payload: { huntName } });
  if (huntName) sendAutomationCommand(selectedAutomationTabId, { type: "requestTiers", payload: { huntName } });
});
automationTierSelect.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, { type: "setConfig", payload: { pullLevel: automationTierSelect.value } });
});
automationCapacityInput.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { capacityThreshold: automationCapacityInput.value },
  });
});
automationStaminaInput.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { staminaResumeThreshold: automationStaminaInput.value },
  });
});
automationRefreshBtn.addEventListener("click", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, { type: "refreshHunts" });
});
automationToggleBtn.addEventListener("click", () => {
  if (!selectedAutomationTabId) return;
  const state = automationState.get(selectedAutomationTabId) || {};
  sendAutomationCommand(selectedAutomationTabId, { type: state.running ? "stop" : "start" });
});

// Atualiza os campos do painel FIXO com o estado da conta selecionada —
// chamado a cada novo estado reportado por ela (frequente: todo log novo
// manda um estado novo). Preserva o valor de quem estiver digitando/com um
// select aberto (não sobrescreve enquanto o elemento está em foco).
function syncAutomationPanel() {
  const tabId = selectedAutomationTabId;
  if (!tabId) return;
  const state = automationState.get(tabId) || {};

  automationDotEl.classList.toggle("on", !!state.running);
  automationDotEl.classList.toggle("err", state.status === "Erro");
  automationStatusTextEl.textContent = state.status || (guestReady.has(tabId) ? "Parado" : "carregando…");
  automationCyclesEl.textContent = state.cycles ? `· ${state.cycles} ciclo${state.cycles === 1 ? "" : "s"}` : "";

  automationToggleBtn.textContent = state.running ? "Desligar automação" : "Ligar automação";
  automationToggleBtn.className = "autoToggleBtn " + (state.running ? "on" : "off");
  automationToggleBtn.disabled = !guestReady.has(tabId);

  if (document.activeElement !== automationHuntSelect) {
    if (Array.isArray(state.huntNames)) {
      automationHuntSelect.innerHTML =
        '<option value="">— escolha —</option>' +
        state.huntNames.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
      automationHuntSelect.value = state.huntName || "";
    } else if (state.huntsLoading) {
      automationHuntSelect.innerHTML = '<option value="">— carregando —</option>';
    } else if (state.huntsError) {
      automationHuntSelect.innerHTML = '<option value="">— faça login e clique em ↻ Atualizar —</option>';
    }
  }

  if (document.activeElement !== automationTierSelect) {
    if (Array.isArray(state.tiers)) {
      automationTierSelect.innerHTML = state.tiers
        .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
        .join("");
      if (state.tiers.includes(state.pullLevel)) automationTierSelect.value = state.pullLevel;
    } else if (state.tiersLoading) {
      automationTierSelect.innerHTML = '<option value="">— carregando —</option>';
    }
  }

  if (document.activeElement !== automationCapacityInput && state.capacityThreshold != null) {
    automationCapacityInput.value = state.capacityThreshold;
  }

  if (document.activeElement !== automationStaminaInput && state.staminaResumeThreshold != null) {
    automationStaminaInput.value = state.staminaResumeThreshold;
  }

  // v0.5.0 — mostra a stamina atual lida do jogo ao lado do status, só
  // enquanto a automação está ligada (senão fica poluindo à toa).
  automationStaminaEl.textContent =
    state.running && state.staminaLeft != null ? `· stamina ${formatStaminaLabel(state.staminaLeft)}` : "";

  if (Array.isArray(state.log)) {
    automationLogEl.innerHTML = state.log
      .slice()
      .reverse()
      .slice(0, 8)
      .map((entry) => `<div>${escapeHtml(entry.message)}</div>`)
      .join("");
  }
}

function renderWebviews() {
  containerEl.classList.toggle("grid", gridMode);
  tabs.forEach((tab) => {
    const wv = ensureWebview(tab);
    if (gridMode) {
      wv.classList.remove("active");
      wv.classList.add("gridCell");
    } else {
      wv.classList.remove("gridCell");
      wv.classList.toggle("active", tab.id === activeTabId);
    }
  });
}

function setActiveTab(id) {
  activeTabId = id;
  renderTabs();
  renderWebviews();
  updateToolbarState();
}

function closeTab(id) {
  const wv = getWebview(id);
  if (wv) wv.remove();
  manualZoom.delete(id);
  loadedTabs.delete(id);
  automationState.delete(id);
  guestReady.delete(id);
  if (selectedAutomationTabId === id) closeAutomationPanel();
  tabs = tabs.filter((t) => t.id !== id);
  if (activeTabId === id) {
    activeTabId = tabs.length ? tabs[0].id : null;
  }
  persistTabs();
  renderTabs();
  renderWebviews();
  updateToolbarState();
}

function addTab() {
  if (tabs.length >= MAX_TABS) return;
  const id = nextTabId();
  const tab = { id, label: `Conta ${tabs.length + 1}`, createdAt: Date.now() };
  tabs.push(tab);
  activeTabId = id;
  persistTabs();
  renderTabs();
  renderWebviews();
  updateToolbarState();
}

function persistTabs() {
  // Rótulo + id + data de criação vão pro disco (ver comentário em
  // main.js) — nunca credenciais. Se a gravação falhar por qualquer
  // motivo, não trava o app.
  window.hunteraFarm.saveTabs(tabs).catch(() => {});
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// v0.5.0 — mesma formatação usada nos logs do content-injected.js, só pro
// texto curto ao lado do status ("· stamina 1h05" / "· stamina 42min").
function formatStaminaLabel(mins) {
  if (mins == null) return "?";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
}

// ---------- barra de ferramentas ----------
// Voltar/avançar/recarregar/URL só fazem sentido apontando pra UMA conta —
// ficam desativados no modo grade. O zoom continua ativo nos dois modos
// (no normal ajusta só a conta em foco; no grade ajusta as 4 juntas, ver
// applyZoom()).
function updateToolbarState() {
  const navDisabled = gridMode || !activeTabId;
  navGroupEl.classList.toggle("disabled", navDisabled);
  if (navDisabled) {
    urlBar.value = "";
    urlBar.placeholder = gridMode
      ? "Modo grade — sem navegação individual"
      : "Nenhuma conta selecionada";
  } else {
    const wv = getWebview(activeTabId);
    if (wv) {
      try {
        navBackBtn.disabled = typeof wv.canGoBack === "function" ? !wv.canGoBack() : false;
        navFwdBtn.disabled = typeof wv.canGoForward === "function" ? !wv.canGoForward() : false;
      } catch {
        // webview ainda não anexou de verdade — ignora, tenta de novo no
        // próximo evento de navegação.
      }
      try {
        if (document.activeElement !== urlBar) {
          urlBar.value = typeof wv.getURL === "function" ? wv.getURL() || gameUrl : gameUrl;
        }
      } catch {
        // idem
      }
    }
  }
  const factor = gridMode
    ? gridZoomOverride ?? ZOOM_GRID
    : activeTabId
    ? manualZoom.get(activeTabId) ?? ZOOM_NORMAL
    : ZOOM_NORMAL;
  updateZoomLabel(factor);
}

function navigateActiveTo(rawUrl) {
  const wv = getWebview(activeTabId);
  if (!wv) return;
  let target = rawUrl.trim();
  if (!target) return;
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  // O main.js já trava (will-navigate) qualquer navegação pra fora do
  // domínio do Huntera em todo webview do app — isso aqui é só o atalho de
  // digitar/colar uma URL, a barreira de segurança de verdade continua lá.
  wv.loadURL(target).catch(() => {});
}

navBackBtn.addEventListener("click", () => {
  const wv = getWebview(activeTabId);
  if (wv && wv.canGoBack()) wv.goBack();
});
navFwdBtn.addEventListener("click", () => {
  const wv = getWebview(activeTabId);
  if (wv && wv.canGoForward()) wv.goForward();
});
navReloadBtn.addEventListener("click", () => {
  const wv = getWebview(activeTabId);
  if (wv) wv.reload();
});
urlGoBtn.addEventListener("click", () => navigateActiveTo(urlBar.value));
urlBar.addEventListener("keydown", (e) => {
  if (e.key === "Enter") navigateActiveTo(urlBar.value);
});

function adjustZoom(delta) {
  if (gridMode) {
    gridZoomOverride = clampZoom((gridZoomOverride ?? ZOOM_GRID) + delta);
    applyZoomToAll();
  } else {
    if (!activeTabId) return;
    manualZoom.set(activeTabId, clampZoom((manualZoom.get(activeTabId) ?? ZOOM_NORMAL) + delta));
    const wv = getWebview(activeTabId);
    if (wv) applyZoom(wv);
  }
  updateToolbarState();
}
zoomOutBtn.addEventListener("click", () => adjustZoom(-ZOOM_STEP));
zoomInBtn.addEventListener("click", () => adjustZoom(ZOOM_STEP));
zoomLabel.addEventListener("click", () => {
  if (gridMode) {
    gridZoomOverride = null;
    applyZoomToAll();
  } else if (activeTabId) {
    manualZoom.delete(activeTabId);
    const wv = getWebview(activeTabId);
    if (wv) applyZoom(wv);
  }
  updateToolbarState();
});

// ---------- trilha de ícones + rodapé da barra lateral ----------
railGridBtn.addEventListener("click", () => {
  gridMode = !gridMode;
  railGridBtn.classList.toggle("on", gridMode);
  renderWebviews();
  applyZoomToAll();
  updateToolbarState();
});

groupHeaderToggle.addEventListener("click", () => {
  const collapsed = tabsEl.classList.toggle("collapsed");
  groupHeaderToggle.classList.toggle("collapsed", collapsed);
});

sidebarFooterReloadBtn.addEventListener("click", () => {
  tabs.forEach((tab) => {
    const wv = getWebview(tab.id);
    if (wv) wv.reload();
  });
});

addTabBtn.addEventListener("click", addTab);

autoLaunchToggle.addEventListener("change", () => {
  window.hunteraFarm.setAutoLaunch(autoLaunchToggle.checked).catch(() => {
    // Nem toda plataforma suporta "abrir com o sistema" (ex: em algumas
    // distros Linux é um no-op) — se falhar, não trava o app, só não
    // aplica de verdade.
  });
});

statusPill.textContent = "";

async function init() {
  gameUrl = await window.hunteraFarm.getGameUrl();
  try {
    gameHost = new URL(gameUrl).host;
  } catch {
    gameHost = gameUrl;
  }
  automationPreloadPath = await window.hunteraFarm.getAutomationPreloadPath();
  tabs = await window.hunteraFarm.loadTabs();
  activeTabId = tabs.length ? tabs[0].id : null;
  try {
    autoLaunchToggle.checked = await window.hunteraFarm.getAutoLaunch();
  } catch {
    autoLaunchToggle.checked = false;
  }
  renderTabs();
  renderWebviews();
  updateToolbarState();
  statusPill.textContent = `${tabs.length}/${MAX_TABS} contas`;
  setInterval(() => {
    updateUptimeLabels();
    statusPill.textContent = `${tabs.length}/${MAX_TABS} contas`;
  }, 60000);
}

init();
