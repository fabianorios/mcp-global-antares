const telas = ["configuracao", "solicitacao", "retorno"];

function mostrar(nome) {
  const ativa = telas.includes(nome) ? nome : "configuracao";
  for (const id of telas) {
    const secao = document.getElementById(`tela-${id}`);
    if (secao) secao.hidden = id !== ativa;
    const link = document.querySelector(`[data-navegar="${id}"]`);
    if (link) link.setAttribute("aria-current", id === ativa ? "page" : "false");
  }
}

function telaPeloHash() {
  return location.hash.replace("#", "");
}

window.addEventListener("hashchange", () => mostrar(telaPeloHash()));

function consultaPodeSerEnviada(sql) {
  const texto = String(sql ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/;\s*$/, "")
    .trim();
  if (!texto) return false;
  const semLiteral = texto
    .replace(/N?'(?:''|[^'])*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  if (semLiteral.includes(";")) return false;
  if (!/^(select|with)\b/i.test(semLiteral)) return false;
  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|into|grant|revoke)\b/i.test(semLiteral)) {
    return false;
  }
  return true;
}

window.consultaPodeSerEnviada = consultaPodeSerEnviada;

function acaoSelecionada() {
  const campos = document.querySelectorAll('input[name="acao"]');
  for (const campo of campos) {
    if (campo.checked) return campo.value;
  }
  return "listar";
}

function atualizarCampos() {
  const acao = acaoSelecionada();
  alternar("campos-listar", acao === "listar");
  alternar("campos-descrever", acao === "descrever");
  alternar("campos-localizar", acao === "localizar");
  alternar("campos-consultar", acao === "consultar");
  atualizarEnvio();
}

function alternar(id, visivel) {
  const elemento = document.getElementById(id);
  if (elemento) elemento.hidden = !visivel;
}

function atualizarEnvio() {
  const bloqueio = document.getElementById("bloqueio-envio");
  const botao = document.getElementById("executar");
  const sql = document.getElementById("sql");
  const consultar = acaoSelecionada() === "consultar";
  const texto = sql ? sql.value : "";
  const bloqueado = consultar && texto.trim() !== "" && !consultaPodeSerEnviada(texto);
  if (botao) botao.disabled = bloqueado;
  if (bloqueio) bloqueio.hidden = !bloqueado;
}

async function lerJson(resposta) {
  const texto = await resposta.text();
  if (!texto) return {};
  return JSON.parse(texto);
}

function preencherConfiguracao(dados) {
  definir("servidor", dados.ANTARES_DB_SERVER);
  definir("porta", dados.ANTARES_DB_PORT || "1433");
  definir("banco", dados.ANTARES_DB_DATABASE);
  definir("usuario", dados.ANTARES_DB_USER);
  const senha = document.getElementById("senha");
  if (senha) senha.value = "";
  const nota = document.getElementById("senha-salva");
  if (nota) nota.hidden = !dados.senhaDefinida;
  definirSelecao("criptografia", dados.ANTARES_DB_ENCRYPT === "false" ? "false" : "true");
  definirSelecao("certificado", dados.ANTARES_DB_TRUST_SERVER_CERTIFICATE === "true" ? "true" : "false");
}

function definir(id, valor) {
  const campo = document.getElementById(id);
  if (campo && "value" in campo) campo.value = valor ?? "";
}

function definirSelecao(id, valor) {
  const campo = document.getElementById(id);
  if (campo) campo.value = valor;
}

function corpoConfiguracao() {
  return {
    ANTARES_DB_SERVER: valor("servidor"),
    ANTARES_DB_PORT: valor("porta"),
    ANTARES_DB_DATABASE: valor("banco"),
    ANTARES_DB_USER: valor("usuario"),
    ANTARES_DB_PASSWORD: valor("senha"),
    ANTARES_DB_ENCRYPT: valor("criptografia"),
    ANTARES_DB_TRUST_SERVER_CERTIFICATE: valor("certificado"),
  };
}

function valor(id) {
  const campo = document.getElementById(id);
  return campo && "value" in campo ? campo.value : "";
}

function marcarStatus(texto, ok) {
  const status = document.getElementById("status-configuracao");
  if (!status) return;
  status.textContent = texto;
  if (ok === undefined) delete status.dataset.ok;
  else status.dataset.ok = ok ? "sim" : "nao";
}

async function salvarConfiguracao() {
  const resposta = await fetch("/api/configuracao", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpoConfiguracao()),
  });
  const dados = await lerJson(resposta);
  if (!resposta.ok) throw new Error(dados.mensagem || "Não foi possível salvar.");
  preencherConfiguracao(dados);
  return dados;
}

function mostrarRetorno(corpo) {
  const erro = document.getElementById("estado-erro");
  const vazio = document.getElementById("estado-vazio");
  const inicial = document.getElementById("estado-inicial");
  const moldura = document.getElementById("moldura-grade");
  const aviso = document.getElementById("aviso-retorno");
  const exemplo = document.getElementById("aviso-exemplo");
  const grade = document.getElementById("grade");
  if (inicial) inicial.hidden = true;
  if (exemplo) exemplo.hidden = !corpo.exemplo;
  if (aviso) {
    const texto = corpo.aviso || (!corpo.erro ? corpo.mensagem : "");
    aviso.hidden = !texto;
    aviso.textContent = texto || "";
  }
  if (corpo.erro) {
    if (erro) {
      erro.hidden = false;
      erro.textContent = corpo.mensagem || "Falha ao executar a solicitação.";
    }
    if (vazio) vazio.hidden = true;
    if (moldura) moldura.hidden = true;
    return;
  }
  if (erro) erro.hidden = true;
  const linhas = Array.isArray(corpo.linhas) ? corpo.linhas : [];
  if (linhas.length === 0) {
    if (vazio) vazio.hidden = false;
    if (moldura) moldura.hidden = true;
    return;
  }
  if (vazio) vazio.hidden = true;
  if (moldura) moldura.hidden = false;
  desenharGrade(grade, corpo.colunas || [], linhas);
}

function desenharGrade(grade, colunas, linhas) {
  if (!grade) return;
  const cabecalho = grade.querySelector("thead");
  const corpo = grade.querySelector("tbody");
  if (!cabecalho || !corpo) return;
  cabecalho.replaceChildren();
  corpo.replaceChildren();
  const nomes = colunas.length > 0 ? colunas : Object.keys(linhas[0] || {});
  const trCabeca = document.createElement("tr");
  for (const nome of nomes) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = nome;
    trCabeca.appendChild(th);
  }
  cabecalho.appendChild(trCabeca);
  for (const linha of linhas) {
    const tr = document.createElement("tr");
    for (const nome of nomes) {
      const td = document.createElement("td");
      const valor = linha[nome];
      td.textContent = valor == null ? "" : typeof valor === "object" ? JSON.stringify(valor) : String(valor);
      tr.appendChild(td);
    }
    corpo.appendChild(tr);
  }
}

async function enviarSolicitacao() {
  const acao = acaoSelecionada();
  const corpo = { acao };
  if (acao === "listar") corpo.filtro = valor("filtro");
  if (acao === "descrever") {
    corpo.tabela = valor("tabela");
    corpo.esquema = valor("esquema");
  }
  if (acao === "localizar") {
    corpo.categoria = valor("categoria");
    corpo.termo = valor("termo");
  }
  if (acao === "consultar") {
    corpo.sql = valor("sql");
    corpo.limite = Number(valor("limite") || "50");
    const parametros = valor("parametros").trim();
    if (parametros) {
      try {
        corpo.parametros = JSON.parse(parametros);
      } catch {
        location.hash = "#retorno";
        mostrarRetorno({ erro: true, mensagem: "Os parâmetros precisam ser um JSON. Exemplo: { \"id\": 10 }.", exemplo: false });
        return;
      }
    }
  }
  const resposta = await fetch("/api/solicitacao", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const dados = await lerJson(resposta);
  location.hash = "#retorno";
  mostrarRetorno(dados);
}

function ligar() {
  mostrar(telaPeloHash());
  document.querySelectorAll('input[name="acao"]').forEach((campo) => {
    campo.addEventListener("change", atualizarCampos);
  });
  const sql = document.getElementById("sql");
  if (sql) sql.addEventListener("input", atualizarEnvio);
  atualizarCampos();

  const formConfig = document.getElementById("form-configuracao");
  if (formConfig) {
    formConfig.addEventListener("submit", (evento) => {
      evento.preventDefault();
      marcarStatus("Salvando…");
      salvarConfiguracao()
        .then(() => marcarStatus("Configuração salva neste computador.", true))
        .catch((erro) => marcarStatus(erro instanceof Error ? erro.message : "Não foi possível salvar.", false));
    });
  }

  const testar = document.getElementById("testar-conexao");
  if (testar) {
    testar.addEventListener("click", () => {
      marcarStatus("Testando conexão…");
      salvarConfiguracao()
        .then(() => fetch("/api/conexao/testar", { method: "POST" }))
        .then((resposta) => lerJson(resposta).then((dados) => ({ ok: resposta.ok && dados.ok === true, dados })))
        .then(({ ok, dados }) => marcarStatus(dados.mensagem || (ok ? "Conexão estabelecida." : "Falha na conexão."), ok))
        .catch((erro) => marcarStatus(erro instanceof Error ? erro.message : "Falha na conexão.", false));
    });
  }

  const formSolicitacao = document.getElementById("form-solicitacao");
  if (formSolicitacao) {
    formSolicitacao.addEventListener("submit", (evento) => {
      evento.preventDefault();
      if (acaoSelecionada() === "consultar" && !consultaPodeSerEnviada(valor("sql"))) {
        atualizarEnvio();
        return;
      }
      enviarSolicitacao().catch((erro) => {
        location.hash = "#retorno";
        mostrarRetorno({
          erro: true,
          mensagem: erro instanceof Error ? erro.message : "Falha ao executar a solicitação.",
          exemplo: false,
        });
      });
    });
  }

  if (typeof fetch === "function") {
    fetch("/api/configuracao")
      .then((resposta) => (resposta.ok ? lerJson(resposta) : null))
      .then((dados) => {
        if (dados) preencherConfiguracao(dados);
      })
      .catch(() => undefined);
  }
}

ligar();
