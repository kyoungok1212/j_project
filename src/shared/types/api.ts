export interface ApiMeta {
  requestId: string;
  timestamp: string;
  pagination?: {
    limit: number;
    nextCursor: string | null;
  };
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: ApiMeta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

