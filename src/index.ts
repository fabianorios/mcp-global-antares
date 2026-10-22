#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { criarBancoDoAmbiente } from "./banco.js";
import { criarServidor } from "./criar-servidor.js";
import { mensagemDe, redigirSegredo } from "./texto.js";

async function main(): Promise<void> {
  const servidor = criarServidor(criarBancoDoAmbiente());
  const transporte = new StdioServerTransport();
  await servidor.connect(transporte);
  console.error("mcp-global-antares em escuta por stdio.");
}

main().catch((erro: unknown) => {
  console.error(redigirSegredo(mensagemDe(erro), []));
  process.exitCode = 1;
});
