// Garante que todo cliente do LazyHunts use o User-Agent reduzido do Chrome,
// sem expor Electron, LazyHunts ou o nome interno do pacote.
//
// Comando: node scripts/teste-user-agent.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = readFileSync(path.join(raiz, "main.js"), "utf8").replace(/\r\n/g, "\n");
const instrucoes = readFileSync(path.join(raiz, "CLAUDE.md"), "utf8").replace(/\r\n/g, "\n");

let falhas = 0;
function assert(cond, msg) {
  if (cond) console.log("ok:", msg);
  else {
    falhas++;
    console.error("FALHOU:", msg);
  }
}

const inicio = main.indexOf("const CHROME_MAJOR_VERSION =");
const fim = main.indexOf("// v0.3.1 tentou usar", inicio);
assert(inicio !== -1 && fim > inicio, "bloco do User-Agent existe em main.js");

if (inicio !== -1 && fim > inicio) {
  const bloco = main.slice(inicio, fim);
  const app = {};
  const contexto = vm.createContext({ app, process: { versions: { chrome: "128.0.6613.186" } } });
  vm.runInContext(bloco, contexto, { filename: "main-user-agent.js" });

  const esperado =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
  assert(app.userAgentFallback === esperado, "gera exatamente o formato reduzido do Chrome para Windows");
  assert(!/LazyHunts|huntera-multiconta|Electron/i.test(app.userAgentFallback || ""), "não revela LazyHunts, pacote interno ou Electron");
  assert(main.indexOf("app.userAgentFallback =", inicio) < main.indexOf("function createWindow()"), "override global roda antes da criação de qualquer janela");
}

assert(!/\.setUserAgent\s*\(/.test(main), "nenhum override local substitui o User-Agent global");
assert(
  instrucoes.includes("REGRA DE OURO — identidade dos clientes como Google Chrome") &&
    instrucoes.includes("node scripts/teste-user-agent.mjs") &&
    instrucoes.includes("LazyHunts`, `huntera-multiconta` ou `Electron`"),
  "CLAUDE.md preserva a regra de ouro, as marcas proibidas e o teste obrigatório"
);

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
