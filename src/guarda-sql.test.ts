import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aplicarLimite,
  guardarSql,
  LIMITE_PADRAO,
  LIMITE_TETO,
  prepararConsultaSomenteLeitura,
} from "./guarda-sql.js";

describe("guardarSql", () => {
  it("aceita um único SELECT", () => {
    const resultado = guardarSql("SELECT 1");
    assert.equal(resultado.ok, true);
    if (resultado.ok) assert.equal(resultado.sql, "SELECT 1");
  });

  it("aceita SELECT com parâmetro, comentário e ponto e vírgula final", () => {
    const resultado = guardarSql("  /* cabecalho */ SELECT * FROM dbo.Tabela WHERE Id = @id; -- fim ");
    assert.equal(resultado.ok, true);
    if (resultado.ok) assert.equal(resultado.sql, "/* cabecalho */ SELECT * FROM dbo.Tabela WHERE Id = @id");
  });

  it("aceita WITH…SELECT, inclusive com mais de uma CTE", () => {
    const resultado = guardarSql(
      "WITH cte AS (SELECT 1 AS n), cte2 AS (SELECT n FROM cte) SELECT * FROM cte2",
    );
    assert.equal(resultado.ok, true);
  });

  it("aceita UNION e palavra proibida só dentro de texto ou identificador", () => {
    assert.equal(guardarSql("SELECT * FROM t UNION ALL SELECT * FROM u").ok, true);
    assert.equal(guardarSql("SELECT 'DELETE' AS texto").ok, true);
    assert.equal(guardarSql("SELECT [DELETE] FROM t").ok, true);
    assert.equal(guardarSql("SELECT ';' AS ponto").ok, true);
    assert.equal(guardarSql("SELECT * FROM t WHERE nome = 'a;b'").ok, true);
    assert.equal(guardarSql("SELECT N'DELETE' AS texto").ok, true);
  });

  it("rejeita escrita, DDL e EXEC", () => {
    const rejeitados = [
      "INSERT INTO t (a) VALUES (1)",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "DROP TABLE t",
      "ALTER TABLE t ADD b int",
      "CREATE TABLE t (id int)",
      "TRUNCATE TABLE t",
      "EXEC sp_who2",
      "EXECUTE ('SELECT 1')",
      "MERGE INTO t USING u ON 1 = 1 WHEN MATCHED THEN DELETE;",
      "SELECT * INTO nova FROM antiga",
      "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x', 'SELECT 1')",
      "DECLARE @x int; SELECT @x",
    ];
    for (const sql of rejeitados) {
      assert.equal(guardarSql(sql).ok, false, sql);
    }
  });

  it("rejeita mais de um comando e WITH que não termina em SELECT", () => {
    assert.equal(guardarSql("SELECT 1; DELETE FROM t").ok, false);
    assert.equal(guardarSql("SELECT 1; SELECT 2").ok, false);
    assert.equal(guardarSql("SELECT 1;;").ok, false);
    assert.equal(guardarSql(";SELECT 1").ok, false);
    assert.equal(guardarSql("WITH cte AS (SELECT 1 AS n) DELETE FROM t").ok, false);
    assert.equal(guardarSql("WITH cte AS (SELECT 1 AS n) INSERT INTO t SELECT * FROM cte").ok, false);
    assert.equal(guardarSql("").ok, false);
    assert.equal(guardarSql("/* so comentario */").ok, false);
    assert.equal(guardarSql("SEL/**/ECT 1").ok, false);
    assert.equal(guardarSql("SELECT 1\nGO\nDELETE FROM t").ok, false);
    assert.equal(guardarSql("SELECT 1\nDELETE FROM t").ok, false);
  });

  it("não trata comando escondido em comentário como SQL", () => {
    const resultado = guardarSql("SELECT 1 -- DELETE FROM t");
    assert.equal(resultado.ok, true);
    if (resultado.ok) assert.match(resultado.sql, /^SELECT 1/);
  });
});

describe("limite", () => {
  it("usa 50 por padrão e corta em 200", () => {
    const padrao = prepararConsultaSomenteLeitura("SELECT * FROM t");
    assert.equal(padrao.ok, true);
    if (padrao.ok) {
      assert.equal(padrao.limite, LIMITE_PADRAO);
      assert.equal(padrao.sql, "SELECT TOP (50) * FROM t");
    }

    const teto = prepararConsultaSomenteLeitura("SELECT * FROM t", 500);
    assert.equal(teto.ok, true);
    if (teto.ok) {
      assert.equal(teto.limite, LIMITE_TETO);
      assert.equal(teto.sql, `SELECT TOP (200) * FROM t`);
    }
  });

  it("injeta TOP só no SELECT externo", () => {
    const resultado = prepararConsultaSomenteLeitura(
      "WITH cte AS (SELECT 1 AS n) SELECT * FROM cte",
      50,
    );
    assert.equal(resultado.ok, true);
    if (resultado.ok) {
      assert.equal(resultado.sql, "WITH cte AS (SELECT 1 AS n) SELECT TOP (50) * FROM cte");
    }
  });

  it("preserva TOP menor, reduz TOP maior e mantém TOP não literal", () => {
    assert.equal(aplicarLimite("SELECT TOP 10 * FROM t", 50), "SELECT TOP 10 * FROM t");
    assert.equal(aplicarLimite("SELECT TOP 1000 * FROM t", 50), "SELECT TOP (50) * FROM t");
    assert.equal(aplicarLimite("SELECT TOP (1000) * FROM t", 50), "SELECT TOP (50) * FROM t");
    assert.equal(aplicarLimite("SELECT TOP (@n) * FROM t", 50), "SELECT TOP (@n) * FROM t");
    assert.equal(aplicarLimite("SELECT DISTINCT a FROM t", 50), "SELECT DISTINCT TOP (50) a FROM t");
    assert.equal(aplicarLimite("SELECT TOP 100 PERCENT * FROM t", 50), "SELECT TOP (50) * FROM t");
  });

  it("rejeita limite inválido e não prepara escrita", () => {
    assert.equal(prepararConsultaSomenteLeitura("SELECT 1", 0).ok, false);
    const escrita = prepararConsultaSomenteLeitura("DELETE FROM t", 10);
    assert.equal(escrita.ok, false);
  });
});
