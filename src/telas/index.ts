import { join } from "node:path";
import { criarBancoFixture } from "./banco-fixture.js";
import { criarAplicacao } from "./servidor-http.js";

const portaPedida = Number(process.env.ANTARES_TELAS_PORT ?? "4173");
const exemplo = process.env.ANTARES_TELAS_FIXTURE === "1";
const diretorioDados = process.env.ANTARES_TELAS_DADOS ?? join(process.cwd(), ".antares");

const aplicacao = criarAplicacao({
  diretorioDados,
  exemplo,
  banco: exemplo ? criarBancoFixture() : undefined,
});

const porta = await aplicacao.escutar(Number.isInteger(portaPedida) && portaPedida > 0 ? portaPedida : 4173);
console.error(`Telas do consultor em http://127.0.0.1:${porta}/`);
