import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  consultaDescreverTabela,
  consultaListarTabelas,
  consultaLocalizar,
  montarPadroes,
} from "./catalogo.js";
import { AVISO_DICIONARIO_NAO_CONFIRMADO, CONSULTAS_DICIONARIO_CONFIRMADO } from "./dicionario-confirmado.js";
import {
  consultarSomenteLeitura,
  descreverTabela,
  executarDicionarioConfirmado,
  listarTabelas,
  localizarRegras,
} from "./ferramentas.js";
import { guardarSql } from "./guarda-sql.js";
import { classificarValor, paraLikeContem, validarParametros } from "./parametros.js";
import type { Banco, Linha, ValorParametro } from "./tipos.js";

interface Chamada {
  sql: string;
  parametros: Record<string, ValorParametro>;
  limite: number;
}

function bancoFalso(responder: (chamada: Chamada) => Linha[]): Banco & { chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    async consultar(sql, parametros, limite) {
      const chamada = { sql, parametros, limite };
      chamadas.push(chamada);
      return responder(chamada).slice(0, limite);
    },
  };
}

describe("catálogo", () => {
  it("gera apenas SELECT e não interpola o termo do usuário", () => {
    const termo = "verba'; DROP TABLE x; --";
    const listar = consultaListarTabelas(termo);
    const localizar = consultaLocalizar(montarPadroes(undefined, termo));
    for (const consulta of [listar, localizar, { sql: consultaDescreverTabela(), parametros: {} }]) {
      assert.equal(guardarSql(consulta.sql).ok, true, consulta.sql);
      assert.equal(consulta.sql.includes("DROP"), false);
    }
    assert.equal(listar.parametros.filtro, paraLikeContem(termo));
    assert.equal(JSON.stringify(localizar.parametros).includes("DROP"), true);
    assert.equal(paraLikeContem("100%_"), "%100\\%\\_%");
  });
});

describe("ferramentas sem banco vivo", () => {
  it("lista tabelas com filtro parametrizado", async () => {
    const banco = bancoFalso(() => [{ esquema: "dbo", tabela: "Verbas" }]);
    const resultado = await listarTabelas(banco, { filtro: "verba", limite: 10 });
    assert.equal(resultado.erro, false);
    assert.equal(banco.chamadas.length, 1);
    assert.match(banco.chamadas[0]?.sql ?? "", /SELECT TOP \(10\)/);
    assert.match(banco.chamadas[0]?.sql ?? "", /@filtro/);
    assert.equal(banco.chamadas[0]?.parametros.filtro, "%verba%");
    assert.match(resultado.texto, /Verbas/);
  });

  it("pede o esquema quando o nome da tabela é ambíguo", async () => {
    const banco = bancoFalso((chamada) => {
      if (chamada.sql.includes("c.column_id")) return [{ coluna: "Id" }];
      const esquema = chamada.parametros.esquema;
      const tabelas = [
        { esquema: "dbo", tabela: "Regra" },
        { esquema: "rh", tabela: "Regra" },
      ];
      return tabelas.filter((tabela) => esquema == null || tabela.esquema === esquema);
    });

    const ambigua = await descreverTabela(banco, { tabela: "Regra" });
    assert.equal(ambigua.erro, false);
    assert.match(ambigua.texto, /ambigua/);
    assert.equal(banco.chamadas.length, 1);

    const descrita = await descreverTabela(banco, { tabela: "Regra", esquema: "dbo" });
    assert.equal(descrita.erro, false);
    assert.match(descrita.texto, /"coluna": "Id"/);
    assert.equal(banco.chamadas.length, 3);
  });

  it("consulta só o SELECT limitado e rejeita escrita", async () => {
    const banco = bancoFalso(() => [{ id: 1 }]);
    const ok = await consultarSomenteLeitura(banco, {
      sql: "SELECT id FROM regras WHERE id = @id",
      parametros: { id: "1; DROP TABLE t" },
      limite: 20,
    });
    assert.equal(ok.erro, false);
    assert.match(ok.texto, /dicionário/);
    assert.equal(banco.chamadas[0]?.sql.includes("DROP"), false);
    assert.equal(banco.chamadas[0]?.parametros.id, "1; DROP TABLE t");
    assert.match(banco.chamadas[0]?.sql ?? "", /TOP \(20\)/);

    const ruim = await consultarSomenteLeitura(banco, { sql: "UPDATE regras SET a = 1" });
    assert.equal(ruim.erro, true);
    assert.match(ruim.texto, /UPDATE/);
    assert.equal(banco.chamadas.length, 1);
  });

  it("localiza regras só no catálogo enquanto o dicionário não está confirmado", async () => {
    assert.equal(CONSULTAS_DICIONARIO_CONFIRMADO.length, 0);
    const fonte = readFileSync(new URL("./dicionario-confirmado.ts", import.meta.url), "utf8");
    assert.match(fonte, /EXTENSAO — dicionario confirmado/);

    const banco = bancoFalso(() => [{ origem: "tabela", esquema: "dbo", tabela: "CalcVerba" }]);
    const resultado = await localizarRegras(banco, { termo: "lpc" });
    assert.equal(resultado.erro, false);
    assert.match(resultado.texto, new RegExp(AVISO_DICIONARIO_NAO_CONFIRMADO.slice(0, 24)));
    assert.match(resultado.texto, /sys\.tables/);
    assert.equal(banco.chamadas.length, 1);
    assert.match(banco.chamadas[0]?.sql ?? "", /sys\.extended_properties/);
    assert.match(banco.chamadas[0]?.sql ?? "", /sys\.columns/);
    assert.equal(banco.chamadas[0]?.sql.includes("lpc"), false);
    const valores = Object.values(banco.chamadas[0]?.parametros ?? {});
    assert.ok(valores.includes("%lpc%"));
  });

  it("não executa consulta confirmada que não seja SELECT, e só lê tabela que existe", async () => {
    const banco = bancoFalso((chamada) => {
      if (chamada.sql.includes("s.name = @esquema")) return [{ esquema: "dbo", tabela: "exemplo_teste" }];
      return [{ nome: "regra" }];
    });

    const bloqueada = await executarDicionarioConfirmado(
      banco,
      [{ id: "ruim", fonte: "teste", esquema: "dbo", tabela: "exemplo_teste", sql: "DELETE FROM exemplo_teste" }],
      ["%regra%"],
      50,
    );
    assert.equal(bloqueada[0]?.executada, false);
    assert.equal(banco.chamadas.length, 0);

    const ausente = await executarDicionarioConfirmado(
      bancoFalso(() => []),
      [
        {
          id: "ausente",
          fonte: "homologacao de teste",
          esquema: "dbo",
          tabela: "exemplo_teste",
          sql: "SELECT nome FROM dbo.exemplo_teste WHERE nome LIKE @p0",
        },
      ],
      ["%regra%"],
      50,
    );
    assert.equal(ausente[0]?.executada, false);
    assert.match(ausente[0]?.motivo ?? "", /não existe/);

    const executada = await executarDicionarioConfirmado(
      banco,
      [
        {
          id: "ok",
          fonte: "homologacao de teste",
          esquema: "dbo",
          tabela: "exemplo_teste",
          sql: "SELECT nome FROM dbo.exemplo_teste WHERE nome LIKE @p0",
        },
      ],
      ["%regra%"],
      50,
    );
    assert.equal(executada[0]?.executada, true);
    assert.equal(executada[0]?.fonte, "homologacao de teste");
    const leitura = banco.chamadas.at(-1);
    assert.match(leitura?.sql ?? "", /SELECT TOP \(50\) nome FROM dbo\.exemplo_teste/);
    assert.equal(leitura?.parametros.p0, "%regra%");
  });
});

describe("parâmetros", () => {
  it("classifica tipos e rejeita nome inválido", () => {
    assert.equal(classificarValor(null), "nvarchar");
    assert.equal(classificarValor("a"), "nvarchar");
    assert.equal(classificarValor(true), "bit");
    assert.equal(classificarValor(10), "int");
    assert.equal(classificarValor(1.5), "float");
    assert.equal(classificarValor(3_000_000_000), "bigint");
    const invalido = validarParametros({ "1ruim": 1 });
    assert.equal(invalido.ok, false);
    const valido = validarParametros({ "@id": 1 });
    assert.equal(valido.ok, true);
    if (valido.ok) assert.deepEqual(valido.parametros, { id: 1 });
  });
});
