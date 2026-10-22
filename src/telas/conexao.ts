import { criarBancoDoAmbiente } from "../banco.js";
import { consultarSomenteLeitura } from "../ferramentas.js";
import { mensagemDe, redigirSegredo } from "../texto.js";

export interface ResultadoConexao {
  ok: boolean;
  mensagem: string;
}

/** Usa o mesmo pool e o guard: só um SELECT 1, sem caminho de escrita. */
export async function testarConexaoSalva(env: NodeJS.ProcessEnv): Promise<ResultadoConexao> {
  const senha = env.ANTARES_DB_PASSWORD ?? "";
  const banco = criarBancoDoAmbiente(env);
  try {
    const resultado = await consultarSomenteLeitura(banco, { sql: "SELECT 1 AS conexao", limite: 1 });
    if (resultado.erro) return { ok: false, mensagem: redigirSegredo(resultado.texto, [senha]) };
    return { ok: true, mensagem: "Conexão estabelecida. O login conseguiu executar um SELECT de teste." };
  } catch (erro) {
    return { ok: false, mensagem: redigirSegredo(mensagemDe(erro), [senha]) };
  } finally {
    await banco.encerrar();
  }
}
