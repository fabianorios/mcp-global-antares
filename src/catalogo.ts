import { paraLikeContem } from "./parametros.js";
import type { ValorParametro } from "./tipos.js";

export interface ConsultaCatalogo {
  sql: string;
  parametros: Record<string, ValorParametro>;
}

export const CATEGORIAS_REGRA = ["verba", "regra", "calculo", "transacao", "lpc", "negocio"] as const;
export type CategoriaRegra = (typeof CATEGORIAS_REGRA)[number];

export const PADROES_POR_CATEGORIA: Record<CategoriaRegra, readonly string[]> = {
  verba: ["%verba%"],
  regra: ["%regra%"],
  calculo: ["%calcul%", "%cálcul%"],
  transacao: ["%transa%"],
  lpc: ["%lpc%"],
  negocio: ["%negocio%", "%negócio%"],
};

export function consultaListarTabelas(filtro: string | undefined): ConsultaCatalogo {
  const base = `
    SELECT s.name AS esquema, t.name AS tabela
    FROM sys.tables AS t
    INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0
  `;
  if (filtro !== undefined && filtro.trim() !== "") {
    return {
      sql: `${base} AND t.name LIKE @filtro ESCAPE '\\' ORDER BY s.name, t.name`,
      parametros: { filtro: paraLikeContem(filtro.trim()) },
    };
  }
  return {
    sql: `${base} ORDER BY s.name, t.name`,
    parametros: {},
  };
}

export function consultaEncontrarTabela(tabela: string, esquema: string | undefined): ConsultaCatalogo {
  return {
    sql: `
      SELECT s.name AS esquema, t.name AS tabela
      FROM sys.tables AS t
      INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
      WHERE t.is_ms_shipped = 0
        AND t.name = @tabela
        AND (@esquema IS NULL OR s.name = @esquema)
      ORDER BY s.name
    `,
    parametros: {
      tabela,
      esquema: esquema ?? null,
    },
  };
}

export function consultaDescreverTabela(): string {
  return `
    SELECT
      c.column_id AS ordem,
      c.name AS coluna,
      ty.name AS tipo,
      c.max_length AS tamanho_bytes,
      c.precision AS precisao,
      c.scale AS escala,
      c.is_nullable AS aceita_nulo,
      c.is_identity AS identidade,
      CASE WHEN pk.column_id IS NOT NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS chave_primaria,
      pk.nome AS nome_chave_primaria,
      STUFF((
        SELECT ', ' + i.name
        FROM sys.indexes AS i
        INNER JOIN sys.index_columns AS ic
          ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        WHERE i.is_unique = 1
          AND i.is_primary_key = 0
          AND ic.object_id = c.object_id
          AND ic.column_id = c.column_id
        ORDER BY i.name
        FOR XML PATH('')
      ), 1, 2, '') AS chaves_unicas,
      STUFF((
        SELECT ', ' + fk.name + ' -> ' + rs.name + '.' + rt.name + '.' + rc.name
        FROM sys.foreign_key_columns AS fkc
        INNER JOIN sys.foreign_keys AS fk ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.tables AS rt ON rt.object_id = fkc.referenced_object_id
        INNER JOIN sys.schemas AS rs ON rs.schema_id = rt.schema_id
        INNER JOIN sys.columns AS rc
          ON rc.object_id = fkc.referenced_object_id
         AND rc.column_id = fkc.referenced_column_id
        WHERE fkc.parent_object_id = c.object_id
          AND fkc.parent_column_id = c.column_id
        ORDER BY fk.name
        FOR XML PATH('')
      ), 1, 2, '') AS chaves_estrangeiras
    FROM sys.columns AS c
    INNER JOIN sys.tables AS t ON t.object_id = c.object_id
    INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
    INNER JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN (
      SELECT ic.object_id, ic.column_id, i.name AS nome
      FROM sys.indexes AS i
      INNER JOIN sys.index_columns AS ic
        ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      WHERE i.is_primary_key = 1
    ) AS pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
    WHERE s.name = @esquema AND t.name = @tabela
    ORDER BY c.column_id
  `;
}

export function consultaTabelaExiste(): string {
  return `
    SELECT s.name AS esquema, t.name AS tabela
    FROM sys.tables AS t
    INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
    WHERE s.name = @esquema AND t.name = @tabela
  `;
}

export function montarPadroes(categoria: CategoriaRegra | undefined, termo: string | undefined): string[] {
  const base = categoria
    ? [...PADROES_POR_CATEGORIA[categoria]]
    : CATEGORIAS_REGRA.flatMap((item) => [...PADROES_POR_CATEGORIA[item]]);
  if (termo !== undefined && termo.trim() !== "") {
    base.push(paraLikeContem(termo.trim()));
  }
  return base;
}

export function consultaLocalizar(padroes: readonly string[]): ConsultaCatalogo {
  const likes = (expressao: string) => padroes.map((_, indice) => `${expressao} LIKE @p${indice}`).join(" OR ");
  const parametros: Record<string, ValorParametro> = {};
  padroes.forEach((padrao, indice) => {
    parametros[`p${indice}`] = padrao;
  });

  const sql = `
    SELECT
      achados.origem,
      achados.esquema,
      achados.tabela,
      achados.coluna,
      achados.propriedade,
      achados.trecho
    FROM (
      SELECT
        CAST('tabela' AS nvarchar(20)) AS origem,
        CAST(s.name AS nvarchar(128)) AS esquema,
        CAST(t.name AS nvarchar(128)) AS tabela,
        CAST(NULL AS nvarchar(128)) AS coluna,
        CAST(NULL AS nvarchar(128)) AS propriedade,
        CAST(NULL AS nvarchar(200)) AS trecho
      FROM sys.tables AS t
      INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
      WHERE t.is_ms_shipped = 0
        AND (${likes("t.name")})

      UNION ALL

      SELECT
        CAST('coluna' AS nvarchar(20)),
        CAST(s.name AS nvarchar(128)),
        CAST(t.name AS nvarchar(128)),
        CAST(c.name AS nvarchar(128)),
        CAST(NULL AS nvarchar(128)),
        CAST(NULL AS nvarchar(200))
      FROM sys.columns AS c
      INNER JOIN sys.tables AS t ON t.object_id = c.object_id
      INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
      WHERE t.is_ms_shipped = 0
        AND (${likes("c.name")})

      UNION ALL

      SELECT
        CAST('propriedade' AS nvarchar(20)),
        CAST(s.name AS nvarchar(128)),
        CAST(t.name AS nvarchar(128)),
        CAST(col.name AS nvarchar(128)),
        CAST(ep.name AS nvarchar(128)),
        LEFT(TRY_CONVERT(nvarchar(4000), ep.value), 200)
      FROM sys.extended_properties AS ep
      INNER JOIN sys.tables AS t ON t.object_id = ep.major_id AND ep.class = 1
      INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
      LEFT JOIN sys.columns AS col
        ON col.object_id = ep.major_id
       AND col.column_id = ep.minor_id
       AND ep.minor_id > 0
      WHERE t.is_ms_shipped = 0
        AND (
          ${likes("ep.name")}
          OR ${likes("TRY_CONVERT(nvarchar(4000), ep.value)")}
        )
    ) AS achados
    ORDER BY achados.origem, achados.esquema, achados.tabela, achados.coluna
  `;

  return { sql, parametros };
}
