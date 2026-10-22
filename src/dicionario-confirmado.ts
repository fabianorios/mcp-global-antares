/**
 * =============================================================================
 * EXTENSAO — dicionario confirmado (homologacao)
 * =============================================================================
 *
 * Esta lista fica vazia de proposito.
 *
 * localizar_regras pesquisa apenas o catalogo do SQL Server:
 * sys.tables, sys.columns e sys.extended_properties.
 *
 * Quando um banco de homologacao existir e uma tabela de dicionario
 * for confirmada por uma fonte que voce realmente leu, acrescente um
 * item abaixo. Cite a fonte no campo `fonte`. Nao invente nomes fisicos
 * de tabelas Apdata.
 *
 * O servidor so executa a consulta se:
 * 1. ela passar no guard de um unico SELECT ou WITH…SELECT; e
 * 2. a tabela indicada existir no catalogo da conexao atual.
 *
 * O SQL pode usar @p0, @p1, ... (padroes LIKE da busca), @esquema e @tabela.
 * executarDicionarioConfirmado, em src/ferramentas.ts, aplica o guard,
 * o teto de linhas e so então chama o banco.
 * =============================================================================
 */

export interface ConsultaDicionarioConfirmado {
  /** Identificador estavel da consulta. */
  id: string;
  /** Documento, ticket ou banco de homologacao que confirmou o nome fisico. */
  fonte: string;
  esquema: string;
  tabela: string;
  /** Um unico SELECT ou WITH…SELECT. Nao concatene entrada do usuario. */
  sql: string;
}

export const CONSULTAS_DICIONARIO_CONFIRMADO: readonly ConsultaDicionarioConfirmado[] = [];

export const AVISO_DICIONARIO_NAO_CONFIRMADO =
  "Nenhuma tabela de dicionário físico da Apdata foi confirmada. A localização usa somente o catálogo do SQL Server (sys.tables, sys.columns e sys.extended_properties), por padrões de nome. Quando houver um banco de homologação, registre a consulta em src/dicionario-confirmado.ts citando a fonte.";
