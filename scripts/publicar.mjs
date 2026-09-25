// Publica a versão atual, escolhendo ONDE e COMO pela versão do package.json.
//
// POR QUE ISTO EXISTE (24/09/2026): o `package.json` tinha `releaseType:
// "release"` fixo, então TODA publicação virava release comum — inclusive as
// prévias de teste (`0.13.4-spawn.4`, `0.13.4-spawn.5`). O `electron-updater` e
// o link "Baixar" do site só enxergam a release mais recente que NÃO é
// prévia; resultado: versão de teste entregue a todos os usuários.
//
// v0.13.5 — DOWNLOADS NO DOMÍNIO (dl.lazyhunts.com, Cloudflare R2).
// O app atualiza por https://dl.lazyhunts.com/latest.yml (provider `generic`,
// primeiro da lista, é o que vai no app-update.yml de cada build) e o
// instalador leve (`nsis-web`) baixa o pacote de lá. Regras:
//   - FINAL (versão limpa, `0.13.5`): sobe pro R2 E pro GitHub (release comum).
//     O GitHub continua recebendo porque quem tem versão ANTIGA instalada
//     ainda lê o feed do GitHub — sem isso, essas pessoas nunca atualizariam.
//   - PRÉVIA (versão com sufixo, `0.13.5-lazyhunts.2`): SÓ pro GitHub, como
//     prévia. NUNCA pro R2: nesta versão do electron-builder o nome do arquivo
//     de atualização vem de `publish.channel` (padrão "latest"), e não do
//     sufixo da versão — uma prévia no R2 sobrescreveria o latest.yml e iria
//     pra todos os usuários.
//
// Uso:
//   npm run publish            → verifica a versão e publica
//   npm run publish -- --dry   → só mostra o que faria, sem publicar nada
//
// Credenciais só por variável de ambiente, nunca impressas nem lidas de arquivo:
//   GH_TOKEN                                 → GitHub (sempre)
//   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY  → R2 (só versão final)

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const URL_DOWNLOADS = "https://dl.lazyhunts.com";
export const R2 = {
  bucket: "lazyhunts-downloads",
  endpoint: "https://20b63a1a65f76d39b18af20cbb9606d0.r2.cloudflarestorage.com",
};

export function tipoDeRelease(versao) {
  return /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(versao) ? "prerelease" : "release";
}

// Lista de publicação da build. O primeiro item é o que vai pro app-update.yml
// (de onde o app instalado busca atualização) e de onde o instalador leve
// baixa o pacote — por isso é sempre o domínio, inclusive nas prévias.
export function destinosDePublicacao(buildConfig, tipo) {
  const github = (buildConfig.publish || []).find((p) => p && p.provider === "github");
  if (!github) throw new Error("package.json: build.publish precisa ter o provider github");
  const feed = { provider: "generic", url: URL_DOWNLOADS };
  if (tipo === "prerelease") return [feed, { ...github, releaseType: "prerelease" }];
  return [
    feed,
    // acl: null — o R2 não aceita o "public-read" que o electron-builder manda
    // por padrão; o acesso público vem do domínio dl.lazyhunts.com no bucket.
    { provider: "s3", bucket: R2.bucket, endpoint: R2.endpoint, region: "auto", acl: null },
    { ...github, releaseType: "release" },
  ];
}

export function credenciaisFaltando(tipo, env) {
  const faltam = [];
  if (!env.GH_TOKEN) faltam.push("GH_TOKEN");
  if (tipo === "release") {
    if (!env.R2_ACCESS_KEY_ID) faltam.push("R2_ACCESS_KEY_ID");
    if (!env.R2_SECRET_ACCESS_KEY) faltam.push("R2_SECRET_ACCESS_KEY");
  }
  return faltam;
}

function main() {
  const dry = process.argv.includes("--dry");
  const pkg = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8"));
  const versao = pkg.version;
  const tipo = tipoDeRelease(versao);
  const destinos = destinosDePublicacao(pkg.build, tipo);
  console.log(
    `Versão ${versao} → ${
      tipo === "prerelease"
        ? "PRÉVIA: só GitHub, marcada como prévia (não vai pro dl.lazyhunts.com nem chega aos usuários)"
        : "RELEASE FINAL: dl.lazyhunts.com (R2) + GitHub; vira a versão que os usuários recebem"
    }.`
  );
  console.log("Destinos: " + destinos.map((d) => (d.provider === "generic" ? `feed ${d.url}` : d.provider === "s3" ? `R2 ${d.bucket}` : `github ${d.releaseType}`)).join(" | "));

  const v = spawnSync(process.execPath, [path.join(raiz, "scripts", "verificar-versao.mjs")], { cwd: raiz, stdio: "inherit" });
  if (v.status !== 0) {
    console.error("\nverify:version falhou — não publico.");
    process.exit(1);
  }

  const faltam = credenciaisFaltando(tipo, process.env);
  if (dry) {
    console.log(`\n[--dry] credenciais: ${faltam.length ? "FALTAM " + faltam.join(", ") + " (o publish real pararia aqui)" : "todas presentes"}.`);
    return;
  }
  if (faltam.length) {
    console.error(`\nFaltam variáveis de ambiente: ${faltam.join(", ")}. Defina no usuário do Windows e abra um terminal novo.`);
    process.exit(1);
  }

  // Config completa num arquivo próprio (--config), em vez de sobrescrever a
  // lista pela linha de comando: o electron-builder MESCLA publish vindo de
  // opção com o do package.json, e a lista precisa ser exatamente esta.
  const dir = path.join(raiz, "dist-novo");
  mkdirSync(dir, { recursive: true });
  const arqConfig = path.join(dir, ".publicar-config.json");
  writeFileSync(arqConfig, JSON.stringify({ ...pkg.build, publish: destinos }, null, 2));
  const env = { ...process.env };
  if (tipo === "release") {
    env.AWS_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
    env.AWS_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
  }
  const r = spawnSync("npx", ["electron-builder", "--win", "--publish", "always", "--config", JSON.stringify(arqConfig)], {
    cwd: raiz,
    stdio: "inherit",
    shell: true,
    env,
  });
  rmSync(arqConfig, { force: true });
  process.exit(r.status === null ? 1 : r.status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
