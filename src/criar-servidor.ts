import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATEGORIAS_REGRA } from "./catalogo.js";
import {
  consultarSomenteLeitura,
  descreverTabela,
  listarTabelas,
  localizarRegras,
} from "./ferramentas.js";
import { mensagemDe, redigirSegredo } from "./texto.js";
import type { Banco, ResultadoFerramenta, ValorParametro } from "./tipos.js";

export const INSTRUCOES =
  "Servidor somente leitura do SQL Server do Global Antares. Use listar_tabelas e descrever_tabela para o catálogo, localizar_regras para achar regras de cálculo, regras de negócio, verbas, transações e LPC por nome no catálogo, e consultar_somente_leitura só para poucas linhas de dicionário ou de regra. Não extraia folha, contracheque nem empregados. Não há nomes físicos de tabelas Apdata confirmados.";

export const DEFINICOES = {
  listar_tabelas: {
    titulo: "Listar tabelas",
    descricao:
      "Lista as tabelas de usuário do banco (esquema e nome), com filtro opcional por parte do nome. Não inclui tabelas de sistema. Somente leitura.",
  },
  descrever_tabela: {
    titulo: "Descrever tabela",
    descricao:
      "Descreve uma tabela: colunas, tipos, tamanho, precisão, nulidade, identidade e chaves primária, única e estrangeira. Somente leitura.",
  },
  consultar_somente_leitura: {
    titulo: "Consultar somente leitura",
    descricao:
      "Executa uma única consulta SELECT ou WITH…SELECT parametrizada para ler linhas de dicionário e de regras. Não use para extrair folha de pagamento, contracheque ou dados de empregados. O limite padrão é 50 linhas e o teto é 200. Rejeita INSERT, UPDATE, DELETE, MERGE, DDL, EXEC e mais de um comando.",
  },
  localizar_regras: {
    titulo: "Localizar regras",
    descricao:
      "Localiza regras de cálculo, regras de negócio, verbas, transações e LPC pesquisando o catálogo do SQL Server (sys.tables, sys.columns e propriedades estendidas) por padrões de nome. Não consulta um dicionário físico da Apdata enquanto o esquema de homologação não estiver confirmado. Somente leitura.",
  },
} as const;

const anotacoes = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const limiteOpcional = z
  .number()
  .int()
  .min(1)
  .max(200)
  .optional()
  .describe("Quantidade máxima de linhas. O teto é 200.");

export function criarServidor(banco: Banco): McpServer {
  const servidor = new McpServer(
    {
      name: "mcp-global-antares",
      version: "0.1.0",
      title: "Global Antares (somente leitura)",
    },
    { instructions: INSTRUCOES },
  );

  servidor.registerTool(
    "listar_tabelas",
    {
      title: DEFINICOES.listar_tabelas.titulo,
      description: DEFINICOES.listar_tabelas.descricao,
      inputSchema: z.object({
        filtro: z
          .string()
          .optional()
          .describe("Parte do nome da tabela. Sem curingas; o servidor trata o texto como substring."),
        limite: limiteOpcional.describe("Padrão 200, teto 200."),
      }),
      annotations: anotacoes,
    },
    async ({ filtro, limite }) => responder(() => listarTabelas(banco, { filtro, limite })),
  );

  servidor.registerTool(
    "descrever_tabela",
    {
      title: DEFINICOES.descrever_tabela.titulo,
      description: DEFINICOES.descrever_tabela.descricao,
      inputSchema: z.object({
        tabela: z.string().describe("Nome da tabela de usuário, sem esquema."),
        esquema: z
          .string()
          .optional()
          .describe("Esquema. Obrigatório quando o mesmo nome existe em mais de um esquema."),
        limite: limiteOpcional.describe("Padrão 200, teto 200."),
      }),
      annotations: anotacoes,
    },
    async ({ tabela, esquema, limite }) => responder(() => descreverTabela(banco, { tabela, esquema, limite })),
  );

  servidor.registerTool(
    "consultar_somente_leitura",
    {
      title: DEFINICOES.consultar_somente_leitura.titulo,
      description: DEFINICOES.consultar_somente_leitura.descricao,
      inputSchema: z.object({
        sql: z
          .string()
          .min(1)
          .max(20_000)
          .describe("Um único SELECT ou WITH…SELECT. Use @parametro para valores; não concatene texto do usuário."),
        parametros: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional()
          .describe("Valores nomeados, sem o @. Exemplo: { \"id\": 10 }. Não são concatenados no texto SQL."),
        limite: limiteOpcional.describe("Padrão 50, teto 200."),
      }),
      annotations: anotacoes,
    },
    async ({ sql, parametros, limite }) =>
      responder(() =>
        consultarSomenteLeitura(banco, {
          sql,
          parametros: parametros as Record<string, ValorParametro> | undefined,
          limite,
        }),
      ),
  );

  servidor.registerTool(
    "localizar_regras",
    {
      title: DEFINICOES.localizar_regras.titulo,
      description: DEFINICOES.localizar_regras.descricao,
      inputSchema: z.object({
        categoria: z
          .enum(CATEGORIAS_REGRA)
          .optional()
          .describe("verba, regra, calculo, transacao, lpc ou negocio. Vazio busca todas."),
        termo: z
          .string()
          .optional()
          .describe("Substring extra no nome da tabela, coluna ou propriedade. Não é um nome físico da Apdata."),
        limite: limiteOpcional.describe("Padrão 200, teto 200."),
      }),
      annotations: anotacoes,
    },
    async ({ categoria, termo, limite }) => responder(() => localizarRegras(banco, { categoria, termo, limite })),
  );

  return servidor;
}

async function responder(acao: () => Promise<ResultadoFerramenta>) {
  try {
    const resultado = await acao();
    return {
      content: [{ type: "text" as const, text: resultado.texto }],
      ...(resultado.erro ? { isError: true as const } : {}),
    };
  } catch (erro) {
    return {
      content: [{ type: "text" as const, text: redigirSegredo(mensagemDe(erro), []) }],
      isError: true as const,
    };
  }
}
