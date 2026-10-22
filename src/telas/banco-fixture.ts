import type { Banco, Linha, ValorParametro } from "../tipos.js";

export interface BancoFixture extends Banco {
  consultas: number;
}

const TABELAS = [
  { esquema: "dbo", tabela: "ExemploRegra" },
  { esquema: "dbo", tabela: "ExemploVerba" },
];

const COLUNAS = [
  {
    ordem: 1,
    coluna: "Codigo",
    tipo: "int",
    aceita_nulo: false,
    chave_primaria: true,
    chaves_estrangeiras: null,
  },
  {
    ordem: 2,
    coluna: "Descricao",
    tipo: "nvarchar",
    aceita_nulo: true,
    chave_primaria: false,
    chaves_estrangeiras: null,
  },
];

/** Banco em memória para a pré-visualização local. Não abre SQL Server e não grava. */
export function criarBancoFixture(): BancoFixture {
  const estado = { consultas: 0 };
  return {
    get consultas() {
      return estado.consultas;
    },
    async consultar(sql, parametros, limite) {
      estado.consultas += 1;
      return responder(sql, parametros).slice(0, limite);
    },
  };
}

function responder(sql: string, parametros: Record<string, ValorParametro>): Linha[] {
  if (sql.includes("c.column_id")) return COLUNAS;
  if (sql.includes("t.name = @tabela")) {
    if (parametros.tabela === "Ausente") return [];
    return [{ esquema: parametros.esquema ?? "dbo", tabela: parametros.tabela }];
  }
  if (sql.includes("sys.extended_properties")) {
    return [
      {
        origem: "tabela",
        esquema: "dbo",
        tabela: "ExemploRegra",
        coluna: null,
        propriedade: null,
        trecho: null,
      },
    ];
  }
  if (sql.includes("sys.tables")) {
    return TABELAS.filter((tabela) => casaFiltro(tabela.tabela, parametros.filtro));
  }
  return [
    { esquema: "dbo", tabela: "ExemploRegra", coluna: "Codigo", tipo: "int" },
    { esquema: "dbo", tabela: "ExemploRegra", coluna: "Descricao", tipo: "nvarchar" },
  ];
}

function casaFiltro(tabela: string, filtro: ValorParametro | undefined): boolean {
  if (typeof filtro !== "string" || filtro === "") return true;
  const nucleo = filtro.replace(/^%/, "").replace(/%$/, "").replace(/\\([%_[\\])/g, "$1");
  return tabela.toLowerCase().includes(nucleo.toLowerCase());
}
