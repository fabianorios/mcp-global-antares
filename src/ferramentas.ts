import {
  consultaDescreverTabela,
  consultaEncontrarTabela,
  consultaListarTabelas,
  consultaLocalizar,
  montarPadroes,
  type CategoriaRegra,
} from "./catalogo.js";
import {
  AVISO_DICIONARIO_NAO_CONFIRMADO,
  CONSULTAS_DICIONARIO_CONFIRMADO,
  type ConsultaDicionarioConfirmado,
} from "./dicionario-confirmado.js";
import { LIMITE_TETO, prepararConsultaSomenteLeitura, resolverLimite } from "./guarda-sql.js";
import { validarParametros } from "./parametros.js";
import { textoJson } from "./texto.js";
import type { Banco, Linha, ResultadoFerramenta, ValorParametro } from "./tipos.js";

const LIMITE_METADADOS = LIMITE_TETO;

export interface ResultadoDicionario {
  id: string;
  fonte: string;
  executada: boolean;
  motivo?: string;
  linhas?: Linha[];
}

export async function listarTabelas(
  banco: Banco,
  entrada: { filtro?: string; limite?: number },
): Promise<ResultadoFerramenta> {
  if (entrada.filtro !== undefined && entrada.filtro.trim().length > 128) {
    return falha("O filtro excede 128 caracteres.");
  }
  const limite = resolverLimite(entrada.limite, LIMITE_METADADOS);
  if (!limite.ok) return falha(limite.motivo);

  const consulta = consultaListarTabelas(entrada.filtro);
  const executada = await executar(banco, consulta.sql, consulta.parametros, limite.limite);
  if (!executada.ok) return falha(executada.motivo);

  return sucesso({
    limite: executada.limite,
    atingiu_limite: executada.linhas.length >= executada.limite,
    tabelas: executada.linhas,
  });
}

export async function descreverTabela(
  banco: Banco,
  entrada: { tabela: string; esquema?: string; limite?: number },
): Promise<ResultadoFerramenta> {
  const erroTabela = validarNome(entrada.tabela, "O nome da tabela");
  if (erroTabela) return falha(erroTabela);
  if (entrada.esquema !== undefined) {
    const erroEsquema = validarNome(entrada.esquema, "O esquema");
    if (erroEsquema) return falha(erroEsquema);
  }

  const limite = resolverLimite(entrada.limite, LIMITE_METADADOS);
  if (!limite.ok) return falha(limite.motivo);

  const busca = consultaEncontrarTabela(entrada.tabela.trim(), entrada.esquema?.trim());
  const encontradas = await executar(banco, busca.sql, busca.parametros, LIMITE_METADADOS);
  if (!encontradas.ok) return falha(encontradas.motivo);
  if (encontradas.linhas.length === 0) {
    return falha("Tabela não encontrada entre as tabelas de usuário.");
  }
  if (encontradas.linhas.length > 1) {
    return sucesso({
      situacao: "ambigua",
      mensagem: "Há mais de uma tabela com esse nome. Informe o esquema.",
      tabelas: encontradas.linhas,
    });
  }

  const esquema = String(encontradas.linhas[0]?.esquema ?? entrada.esquema ?? "");
  const tabela = String(encontradas.linhas[0]?.tabela ?? entrada.tabela.trim());
  const colunas = await executar(
    banco,
    consultaDescreverTabela(),
    { esquema, tabela },
    limite.limite,
  );
  if (!colunas.ok) return falha(colunas.motivo);

  return sucesso({
    esquema,
    tabela,
    limite: colunas.limite,
    atingiu_limite: colunas.linhas.length >= colunas.limite,
    colunas: colunas.linhas,
  });
}

export async function consultarSomenteLeitura(
  banco: Banco,
  entrada: { sql: string; parametros?: Record<string, ValorParametro>; limite?: number },
): Promise<ResultadoFerramenta> {
  const limite = resolverLimite(entrada.limite, 50);
  if (!limite.ok) return falha(limite.motivo);
  const parametros = validarParametros(entrada.parametros);
  if (!parametros.ok) return falha(parametros.motivo);

  const preparada = prepararConsultaSomenteLeitura(entrada.sql, limite.limite);
  if (!preparada.ok) return falha(preparada.motivo);

  const linhas = (await banco.consultar(preparada.sql, parametros.parametros, preparada.limite)).slice(
    0,
    preparada.limite,
  );
  return sucesso({
    uso: "Linhas de dicionário ou de regra. Esta ferramenta não é extração de folha, contracheque ou empregados.",
    limite: preparada.limite,
    atingiu_limite: linhas.length >= preparada.limite,
    linhas,
  });
}

export async function localizarRegras(
  banco: Banco,
  entrada: { categoria?: CategoriaRegra; termo?: string; limite?: number },
  consultas: readonly ConsultaDicionarioConfirmado[] = CONSULTAS_DICIONARIO_CONFIRMADO,
): Promise<ResultadoFerramenta> {
  if (entrada.termo !== undefined && entrada.termo.trim().length > 128) {
    return falha("O termo excede 128 caracteres.");
  }
  const limite = resolverLimite(entrada.limite, LIMITE_METADADOS);
  if (!limite.ok) return falha(limite.motivo);

  const padroes = montarPadroes(entrada.categoria, entrada.termo);
  if (padroes.length === 0) return falha("Nenhum padrão de busca foi informado.");

  const consulta = consultaLocalizar(padroes);
  const achados = await executar(banco, consulta.sql, consulta.parametros, limite.limite);
  if (!achados.ok) return falha(achados.motivo);

  const dicionario = await executarDicionarioConfirmado(banco, consultas, padroes, limite.limite);
  return sucesso({
    aviso: AVISO_DICIONARIO_NAO_CONFIRMADO,
    fonte: "catálogo SQL Server (sys.tables, sys.columns, sys.extended_properties)",
    padroes,
    limite: achados.limite,
    atingiu_limite: achados.linhas.length >= achados.limite,
    achados: achados.linhas,
    dicionario_confirmado: dicionario,
  });
}

export async function executarDicionarioConfirmado(
  banco: Banco,
  consultas: readonly ConsultaDicionarioConfirmado[],
  padroes: readonly string[],
  limite: number,
): Promise<ResultadoDicionario[]> {
  const resultados: ResultadoDicionario[] = [];
  for (const consulta of consultas) {
    const preparada = prepararConsultaSomenteLeitura(consulta.sql, limite);
    if (!preparada.ok) {
      resultados.push({
        id: consulta.id,
        fonte: consulta.fonte,
        executada: false,
        motivo: preparada.motivo,
      });
      continue;
    }

    const existe = await executar(
      banco,
      `
        SELECT s.name AS esquema, t.name AS tabela
        FROM sys.tables AS t
        INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
        WHERE s.name = @esquema AND t.name = @tabela
      `,
      { esquema: consulta.esquema, tabela: consulta.tabela },
      1,
    );
    if (!existe.ok) {
      resultados.push({ id: consulta.id, fonte: consulta.fonte, executada: false, motivo: existe.motivo });
      continue;
    }
    if (existe.linhas.length === 0) {
      resultados.push({
        id: consulta.id,
        fonte: consulta.fonte,
        executada: false,
        motivo: "A tabela confirmada não existe neste banco.",
      });
      continue;
    }

    const parametros: Record<string, ValorParametro> = {
      esquema: consulta.esquema,
      tabela: consulta.tabela,
    };
    padroes.forEach((padrao, indice) => {
      parametros[`p${indice}`] = padrao;
    });
    const linhas = (await banco.consultar(preparada.sql, parametros, preparada.limite)).slice(0, preparada.limite);
    resultados.push({
      id: consulta.id,
      fonte: consulta.fonte,
      executada: true,
      linhas,
    });
  }
  return resultados;
}

async function executar(
  banco: Banco,
  sql: string,
  parametros: Record<string, ValorParametro>,
  limite: number,
): Promise<{ ok: true; linhas: Linha[]; limite: number } | { ok: false; motivo: string }> {
  const preparada = prepararConsultaSomenteLeitura(sql, limite);
  if (!preparada.ok) return preparada;
  const linhas = (await banco.consultar(preparada.sql, parametros, preparada.limite)).slice(0, preparada.limite);
  return { ok: true, linhas, limite: preparada.limite };
}

function validarNome(valor: string, rotulo: string): string | undefined {
  const texto = valor.trim();
  if (texto.length === 0) return `${rotulo} não pode ser vazio.`;
  if (texto.length > 128) return `${rotulo} excede 128 caracteres.`;
  if (texto.includes("\0")) return `${rotulo} contém caractere inválido.`;
  return undefined;
}

function falha(motivo: string): ResultadoFerramenta {
  return { erro: true, texto: motivo };
}

function sucesso(valor: unknown): ResultadoFerramenta {
  return { erro: false, texto: textoJson(valor) };
}
