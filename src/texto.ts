export function mensagemDe(erro: unknown): string {
  if (erro instanceof Error) {
    const codigo =
      "code" in erro && typeof erro.code === "string" && erro.code.length > 0 && erro.code.length <= 32
        ? erro.code
        : undefined;
    return codigo ? `${erro.message} (${codigo})` : erro.message;
  }
  return "Falha ao consultar o SQL Server.";
}

export function redigirSegredo(texto: string, segredos: readonly string[]): string {
  let saida = texto;
  for (const segredo of segredos) {
    if (segredo.length >= 4) {
      saida = saida.split(segredo).join("***");
    }
  }
  saida = saida.replace(/Password\s*=\s*("[^"]*"|'[^']*'|[^\s;]+)/gi, "Password=***");
  if (saida.length > 2000) {
    saida = `${saida.slice(0, 2000)}…`;
  }
  return saida;
}

export function textoJson(valor: unknown): string {
  return JSON.stringify(
    valor,
    (_chave, item: unknown) => {
      if (typeof item === "bigint") return item.toString();
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(item)) return item.toString("base64");
      return item;
    },
    2,
  );
}
