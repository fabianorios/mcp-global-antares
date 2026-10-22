import type { ValorParametro } from "./tipos.js";

const NOME = /^[\p{L}_][\p{L}\p{N}_@#$]*$/u;
const MAXIMO_PARAMETROS = 50;
const MAXIMO_TEXTO = 4000;

export type TipoSql = "nvarchar" | "int" | "bigint" | "float" | "bit";

export function validarParametros(
  parametros: Record<string, ValorParametro> | undefined,
): { ok: true; parametros: Record<string, ValorParametro> } | { ok: false; motivo: string } {
  const saida: Record<string, ValorParametro> = {};
  const entradas = Object.entries(parametros ?? {});
  if (entradas.length > MAXIMO_PARAMETROS) {
    return { ok: false, motivo: `No máximo ${MAXIMO_PARAMETROS} parâmetros.` };
  }

  for (const [bruto, valor] of entradas) {
    const nome = bruto.startsWith("@") ? bruto.slice(1) : bruto;
    if (nome.length === 0 || nome.length > 128 || !NOME.test(nome)) {
      return { ok: false, motivo: "Nome de parâmetro inválido. Use letras, números e _; o @ é opcional." };
    }
    if (typeof valor === "string" && valor.length > MAXIMO_TEXTO) {
      return { ok: false, motivo: `O parâmetro @${nome} excede ${MAXIMO_TEXTO} caracteres.` };
    }
    if (typeof valor === "number" && !Number.isFinite(valor)) {
      return { ok: false, motivo: `O parâmetro @${nome} não é um número finito.` };
    }
    saida[nome] = valor;
  }

  return { ok: true, parametros: saida };
}

export function classificarValor(valor: ValorParametro): TipoSql {
  if (valor === null || typeof valor === "string") return "nvarchar";
  if (typeof valor === "boolean") return "bit";
  if (Number.isInteger(valor) && valor >= -2_147_483_648 && valor <= 2_147_483_647) return "int";
  if (Number.isInteger(valor)) return "bigint";
  return "float";
}

export function paraLikeContem(termo: string): string {
  const escapado = termo.replace(/[\\%_[]/g, (caractere) => `\\${caractere}`);
  return `%${escapado}%`;
}
