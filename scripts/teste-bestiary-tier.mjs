// TASK-003-R2.3 — teste isolado: a automação do Bestiary usa o TIER salvo
// no item da escada (não mais só `cfg.pullLevel` global).
//
// Mesmo método dos outros testes isolados deste projeto: extrai, por
// marcador de texto, o bloco REAL de `automation/content-injected.js`
// (`bestiaryLadderItemAtual` até o fim de `alvoDeCacada`) e roda num
// sandbox `vm` — não reimplementa a lógica, só fornece `guild`/
// `currentHuntNameCache`, as únicas dependências externas desse trecho.
//
// Comando: node scripts/teste-bestiary-tier.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentPath = path.join(here, "..", "automation", "content-injected.js");
const source = readFileSync(contentPath, "utf8");

function extrair(inicio, fimExclusivo, nome) {
  const i = source.indexOf(inicio);
  const f = source.indexOf(fimExclusivo, i);
  if (i === -1 || f === -1 || f <= i) {
    console.error(`FALHA: marcadores de '${nome}' não encontrados em content-injected.js.`);
    process.exit(1);
  }
  return source.slice(i, f);
}

const bloco = extrair(
  "function bestiaryLadderItemAtual(cfg) {",
  "const GOLD_COIN_ITEM_ID = 3031;",
  "bestiaryLadderItemAtual..alvoDeCacada"
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

// ---------- sandbox ----------
// `alvoDeCacada` só toca `guild`/`currentHuntNameCache` nos ramos de
// EXPEDIÇÃO (escolherObjetivoDaExpedicao, cacadaParaCriaturas,
// TIER_MAIS_DIFICIL) — todo cenário abaixo usa `expeditionEnabled: false`,
// que faz `alvoDeCacada` retornar `padrao` ANTES de qualquer desses nomes
// ser avaliado (curto-circuito do `||`), então não precisam existir aqui.
const sandbox = {
  console,
  guild: { cacadas: [] },
  currentHuntNameCache: null,
};
const context = vm.createContext(sandbox);
vm.runInContext(bloco, context, { filename: "content-injected-bestiary-tier.js" });

function run(code) {
  return vm.runInContext(code, context, { filename: "teste-bestiary-tier-inline.js" });
}

// ============================================================
// Cenário 1 — automação do Bestiário usa o TIER DO ITEM quando o Ladder
// está decidindo a caçada (defeito original desta tarefa).
// ============================================================

const cfgComItemTier = {
  pullLevel: "Cautious", // global — diferente do tier do item, de propósito
  expeditionEnabled: false,
  bestiaryLadder: {
    enabled: true,
    index: 0,
    itens: [{ hunt: "Sand Sharpie", criatura: "Piranha", faseAlvo: 2, concluido: false, tier: "Reckless" }],
  },
};
const alvo1 = run(`alvoDeCacada(${JSON.stringify(cfgComItemTier)}, null)`);
assert(alvo1.nome === "Sand Sharpie", "alvoDeCacada escolhe a caçada da escada (Ladder ligado)");
assert(
  alvo1.pullLevel === "Reckless",
  `alvoDeCacada usa o TIER DO ITEM ("Reckless"), não o pullLevel global ("Cautious") — recebido: "${alvo1.pullLevel}"`
);

// ============================================================
// Cenário 2 — item LEGADO sem `tier` continua usando `cfg.pullLevel`
// (fallback preservado, nada quebra pra configuração antiga).
// ============================================================

const cfgComItemLegado = {
  pullLevel: "Bold",
  expeditionEnabled: false,
  bestiaryLadder: {
    enabled: true,
    index: 0,
    itens: [{ hunt: "Sand Sharpie", criatura: "Piranha", faseAlvo: 2, concluido: false }], // sem `tier`
  },
};
const alvo2 = run(`alvoDeCacada(${JSON.stringify(cfgComItemLegado)}, null)`);
assert(alvo2.nome === "Sand Sharpie", "alvoDeCacada ainda escolhe a caçada da escada");
assert(
  alvo2.pullLevel === "Bold",
  `item legado sem tier -> pullLevel cai pro cfg.pullLevel global ("Bold") — recebido: "${alvo2.pullLevel}"`
);

// ============================================================
// Cenário 3 — fora do Bestiary (Ladder desligado ou sem itens), o
// comportamento da Caçada normal não muda: pullLevel é sempre o global.
// ============================================================

const cfgSemLadder = {
  pullLevel: "Bold",
  huntName: "Rat Cellars",
  expeditionEnabled: false,
  bestiaryLadder: { enabled: false, index: 0, itens: [{ hunt: "Sand Sharpie", criatura: "Piranha", faseAlvo: 2, concluido: false, tier: "Reckless" }] },
};
const alvo3 = run(`alvoDeCacada(${JSON.stringify(cfgSemLadder)}, "Rat Cellars")`);
assert(alvo3.nome === "Rat Cellars", "com o Ladder DESLIGADO, alvoDeCacada volta a usar cfg.huntName (caçada normal)");
assert(
  alvo3.pullLevel === "Bold",
  `com o Ladder desligado, pullLevel é sempre cfg.pullLevel — nunca vaza o tier de um item da escada (recebido: "${alvo3.pullLevel}")`
);

// ============================================================
// Cenário 4 — `tierDoBestiaryLadder` isolada: null quando não há item
// atual, ou quando o item não tem tier.
// ============================================================

assert(run("tierDoBestiaryLadder({ bestiaryLadder: { enabled: false, index: 0, itens: [] } })") === null, "sem Ladder ativo, tierDoBestiaryLadder devolve null");
assert(
  run(`tierDoBestiaryLadder({ bestiaryLadder: { enabled: true, index: 0, itens: [{ hunt: "X", criatura: "Y", faseAlvo: 1, concluido: false }] } })`) === null,
  "item sem `tier` -> tierDoBestiaryLadder devolve null (não inventa)"
);
assert(
  run(`tierDoBestiaryLadder({ bestiaryLadder: { enabled: true, index: 0, itens: [{ hunt: "X", criatura: "Y", faseAlvo: 1, concluido: false, tier: "Bold" }] } })`) === "Bold",
  "item com `tier` -> tierDoBestiaryLadder devolve exatamente esse valor"
);

// ============================================================
if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) FALHARAM.`);
  process.exit(1);
}
console.log("\nTODOS OS CENARIOS PASSARAM");
