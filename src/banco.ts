import sql, { type Config, type ConnectionPool, type Request } from "mssql";
import { lerConfigBanco, type ConfigBanco } from "./config.js";
import { classificarValor } from "./parametros.js";
import { mensagemDe, redigirSegredo } from "./texto.js";
import type { Banco, Linha, ValorParametro } from "./tipos.js";

export interface BancoSessao extends Banco {
  encerrar(): Promise<void>;
}

export function criarBancoDoAmbiente(env: NodeJS.ProcessEnv = process.env): BancoSessao {
  let pool: ConnectionPool | undefined;
  let pendente: Promise<ConnectionPool> | undefined;

  function obterPool(config: ConfigBanco): Promise<ConnectionPool> {
    if (pool?.connected) return Promise.resolve(pool);
    if (!pendente) {
      const criado = new sql.ConnectionPool(paraConfigDriver(config));
      pendente = criado
        .connect()
        .then((conectado) => {
          pool = conectado;
          conectado.on("error", (falha: Error) => {
            console.error(`pool SQL Server: ${redigirSegredo(falha.message, [config.senha])}`);
          });
          return conectado;
        })
        .catch((falha: unknown) => {
          pendente = undefined;
          pool = undefined;
          throw falha;
        });
    }
    return pendente;
  }

  return {
    async consultar(sqlTexto, parametros, limite) {
      const config = lerConfigBanco(env);
      try {
        const conexao = await obterPool(config);
        return await lerLinhas(conexao, sqlTexto, parametros, limite);
      } catch (erro) {
        throw new Error(redigirSegredo(mensagemDe(erro), [config.senha]));
      }
    },
    async encerrar() {
      const atual = pool;
      pool = undefined;
      pendente = undefined;
      if (atual) await atual.close().catch(() => undefined);
    },
  };
}

function paraConfigDriver(config: ConfigBanco): Config {
  const driver: Config = {
    server: config.servidor,
    database: config.banco,
    user: config.usuario,
    password: config.senha,
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      encrypt: config.criptografia,
      trustServerCertificate: config.confiarCertificado,
      readOnlyIntent: true,
      appName: "mcp-global-antares",
    },
  };
  if (config.porta !== undefined) driver.port = config.porta;
  return driver;
}

function ligar(request: Request, parametros: Record<string, ValorParametro>): void {
  for (const [nome, valor] of Object.entries(parametros)) {
    const tipo = classificarValor(valor);
    if (tipo === "nvarchar") request.input(nome, sql.NVarChar(sql.MAX), valor);
    else if (tipo === "bit") request.input(nome, sql.Bit, valor);
    else if (tipo === "int") request.input(nome, sql.Int, valor);
    else if (tipo === "bigint") request.input(nome, sql.BigInt, valor);
    else request.input(nome, sql.Float, valor);
  }
}

async function lerLinhas(
  pool: ConnectionPool,
  sqlTexto: string,
  parametros: Record<string, ValorParametro>,
  limite: number,
): Promise<Linha[]> {
  const request = pool.request();
  ligar(request, parametros);
  request.stream = true;

  const linhas: Linha[] = [];
  let cancelou = false;

  await new Promise<void>((resolve, reject) => {
    let encerrado = false;
    const finalizar = (erro?: unknown) => {
      if (encerrado) return;
      encerrado = true;
      if (erro && !(cancelou && ehCancelamento(erro))) {
        reject(erro instanceof Error ? erro : new Error(mensagemDe(erro)));
        return;
      }
      resolve();
    };

    request.on("row", (row: unknown) => {
      if (linhas.length < limite) linhas.push(copiarLinha(row));
      if (linhas.length >= limite && !cancelou) {
        cancelou = true;
        try {
          request.cancel();
        } catch {
          finalizar();
        }
      }
    });
    request.on("error", (erro: unknown) => finalizar(erro));
    request.on("done", () => finalizar());
    request.query(sqlTexto).then(
      () => finalizar(),
      (erro: unknown) => finalizar(erro),
    );
  });

  return linhas.slice(0, limite);
}

function copiarLinha(row: unknown): Linha {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return { valor: row };
  return { ...(row as Linha) };
}

function ehCancelamento(erro: unknown): boolean {
  if (typeof erro === "object" && erro !== null && "code" in erro && erro.code === "ECANCEL") return true;
  return erro instanceof Error && erro.message === "Canceled.";
}
