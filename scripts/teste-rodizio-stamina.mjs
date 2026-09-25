// v0.13.4 — troca de personagem por stamina: o rodízio troca com 10 minutos.
//
// André (24/09/2026): o jogo NÃO deixa entrar em caçada com menos de 5min de
// stamina. Um personagem que saiu com 4min ficava travado — "não troca de
// personagem e nem volta pra caçada". Causa: com "Esperar a stamina encher"
// desligado, `hasEnoughStaminaToHunt` valia `> 0`, então 4min "tinha stamina",
// o bot tentava reentrar, o jogo recusava — e como o rodízio só é chamado quando
// essa função devolve false, ele nunca trocava.
//
// Mesmo método dos outros testes: extrai por marcador de texto os blocos REAIS
// de `automation/content-injected.js` e roda num sandbox `vm`.
//
// Comando: node scripts/teste-rodizio-stamina.mjs

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, "..");
const fonte = readFileSync(path.join(raiz, "automation", "content-injected.js"), "utf8").replace(/\r\n/g, "\n");

function extrair(src, inicio, fim, nome) {
  const i = src.indexOf(inicio);
  const f = src.indexOf(fim, i + inicio.length);
  if (i === -1 || f === -1 || f <= i) {
    console.error(`FALHA: marcadores de '${nome}' não encontrados.`);
    process.exit(1);
  }
  return src.slice(i, f);
}

let falhas = 0;
function assert(cond, msg) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", msg);
  } else {
    console.log("ok:", msg);
  }
}

const constantes = extrair(fonte, "const STAMINA_MINIMA_DO_JOGO", "let rotationsWithoutHunt", "constantes de stamina");
const blocoPiso = extrair(fonte, "function pisoDeStaminaDoRodizio(", "function logStaminaWaitingThrottled(", "pisoDeStaminaDoRodizio..hasEnoughStaminaToHunt");
const blocoExausto = extrair(fonte, "function isStaminaExhausted(", "// Próximo da fila, começando de quem está logado agora.", "isStaminaExhausted..rotationPoolSize");

function criar(codigoPiso, codigoConstantes) {
  const estado = { stamina: null, tela: [] };
  const ctx = { console, Number, Math, listCharactersOnScreen: () => estado.tela };
  vm.createContext(ctx);
  const api = vm.runInContext(
    `(() => {
      const getStaminaRemainingMinutes = () => __estado.stamina;
      ${codigoConstantes}
      ${codigoPiso}
      ${blocoExausto}
      return { pisoDeStaminaDoRodizio, hasEnoughStaminaToHunt, isStaminaExhausted, rotationPoolSize };
    })()`,
    Object.assign(ctx, { __estado: estado })
  );
  return { api, estado };
}

const { api, estado } = criar(blocoPiso, constantes);
const cfg = (extra) => ({ staminaWaitEnabled: true, staminaResumeThreshold: 60, rotateCharactersEnabled: false, rotateMinStaminaMinutes: 10, huntMode: "solo", ...extra });
const pode = (min, c) => {
  estado.stamina = min;
  return api.hasEnoughStaminaToHunt(c);
};

// ---------- 1) o mínimo do JOGO (5min) vale sempre, com ou sem espera ligada ----------
{
  const semEspera = cfg({ staminaWaitEnabled: false });
  assert(pode(0, semEspera) === false, "espera desligada, 0min: não entra");
  assert(pode(4, semEspera) === false, "espera desligada, 4min: NÃO entra (o jogo recusa) — antes valia `> 0` e travava");
  assert(pode(5, semEspera) === true, "espera desligada, 5min: entra (é o mínimo do jogo)");
  assert(pode(300, semEspera) === true, "espera desligada, stamina cheia: entra");

  for (const th of [0, 1, 3, 4]) {
    assert(pode(4, cfg({ staminaResumeThreshold: th })) === false, `espera ligada com limiar configurado ${th}min: 4min ainda NÃO entra (piso do jogo)`);
    assert(pode(5, cfg({ staminaResumeThreshold: th })) === true, `espera ligada com limiar ${th}min: 5min entra`);
  }
  assert(pode(59, cfg()) === false && pode(60, cfg()) === true, "espera ligada com limiar 60: 59 espera, 60 entra (comportamento de sempre)");
  assert(pode(10, cfg({ staminaResumeThreshold: undefined })) === true, "limiar ausente/inválido não vira NaN (antes `>= undefined` era sempre false): usa o piso do jogo");
}

// ---------- 2) rodízio ligado: troca com 10min, e só caça acima disso ----------
{
  const rod = cfg({ rotateCharactersEnabled: true, staminaWaitEnabled: false });
  estado.stamina = 10;
  assert(api.isStaminaExhausted(rod) === true, "rodízio: 10min → é hora de trocar");
  assert(pode(10, rod) === false, "rodízio: com 10min NÃO segue/entra — devolver false é o que dispara `tryRotateCharacter`");
  assert(pode(11, rod) === true, "rodízio: 11min ainda caça");
  estado.stamina = 11;
  assert(api.isStaminaExhausted(rod) === false, "rodízio: 11min → ainda não troca");
  estado.stamina = 4;
  assert(api.isStaminaExhausted(rod) === true && pode(4, rod) === false, "o caso do André: saiu com 4min → TROCA (antes: 'tinha stamina', tentava entrar, o jogo recusava e ficava travado)");
  estado.stamina = 0;
  assert(api.isStaminaExhausted(rod) === true, "rodízio: 0min também troca");

  // Com espera ligada e limiar alto, o rodízio só age dentro do piso dele.
  const rodEspera = cfg({ rotateCharactersEnabled: true });
  estado.stamina = 30;
  assert(api.isStaminaExhausted(rodEspera) === false && pode(30, rodEspera) === false, "espera 60 + rodízio: 30min não troca (>10) e não reentra (<60): espera regenerar como sempre");
}

// ---------- 3) config antiga (5) nunca vale menos de 10 ----------
{
  const velha = cfg({ rotateCharactersEnabled: true, rotateMinStaminaMinutes: 5 });
  assert(api.pisoDeStaminaDoRodizio(velha) === 10, "config salva com 5 (a antiga) vira 10 na leitura");
  assert(api.pisoDeStaminaDoRodizio(cfg({ rotateMinStaminaMinutes: 0 })) === 10, "config 0 vira 10");
  assert(api.pisoDeStaminaDoRodizio(cfg({ rotateMinStaminaMinutes: 20 })) === 20, "config maior que 10 é respeitada (20)");
  assert(api.pisoDeStaminaDoRodizio(cfg({ rotateMinStaminaMinutes: undefined })) === 10, "config ausente vira 10");
  assert(api.pisoDeStaminaDoRodizio(cfg({ rotateMinStaminaMinutes: "abc" })) === 10, "config inválida vira 10");
  estado.stamina = 8;
  assert(api.isStaminaExhausted(velha) === true, "com a config antiga (5) e 8min, agora troca (antes esperava chegar em 5)");
}

// ---------- 4) modo em grupo: sem rodízio, só o mínimo do jogo ----------
{
  const grupo = cfg({ rotateCharactersEnabled: true, huntMode: "group", staminaWaitEnabled: false });
  assert(pode(6, grupo) === true, "em grupo o rodízio não se aplica: 6min continua caçando (líder não pode trocar)");
  assert(pode(4, grupo) === false, "em grupo, 4min também não entra (piso do jogo)");
}

// ---------- 5) stamina ilegível: nunca troca nem trava ----------
{
  estado.stamina = null;
  assert(api.hasEnoughStaminaToHunt(cfg({ rotateCharactersEnabled: true })) === true, "stamina ilegível: não trava a caçada");
  assert(api.isStaminaExhausted(cfg({ rotateCharactersEnabled: true })) === false, "stamina ilegível: não arrisca trocar");
}

// ---------- 6) tamanho da fila ----------
{
  estado.tela = ["A", "B", "C"];
  assert(api.rotationPoolSize({ rotateCharacters: ["X", "Y"] }) === 2, "fila configurada manda");
  assert(api.rotationPoolSize({ rotateCharacters: [] }) === 3, "sem fila configurada, usa a lista da tela");
  estado.tela = [];
  assert(api.rotationPoolSize({ rotateCharacters: [] }) === 2, "sem nada, mínimo de 2");
}

// ---------- 7) o bug de verdade, contra o código ANTIGO (git HEAD) ----------
// Roda a função `hasEnoughStaminaToHunt` de ANTES da correção com o mesmo cenário
// do relato — prova que o teste enxerga o defeito, em vez de só passar no código
// novo.
{
  let antigo = null;
  try {
    antigo = execFileSync("git", ["show", "HEAD:automation/content-injected.js"], { cwd: raiz, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, "\n");
  } catch (e) {
    console.log("(pulado: git indisponível neste ambiente: " + String((e && e.message) || e).split("\n")[0] + ")");
  }
  if (antigo && antigo.includes("function hasEnoughStaminaToHunt(cfg) {") && !antigo.includes("STAMINA_MINIMA_DO_JOGO")) {
    const fnVelha = extrair(antigo, "function hasEnoughStaminaToHunt(cfg) {", "function logStaminaWaitingThrottled(", "hasEnoughStaminaToHunt antigo");
    const c2 = { Number, Math, __estado: { stamina: 4 } };
    vm.createContext(c2);
    const velhoHasEnough = vm.runInContext("(() => { const getStaminaRemainingMinutes = () => __estado.stamina; " + fnVelha + " return hasEnoughStaminaToHunt; })()", c2);
    const relato = cfg({ rotateCharactersEnabled: true, staminaWaitEnabled: false, rotateMinStaminaMinutes: 5 });
    assert(velhoHasEnough(relato) === true, "(código ANTIGO do HEAD) espera desligada + 4min: `hasEnoughStaminaToHunt` dizia TRUE — o bot tentava entrar, o jogo recusava e o rodízio nunca era chamado (o travamento do relato)");
    estado.stamina = 4;
    assert(api.hasEnoughStaminaToHunt(relato) === false, "(código NOVO) o mesmo cenário devolve FALSE — e é isso que aciona a troca de personagem");
  } else if (antigo) {
    console.log("(pulado: o HEAD já contém a correção)");
  }
}

// ---------- 8) fiação: a saída proativa está antes da expedição, e os defaults ----------
{
  const iProativo = fonte.indexOf("TROCA DE PERSONAGEM ANTES DE A STAMINA ACABAR");
  const iExpedicao = fonte.indexOf("v0.11.27 — EXPEDIÇÃO PODE TIRAR O PERSONAGEM");
  assert(iProativo !== -1 && iExpedicao !== -1 && iProativo < iExpedicao, "a saída proativa por stamina roda ANTES da troca por expedição (stamina tem prioridade)");
  const bloco = fonte.slice(iProativo, iExpedicao);
  assert(/cfg\.rotateCharactersEnabled\s*&&\s*cfg\.huntMode !== "group"\s*&&\s*isStaminaExhausted\(cfg\)\s*&&\s*rotationsWithoutHunt < rotationPoolSize\(cfg\)/.test(bloco), "só sai se: rodízio ligado, modo Solo, stamina ≤ piso e ainda há quem assuma");
  assert(/await leaveHunt\(\);/.test(bloco), "a saída é o mesmo `leaveHunt()` de sempre (o próximo tick vende e chama o rodízio)");
  assert(/rotateMinStaminaMinutes: 10,/.test(fonte), "o padrão da config é 10");
  assert(/next\.rotateMinStaminaMinutes = Math\.max\(RODIZIO_STAMINA_MINIMA, n\)/.test(fonte), "o applyConfig nunca grava menos de 10");
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
