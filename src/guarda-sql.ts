export const LIMITE_PADRAO = 50;
export const LIMITE_TETO = 200;
export const TAMANHO_MAXIMO_SQL = 20_000;

const PALAVRAS_PROIBIDAS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "EXEC",
  "EXECUTE",
  "GRANT",
  "REVOKE",
  "DENY",
  "INTO",
  "BACKUP",
  "RESTORE",
  "BULK",
  "DBCC",
  "SHUTDOWN",
  "RECONFIGURE",
  "KILL",
  "WAITFOR",
  "OPENROWSET",
  "OPENDATASOURCE",
  "OPENQUERY",
  "OPENXML",
  "DECLARE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVE",
  "USE",
  "SET",
  "GO",
  "SP_EXECUTESQL",
  "XP_CMDSHELL",
]);

type Token =
  | { tipo: "palavra"; texto: string; inicio: number; fim: number }
  | { tipo: "numero"; texto: string; inicio: number; fim: number }
  | { tipo: "texto"; inicio: number; fim: number }
  | { tipo: "identificador"; inicio: number; fim: number }
  | { tipo: "comentario"; inicio: number; fim: number }
  | { tipo: "simbolo"; texto: string; inicio: number; fim: number };

export type ResultadoGuarda =
  | { ok: true; sql: string }
  | { ok: false; motivo: string };

export type ConsultaPreparada =
  | { ok: true; sql: string; limite: number }
  | { ok: false; motivo: string };

export function resolverLimite(
  valor: number | undefined,
  padrao: number,
): { ok: true; limite: number } | { ok: false; motivo: string } {
  const base = valor ?? padrao;
  if (!Number.isInteger(base) || base < 1) {
    return { ok: false, motivo: "O limite deve ser um inteiro de 1 a 200." };
  }
  return { ok: true, limite: Math.min(base, LIMITE_TETO) };
}

export function guardarSql(sqlBruto: string): ResultadoGuarda {
  if (sqlBruto.includes("\0")) {
    return { ok: false, motivo: "A consulta contém um caractere nulo." };
  }

  const sql = sqlBruto.replace(/^\uFEFF/, "").trim();
  if (sql.length === 0) {
    return { ok: false, motivo: "A consulta está vazia." };
  }
  if (sql.length > TAMANHO_MAXIMO_SQL) {
    return { ok: false, motivo: `A consulta excede ${TAMANHO_MAXIMO_SQL} caracteres.` };
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(sql)) {
    return { ok: false, motivo: "A consulta contém um caractere de controle." };
  }

  const lido = tokenizar(sql);
  if (!lido.ok) return lido;

  const significativos = lido.tokens.filter((token) => token.tipo !== "comentario");
  if (significativos.length === 0) {
    return { ok: false, motivo: "A consulta está vazia." };
  }

  const pontoEVirgula = significativos.filter((token) => token.tipo === "simbolo" && token.texto === ";");
  let sqlUnico = sql;
  if (pontoEVirgula.length > 1) {
    return { ok: false, motivo: "Mais de um comando foi rejeitado. Envie um único SELECT." };
  }
  if (pontoEVirgula.length === 1) {
    const semi = pontoEVirgula[0];
    const ultimo = significativos[significativos.length - 1];
    if (!semi || ultimo !== semi) {
      return { ok: false, motivo: "Mais de um comando foi rejeitado. Envie um único SELECT." };
    }
    sqlUnico = sql.slice(0, semi.inicio).trim();
    if (sqlUnico.length === 0) {
      return { ok: false, motivo: "A consulta está vazia." };
    }
  }

  for (const token of significativos) {
    if (token.tipo !== "palavra") continue;
    const palavra = token.texto.toUpperCase();
    if (proibida(palavra)) {
      if (palavra === "INTO") {
        return { ok: false, motivo: "SELECT INTO grava uma tabela e foi rejeitado." };
      }
      return { ok: false, motivo: `Comando não permitido: ${palavra}.` };
    }
  }

  const principal = localizarSelectPrincipal(lido.tokens);
  if (!principal.ok) return principal;
  return { ok: true, sql: sqlUnico };
}

export function aplicarLimite(sql: string, limite: number): string {
  const lido = tokenizar(sql);
  if (!lido.ok) return sql;
  const principal = localizarSelectPrincipal(lido.tokens);
  if (!principal.ok) return sql;

  let cursor = proximo(lido.tokens, principal.indice + 1);
  let ancora = lido.tokens[principal.indice];
  if (!ancora) return sql;

  if (cursor >= 0) {
    const modificador = lido.tokens[cursor];
    if (
      modificador &&
      modificador.tipo === "palavra" &&
      (modificador.texto.toUpperCase() === "DISTINCT" || modificador.texto.toUpperCase() === "ALL")
    ) {
      ancora = modificador;
      cursor = proximo(lido.tokens, cursor + 1);
    }
  }

  const seguinte = cursor >= 0 ? lido.tokens[cursor] : undefined;
  if (seguinte && seguinte.tipo === "palavra" && seguinte.texto.toUpperCase() === "TOP") {
    const clausula = lerTop(lido.tokens, cursor);
    if (!clausula) return sql;
    const acimaDoTeto = clausula.literal && clausula.inteiro !== undefined && clausula.inteiro > limite;
    if (clausula.percentual || acimaDoTeto) {
      return `${sql.slice(0, seguinte.inicio)}TOP (${limite})${sql.slice(clausula.fim)}`;
    }
    return sql;
  }

  return `${sql.slice(0, ancora.fim)} TOP (${limite})${sql.slice(ancora.fim)}`;
}

export function prepararConsultaSomenteLeitura(sql: string, limiteInformado?: number): ConsultaPreparada {
  const limite = resolverLimite(limiteInformado, LIMITE_PADRAO);
  if (!limite.ok) return limite;
  const guardado = guardarSql(sql);
  if (!guardado.ok) return guardado;
  return { ok: true, sql: aplicarLimite(guardado.sql, limite.limite), limite: limite.limite };
}

function proibida(palavra: string): boolean {
  return PALAVRAS_PROIBIDAS.has(palavra) || palavra.startsWith("XP_");
}

function localizarSelectPrincipal(tokens: Token[]): { ok: true; indice: number } | { ok: false; motivo: string } {
  const inicio = proximo(tokens, 0);
  if (inicio < 0) return { ok: false, motivo: "A consulta está vazia." };

  const primeiro = tokens[inicio];
  if (!primeiro || primeiro.tipo !== "palavra") {
    return { ok: false, motivo: "Apenas um SELECT (ou WITH…SELECT) é permitido." };
  }

  const verbo = primeiro.texto.toUpperCase();
  if (verbo === "SELECT") return { ok: true, indice: inicio };
  if (verbo !== "WITH") {
    return { ok: false, motivo: "Apenas um SELECT (ou WITH…SELECT) é permitido." };
  }

  let indice = proximo(tokens, inicio + 1);
  if (indice < 0) return { ok: false, motivo: "WITH sem consulta SELECT." };

  for (;;) {
    const nome = tokens[indice];
    if (!nome || (nome.tipo !== "palavra" && nome.tipo !== "identificador")) {
      return { ok: false, motivo: "WITH sem nome de CTE." };
    }

    indice = proximo(tokens, indice + 1);
    if (indice < 0) return { ok: false, motivo: "WITH sem consulta SELECT." };

    const depoisDoNome = tokens[indice];
    if (depoisDoNome && depoisDoNome.tipo === "simbolo" && depoisDoNome.texto === "(") {
      const aposColunas = pularParenteses(tokens, indice);
      if (aposColunas === null) return { ok: false, motivo: "Parênteses não fechados no WITH." };
      indice = proximo(tokens, aposColunas);
      if (indice < 0) return { ok: false, motivo: "WITH sem consulta SELECT." };
    }

    const asToken = tokens[indice];
    if (!asToken || asToken.tipo !== "palavra" || asToken.texto.toUpperCase() !== "AS") {
      return { ok: false, motivo: "WITH sem AS antes da consulta da CTE." };
    }

    indice = proximo(tokens, indice + 1);
    const abre = indice >= 0 ? tokens[indice] : undefined;
    if (!abre || abre.tipo !== "simbolo" || abre.texto !== "(") {
      return { ok: false, motivo: "WITH sem a consulta da CTE entre parênteses." };
    }

    const aposCte = pularParenteses(tokens, indice);
    if (aposCte === null) return { ok: false, motivo: "Parênteses não fechados no WITH." };
    indice = proximo(tokens, aposCte);
    if (indice < 0) return { ok: false, motivo: "WITH sem consulta SELECT." };

    const separador = tokens[indice];
    if (separador && separador.tipo === "simbolo" && separador.texto === ",") {
      indice = proximo(tokens, indice + 1);
      if (indice < 0) return { ok: false, motivo: "WITH termina em vírgula." };
      continue;
    }
    break;
  }

  const principal = tokens[indice];
  if (principal && principal.tipo === "palavra" && principal.texto.toUpperCase() === "SELECT") {
    return { ok: true, indice };
  }

  const nomeVerbo = principal && principal.tipo === "palavra" ? principal.texto.toUpperCase() : "desconhecido";
  return {
    ok: false,
    motivo: `O comando principal depois do WITH é ${nomeVerbo}. Apenas SELECT é permitido.`,
  };
}

function lerTop(
  tokens: Token[],
  indiceTop: number,
): { fim: number; literal: boolean; inteiro?: number; percentual: boolean } | undefined {
  const inicioValor = proximo(tokens, indiceTop + 1);
  if (inicioValor < 0) return undefined;
  const valor = tokens[inicioValor];
  if (!valor) return undefined;

  let fim = valor.fim;
  let literal = false;
  let inteiro: number | undefined;
  let proximoIndice: number;

  if (valor.tipo === "simbolo" && valor.texto === "(") {
    const depois = pularParenteses(tokens, inicioValor);
    if (depois === null) return undefined;
    const fecha = tokens[depois - 1];
    if (!fecha) return undefined;
    fim = fecha.fim;
    const internos = tokens
      .slice(inicioValor + 1, depois - 1)
      .filter((token) => token.tipo !== "comentario");
    if (internos.length === 1 && internos[0]?.tipo === "numero" && /^\d+$/.test(internos[0].texto)) {
      literal = true;
      inteiro = Number(internos[0].texto);
    }
    proximoIndice = proximo(tokens, depois);
  } else if (valor.tipo === "numero" && /^\d+$/.test(valor.texto)) {
    literal = true;
    inteiro = Number(valor.texto);
    proximoIndice = proximo(tokens, inicioValor + 1);
  } else {
    proximoIndice = proximo(tokens, inicioValor + 1);
  }

  let percentual = false;
  if (proximoIndice >= 0) {
    const talvezPercentual = tokens[proximoIndice];
    if (
      talvezPercentual &&
      talvezPercentual.tipo === "palavra" &&
      talvezPercentual.texto.toUpperCase() === "PERCENT"
    ) {
      percentual = true;
      fim = talvezPercentual.fim;
    }
  }

  return { fim, literal, inteiro, percentual };
}

function proximo(tokens: Token[], indice: number): number {
  for (let i = indice; i < tokens.length; i += 1) {
    if (tokens[i]?.tipo !== "comentario") return i;
  }
  return -1;
}

function pularParenteses(tokens: Token[], indiceAbre: number): number | null {
  let profundidade = 0;
  for (let i = indiceAbre; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token.tipo === "comentario") continue;
    if (token.tipo === "simbolo" && token.texto === "(") profundidade += 1;
    else if (token.tipo === "simbolo" && token.texto === ")") {
      profundidade -= 1;
      if (profundidade === 0) return i + 1;
    }
  }
  return null;
}

function tokenizar(sql: string): { ok: true; tokens: Token[] } | { ok: false; motivo: string } {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i] ?? "";

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") {
      i += 1;
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      const inicio = i;
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      tokens.push({ tipo: "comentario", inicio, fim: i });
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      const inicio = i;
      const fecha = sql.indexOf("*/", i + 2);
      if (fecha < 0) return { ok: false, motivo: "Comentário de bloco não foi fechado." };
      i = fecha + 2;
      tokens.push({ tipo: "comentario", inicio, fim: i });
      continue;
    }

    if (ch === "[") {
      const inicio = i;
      i += 1;
      let fechou = false;
      while (i < sql.length) {
        if (sql[i] === "]" && sql[i + 1] === "]") {
          i += 2;
          continue;
        }
        if (sql[i] === "]") {
          i += 1;
          fechou = true;
          break;
        }
        i += 1;
      }
      if (!fechou) return { ok: false, motivo: "Identificador entre colchetes não foi fechado." };
      tokens.push({ tipo: "identificador", inicio, fim: i });
      continue;
    }

    if (ch === '"') {
      const inicio = i;
      i += 1;
      let fechou = false;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          i += 1;
          fechou = true;
          break;
        }
        i += 1;
      }
      if (!fechou) return { ok: false, motivo: "Identificador entre aspas não foi fechado." };
      tokens.push({ tipo: "identificador", inicio, fim: i });
      continue;
    }

    if ((ch === "N" || ch === "n") && sql[i + 1] === "'") {
      const texto = lerTexto(sql, i + 1);
      if (!texto.ok) return texto;
      tokens.push({ tipo: "texto", inicio: i, fim: texto.fim });
      i = texto.fim;
      continue;
    }

    if (ch === "'") {
      const texto = lerTexto(sql, i);
      if (!texto.ok) return texto;
      tokens.push({ tipo: "texto", inicio: i, fim: texto.fim });
      i = texto.fim;
      continue;
    }

    if (ch === "0" && (sql[i + 1] === "x" || sql[i + 1] === "X") && /[0-9a-fA-F]/.test(sql[i + 2] ?? "")) {
      const inicio = i;
      i += 2;
      while (i < sql.length && /[0-9a-fA-F]/.test(sql[i] ?? "")) i += 1;
      tokens.push({ tipo: "numero", texto: sql.slice(inicio, i), inicio, fim: i });
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      const inicio = i;
      i += 1;
      while (i < sql.length && (sql[i] ?? "") >= "0" && (sql[i] ?? "") <= "9") i += 1;
      if (sql[i] === "." && (sql[i + 1] ?? "") >= "0" && (sql[i + 1] ?? "") <= "9") {
        i += 1;
        while (i < sql.length && (sql[i] ?? "") >= "0" && (sql[i] ?? "") <= "9") i += 1;
      }
      tokens.push({ tipo: "numero", texto: sql.slice(inicio, i), inicio, fim: i });
      continue;
    }

    if (inicioDePalavra(ch)) {
      const inicio = i;
      i += 1;
      while (i < sql.length && continuaPalavra(sql[i] ?? "")) i += 1;
      tokens.push({ tipo: "palavra", texto: sql.slice(inicio, i), inicio, fim: i });
      continue;
    }

    tokens.push({ tipo: "simbolo", texto: ch, inicio: i, fim: i + 1 });
    i += 1;
  }

  return { ok: true, tokens };
}

function lerTexto(sql: string, inicioAspas: number): { ok: true; fim: number } | { ok: false; motivo: string } {
  let i = inicioAspas + 1;
  while (i < sql.length) {
    if (sql[i] === "'" && sql[i + 1] === "'") {
      i += 2;
      continue;
    }
    if (sql[i] === "'") return { ok: true, fim: i + 1 };
    i += 1;
  }
  return { ok: false, motivo: "Texto entre aspas não foi fechado." };
}

function inicioDePalavra(ch: string): boolean {
  return ch === "_" || ch === "@" || ch === "#" || /\p{L}/u.test(ch);
}

function continuaPalavra(ch: string): boolean {
  return ch === "_" || ch === "@" || ch === "#" || ch === "$" || /\p{L}/u.test(ch) || /\p{N}/u.test(ch);
}
