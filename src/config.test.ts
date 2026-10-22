import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { lerConfigBanco, resumirConfig, variaveisObrigatorias } from "./config.js";
import { redigirSegredo } from "./texto.js";

const ambiente = {
  ANTARES_DB_SERVER: "sql.interno",
  ANTARES_DB_DATABASE: "antares",
  ANTARES_DB_USER: "consultor_leitura",
  ANTARES_DB_PASSWORD: "segredo-super-secreto",
};

describe("lerConfigBanco", () => {
  it("lê só variáveis de ambiente e omite a senha do resumo", () => {
    const config = lerConfigBanco(ambiente);
    assert.equal(config.servidor, "sql.interno");
    assert.equal(config.porta, 1433);
    assert.equal(config.banco, "antares");
    assert.equal(config.usuario, "consultor_leitura");
    assert.equal(config.senha, "segredo-super-secreto");
    assert.equal(config.criptografia, true);
    assert.equal(config.confiarCertificado, false);
    assert.equal(JSON.stringify(resumirConfig(config)).includes("segredo-super-secreto"), false);
    assert.deepEqual(variaveisObrigatorias(), [
      "ANTARES_DB_SERVER",
      "ANTARES_DB_DATABASE",
      "ANTARES_DB_USER",
      "ANTARES_DB_PASSWORD",
    ]);
  });

  it("não coloca a senha na mensagem quando outra variável falta", () => {
    assert.throws(
      () => lerConfigBanco({ ...ambiente, ANTARES_DB_SERVER: "  " }),
      (erro: unknown) => {
        assert.ok(erro instanceof Error);
        assert.match(erro.message, /ANTARES_DB_SERVER/);
        assert.equal(erro.message.includes("segredo-super-secreto"), false);
        assert.match(erro.message, /linha de comando/);
        return true;
      },
    );
  });

  it("aceita instância nomeada sem porta e booleanos explícitos", () => {
    const config = lerConfigBanco({
      ...ambiente,
      ANTARES_DB_SERVER: "host\\instancia",
      ANTARES_DB_ENCRYPT: "false",
      ANTARES_DB_TRUST_SERVER_CERTIFICATE: "sim",
    });
    assert.equal(config.servidor, "host\\instancia");
    assert.equal(config.porta, undefined);
    assert.equal(config.criptografia, false);
    assert.equal(config.confiarCertificado, true);
  });

  it("redige senha e Password= da mensagem de erro", () => {
    const texto = redigirSegredo(
      "Login failed Password=segredo-super-secreto; servidor=sql",
      ["segredo-super-secreto"],
    );
    assert.equal(texto.includes("segredo-super-secreto"), false);
    assert.match(texto, /Password=\*\*\*/);
  });
});

describe("fontes", () => {
  it("não lê argumentos de linha de comando nem escreve em stdout", () => {
    const raiz = fileURLToPath(new URL(".", import.meta.url));
    const arquivos = listarFontes(raiz);
    assert.ok(arquivos.some((arquivo) => arquivo.endsWith(`${join("src", "index.ts")}`) || arquivo.endsWith("index.ts")));
    assert.ok(arquivos.some((arquivo) => arquivo.includes(`${join("telas", "index.ts")}`)));
    for (const arquivo of arquivos) {
      const texto = readFileSync(arquivo, "utf8");
      assert.equal(texto.includes("process.argv"), false, arquivo);
      assert.equal(texto.includes("console.log("), false, arquivo);
    }
  });
});

function listarFontes(diretorio: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...listarFontes(caminho));
    else if (entrada.isFile() && entrada.name.endsWith(".ts") && !entrada.name.endsWith(".test.ts")) {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}
