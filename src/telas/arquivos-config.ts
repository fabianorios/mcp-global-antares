import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const CAMPOS_CONEXAO = [
  "ANTARES_DB_SERVER",
  "ANTARES_DB_PORT",
  "ANTARES_DB_DATABASE",
  "ANTARES_DB_USER",
  "ANTARES_DB_PASSWORD",
  "ANTARES_DB_ENCRYPT",
  "ANTARES_DB_TRUST_SERVER_CERTIFICATE",
] as const;

export type CampoConexao = (typeof CAMPOS_CONEXAO)[number];
export type RegistroConexao = Record<CampoConexao, string>;

const VAZIO: RegistroConexao = {
  ANTARES_DB_SERVER: "",
  ANTARES_DB_PORT: "1433",
  ANTARES_DB_DATABASE: "",
  ANTARES_DB_USER: "",
  ANTARES_DB_PASSWORD: "",
  ANTARES_DB_ENCRYPT: "true",
  ANTARES_DB_TRUST_SERVER_CERTIFICATE: "false",
};

export function caminhoConexao(diretorioDados: string): string {
  return join(diretorioDados, "conexao.json");
}

export async function lerConexao(diretorioDados: string): Promise<RegistroConexao> {
  try {
    const texto = await readFile(caminhoConexao(diretorioDados), "utf8");
    return normalizar(JSON.parse(texto) as unknown);
  } catch {
    return { ...VAZIO };
  }
}

export async function gravarConexao(diretorioDados: string, entrada: unknown): Promise<RegistroConexao> {
  const anterior = await lerConexao(diretorioDados);
  const registro = normalizar(entrada);
  if (registro.ANTARES_DB_PASSWORD.trim() === "" && anterior.ANTARES_DB_PASSWORD !== "") {
    registro.ANTARES_DB_PASSWORD = anterior.ANTARES_DB_PASSWORD;
  }
  await mkdir(diretorioDados, { recursive: true, mode: 0o700 });
  const destino = caminhoConexao(diretorioDados);
  const temporario = `${destino}.tmp`;
  await writeFile(temporario, `${JSON.stringify(registro, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporario, 0o600);
  await rename(temporario, destino);
  await chmod(dirname(destino), 0o700).catch(() => undefined);
  return registro;
}

export function visaoPublica(registro: RegistroConexao): Record<string, string | boolean> {
  return {
    ANTARES_DB_SERVER: registro.ANTARES_DB_SERVER,
    ANTARES_DB_PORT: registro.ANTARES_DB_PORT,
    ANTARES_DB_DATABASE: registro.ANTARES_DB_DATABASE,
    ANTARES_DB_USER: registro.ANTARES_DB_USER,
    ANTARES_DB_PASSWORD: "",
    senhaDefinida: registro.ANTARES_DB_PASSWORD !== "",
    ANTARES_DB_ENCRYPT: registro.ANTARES_DB_ENCRYPT,
    ANTARES_DB_TRUST_SERVER_CERTIFICATE: registro.ANTARES_DB_TRUST_SERVER_CERTIFICATE,
  };
}

export function ambienteDaConexao(registro: RegistroConexao): NodeJS.ProcessEnv {
  return { ...registro };
}

function normalizar(entrada: unknown): RegistroConexao {
  const origem = entrada && typeof entrada === "object" ? (entrada as Record<string, unknown>) : {};
  const registro = { ...VAZIO };
  for (const campo of CAMPOS_CONEXAO) {
    const valor = origem[campo];
    if (typeof valor === "boolean") registro[campo] = valor ? "true" : "false";
    else if (typeof valor === "string") registro[campo] = valor;
    else if (typeof valor === "number" && Number.isFinite(valor)) registro[campo] = String(valor);
  }
  registro.ANTARES_DB_ENCRYPT = booleano(registro.ANTARES_DB_ENCRYPT, "true");
  registro.ANTARES_DB_TRUST_SERVER_CERTIFICATE = booleano(registro.ANTARES_DB_TRUST_SERVER_CERTIFICATE, "false");
  return registro;
}

function booleano(valor: string, padrao: "true" | "false"): "true" | "false" {
  const texto = valor.trim().toLowerCase();
  if (texto === "true" || texto === "1" || texto === "sim") return "true";
  if (texto === "false" || texto === "0" || texto === "nao" || texto === "não") return "false";
  return padrao;
}
