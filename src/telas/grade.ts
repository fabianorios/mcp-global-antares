import type { Linha, ResultadoFerramenta } from "../tipos.js";

export interface RespostaGrade {
  erro: boolean;
  mensagem: string | null;
  aviso: string | null;
  colunas: string[];
  linhas: Linha[];
  exemplo: boolean;
}

export function gradeDeResultado(resultado: ResultadoFerramenta, exemplo: boolean): RespostaGrade {
  if (resultado.erro) {
    return { erro: true, mensagem: resultado.texto, aviso: null, colunas: [], linhas: [], exemplo };
  }

  let dados: unknown;
  try {
    dados = JSON.parse(resultado.texto) as unknown;
  } catch {
    return {
      erro: true,
      mensagem: "A resposta não pôde ser lida.",
      aviso: null,
      colunas: [],
      linhas: [],
      exemplo,
    };
  }

  const linhas = extrairLinhas(dados);
  return {
    erro: false,
    mensagem: textoDe(dados, "mensagem"),
    aviso: textoDe(dados, "aviso") ?? textoDe(dados, "uso"),
    colunas: colunasDe(linhas),
    linhas,
    exemplo,
  };
}

function extrairLinhas(dados: unknown): Linha[] {
  if (!dados || typeof dados !== "object") return [];
  const registro = dados as Record<string, unknown>;
  for (const chave of ["tabelas", "colunas", "linhas", "achados"]) {
    const valor = registro[chave];
    if (Array.isArray(valor)) return valor.filter(linhaObjeto);
  }
  return [];
}

function linhaObjeto(valor: unknown): valor is Linha {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function colunasDe(linhas: Linha[]): string[] {
  const colunas: string[] = [];
  for (const linha of linhas) {
    for (const chave of Object.keys(linha)) {
      if (!colunas.includes(chave)) colunas.push(chave);
    }
  }
  return colunas;
}

function textoDe(dados: unknown, chave: string): string | null {
  if (!dados || typeof dados !== "object" || !(chave in dados)) return null;
  const valor = (dados as Record<string, unknown>)[chave];
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}
