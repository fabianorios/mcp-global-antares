import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Window } from "happy-dom";
import { criarBancoFixture } from "./banco-fixture.js";
import { criarAplicacao } from "./servidor-http.js";

describe("telas no navegador local", () => {
  it("renderiza as três telas", async () => {
    const { window, document } = await abrirDocumento("http://127.0.0.1:4173/");
    try {
      assert.equal(document.documentElement.lang, "pt-BR");
      const configuracao = secao(document, "tela-configuracao");
      assert.equal(configuracao.hidden, false);
      assert.match(configuracao.textContent ?? "", /ANTARES_DB_SERVER/);
      assert.match(configuracao.textContent ?? "", /ANTARES_DB_PASSWORD/);
      assert.equal(secao(document, "testar-conexao").textContent, "Testar conexão");

      await irPara(window, "solicitacao");
      const solicitacao = secao(document, "tela-solicitacao");
      assert.equal(solicitacao.hidden, false);
      assert.match(solicitacao.textContent ?? "", /Listar tabelas/);
      assert.match(solicitacao.textContent ?? "", /Descrever tabela/);
      assert.match(solicitacao.textContent ?? "", /Localizar regras/);
      assert.match(solicitacao.textContent ?? "", /Consultar somente leitura/);

      await irPara(window, "retorno");
      const retorno = secao(document, "tela-retorno");
      assert.equal(retorno.hidden, false);
      assert.match(retorno.textContent ?? "", /Nenhuma solicitação executada ainda/);
      assert.ok(document.getElementById("grade"));
    } finally {
      await window.happyDOM.abort();
    }
  });

  it("não envia uma consulta que não é SELECT", async () => {
    const { window, document } = await abrirDocumento("http://127.0.0.1:4173/#solicitacao");
    try {
      const consultar = document.querySelector('input[value="consultar"]') as {
        checked: boolean;
        dispatchEvent(evento: unknown): boolean;
      } | null;
      assert.ok(consultar);
      consultar.checked = true;
      consultar.dispatchEvent(new window.Event("change", { bubbles: true }));
      const sql = document.getElementById("sql");
      assert.ok(sql instanceof window.HTMLTextAreaElement);
      sql.value = "DELETE FROM ExemploRegra";
      sql.dispatchEvent(new window.Event("input", { bubbles: true }));

      const botao = document.getElementById("executar");
      assert.ok(botao instanceof window.HTMLButtonElement);
      assert.equal(botao.disabled, true);
      assert.equal(secao(document, "bloqueio-envio").hidden, false);

      let chamadas = 0;
      window.fetch = async () => {
        chamadas += 1;
        return new window.Response("{}", { status: 500 });
      };
      document.getElementById("form-solicitacao")?.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
      assert.equal(chamadas, 0);
    } finally {
      await window.happyDOM.abort();
    }
  });
});

describe("API das telas", () => {
  it("rejeita escrita sem consultar o banco e devolve uma grade de exemplo", async () => {
    const ambiente = await subir();
    try {
      const escrita = await fetch(`${ambiente.origem}/api/solicitacao`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao: "consultar", sql: "DELETE FROM ExemploRegra" }),
      });
      assert.equal(escrita.status, 400);
      const erro = (await escrita.json()) as { erro: boolean; mensagem: string; linhas: unknown[] };
      assert.equal(erro.erro, true);
      assert.match(erro.mensagem, /DELETE/);
      assert.equal(erro.linhas.length, 0);
      assert.equal(ambiente.fixture.consultas, 0);

      const leitura = await fetch(`${ambiente.origem}/api/solicitacao`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao: "listar", filtro: "verba" }),
      });
      assert.equal(leitura.status, 200);
      const grade = (await leitura.json()) as { erro: boolean; colunas: string[]; linhas: Array<{ tabela: string }>; exemplo: boolean };
      assert.equal(grade.erro, false);
      assert.equal(grade.exemplo, true);
      assert.deepEqual(grade.colunas.slice(0, 2), ["esquema", "tabela"]);
      assert.equal(grade.linhas.length, 1);
      assert.equal(grade.linhas[0]?.tabela, "ExemploVerba");
      assert.equal(ambiente.fixture.consultas > 0, true);

      const ausente = await fetch(`${ambiente.origem}/api/solicitacao`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao: "descrever", tabela: "Ausente" }),
      });
      assert.equal(ausente.status, 404);
      const faltou = (await ausente.json()) as { erro: boolean; mensagem: string };
      assert.equal(faltou.erro, true);
      assert.match(faltou.mensagem, /não encontrada/);
    } finally {
      await ambiente.fechar();
    }
  });

  it("grava a senha só no arquivo local e não a devolve nem registra", async () => {
    const ambiente = await subir();
    const segredo = "segredo-unico-telas-9f2a";
    try {
      const salvo = await fetch(`${ambiente.origem}/api/configuracao`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ANTARES_DB_SERVER: "127.0.0.1",
          ANTARES_DB_PORT: "1",
          ANTARES_DB_DATABASE: "exemplo",
          ANTARES_DB_USER: "leitura",
          ANTARES_DB_PASSWORD: segredo,
          ANTARES_DB_ENCRYPT: "true",
          ANTARES_DB_TRUST_SERVER_CERTIFICATE: "false",
        }),
      });
      assert.equal(salvo.status, 200);
      const publico = (await salvo.json()) as { senhaDefinida: boolean; ANTARES_DB_PASSWORD: string };
      assert.equal(publico.senhaDefinida, true);
      assert.equal(publico.ANTARES_DB_PASSWORD, "");
      assert.equal(JSON.stringify(publico).includes(segredo), false);
      assert.equal(ambiente.logs.join("\n").includes(segredo), false);

      const arquivo = await readFile(join(ambiente.diretorio, "conexao.json"), "utf8");
      assert.match(arquivo, new RegExp(segredo));
      const deNovo = await fetch(`${ambiente.origem}/api/configuracao`);
      assert.equal((await deNovo.text()).includes(segredo), false);
    } finally {
      await ambiente.fechar();
    }
  });

  it("fica em localhost e ignora a pasta da conexão", () => {
    const servidor = readFileSync(new URL("./servidor-http.ts", import.meta.url), "utf8");
    const indice = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const navegador = readFileSync(new URL("./publico/app.js", import.meta.url), "utf8");
    assert.match(servidor, /listen\(porta, "127\.0\.0\.1"/);
    assert.match(servidor, /testarConexaoSalva/);
    assert.match(indice, /127\.0\.0\.1/);
    assert.equal(navegador.includes("console.log"), false);
    assert.equal(navegador.includes("mssql"), false);
    assert.match(readFileSync(new URL("../../.gitignore", import.meta.url), "utf8"), /^\.antares\/$/m);
  });
});

async function abrirDocumento(url: string): Promise<{ window: Window; document: Window["document"] }> {
  const html = readFileSync(new URL("./publico/index.html", import.meta.url), "utf8").replace(
    '<script src="/app.js"></script>',
    "",
  );
  const script = readFileSync(new URL("./publico/app.js", import.meta.url), "utf8");
  const window = new Window({ url, settings: { disableJavaScriptFileLoading: true } });
  window.document.write(html);
  window.document.close();
  window.eval(script);
  return { window, document: window.document };
}

function secao(document: Window["document"], id: string): { hidden: boolean; textContent: string | null } {
  const encontrado = document.getElementById(id) as { hidden: boolean; textContent: string | null } | null;
  assert.ok(encontrado, id);
  return encontrado;
}

async function irPara(window: Window, tela: string): Promise<void> {
  window.location.hash = `#${tela}`;
  window.dispatchEvent(new window.Event("hashchange"));
}

async function subir(): Promise<{
  origem: string;
  diretorio: string;
  logs: string[];
  fixture: ReturnType<typeof criarBancoFixture>;
  fechar: () => Promise<void>;
}> {
  const diretorio = await mkdtemp(join(tmpdir(), "antares-telas-"));
  const logs: string[] = [];
  const fixture = criarBancoFixture();
  const aplicacao = criarAplicacao({
    diretorioDados: diretorio,
    banco: fixture,
    exemplo: true,
    registrar(mensagem) {
      logs.push(mensagem);
    },
    testarConexao: async () => ({ ok: false, mensagem: "falha simulada" }),
  });
  const porta = await aplicacao.escutar(0);
  return {
    origem: `http://127.0.0.1:${porta}`,
    diretorio,
    logs,
    fixture,
    async fechar() {
      await aplicacao.fechar();
      await rm(diretorio, { recursive: true, force: true });
    },
  };
}
