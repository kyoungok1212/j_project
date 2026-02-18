export interface PracticeSession {
  id: string;
  userId: string;
  category: string;
  targetType: string;
  targetId: string | null;
  bpm: number;
  durationSec: number;
  result: string;
  createdAt: string;
}

export interface PracticeSessionListResponse {
  items: PracticeSession[];
}

export interface ProgressSummary {
  period: string;
  totalPracticeSec: number;
  sessionCount: number;
  maxStableBpmByCategory: Record<string, number>;
}

