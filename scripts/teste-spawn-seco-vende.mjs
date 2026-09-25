// v0.13.4 — renovar a caçada por spawn seco tem que VENDER o loot antes de reentrar.
//
// André (24/09/2026): "quando sai da caçada por spawn seco, não está vendendo e
// voltando com a bag cheia". O caminho do spawn seco fazia leaveHunt() →
// ensureHunting() direto; a venda só existia no ciclo de capacidade e no tick
// "cheguei na cidade" (que nunca chegava a rodar, porque o personagem já tinha
// reentrado).
//
// O `monitorTick` é grande demais pra rodar num sandbox, então este teste é de
// ORDEM e de FIAÇÃO sobre o código real: dentro do bloco do spawn seco, a venda
// vem depois de sair e antes de reentrar, respeita a opção de venda automática,
// não deixa uma falha de venda impedir a renovação e cai no mesmo tratamento de
// stamina do ciclo de capacidade.
//
// Comando: node scripts/teste-spawn-seco-vende.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(path.join(here, "..", "automation", "content-injected.js"), "utf8").replace(/\r\n/g, "\n");

let falhas = 0;
function assert(cond, msg) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", msg);
  } else {
    console.log("ok:", msg);
  }
}

const iIni = fonte.indexOf("if (seco && Date.now() - spawnUltimaReentradaEm > 60000) {");
const iFim = fonte.indexOf("// v0.11.22 — O RÓTULO PRECISA REFLETIR O ESTADO ESTÁVEL", iIni);
assert(iIni !== -1 && iFim > iIni, "bloco do spawn seco encontrado");
const bloco = fonte.slice(iIni, iFim);

const pos = (t) => bloco.indexOf(t);
const iSair = pos("await leaveHunt();");
const iVender = pos('await sellLootOnce(cfg, "Saí da caçada por spawn esgotado");');
const iEstamina = pos("if (!hasEnoughStaminaToHunt(cfg)) {");
const iReentrar = pos("await ensureHunting(");

assert(iSair !== -1 && iVender !== -1 && iReentrar !== -1, "o bloco sai, vende e reentra");
assert(iSair < iVender && iVender < iReentrar, "ordem: sai da caçada → vende → reentra (antes reentrava direto, com a bag cheia)");
assert(iVender < iEstamina && iEstamina < iReentrar, "depois de vender, confere a stamina ANTES de tentar reentrar");
assert(bloco.includes("cfg.autoSellOnCityArrival !== false"), "respeita a opção 'vender ao chegar na cidade' (desligada = comportamento antigo)");
assert(/try \{\s*await sellLootOnce\([^)]*\);\s*\} catch \(err\) \{/.test(bloco), "falha na venda é capturada: não impede a renovação (a trava de venda já foi marcada)");
assert(bloco.includes("if (!algumModoDeCacaAtivo()) return;"), "desligar a automação no meio da venda cancela a reentrada");
assert(bloco.includes("await afterSellingDecideNext(cfg, caçadaAtual);"), "sem stamina: mesmo tratamento do ciclo de capacidade (rodízio ou espera)");
assert(iVender > pos("zerarDeteccaoDeSpawn();"), "o detector é zerado antes da venda (fora da caçada não há o que medir)");

// A venda em si é a mesma função dos outros caminhos, com a trava por ida à cidade.
const iSell = fonte.indexOf("async function sellLootOnce(");
assert(fonte.slice(iSell, iSell + 900).includes("soldSinceArrivingInCity = true;"), "sellLootOnce marca a trava por ida à cidade (uma tentativa só)");

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
