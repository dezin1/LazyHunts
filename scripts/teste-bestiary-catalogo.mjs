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

function parseElementos(html) {
  const elementos = [];
  const reButton = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = reButton.exec(html))) elementos.push(elementoDe("button", parseAtributos(m[1]), m[2]));
  const reInput = /<input\b([^>]*?)\/?>/g;
  while ((m = reInput.exec(html))) elementos.push(elementoDe("input", parseAtributos(m[1]), ""));
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
  return { value: initial, addEventListener() {} };
}

const enviosBestiaryLadder = []; // toda chamada real a sendAutomationCommand com setConfig.bestiaryLadder
const outrosComandos = [];

// TASK-003-R2 — as consts do bloco real (`const x = document.getElementById(...)`)
// criam bindings `const` no escopo léxico do contexto `vm`, que SOMBREIAM
// qualquer propriedade igual já setada no objeto sandbox — por isso os
// elementos falsos vêm de dentro de `getElementById`, nunca como
// propriedade pré-setada no sandbox (bug já corrigido numa rodada anterior
// deste mesmo teste).
const elementosFalsos = {
  bestiaryControl: fakeContainer(),
  bestiaryLadderLista: fakeContainer(),
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
];
function estadoComLadder(itens) {
  return { bestiaryCatalogo: catalogoBase, bestiaryLadder: { enabled: false, index: 0, itens } };
}

sandbox.automationState.set("conta-1", estadoComLadder([]));

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

// Cenário 3 — nível selecionado é persistido (stepper em "Minha escada").
sandbox.automationState.set("conta-1", estadoComLadder(itens));
enviosBestiaryLadder.length = 0;
run('ajustarFaseAlvo("Rat Cellars", 1);');
itens = itensDoUltimoEnvio();
const ratAposStepper = itens.find((it) => it.hunt === "Rat Cellars");
assert(ratAposStepper && ratAposStepper.faseAlvo === 2, `stepper +1 leva faseAlvo de Rat Cellars a 2 — recebido: ${ratAposStepper && ratAposStepper.faseAlvo}`);
run(`ajustarFaseAlvo("Rat Cellars", -5);`); // nunca abaixo de 1 — sem teto/piso inventado além do mínimo óbvio
itens = itensDoUltimoEnvio();
const ratAposDescer = itens.find((it) => it.hunt === "Rat Cellars");
assert(ratAposDescer.faseAlvo === 1, "stepper nunca deixa faseAlvo menor que 1");

// Cenário 4 — itens legados continuam carregando sem serem descartados +
// dedup mantém a PRIMEIRA ocorrência quando há duplicata por hunt.
const legado = run(`itensBestiaryLadderPersistiveis([
  { hunt: "Legado Sem Campo Novo", criatura: "Legado Sem Campo Novo", faseAlvo: 3, concluido: true },
  { hunt: "Duplicada", criatura: "Primeira", faseAlvo: 2, concluido: false },
  { hunt: "Duplicada", criatura: "Segunda", faseAlvo: 9, concluido: true },
])`);
assert(legado.length === 2, `dedup mantém 1 entrada por hunt (Legado + Duplicada) — recebido: ${legado.length}`);
assert(legado[0].hunt === "Legado Sem Campo Novo" && legado[0].faseAlvo === 3 && legado[0].concluido === true, "item legado é preservado com seus valores originais");
const duplicadaMantida = legado.find((it) => it.hunt === "Duplicada");
assert(duplicadaMantida.criatura === "Primeira", "quando há duplicata por hunt, a PRIMEIRA ocorrência é a mantida");

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
if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) FALHARAM.`);
  process.exit(1);
}
console.log("\nTODOS OS CENARIOS PASSARAM");
