export interface Env {
  DB: D1Database;
}

export interface ApiMeta {
  requestId: string;
  timestamp: string;
  pagination?: {
    limit: number;
    nextCursor: string | null;
  };
}

