import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFINICOES, criarServidor } from "./criar-servidor.js";
import type { Banco } from "./tipos.js";

describe("servidor MCP", () => {
  it("publica as quatro ferramentas em português e bloqueia escrita sem banco", async () => {
    const chamadas: string[] = [];
    const banco: Banco = {
      async consultar(sql) {
        chamadas.push(sql);
        return [{ n: 1 }];
      },
    };
    const servidor = criarServidor(banco);
    const cliente = new Client({ name: "teste", version: "0.0.0" });
    const [transporteCliente, transporteServidor] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([cliente.connect(transporteCliente), servidor.connect(transporteServidor)]);
      const lista = await cliente.listTools();
      const nomes = lista.tools.map((ferramenta) => ferramenta.name).sort();
      assert.deepEqual(nomes, [
        "consultar_somente_leitura",
        "descrever_tabela",
        "listar_tabelas",
        "localizar_regras",
      ]);

      for (const ferramenta of lista.tools) {
        const definicao = DEFINICOES[ferramenta.name as keyof typeof DEFINICOES];
        assert.equal(ferramenta.description, definicao.descricao);
        assert.match(definicao.descricao, /[áàãéíóõúç]/i);
        assert.equal(ferramenta.annotations?.readOnlyHint, true);
      }

      const escrita = await cliente.callTool({
        name: "consultar_somente_leitura",
        arguments: { sql: "DELETE FROM folha" },
      });
      assert.equal(escrita.isError, true);
      assert.equal(chamadas.length, 0);
      const textoEscrita = textoDoResultado(escrita.content);
      assert.match(textoEscrita, /DELETE/);

      const leitura = await cliente.callTool({
        name: "consultar_somente_leitura",
        arguments: { sql: "SELECT n FROM regras", limite: 50 },
      });
      assert.notEqual(leitura.isError, true);
      assert.match(chamadas[0] ?? "", /^SELECT TOP \(50\)/);
      assert.match(textoDoResultado(leitura.content), /"n": 1/);
    } finally {
      await cliente.close();
      await servidor.close();
    }
  });
});

function textoDoResultado(content: unknown): string {
  assert.ok(Array.isArray(content));
  const primeiro = content[0] as { type?: string; text?: string };
  assert.equal(primeiro.type, "text");
  return primeiro.text ?? "";
}
