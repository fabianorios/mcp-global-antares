import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarBancoDoAmbiente, type BancoSessao } from "../banco.js";
import type { Banco } from "../tipos.js";
import {
  ambienteDaConexao,
  gravarConexao,
  lerConexao,
  visaoPublica,
} from "./arquivos-config.js";
import { criarBancoFixture } from "./banco-fixture.js";
import { testarConexaoSalva, type ResultadoConexao } from "./conexao.js";
import { executarSolicitacao } from "./solicitacao.js";

const PUBLICO = fileURLToPath(new URL("./publico/", import.meta.url));
const LIMITE_CORPO = 32_000;

const ESTATICOS: Record<string, { arquivo: string; tipo: string }> = {
  "/": { arquivo: "index.html", tipo: "text/html; charset=utf-8" },
  "/app.css": { arquivo: "app.css", tipo: "text/css; charset=utf-8" },
  "/app.js": { arquivo: "app.js", tipo: "text/javascript; charset=utf-8" },
};

export interface OpcoesTelas {
  diretorioDados: string;
  banco?: Banco;
  exemplo?: boolean;
  testarConexao?: (env: NodeJS.ProcessEnv) => Promise<ResultadoConexao>;
  registrar?: (mensagem: string) => void;
}

export interface AplicacaoTelas {
  escutar(porta: number): Promise<number>;
  fechar(): Promise<void>;
}

export function criarAplicacao(opcoes: OpcoesTelas): AplicacaoTelas {
  const exemplo = opcoes.exemplo === true;
  const bancoFixo = opcoes.banco ?? (exemplo ? criarBancoFixture() : undefined);
  const testar = opcoes.testarConexao ?? testarConexaoSalva;
  const registrar = opcoes.registrar ?? ((mensagem: string) => console.error(mensagem));
  let sessao: BancoSessao | undefined;
  let assinatura = "";

  const servidor = createServer((req, res) => {
    void atender(req, res).catch((erro: unknown) => {
      if (res.headersSent) return;
      if (erro instanceof ErroHttp) {
        enviarJson(res, erro.status, { erro: true, mensagem: erro.message });
        return;
      }
      registrar(`erro ${req.method ?? "?"} ${caminhoDe(req)}`);
      enviarJson(res, 500, { erro: true, mensagem: "Falha interna." });
    });
  });

  return {
    escutar(porta: number) {
      return new Promise((resolve, reject) => {
        servidor.once("error", reject);
        servidor.listen(porta, "127.0.0.1", () => {
          const endereco = servidor.address();
          if (!endereco || typeof endereco === "string") {
            reject(new Error("Porta indisponível."));
            return;
          }
          resolve(endereco.port);
        });
      });
    },
    async fechar() {
      await sessao?.encerrar();
      sessao = undefined;
      await new Promise<void>((resolve, reject) => {
        servidor.close((erro) => (erro ? reject(erro) : resolve()));
      });
    },
  };

  async function bancoDaSolicitacao(): Promise<Banco> {
    if (bancoFixo) return bancoFixo;
    const registro = await lerConexao(opcoes.diretorioDados);
    const chave = JSON.stringify(registro);
    if (!sessao || chave !== assinatura) {
      await sessao?.encerrar();
      assinatura = chave;
      sessao = criarBancoDoAmbiente(ambienteDaConexao(registro));
    }
    return sessao;
  }

  async function atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!ehLoopback(req.socket.remoteAddress)) {
      enviarJson(res, 403, { erro: true, mensagem: "As telas só atendem localhost." });
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    registrar(`${req.method ?? "GET"} ${url.pathname}`);

    if (req.method === "GET" && ESTATICOS[url.pathname]) {
      const estatico = ESTATICOS[url.pathname];
      if (!estatico) return;
      const conteudo = await readFile(join(PUBLICO, estatico.arquivo));
      res.writeHead(200, {
        "content-type": estatico.tipo,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(conteudo);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/configuracao") {
      enviarJson(res, 200, visaoPublica(await lerConexao(opcoes.diretorioDados)));
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/configuracao") {
      const json = await jsonDoPedido(req);
      const registro = await gravarConexao(opcoes.diretorioDados, json);
      enviarJson(res, 200, visaoPublica(registro));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/conexao/testar") {
      const registro = await lerConexao(opcoes.diretorioDados);
      const resultado = await testar(ambienteDaConexao(registro));
      enviarJson(res, resultado.ok ? 200 : 503, resultado);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/solicitacao") {
      const json = await jsonDoPedido(req);
      const resultado = await executarSolicitacao(await bancoDaSolicitacao(), json, exemplo);
      enviarJson(res, resultado.status, resultado.corpo);
      return;
    }

    enviarJson(res, 404, { erro: true, mensagem: "Caminho não encontrado." });
  }
}

async function jsonDoPedido(req: IncomingMessage): Promise<unknown> {
  const tipo = req.headers["content-type"] ?? "";
  if (!tipo.includes("application/json")) {
    throw new ErroHttp(415, "Envie JSON.");
  }
  const texto = await lerCorpo(req);
  if (texto.trim() === "") return {};
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw new ErroHttp(400, "JSON inválido.");
  }
}

function lerCorpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let tamanho = 0;
    req.on("data", (pedaco: Buffer) => {
      tamanho += pedaco.length;
      if (tamanho > LIMITE_CORPO) {
        reject(new ErroHttp(413, "Pedido grande demais."));
        req.destroy();
        return;
      }
      partes.push(pedaco);
    });
    req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
    req.on("error", reject);
  });
}

function enviarJson(res: ServerResponse, status: number, corpo: unknown): void {
  const json = JSON.stringify(corpo);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(json);
}

function caminhoDe(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

function ehLoopback(endereco: string | undefined): boolean {
  return endereco === "127.0.0.1" || endereco === "::1" || endereco === "::ffff:127.0.0.1";
}

class ErroHttp extends Error {
  constructor(
    public status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}
