declare module "mssql" {
  import { EventEmitter } from "node:events";

  export interface Config {
    server: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    connectionTimeout?: number;
    requestTimeout?: number;
    pool?: {
      max?: number;
      min?: number;
      idleTimeoutMillis?: number;
    };
    options?: {
      encrypt?: boolean;
      trustServerCertificate?: boolean;
      readOnlyIntent?: boolean;
      appName?: string;
      instanceName?: string;
    };
  }

  export interface ISqlType {
    type: unknown;
    length?: number;
  }

  export interface ISqlTypeFactory {
    (...args: unknown[]): ISqlType;
  }

  export interface IResult<T> {
    recordset?: T[];
    recordsets?: T[][];
    rowsAffected?: number[];
  }

  export class Request extends EventEmitter {
    stream: boolean | null;
    input(name: string, type: ISqlTypeFactory | ISqlType, value: unknown): this;
    query<T = Record<string, unknown>>(command: string): Promise<IResult<T>>;
    cancel(): boolean;
  }

  export class ConnectionPool extends EventEmitter {
    constructor(config: Config);
    connect(): Promise<ConnectionPool>;
    close(): Promise<void>;
    request(): Request;
    readonly connected: boolean;
  }

  export const Int: ISqlTypeFactory;
  export const BigInt: ISqlTypeFactory;
  export const Float: ISqlTypeFactory;
  export const Bit: ISqlTypeFactory;
  export const NVarChar: ISqlTypeFactory;
  export const MAX: number;

  const sql: {
    ConnectionPool: typeof ConnectionPool;
    Int: ISqlTypeFactory;
    BigInt: ISqlTypeFactory;
    Float: ISqlTypeFactory;
    Bit: ISqlTypeFactory;
    NVarChar: ISqlTypeFactory;
    MAX: number;
  };

  export default sql;
}
