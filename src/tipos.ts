export type ValorParametro = string | number | boolean | null;

export type Linha = Record<string, unknown>;

export interface Banco {
  consultar(
    sql: string,
    parametros: Record<string, ValorParametro>,
    limite: number,
  ): Promise<Linha[]>;
}

export interface ResultadoFerramenta {
  texto: string;
  erro: boolean;
}
