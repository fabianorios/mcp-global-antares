# mcp-global-antares

Servidor MCP somente leitura para um consultor inspecionar o banco SQL Server do Apdata Global Antares a partir do Cursor. O processo fala pelo stdio. O Cursor inicia o comando; a senha fica em variável de ambiente.

Este recorte lista tabelas, descreve colunas e chaves, executa um único `SELECT` parametrizado e procura regras pelo catálogo do SQL Server. Não grava nada.

## O que este recorte não faz

- Não executa `INSERT`, `UPDATE`, `DELETE`, `MERGE`, DDL nem `EXEC`.
- Não extrai folha, contracheque nem cadastro de empregados. `consultar_somente_leitura` é para poucas linhas de dicionário e de regra.
- Não conhece os nomes físicos do dicionário Apdata. A busca de regras depende do esquema do cliente: até existir um banco de homologação confirmado, ela só pesquisa `sys.tables`, `sys.columns` e propriedades estendidas por padrões de nome (verba, regra, cálculo, transação, negócio, LPC).
- Não conecta em Oracle nem em outro SGBD. Só SQL Server, pelo pacote `mssql`.
- Não recebe senha em argumento de linha de comando.

## Login somente leitura

Peça ao DBA um login membro de `db_datareader` no banco do cliente, sem `db_datawriter`, `db_ddladmin` ou `db_owner`. Exemplo, executado por um administrador fora deste servidor:

```sql
CREATE LOGIN consultor_leitura WITH PASSWORD = '<senha>';
USE <banco_antares>;
CREATE USER consultor_leitura FOR LOGIN consultor_leitura;
ALTER ROLE db_datareader ADD MEMBER consultor_leitura;
```

`db_datareader` lê todas as tabelas de usuário, inclusive folha, se elas existirem. O guard deste servidor barra comando que não seja um único `SELECT` ou `WITH…SELECT`, mas não sabe quais tabelas são de folha enquanto o esquema não estiver confirmado. Use `consultar_somente_leitura` só para dicionário e regras.

A opção `readOnlyIntent` pede uma réplica de leitura quando o servidor participa de um availability group. Quem impede a escrita é o login, junto com o guard.

## Variáveis de ambiente

A conexão sai só destas variáveis. Não as coloque em `args` nem no repositório.

| Variável | Obrigatória | Padrão | Uso |
| --- | --- | --- | --- |
| `ANTARES_DB_SERVER` | sim | | Host, ou `host\instancia` |
| `ANTARES_DB_PORT` | não | `1433` | Porta. Se o servidor for `host\instancia`, o driver resolve a porta pelo SQL Server Browser e ignora esta variável. Para fixar a porta, informe só o host |
| `ANTARES_DB_DATABASE` | sim | | Nome do banco |
| `ANTARES_DB_USER` | sim | | Login de leitura |
| `ANTARES_DB_PASSWORD` | sim | | Senha. Só no ambiente do processo |
| `ANTARES_DB_ENCRYPT` | não | `true` | TLS. Use `false` só em SQL Server sem criptografia |
| `ANTARES_DB_TRUST_SERVER_CERTIFICATE` | não | `false` | `true` aceita certificado sem validar a cadeia |

Os valores `true`, `false`, `1`, `0`, `sim` e `nao` valem para as duas opções booleanas. Há um modelo sem segredo em `.env.example`.

## Cursor

Na raiz do repositório:

```bash
npm install
npm run build
```

No `mcp.json` do Cursor, o bloco `env` é local. Não commite a senha.

```json
{
  "mcpServers": {
    "global-antares": {
      "command": "node",
      "args": ["CAMINHO/mcp-global-antares/dist/index.js"],
      "env": {
        "ANTARES_DB_SERVER": "servidor.exemplo",
        "ANTARES_DB_PORT": "1433",
        "ANTARES_DB_DATABASE": "nome_do_banco",
        "ANTARES_DB_USER": "consultor_leitura",
        "ANTARES_DB_PASSWORD": "definir-no-mcp-json-local",
        "ANTARES_DB_ENCRYPT": "true",
        "ANTARES_DB_TRUST_SERVER_CERTIFICATE": "false"
      }
    }
  }
}
```

Stdout é o canal do protocolo. O servidor escreve diagnóstico só em stderr.

## Ferramentas

| Ferramenta | Função |
| --- | --- |
| `listar_tabelas` | Tabelas de usuário (`sys.tables`), com filtro opcional por parte do nome. Padrão de 200 linhas, teto 200 |
| `descrever_tabela` | Colunas, tipo, tamanho, precisão, nulidade, identidade, chave primária, chaves únicas e estrangeiras |
| `consultar_somente_leitura` | Um `SELECT` ou `WITH…SELECT` parametrizado. Padrão de 50 linhas, teto 200. Para dicionário e regras |
| `localizar_regras` | Procura verba, regra, cálculo, transação, negócio e LPC no catálogo |

Os valores de `consultar_somente_leitura` vão em `parametros` (`{ "id": 10 }` para `@id`). O texto SQL não recebe esses valores por concatenação.

O guard rejeita outro comando, mais de um comando, `SELECT INTO`, `EXEC` e funções de acesso externo como `OPENROWSET`. Uma palavra de escrita usada como nome sem colchetes também é rejeitada; nesse caso use `[nome]`. Comentário no meio de uma palavra (`SEL/**/ECT`) é rejeitado.

## Dicionário ainda não confirmado

`localizar_regras` não consulta uma tabela física da Apdata. Este repositório não documenta esse dicionário, e a busca fica no catálogo até alguém confirmar o esquema num banco de homologação.

O ponto de extensão está em `src/dicionario-confirmado.ts`. A lista começa vazia. Um item novo precisa da fonte que confirmou o nome e de um único `SELECT`. O servidor só o executa se o guard aceitar a consulta e se a tabela existir no catálogo da conexão.

## Desenvolvimento

Exige Node.js 20 ou superior. `npm test` cobre o guard e as ferramentas com um banco falso. A integração contínua não abre conexão com o Antares.

```bash
npm test
npm run build
```
