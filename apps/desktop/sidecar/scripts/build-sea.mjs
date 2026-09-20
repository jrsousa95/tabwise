#!/usr/bin/env node
// Empacota dist/index.js como um binário standalone (Node SEA) e o instala
// em src-tauri/sidecar/ com o sufixo de target triple que o Tauri espera
// para um "externalBin" (sidecar).
//
// Escopo deste Spike 1 (M0): builda apenas para o HOST atual (a máquina
// onde o script roda). Build cross-plataforma para Windows a partir do Mac
// exigiria baixar o node.exe da versão correspondente e rodar o postject
// sobre ele (postject só edita bytes do binário, não precisa rodar no SO
// alvo) — isso fica fora do escopo deste spike porque a validação real só
// vale rodando em Windows de verdade, não só cross-building o binário.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarRoot = path.resolve(__dirname, "..");
const distDir = path.join(sidecarRoot, "dist");
const mainScript = path.join(distDir, "index.js");
const seaConfigPath = path.join(distDir, "sea-config.json");
const blobPath = path.join(distDir, "sea-prep.blob");

const srcTauriSidecarDir = path.resolve(sidecarRoot, "..", "src-tauri", "sidecar");

function hostTargetTriple() {
  const rustcOutput = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = rustcOutput.match(/host:\s*(\S+)/);
  if (!match) throw new Error("Não foi possível determinar o target triple via `rustc -vV`.");
  return match[1];
}

function main() {
  if (!existsSync(mainScript)) {
    throw new Error(`Build TS não encontrado em ${mainScript}. Rode "npm run build:ts" antes.`);
  }

  const triple = hostTargetTriple();
  const isWindows = triple.includes("windows");
  const outputName = `passa-a-regua-sidecar-${triple}${isWindows ? ".exe" : ""}`;
  const outputPath = path.join(srcTauriSidecarDir, outputName);

  mkdirSync(srcTauriSidecarDir, { recursive: true });

  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: mainScript,
        output: blobPath,
        disableExperimentalSEAWarning: true,
      },
      null,
      2
    )
  );

  console.log(`[build-sea] gerando blob SEA a partir de ${mainScript}...`);
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], {
    stdio: "inherit",
  });

  console.log(`[build-sea] copiando binário base do Node para ${outputPath}...`);
  if (existsSync(outputPath)) rmSync(outputPath);
  copyFileSync(process.execPath, outputPath);

  if (process.platform === "darwin") {
    // O Node distribuído para macOS costuma ser um binário universal
    // (x86_64 + arm64). Isso duplica o sentinel do SEA no arquivo e faz o
    // postject falhar ("Multiple occurences of sentinel"). Workaround
    // documentado: reduzir ("thin") para a arquitetura nativa antes de injetar.
    const isUniversal = execFileSync("lipo", ["-info", outputPath], { encoding: "utf8" }).includes(
      "Architectures in the fat file"
    );
    if (isUniversal) {
      console.log(`[build-sea] binário universal detectado — reduzindo para ${process.arch}...`);
      const lipoArch = process.arch === "arm64" ? "arm64" : "x86_64";
      execFileSync("lipo", ["-thin", lipoArch, outputPath, "-output", outputPath]);
    }

    console.log("[build-sea] removendo assinatura existente (necessário antes de injetar o blob)...");
    execFileSync("codesign", ["--remove-signature", outputPath]);
  }

  console.log("[build-sea] injetando o blob no binário via postject...");
  execFileSync(
    "npx",
    [
      "postject",
      outputPath,
      "NODE_SEA_BLOB",
      blobPath,
      "--sentinel-fuse",
      "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
      ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
    ],
    { stdio: "inherit" }
  );

  if (process.platform === "darwin") {
    console.log("[build-sea] re-assinando (ad-hoc) o binário modificado...");
    execFileSync("codesign", ["--sign", "-", outputPath]);
  }

  execFileSync("chmod", ["+x", outputPath]);

  console.log(`[build-sea] OK — sidecar pronto em: ${outputPath}`);
}

main();
