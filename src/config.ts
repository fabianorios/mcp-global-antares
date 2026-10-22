export interface ConfigBanco {
  servidor: string;
  porta?: number;
  banco: string;
  usuario: string;
  senha: string;
  criptografia: boolean;
  confiarCertificado: boolean;
}

export const VARIAVEIS_AMBIENTE = {
  servidor: "ANTARES_DB_SERVER",
  porta: "ANTARES_DB_PORT",
  banco: "ANTARES_DB_DATABASE",
  usuario: "ANTARES_DB_USER",
  senha: "ANTARES_DB_PASSWORD",
  criptografia: "ANTARES_DB_ENCRYPT",
  confiarCertificado: "ANTARES_DB_TRUST_SERVER_CERTIFICATE",
} as const;

const OBRIGATORIAS = [
  VARIAVEIS_AMBIENTE.servidor,
  VARIAVEIS_AMBIENTE.banco,
  VARIAVEIS_AMBIENTE.usuario,
  VARIAVEIS_AMBIENTE.senha,
] as const;

export function lerConfigBanco(env: NodeJS.ProcessEnv): ConfigBanco {
  const servidor = exigir(env, VARIAVEIS_AMBIENTE.servidor);
  const banco = exigir(env, VARIAVEIS_AMBIENTE.banco);
  const usuario = exigir(env, VARIAVEIS_AMBIENTE.usuario);
  const senha = exigir(env, VARIAVEIS_AMBIENTE.senha);
  const portaInformada = env[VARIAVEIS_AMBIENTE.porta];
  const portaExplicita = portaInformada !== undefined && portaInformada.trim() !== "";

  return {
    servidor,
    porta: portaExplicita ? lerPorta(portaInformada) : servidor.includes("\\") ? undefined : 1433,
    banco,
    usuario,
    senha,
    criptografia: lerBooleano(env[VARIAVEIS_AMBIENTE.criptografia], true, VARIAVEIS_AMBIENTE.criptografia),
    confiarCertificado: lerBooleano(
      env[VARIAVEIS_AMBIENTE.confiarCertificado],
      false,
      VARIAVEIS_AMBIENTE.confiarCertificado,
    ),
  };
}

export function resumirConfig(config: ConfigBanco): Record<string, unknown> {
  return {
    servidor: config.servidor,
    porta: config.porta ?? null,
    banco: config.banco,
    usuario: config.usuario,
    criptografia: config.criptografia,
    confiarCertificado: config.confiarCertificado,
  };
}

export function variaveisObrigatorias(): readonly string[] {
  return OBRIGATORIAS;
}

function exigir(env: NodeJS.ProcessEnv, nome: string): string {
  const valor = env[nome];
  if (valor === undefined || valor.trim() === "") {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${nome}. Defina-a no ambiente do processo (bloco env do mcp.json do Cursor). Não passe senha nem outros segredos em argumentos de linha de comando.`,
    );
  }
  return valor;
}

function lerPorta(valor: string): number {
  const texto = valor.trim();
  if (!/^\d+$/.test(texto)) {
    throw new Error("ANTARES_DB_PORT deve ser um inteiro entre 1 e 65535.");
  }
  const porta = Number(texto);
  if (porta < 1 || porta > 65535) {
    throw new Error("ANTARES_DB_PORT deve ser um inteiro entre 1 e 65535.");
  }
  return porta;
}

function lerBooleano(valor: string | undefined, padrao: boolean, nome: string): boolean {
  if (valor === undefined || valor.trim() === "") return padrao;
  const normalizado = valor.trim().toLowerCase();
  if (normalizado === "1" || normalizado === "true" || normalizado === "yes" || normalizado === "sim") {
    return true;
  }
  if (
    normalizado === "0" ||
    normalizado === "false" ||
    normalizado === "no" ||
    normalizado === "nao" ||
    normalizado === "não"
  ) {
    return false;
  }
  throw new Error(`Valor inválido para ${nome}. Use true ou false.`);
}
