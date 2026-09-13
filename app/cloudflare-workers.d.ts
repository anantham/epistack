// Minimal Cloudflare ambient types for the `tsc` gate. The full
// `@cloudflare/workers-types` package also narrows `Response.json()` to
// `unknown`, which is a larger typing migration; adopting it is a follow-up.

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    LYRA_PUBLIC_GATEWAY_URL?: string;
    LYRA_API_KEY?: string;
    OPENROUTER_API_KEY?: string;
    JOBS_TICK_TOKEN?: string;
  };
}