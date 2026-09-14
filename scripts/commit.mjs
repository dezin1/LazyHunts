// Commit de uma entrega do Swag, com a mensagem montada sozinha.
//
// POR QUE ISTO EXISTE: entre 04/09 e 14/09 o projeto acumulou ONZE versões sem
// nenhum commit — e quando um arquivo foi sobrescrito, os CHANGELOGs daquelas
// versões se perderam pra sempre. O git estava lá o tempo todo; o que faltou
// foi commitar. A fricção real não é digitar `git add -A`, é parar pra pensar
// numa mensagem. Então a mensagem sai do package.json + CHANGELOG.md.
//
// Uso:
//   npm run commit                  → mensagem automática
//   npm run commit -- "texto seu"   → mensagem sua
//
// NUNCA faz push: o remoto é a conta do André e credencial não passa por aqui.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: raiz, encoding: "utf8" });

function versao() {
  return JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).version;
}

// Primeiro título de seção da entrada mais recente do CHANGELOG — é a frase
// que descreve a entrega, escrita quando ela ainda estava fresca.
function resumoDoChangelog(v) {
  try {
    const texto = readFileSync(join(raiz, "CHANGELOG.md"), "utf8");
    const inicio = texto.indexOf(`## ${v}`);
    if (inicio < 0) return null;
    const proxima = texto.indexOf("\n## ", inicio + 1);
    const bloco = texto.slice(inicio, proxima < 0 ? undefined : proxima);
    const titulos = [...bloco.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
    if (!titulos.length) return null;
    return titulos.slice(0, 2).join("; ");
  } catch (e) {
    return null;
  }
}

function main() {
  const v = versao();
  const custom = process.argv.slice(2).join(" ").trim();

  const status = git("status", "--short").trim();
  if (!status) {
    console.log("Nada pra commitar — a árvore está limpa.");
    return;
  }

  console.log("Vai entrar no commit:\n");
  console.log(status);
  console.log("");

  // Aviso, não bloqueio: quem decide é quem está rodando. Mas se algo enorme
  // ou gerado escapar do .gitignore, é aqui que dá pra ver antes.
  const suspeitos = status
    .split("\n")
    .map((l) => l.slice(3))
    .filter((f) => /^(dist|dist-novo|node_modules|build\/.*\.(exe|zip|blockmap))/.test(f));
  if (suspeitos.length) {
    console.log("⚠️  Isto parece arquivo gerado e talvez devesse estar no .gitignore:");
    for (const f of suspeitos) console.log(`    ${f}`);
    console.log("");
  }

  const resumo = custom || resumoDoChangelog(v);
  const mensagem = resumo ? `Swag v${v} - ${resumo}` : `Swag v${v}`;

  git("add", "-A");
  git("commit", "-m", mensagem);

  const hash = git("rev-parse", "--short", "HEAD").trim();
  console.log(`Commitado ${hash}: ${mensagem}`);
  console.log("\nO push fica por sua conta (o remoto é a sua conta do GitHub).");
}

main();
