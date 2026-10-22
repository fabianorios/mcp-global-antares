import type { CategoriaRegra } from "../catalogo.js";
import {
  consultarSomenteLeitura,
  descreverTabela,
  listarTabelas,
  localizarRegras,
} from "../ferramentas.js";
import type { ValorParametro } from "../tipos.js";
import type { Banco } from "../tipos.js";
import { gradeDeResultado, type RespostaGrade } from "./grade.js";

export type AcaoSolicitacao = "listar" | "descrever" | "localizar" | "consultar";

export async function executarSolicitacao(
  banco: Banco,
  corpo: unknown,
  exemplo: boolean,
): Promise<{ status: number; corpo: RespostaGrade }> {
  if (!corpo || typeof corpo !== "object") {
    return recusar("Informe a ação da solicitação.");
  }
  const entrada = corpo as Record<string, unknown>;
  const acao = entrada.acao;
  if (acao !== "listar" && acao !== "descrever" && acao !== "localizar" && acao !== "consultar") {
    return recusar("Ação desconhecida.");
  }

  try {
    if (acao === "listar") {
      const resultado = await listarTabelas(banco, {
        filtro: texto(entrada.filtro),
        limite: numero(entrada.limite),
      });
      return { status: resultado.erro ? 400 : 200, corpo: gradeDeResultado(resultado, exemplo) };
    }
    if (acao === "descrever") {
      const tabela = texto(entrada.tabela);
      if (!tabela) return recusar("Informe o nome da tabela.");
      const resultado = await descreverTabela(banco, {
        tabela,
        esquema: texto(entrada.esquema),
        limite: numero(entrada.limite),
      });
      return { status: resultado.erro ? 404 : 200, corpo: gradeDeResultado(resultado, exemplo) };
    }
    if (acao === "localizar") {
      const resultado = await localizarRegras(banco, {
        categoria: categoria(entrada.categoria),
        termo: texto(entrada.termo),
        limite: numero(entrada.limite),
      });
      return { status: resultado.erro ? 400 : 200, corpo: gradeDeResultado(resultado, exemplo) };
    }
    const sql = typeof entrada.sql === "string" ? entrada.sql : "";
    const resultado = await consultarSomenteLeitura(banco, {
      sql,
      parametros: parametros(entrada.parametros),
      limite: numero(entrada.limite),
    });
    return { status: resultado.erro ? 400 : 200, corpo: gradeDeResultado(resultado, exemplo) };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha ao consultar.";
    return {
      status: 503,
      corpo: { erro: true, mensagem, aviso: null, colunas: [], linhas: [], exemplo },
    };
  }
}

function recusar(mensagem: string): { status: number; corpo: RespostaGrade } {
  return {
    status: 400,
    corpo: { erro: true, mensagem, aviso: null, colunas: [], linhas: [], exemplo: false },
  };
}

function texto(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  const textoLimpo = valor.trim();
  return textoLimpo === "" ? undefined : textoLimpo;
}

function numero(valor: unknown): number | undefined {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return undefined;
  return valor;
}

function categoria(valor: unknown): CategoriaRegra | undefined {
  if (
    valor === "verba" ||
    valor === "regra" ||
    valor === "calculo" ||
    valor === "transacao" ||
    valor === "lpc" ||
    valor === "negocio"
  ) {
    return valor;
  }
  return undefined;
}

function parametros(valor: unknown): Record<string, ValorParametro> | undefined {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return undefined;
  const saida: Record<string, ValorParametro> = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      saida[chave] = item;
    }
  }
  return saida;
}
