// TASK-003-R2 — teste isolado: escada do Bestiário organizada por CAÇADA
// (não por criatura), nível selecionável, e controle explícito
// Iniciar/Pausar com fonte única de verdade.
//
// Mesmo método do scripts/teste-freio-ui.mjs: extrai, por marcador de
// texto, o bloco REAL de `renderer/renderer.js` (das consts do painel até
// o fim de `renderBestiaryLadder`) e roda dentro de um sandbox `vm` com um
// mini-DOM falso — não reimplementa a lógica, só o ambiente ao redor dela.
//
// Comando: node scripts/teste-bestiary-catalogo.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(here, "..", "renderer", "renderer.js");
const source = readFileSync(rendererPath, "utf8");

function extrair(inicio, fimExclusivo, nome) {
  const i = source.indexOf(inicio);
  const f = source.indexOf(fimExclusivo);
  if (i === -1 || f === -1 || f <= i) {
    console.error(`FALHA: marcadores de '${nome}' não encontrados em renderer.js.`);
    process.exit(1);
  }
  return source.slice(i, f);
}

const constsPainel = extrair(
  'const bestiaryControlEl = document.getElementById("bestiaryControl");',
  "// v0.11.10 — detector de spawn seco",
  "consts do painel do Bestiário"
);
const blocoBestiario = extrair(
  "function itensBestiaryLadderPersistiveis(itens) {",
  "function renderExpedicao(state) {",
  "bloco itensBestiaryLadderPersistiveis..renderBestiaryLadder"
);

let falhas = 0;
function assert(cond, msg) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// ---------- mini-DOM ----------

function parseAtributos(attrsStr) {
  const attrs = {};
  const re = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g;
  let m;
  while ((m = re.exec(attrsStr))) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : true;
  }
  return attrs;
}

function elementoDe(tag, attrs, texto) {
  const handlersPorTipo = {};
  return {
    tagName: tag.toUpperCase(),
    _attrs: attrs,
    checked: attrs.checked !== undefined,
    disabled: attrs.disabled !== undefined,
    textContent: texto || "",
    getAttribute(nome) {
      if (!Object.prototype.hasOwnProperty.call(this._attrs, nome)) return null;
      return this._attrs[nome] === true ? "" : this._attrs[nome];
    },
    addEventListener(tipo, cb) {
      (handlersPorTipo[tipo] = handlersPorTipo[tipo] || []).push(cb);
    },
    disparar(tipo) {
      if (this.disabled) return; // igual a um <button disabled> real: clique não dispara nada
      (handlersPorTipo[tipo] || []).forEach((h) => h());
    },
  };
}

// TASK-003-R2.3 — `<select>` real: `.value` reflete a `<option selected>`
// (ou a primeira, igual ao DOM de verdade) e pode ser sobrescrito antes de
// disparar "change", exatamente como o clique real do usuário faria.
function elementoSelectDe(attrs, innerHtml) {
  const handlersPorTipo = {};
  const opcoes = [];
  const reOption = /<option\b([^>]*)>([\s\S]*?)<\/option>/g;
  let m;
  while ((m = reOption.exec(innerHtml))) {
    const oAttrs = parseAtributos(m[1]);
    opcoes.push({ value: oAttrs.value !== undefined ? oAttrs.value : m[2], selected: oAttrs.selected !== undefined });
  }
  const selecionadaInicial = opcoes.find((o) => o.selected) || opcoes[0];
  return {
    tagName: "SELECT",
    _attrs: attrs,
    _opcoes: opcoes,
    value: selecionadaInicial ? selecionadaInicial.value : "",
    getAttribute(nome) {
      if (!Object.prototype.hasOwnProperty.call(this._attrs, nome)) return null;
      return this._attrs[nome] === true ? "" : this._attrs[nome];
    },
    addEventListener(tipo, cb) {
      (handlersPorTipo[tipo] = handlersPorTipo[tipo] || []).push(cb);
    },
    disparar(tipo) {
      (handlersPorTipo[tipo] || []).forEach((h) => h());
    },
  };
}

function parseElementos(html) {
  const elementos = [];
  const reButton = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = reButton.exec(html))) elementos.push(elementoDe("button", parseAtributos(m[1]), m[2]));
  const reInput = /<input\b([^>]*?)\/?>/g;
  while ((m = reInput.exec(html))) elementos.push(elementoDe("input", parseAtributos(m[1]), ""));
  const reSelect = /<select\b([^>]*)>([\s\S]*?)<\/select>/g;
  while ((m = reSelect.exec(html))) elementos.push(elementoSelectDe(parseAtributos(m[1]), m[2]));
  return elementos;
}

function fakeContainer() {
  return {
    _html: "",
    _elementos: [],
    set innerHTML(v) {
      this._html = v;
      this._elementos = parseElementos(v);
    },
    get innerHTML() {
      return this._html;
    },
    querySelectorAll(sel) {
      const m = /^([a-z]+)\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(sel.trim());
      if (!m) return [];
      const [, tag, attr, valorExigido] = m;
      return this._elementos.filter((el) => {
        if (el.tagName !== tag.toUpperCase()) return false;
        if (!Object.prototype.hasOwnProperty.call(el._attrs, attr)) return false;
        if (valorExigido !== undefined && el.getAttribute(attr) !== valorExigido) return false;
        return true;
      });
    },
  };
}

function fakeInput(initial = "") {
  return { value: initial, addEventListener() {}, focus() {} };
}
// TASK-003-R2.2 — botão/overlay simples com handlers por tipo de evento,
// pra testar abrir/fechar do modal sem precisar de um DOM real.
function fakeBotaoOuOverlay(propsIniciais = {}) {
  const handlers = {};
  return {
    ...propsIniciais,
    addEventListener(tipo, cb) {
      (handlers[tipo] = handlers[tipo] || []).push(cb);
    },
    disparar(tipo, evt) {
      if (this.disabled) return;
      (handlers[tipo] || []).forEach((h) => h(evt || {}));
    },
  };
}
function fakeTexto() {
  return {
    _text: "",
    set textContent(v) {
      this._text = v;
    },
    get textContent() {
      return this._text;
    },
  };
}

const enviosBestiaryLadder = []; // toda chamada real a sendAutomationCommand com setConfig.bestiaryLadder
const outrosComandos = [];
const documentHandlers = {}; // document.addEventListener("keydown", ...) — pro Esc fechar o modal

// TASK-003-R2 — as consts do bloco real (`const x = document.getElementById(...)`)
// criam bindings `const` no escopo léxico do contexto `vm`, que SOMBREIAM
// qualquer propriedade igual já setada no objeto sandbox — por isso os
// elementos falsos vêm de dentro de `getElementById`, nunca como
// propriedade pré-setada no sandbox (bug já corrigido numa rodada anterior
// deste mesmo teste).
const bestiaryModalCardFake = fakeBotaoOuOverlay();
const elementosFalsos = {
  bestiaryControl: fakeContainer(),
  bestiaryLadderLista: fakeContainer(),
  bestiaryLadderResumo: fakeTexto(),
  bestiaryAddHuntsBtn: fakeBotaoOuOverlay(),
  bestiaryHuntModal: fakeBotaoOuOverlay({
    hidden: true,
    querySelector: (sel) => (sel === ".bestiaryModalCard" ? bestiaryModalCardFake : null),
  }),
  bestiaryModalFecharBtn: fakeBotaoOuOverlay(),
  bestiaryCatalogoSearch: fakeInput(""),
  bestiaryCatalogoLista: fakeContainer(),
};

const sandbox = {
  console,
  document: {
    activeElement: null,
    getElementById: (id) => {
      if (elementosFalsos[id]) return elementosFalsos[id];
      for (const contId of ["bestiaryControl", "bestiaryCatalogoLista"]) {
        const achado = elementosFalsos[contId]._elementos.find((el) => el.getAttribute("id") === id);
        if (achado) return achado;
      }
      return null;
    },
    addEventListener: (tipo, cb) => {
      (documentHandlers[tipo] = documentHandlers[tipo] || []).push(cb);
    },
  },
  automationState: new Map(),
  selectedAutomationTabId: "conta-1",
  sendAutomationCommand: (tabId, msg) => {
    if (msg && msg.type === "setConfig" && msg.payload && msg.payload.bestiaryLadder) {
      enviosBestiaryLadder.push({ tabId, msg });
    } else {
      outrosComandos.push({ tabId, msg });
    }
    return true;
  },
  escapeHtml: (s) => String(s == null ? "" : s),
  fmtNum: (n) => String(n),
};

const context = vm.createContext(sandbox);
vm.runInContext(constsPainel, context, { filename: "renderer-bestiary-consts.js" });
vm.runInContext(blocoBestiario, context, { filename: "renderer-bestiary-block.js" });

function run(code) {
  return vm.runInContext(code, context, { filename: "teste-bestiary-inline.js" });
}
function dispararDocumento(tipo, evt) {
  (documentHandlers[tipo] || []).forEach((h) => h(evt || {}));
}

function ultimoEnvio() {
  return enviosBestiaryLadder[enviosBestiaryLadder.length - 1] || null;
}
function itensDoUltimoEnvio() {
  const e = ultimoEnvio();
  return e ? e.msg.payload.bestiaryLadder.itens : null;
}

// ============================================================
// PARTE 1 — modelo por CAÇADA (dedup por hunt, criatura de referência)
// ============================================================

const catalogoBase = [
  { hunt: "Rat Cellars", criaturas: ["Rat"], tiers: ["Tier 1"], forca: 10 },
  { hunt: "Giant Lair", criaturas: ["Behemoth", "Cyclops"], tiers: ["Tier 3"], forca: 500 },
  { hunt: "Caçada Sem Bicho Mapeado", criaturas: [], tiers: [], forca: null },
  // TASK-003-R2.3 — hunt dedicada aos testes de tier: 3 tiers reais, na
  // ordem do jogo (mais fácil -> mais difícil), igual `guild.cacadas[].tiers`.
  { hunt: "Sand Sharpie", criaturas: ["Piranha"], tiers: ["Cautious", "Bold", "Reckless"], forca: 50 },
];
function estadoComLadder(itens, pullLevel) {
  return {
    bestiaryCatalogo: catalogoBase,
    bestiaryLadder: { enabled: false, index: 0, itens },
    pullLevel: pullLevel || "",
  };
}

sandbox.automationState.set("conta-1", estadoComLadder([]));

// Cenário 0 — TASK-003-R2.2: com o modal FECHADO (estado inicial real do
// app), o catálogo pesado nunca é montado no DOM, mesmo chamando a função
// de render diretamente com dados de sobra. "Minha escada" continua
// funcionando (renderBestiaryLadder não depende do modal pra nada).
assert(elementosFalsos.bestiaryHuntModal.hidden === true, "modal começa fechado (hidden=true), como no boot real do app");
run('renderBestiaryCatalogo(automationState.get("conta-1"));');
assert(elementosFalsos.bestiaryCatalogoLista.innerHTML === "", "com o modal fechado, chamar renderBestiaryCatalogo não põe NADA no DOM do catálogo");
run('renderBestiaryLadder(automationState.get("conta-1"));');
assert(elementosFalsos.bestiaryLadderLista.innerHTML.includes("Nenhuma caçada na escada"), "\"Minha escada\" renderiza normalmente mesmo com o modal do catálogo fechado");

// A partir daqui, Parte 1 testa o CONTEÚDO do catálogo — abre o modal uma
// vez (mesma função que o botão "+ Adicionar caçadas" chama) e deixa
// aberto pro resto desta parte; o ciclo completo abrir→fechar→reabrir tem
// sua própria seção (Parte 4, mais abaixo).
run("abrirBestiaryModal();");
assert(elementosFalsos.bestiaryHuntModal.hidden === false, "abrirBestiaryModal() desoculta o modal");

// Cenário 1 — adicionar "Rat Cellars" cria uma única entrada por hunt.
enviosBestiaryLadder.length = 0;
run('renderBestiaryCatalogo(automationState.get("conta-1"));');
const botaoAddRat = elementosFalsos.bestiaryCatalogoLista._elementos.find(
  (el) => el.tagName === "BUTTON" && el.getAttribute("data-add-hunt") === "Rat Cellars" && el.getAttribute("data-add-criatura") === "Rat"
);
assert(!!botaoAddRat, "existe um botão 'Adicionar' real pra Rat Cellars + Rat");
botaoAddRat.disparar("click");
assert(enviosBestiaryLadder.length === 1, `1 comando enviado ao adicionar (encontrados: ${enviosBestiaryLadder.length})`);
let itens = itensDoUltimoEnvio();
assert(itens.length === 1, "a escada tem exatamente 1 entrada após adicionar Rat Cellars");
assert(
  itens[0].hunt === "Rat Cellars" && itens[0].criatura === "Rat" && itens[0].faseAlvo === 1,
  `entrada é { hunt: "Rat Cellars", criatura: "Rat", faseAlvo: 1 } — recebido: ${JSON.stringify(itens[0])}`
);

// Cenário 2 — adicionar de novo a MESMA hunt não duplica a entrada.
sandbox.automationState.set("conta-1", estadoComLadder(itens));
enviosBestiaryLadder.length = 0;
run('renderBestiaryCatalogo(automationState.get("conta-1"));');
const botaoRatDeNovo = elementosFalsos.bestiaryCatalogoLista._elementos.find(
  (el) => el.tagName === "BUTTON" && el.getAttribute("data-add-hunt") === "Rat Cellars"
);
assert(!botaoRatDeNovo, "depois de adicionada, Rat Cellars não mostra mais botão 'Adicionar' nenhum (chip vira informativo)");
run('adicionarCacadaNaEscada("Rat Cellars", "Rat");'); // chamada direta, defesa em profundidade
assert(enviosBestiaryLadder.length === 0, "chamar adicionarCacadaNaEscada de novo pra hunt já presente não envia comando nenhum");

// Cenário 2b — Giant Lair tem 2 criaturas: adicionar por "Behemoth" e depois
// trocar a referência pra "Cyclops" continua sendo 1 entrada só.
sandbox.automationState.set("conta-1", estadoComLadder(itens));
enviosBestiaryLadder.length = 0;
run('renderBestiaryCatalogo(automationState.get("conta-1"));');
let botaoAddBehemoth = elementosFalsos.bestiaryCatalogoLista._elementos.find(
  (el) => el.tagName === "BUTTON" && el.getAttribute("data-add-hunt") === "Giant Lair" && el.getAttribute("data-add-criatura") === "Behemoth"
);
assert(!!botaoAddBehemoth, "existe botão 'Adicionar' pra Giant Lair + Behemoth");
botaoAddBehemoth.disparar("click");
itens = itensDoUltimoEnvio();
assert(itens.length === 2, `escada tem 2 entradas (Rat Cellars + Giant Lair) — recebido: ${itens.length}`);
const giantEntry1 = itens.find((it) => it.hunt === "Giant Lair");
assert(giantEntry1 && giantEntry1.criatura === "Behemoth", "Giant Lair foi adicionada com Behemoth como referência");

sandbox.automationState.set("conta-1", estadoComLadder(itens));
enviosBestiaryLadder.length = 0;
run('renderBestiaryCatalogo(automationState.get("conta-1"));');
const botaoUsarCyclops = elementosFalsos.bestiaryCatalogoLista._elementos.find(
  (el) => el.tagName === "BUTTON" && el.getAttribute("data-switch-hunt") === "Giant Lair" && el.getAttribute("data-switch-criatura") === "Cyclops"
);
assert(!!botaoUsarCyclops, "existe botão 'Usar esta' pra trocar a referência pra Cyclops");
botaoUsarCyclops.disparar("click");
itens = itensDoUltimoEnvio();
assert(itens.length === 2, "trocar a referência não cria uma 3ª entrada — continuam 2");
const giantEntry2 = itens.find((it) => it.hunt === "Giant Lair");
assert(giantEntry2 && giantEntry2.criatura === "Cyclops", "referência de Giant Lair agora é Cyclops");
assert(giantEntry2.faseAlvo === 1 && giantEntry2.concluido === false, "trocar referência não mexeu em faseAlvo/concluido");

// Cenário 2c — v0.13.0-fix: André quer acompanhar DUAS criaturas da MESMA
// caçada (cada uma com seu próprio alvo/prioridade), não só trocar qual é a
// referência única. Giant Lair já tem Cyclops como referência (cenário
// 2b) — precisa existir um "+ Também" pra Behemoth que cria uma SEGUNDA
// entrada, sem mexer na primeira.
sandbox.automationState.set("conta-1", estadoComLadder(itens));
enviosBestiaryLadder.length = 0;
run('renderBestiaryCatalogo(automationState.get("conta-1"));');
const botaoTambemBehemoth = elementosFalsos.bestiaryCatalogoLista._elementos.find(
  (el) => el.tagName === "BUTTON" && el.getAttribute("data-add-hunt") === "Giant Lair" && el.getAttribute("data-add-criatura") === "Behemoth"
);
assert(!!botaoTambemBehemoth, "existe botão '+ Também' pra acompanhar Behemoth JUNTO com Cyclops em Giant Lair");
botaoTambemBehemoth.disparar("click");
itens = itensDoUltimoEnvio();
assert(itens.length === 3, `escada tem 3 entradas agora (Rat Cellars + Giant Lair×2) — recebido: ${itens.length}`);
const giantEntries = itens.filter((it) => it.hunt === "Giant Lair");
assert(giantEntries.length === 2, `Giant Lair tem 2 entradas — recebido: ${giantEntries.length}`);
assert(
  giantEntries.some((it) => it.criatura === "Cyclops") && giantEntries.some((it) => it.criatura === "Behemoth"),
  "as duas entradas de Giant Lair têm criaturas de referência diferentes (Cyclops e Behemoth)"
);
assert(
  giantEntries.every((it) => it.faseAlvo === 1 && it.concluido === false),
  "a nova entrada (Behemoth) nasce com faseAlvo 1 e não concluída, igual a qualquer entrada nova — não herda nada da entrada irmã"
);

sandbox.automationState.set("conta-1", estadoComLadder(itens));
enviosBestiaryLadder.length = 0;
run('renderBestiaryCatalogo(automationState.get("conta-1"));');
const chipsGiantLair = elementosFalsos.bestiaryCatalogoLista._elementos.filter(
  (el) => el.getAttribute && el.getAttribute("data-add-criatura") === "Behemoth"
);
assert(chipsGiantLair.length === 0, "com as 2 entradas já criadas, Behemoth não mostra mais nenhum botão de ação (chip vira 'acompanhando')");

// Cenário 3 — nível selecionado é persistido (stepper em "Minha escada").
// TASK-003-R2.1 — `ajustarFaseAlvo` passou a ser por ÍNDICE (não por
// `hunt`): "Rat Cellars" está no índice 0 desta lista (`itens[0]`).
sandbox.automationState.set("conta-1", estadoComLadder(itens));
enviosBestiaryLadder.length = 0;
assert(itens[0].hunt === "Rat Cellars", "pré-condição do cenário: Rat Cellars está no índice 0");
run("ajustarFaseAlvo(0, 1);");
itens = itensDoUltimoEnvio();
const ratAposStepper = itens.find((it) => it.hunt === "Rat Cellars");
assert(ratAposStepper && ratAposStepper.faseAlvo === 2, `stepper +1 leva faseAlvo de Rat Cellars a 2 — recebido: ${ratAposStepper && ratAposStepper.faseAlvo}`);
run("ajustarFaseAlvo(0, -5);"); // nunca abaixo de 1 — sem teto/piso inventado além do mínimo óbvio
itens = itensDoUltimoEnvio();
const ratAposDescer = itens.find((it) => it.hunt === "Rat Cellars");
assert(ratAposDescer.faseAlvo === 1, "stepper nunca deixa faseAlvo menor que 1");

// Cenário 4 — itens legados continuam carregando sem serem descartados.
// TASK-003-R2.1 — REVERTIDO: chegou a existir dedup automática por `hunt`
// aqui (mantendo só a 1ª ocorrência). Isso apagava configuração legada
// válida (duas entradas da mesma hunt com criaturas de referência
// diferentes) na primeira ação trivial qualquer. Agora NENHUMA duplicata é
// removida por esta função — só itens estruturalmente inválidos (sem
// `hunt`) são filtrados.
const legado = run(`itensBestiaryLadderPersistiveis([
  { hunt: "Legado Sem Campo Novo", criatura: "Legado Sem Campo Novo", faseAlvo: 3, concluido: true },
  { hunt: "Duplicada Legada", criatura: "Primeira", faseAlvo: 2, concluido: false },
  { hunt: "Duplicada Legada", criatura: "Segunda", faseAlvo: 9, concluido: true },
  { hunt: "", criatura: "Sem Hunt", faseAlvo: 1, concluido: false },
])`);
assert(legado.length === 3, `hunt vazia é filtrada, mas a duplicata legada NÃO é removida — recebido: ${legado.length}`);
assert(legado[0].hunt === "Legado Sem Campo Novo" && legado[0].faseAlvo === 3 && legado[0].concluido === true, "item legado é preservado com seus valores originais");
const duplicadasLegadas = legado.filter((it) => it.hunt === "Duplicada Legada");
assert(duplicadasLegadas.length === 2, "as DUAS entradas legadas da mesma hunt sobrevivem — nenhuma é descartada silenciosamente");
assert(
  duplicadasLegadas.some((it) => it.criatura === "Primeira" && it.faseAlvo === 2) &&
    duplicadasLegadas.some((it) => it.criatura === "Segunda" && it.faseAlvo === 9),
  "cada duplicata legada mantém sua própria criatura de referência e faseAlvo, intactos"
);

// Cenário 5 — nenhuma criatura/hunt inexistente é inventada.
enviosBestiaryLadder.length = 0;
run('adicionarCacadaNaEscada("Caçada Sem Bicho Mapeado", "");');
run('adicionarCacadaNaEscada("Caçada Sem Bicho Mapeado", null);');
run('adicionarCacadaNaEscada("Caçada Sem Bicho Mapeado", undefined);');
run('adicionarCacadaNaEscada("", "Alguma Criatura");');
assert(enviosBestiaryLadder.length === 0, "sem hunt ou sem criatura real, nenhum comando é enviado (nada é inventado)");
sandbox.automationState.set("conta-1", estadoComLadder(itens));
run('trocarCriaturaReferencia("Rat Cellars", "");');
assert(enviosBestiaryLadder.length === 0, "trocar referência pra uma criatura vazia também não envia nada");

// ============================================================
// PARTE 2 — controle explícito Iniciar/Pausar (fonte única de verdade)
// ============================================================

// Cenário 6 — sem itens: botão indisponível, nenhuma config enviada.
enviosBestiaryLadder.length = 0;
run('renderBestiaryControl({ bestiaryLadder: { enabled: false, index: 0, itens: [] } });');
const startVazio = sandbox.document.getElementById("bestiaryStartBtn");
assert(!!startVazio && startVazio.disabled === true, "sem itens, o botão 'Iniciar Bestiário' existe mas está desabilitado");
if (startVazio) startVazio.disparar("click");
assert(enviosBestiaryLadder.length === 0, "clicar no botão desabilitado (sem itens) não envia comando nenhum");

// Cenário 7 — com hunt válida e enabled=false: "Iniciar Bestiário" envia
// enabled:true preservando os itens.
const itensParaControle = [{ hunt: "Rat Cellars", criatura: "Rat", faseAlvo: 2, concluido: false }];
enviosBestiaryLadder.length = 0;
run(`renderBestiaryControl({ bestiaryLadder: { enabled: false, index: 0, itens: ${JSON.stringify(itensParaControle)} } });`);
const startBtn = sandbox.document.getElementById("bestiaryStartBtn");
assert(!!startBtn && startBtn.disabled === false, "com 1 hunt configurada, 'Iniciar Bestiário' aparece habilitado");
startBtn.disparar("click");
assert(enviosBestiaryLadder.length === 1, "clicar em Iniciar envia exatamente 1 comando");
const payloadIniciar = ultimoEnvio().msg.payload.bestiaryLadder;
assert(payloadIniciar.enabled === true, "Iniciar Bestiário manda enabled: true");
assert(JSON.stringify(payloadIniciar.itens) === JSON.stringify(itensParaControle), "Iniciar Bestiário preserva os itens exatamente como estavam (ordem, nível, tudo)");

// Cenário 8 — com enabled=true: "Pausar Bestiário" envia enabled:false
// preservando os itens.
enviosBestiaryLadder.length = 0;
run(`renderBestiaryControl({ bestiaryLadder: { enabled: true, index: 0, indiceAtual: 0, itens: ${JSON.stringify(
  itensParaControle.map((it) => ({ ...it, faseAtual: 1 }))
)} } });`);
const pauseBtn = sandbox.document.getElementById("bestiaryPauseBtn");
assert(!!pauseBtn, "com enabled:true, o botão vira 'Pausar Bestiário'");
pauseBtn.disparar("click");
assert(enviosBestiaryLadder.length === 1, "clicar em Pausar envia exatamente 1 comando");
const payloadPausar = ultimoEnvio().msg.payload.bestiaryLadder;
assert(payloadPausar.enabled === false, "Pausar Bestiário manda enabled: false");
assert(
  JSON.stringify(payloadPausar.itens.map(({ hunt, criatura, faseAlvo, concluido }) => ({ hunt, criatura, faseAlvo, concluido }))) ===
    JSON.stringify(itensParaControle),
  "Pausar Bestiário preserva hunt/criatura/faseAlvo/concluido de cada item"
);

// Cenário 9 — pausar e iniciar de novo não perde ordem/níveis, e o comando
// nunca carrega `faseAtual`/`abatesAtuais` (progresso é sempre relido do
// host, nunca reenviado pelo cliente — não existe risco de "regredir" o
// progresso local que o backend já tem).
assert(
  !("faseAtual" in payloadPausar.itens[0]) && !("abatesAtuais" in payloadPausar.itens[0]),
  "o payload enviado ao pausar/iniciar nunca inclui faseAtual/abatesAtuais (só o backend escreve isso)"
);

// ============================================================
// PARTE 3 — TASK-003-R2.1: duplicata legada nunca é apagada por uma ação
// trivial (iniciar, pausar, ajustar nível de UMA das duas).
// ============================================================

const duasEntradasLegadas = [
  { hunt: "Rat Cellars", criatura: "Rat", faseAlvo: 2, concluido: false },
  { hunt: "Rat Cellars", criatura: "Rat Rei", faseAlvo: 5, concluido: false }, // duplicata legada — criatura de referência diferente
];

function assertAmbasPresentes(itensRecebidos, contexto) {
  const doHunt = itensRecebidos.filter((it) => it.hunt === "Rat Cellars");
  assert(doHunt.length === 2, `${contexto}: as 2 entradas legadas de "Rat Cellars" continuam presentes — recebido: ${doHunt.length}`);
  assert(doHunt.some((it) => it.criatura === "Rat" && it.faseAlvo === 2), `${contexto}: a entrada de referência "Rat" (faseAlvo 2) não foi alterada nem removida`);
  assert(doHunt.some((it) => it.criatura === "Rat Rei" && it.faseAlvo === 5), `${contexto}: a entrada de referência "Rat Rei" (faseAlvo 5) não foi alterada nem removida`);
}

// Cenário 10 — Iniciar preserva as duas.
enviosBestiaryLadder.length = 0;
run(`renderBestiaryControl({ bestiaryLadder: { enabled: false, index: 0, itens: ${JSON.stringify(duasEntradasLegadas)} } });`);
sandbox.document.getElementById("bestiaryStartBtn").disparar("click");
assertAmbasPresentes(itensDoUltimoEnvio(), "Iniciar Bestiário");
assert(ultimoEnvio().msg.payload.bestiaryLadder.enabled === true, "Iniciar ainda manda enabled:true corretamente mesmo com duplicata legada presente");

// Cenário 11 — Pausar preserva as duas.
enviosBestiaryLadder.length = 0;
run(`renderBestiaryControl({ bestiaryLadder: { enabled: true, index: 0, indiceAtual: 0, itens: ${JSON.stringify(duasEntradasLegadas)} } });`);
sandbox.document.getElementById("bestiaryPauseBtn").disparar("click");
assertAmbasPresentes(itensDoUltimoEnvio(), "Pausar Bestiário");
assert(ultimoEnvio().msg.payload.bestiaryLadder.enabled === false, "Pausar ainda manda enabled:false corretamente mesmo com duplicata legada presente");

// Cenário 12 — ajustar o nível de UMA (pelo índice da linha clicada, nunca
// pela hunt) não remove nem mexe na outra.
sandbox.automationState.set("conta-1", { bestiaryLadder: { enabled: false, index: 0, itens: duasEntradasLegadas } });
enviosBestiaryLadder.length = 0;
run("ajustarFaseAlvo(1, 1);"); // índice 1 = a entrada "Rat Rei" (faseAlvo 5 -> 6)
let itensPosStepper = itensDoUltimoEnvio();
assert(itensPosStepper.length === 2, "ajustar o nível do índice 1 não faz a outra entrada sumir — continuam 2");
const ratReiDepois = itensPosStepper.find((it) => it.criatura === "Rat Rei");
const ratNormalDepois = itensPosStepper.find((it) => it.criatura === "Rat");
assert(ratReiDepois && ratReiDepois.faseAlvo === 6, `o stepper no índice 1 mexeu na entrada certa (Rat Rei: 5→6) — recebido: ${ratReiDepois && ratReiDepois.faseAlvo}`);
assert(ratNormalDepois && ratNormalDepois.faseAlvo === 2, "a OUTRA entrada (Rat, índice 0) não foi tocada pelo stepper do índice 1");

// Cenário 13 — nenhuma entrada legada desaparece do payload salvo, mesmo
// depois de várias operações em sequência (checkbox, mover, iniciar).
sandbox.automationState.set("conta-1", { bestiaryLadder: { enabled: false, index: 0, itens: duasEntradasLegadas } });
enviosBestiaryLadder.length = 0;
run('renderBestiaryLadder({ bestiaryLadder: { enabled: false, index: 0, indiceAtual: 0, itens: ' + JSON.stringify(duasEntradasLegadas) + ' } });');
const checkboxRatRei = elementosFalsos.bestiaryLadderLista._elementos.find((el) => el.tagName === "INPUT" && el.getAttribute("data-ladder-done") === "1");
assert(!!checkboxRatRei, "checkbox 'concluída' da 2ª linha (índice 1) existe");
checkboxRatRei.checked = true; // simula o clique real marcando a caixa antes do evento "change"
checkboxRatRei.disparar("change");
const itensPosCheckbox = itensDoUltimoEnvio();
assert(itensPosCheckbox.length === 2, "marcar 'concluída' na 2ª linha não descarta a 1ª");
assert(itensPosCheckbox.find((it) => it.criatura === "Rat Rei").concluido === true, "a 2ª linha foi marcada concluída");
assert(itensPosCheckbox.find((it) => it.criatura === "Rat").concluido === false, "a 1ª linha continua não concluída, intocada");

// ============================================================
// PARTE 4 — TASK-003-R2.2: modal "Adicionar caçadas" (abrir/fechar/reabrir)
// ============================================================

const estadoModalTeste = estadoComLadder([{ hunt: "Rat Cellars", criatura: "Rat", faseAlvo: 1, concluido: false }]);
sandbox.automationState.set("conta-1", estadoModalTeste);

// Cenário 14 — fechar desmonta o catálogo pesado (nunca fica invisível no
// DOM) e NÃO mexe na escada/configuração.
run("fecharBestiaryModal();");
assert(elementosFalsos.bestiaryHuntModal.hidden === true, "fecharBestiaryModal() oculta o modal");
assert(elementosFalsos.bestiaryCatalogoLista.innerHTML === "", "fechar limpa o innerHTML do catálogo — nenhum card fica escondido no DOM");
const ladderIntacta = sandbox.automationState.get("conta-1").bestiaryLadder.itens;
assert(ladderIntacta.length === 1 && ladderIntacta[0].hunt === "Rat Cellars", "fechar o modal não altera a escada/configuração de forma alguma");

// Cenário 15 — enquanto fechado, chamadas de render (via sendState/tick
// normal do app) continuam sem popular o catálogo.
run('renderBestiaryLadder(automationState.get("conta-1"));'); // isto chama renderBestiaryCatalogo por dentro
assert(elementosFalsos.bestiaryCatalogoLista.innerHTML === "", "um tick normal de renderBestiaryLadder não repopula o catálogo com o modal fechado");
assert(elementosFalsos.bestiaryLadderLista.innerHTML.includes("Rat Cellars"), "\"Minha escada\" continua visível e funcional com o modal fechado");

// Cenário 16 — reabrir renderiza o catálogo de novo (sob demanda), busca
// filtra, adicionar funciona, e a MESMA hunt já presente não duplica.
run("abrirBestiaryModal();");
assert(elementosFalsos.bestiaryHuntModal.hidden === false, "reabrir desoculta o modal de novo");
assert(elementosFalsos.bestiaryCatalogoLista.innerHTML.length > 0, "reabrir renderiza o catálogo de novo (sob demanda, não ficou pré-montado)");
const botaoRatJaNaEscadaAoReabrir = elementosFalsos.bestiaryCatalogoLista._elementos.find(
  (el) => el.tagName === "BUTTON" && el.getAttribute("data-add-hunt") === "Rat Cellars"
);
assert(!botaoRatJaNaEscadaAoReabrir, "Rat Cellars (já configurada antes de fechar) continua sem botão 'Adicionar' ao reabrir — não duplica");

elementosFalsos.bestiaryCatalogoSearch.value = "Goblin"; // busca por algo que não existe no catálogo desta rodada
run("bestiaryCatalogoAssinaturaAnterior = null; renderBestiaryCatalogo(automationState.get('conta-1'));");
assert(
  elementosFalsos.bestiaryCatalogoLista.innerHTML.includes("Nenhuma caçada encontrada"),
  "a busca dentro do modal filtra de verdade (sem resultado pra 'Goblin' neste catálogo)"
);
elementosFalsos.bestiaryCatalogoSearch.value = "";

// Cenário 17 — fechar de novo por clique no overlay (fora do card) e pelo
// botão "✕" — os dois caminhos funcionam.
run("bestiaryCatalogoAssinaturaAnterior = null; renderBestiaryCatalogo(automationState.get('conta-1'));");
assert(elementosFalsos.bestiaryCatalogoLista.innerHTML.length > 0, "pré-condição: catálogo está populado antes de testar os fechamentos");
elementosFalsos.bestiaryHuntModal.disparar("click", { target: elementosFalsos.bestiaryHuntModal });
assert(elementosFalsos.bestiaryHuntModal.hidden === true, "clicar no overlay (fora do card) fecha o modal");
assert(elementosFalsos.bestiaryCatalogoLista.innerHTML === "", "fechar pelo overlay também desmonta o catálogo");

run("abrirBestiaryModal();");
elementosFalsos.bestiaryModalFecharBtn.disparar("click");
assert(elementosFalsos.bestiaryHuntModal.hidden === true, "clicar no botão '✕' fecha o modal");

run("abrirBestiaryModal();");
dispararDocumento("keydown", { key: "Escape" });
assert(elementosFalsos.bestiaryHuntModal.hidden === true, "a tecla Esc também fecha o modal");

// ============================================================
// PARTE 5 — TASK-003-R2.3: nível/tier selecionável por hunt
// ============================================================

function selectDeTier(hunt) {
  return elementosFalsos.bestiaryCatalogoLista._elementos.find(
    (el) => el.tagName === "SELECT" && el.getAttribute("data-tier-hunt") === hunt
  );
}

// Cenário 18 — hunt com vários tiers: o select mostra todos, na ordem do
// catálogo (mais fácil -> mais difícil), sem inventar nenhum.
// (Parte 4 terminou com o modal fechado via Esc — reabre pra Parte 5.)
run("abrirBestiaryModal();");
sandbox.automationState.set("conta-1", estadoComLadder([], "Bold"));
enviosBestiaryLadder.length = 0;
run('bestiaryCatalogoAssinaturaAnterior = null; renderBestiaryCatalogo(automationState.get("conta-1"));');
let selectSand = selectDeTier("Sand Sharpie");
assert(!!selectSand, "existe um <select> de tier pra Sand Sharpie (3 tiers reais)");
assert(
  JSON.stringify(selectSand._opcoes.map((o) => o.value)) === JSON.stringify(["Cautious", "Bold", "Reckless"]),
  `as opções do select são exatamente os tiers do catálogo, na ordem — recebido: ${JSON.stringify(selectSand._opcoes.map((o) => o.value))}`
);

// Cenário 19 — tier global válido (existe entre os tiers da hunt) vira o
// padrão selecionado.
assert(selectSand.value === "Bold", `com pullLevel global "Bold" (existe em Sand Sharpie), o padrão selecionado é "Bold" — recebido: "${selectSand.value}"`);

// Cenário 20 — tier global AUSENTE na hunt -> primeiro tier válido do
// catálogo vira o padrão (nunca o global inventado nem vazio).
sandbox.automationState.set("conta-1", estadoComLadder([], "Suicidal")); // "Suicidal" não existe em Sand Sharpie
enviosBestiaryLadder.length = 0;
run('bestiaryCatalogoAssinaturaAnterior = null; renderBestiaryCatalogo(automationState.get("conta-1"));');
selectSand = selectDeTier("Sand Sharpie");
assert(selectSand.value === "Cautious", `pullLevel global fora dos tiers da hunt -> padrão é o PRIMEIRO tier real ("Cautious") — recebido: "${selectSand.value}"`);

// Cenário 21 — a seleção persiste no item ao adicionar (não o padrão, o que
// o usuário efetivamente escolheu no select).
selectSand.value = "Reckless"; // usuário troca a seleção antes de clicar
const botaoAddPiranha = elementosFalsos.bestiaryCatalogoLista._elementos.find(
  (el) => el.tagName === "BUTTON" && el.getAttribute("data-add-hunt") === "Sand Sharpie" && el.getAttribute("data-add-criatura") === "Piranha"
);
assert(!!botaoAddPiranha, "existe o botão 'Adicionar' pra Sand Sharpie + Piranha");
botaoAddPiranha.disparar("click");
let itensComTier = itensDoUltimoEnvio();
const sandEntry = itensComTier.find((it) => it.hunt === "Sand Sharpie");
assert(sandEntry && sandEntry.tier === "Reckless", `a entrada salva com o tier ESCOLHIDO ("Reckless"), não o padrão — recebido: ${sandEntry && sandEntry.tier}`);

// Cenário 22 — a automação do Bestiário usa o tier do item (backend,
// content-injected.js) — coberto em scripts/teste-bestiary-tier.mjs
// (extração real de alvoDeCacada/tierDoBestiaryLadder), não aqui: este
// arquivo testa só o lado do renderer. Ver ENTREGA pra detalhe.

// Cenário 23 — item legado sem tier continua sem o campo (cai pro
// cfg.pullLevel em runtime) — `itensBestiaryLadderPersistiveis` nunca
// inventa um `tier`.
const legadoSemTier = run('itensBestiaryLadderPersistiveis([{ hunt: "Rat Cellars", criatura: "Rat", faseAlvo: 1, concluido: false }])');
assert(!("tier" in legadoSemTier[0]), "item legado sem tier continua SEM o campo `tier` depois de persistido (nunca inventa um valor)");

// Cenário 24 — tier inválido (não pertence à hunt) não é aceito nem ao
// adicionar, nem ao editar em "Minha escada".
sandbox.automationState.set("conta-1", estadoComLadder([]));
enviosBestiaryLadder.length = 0;
run('adicionarCacadaNaEscada("Sand Sharpie", "Piranha", "Nivel-Que-Nao-Existe");');
itensComTier = itensDoUltimoEnvio();
assert(!("tier" in itensComTier[0]), "tier inválido na criação: a entrada é criada, mas SEM o campo tier (não inventa nem aceita o inválido)");

sandbox.automationState.set("conta-1", {
  ...estadoComLadder([{ hunt: "Sand Sharpie", criatura: "Piranha", faseAlvo: 1, concluido: false, tier: "Bold" }]),
});
enviosBestiaryLadder.length = 0;
run('ajustarTier(0, "Nivel-Que-Nao-Existe");');
assert(enviosBestiaryLadder.length === 0, "editar pra um tier inválido em 'Minha escada' não envia comando nenhum (fica com o valor anterior)");

// Cenário 25 — editar o tier de uma entrada já existente, em "Minha
// escada", sem remover a hunt.
sandbox.automationState.set("conta-1", {
  ...estadoComLadder([{ hunt: "Sand Sharpie", criatura: "Piranha", faseAlvo: 1, concluido: false, tier: "Bold" }]),
});
run('ajustarTier(0, "Reckless");');
itensComTier = itensDoUltimoEnvio();
assert(itensComTier.length === 1 && itensComTier[0].hunt === "Sand Sharpie", "editar o tier não remove nem duplica a entrada");
assert(itensComTier[0].tier === "Reckless", `tier editado com sucesso pra "Reckless" — recebido: ${itensComTier[0].tier}`);

// Cenário 26 — modal fechado continua sem catálogo pesado no DOM mesmo
// depois de toda a interação com tiers acima (regressão do R2.2).
run("fecharBestiaryModal();");
assert(elementosFalsos.bestiaryCatalogoLista.innerHTML === "", "modal fechado ao final: catálogo continua vazio no DOM");

// ============================================================
if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) FALHARAM.`);
  process.exit(1);
}
console.log("\nTODOS OS CENARIOS PASSARAM");
