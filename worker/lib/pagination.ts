export interface CursorPayload {
  sortValue: string;
  id: string;
}

export function decodeCursor(cursor: string | null): CursorPayload | null {
  if (!cursor) return null;
  try {
    const decoded = atob(cursor);
    const payload = JSON.parse(decoded) as CursorPayload;
    if (!payload.id || !payload.sortValue) return null;
    return payload;
  } catch {
    return null;
  }
}

export function encodeCursor(payload: CursorPayload | null): string | null {
  if (!payload) return null;
  return btoa(JSON.stringify(payload));
}

