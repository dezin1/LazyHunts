// Publica a versão atual no GitHub Releases, escolhendo o TIPO de release pela
// versão do package.json.
//
// POR QUE ISTO EXISTE (24/09/2026): o `package.json` tinha `releaseType:
// "release"` fixo, então TODA publicação virava release comum — inclusive as
// prévias de teste (`0.13.4-spawn.4`, `0.13.4-spawn.5`). O `electron-updater` e
// o link "Baixar" do site só enxergam a release mais recente que NÃO é
// prévia; resultado: versão de teste entregue a todos os usuários.
//
// Regra (a mesma do CLAUDE.md): versão com sufixo (`-spawn.5`) = prévia;
// versão limpa (`0.13.4`) = release final.
//
// Uso:
//   npm run publish            → verifica a versão e publica
//   npm run publish -- --dry   → só mostra o que faria, sem publicar nada
//
// O token vem de `GH_TOKEN` no ambiente; nunca é lido de arquivo nem impresso.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function tipoDeRelease(versao) {
  return /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(versao) ? "prerelease" : "release";
}

function main() {
  const dry = process.argv.includes("--dry");
  const versao = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8")).version;
  const tipo = tipoDeRelease(versao);
  console.log(`Versão ${versao} → será publicada como ${tipo === "prerelease" ? "PRÉVIA (não vira 'latest', não chega ao updater de quem está numa versão final)" : "RELEASE FINAL (vira 'latest' e chega aos usuários)"}.`);

  const v = spawnSync(process.execPath, [path.join(raiz, "scripts", "verificar-versao.mjs")], { cwd: raiz, stdio: "inherit" });
  if (v.status !== 0) {
    console.error("\nverify:version falhou — não publico.");
    process.exit(1);
  }

  if (dry) {
    console.log(`\n[--dry] rodaria: electron-builder --publish always -c.publish.releaseType=${tipo}`);
    console.log(process.env.GH_TOKEN ? "[--dry] GH_TOKEN: presente no ambiente." : "[--dry] GH_TOKEN: AUSENTE no ambiente (o publish real pararia aqui).");
    return;
  }
  if (!process.env.GH_TOKEN) {
    console.error("\nGH_TOKEN não está definido no ambiente — o electron-builder não consegue criar a Release. Defina a variável (usuário do Windows) e abra um terminal novo.");
    process.exit(1);
  }

  const r = spawnSync("npx", ["electron-builder", "--publish", "always", `-c.publish.releaseType=${tipo}`], {
    cwd: raiz,
    stdio: "inherit",
    shell: true,
  });
  process.exit(r.status === null ? 1 : r.status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
