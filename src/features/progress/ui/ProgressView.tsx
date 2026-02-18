import { useEffect, useState } from "react";
import { createPracticeSession, getPracticeSessions, getProgressSummary } from "../api";
import { formatDuration } from "../service";
import type { PracticeSession, ProgressSummary } from "../types";

export function ProgressView() {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadAll();
  }, []);

  async function createSample() {
    setError("");
    setLoading(true);
    try {
      await createPracticeSession({
        category: "scales",
        targetType: "scale",
        bpm: 100,
        durationSec: 300,
        result: "success"
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  async function loadAll() {
    setError("");
    setLoading(true);
    try {
      const [sessionData, summaryData] = await Promise.all([
        getPracticeSessions(),
        getProgressSummary("week")
      ]);
      setSessions(sessionData.items);
      setSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h2>연습 분석</h2>
      <div className="row">
        <button onClick={() => void createSample()} disabled={loading}>샘플 세션 추가</button>
        <button onClick={() => void loadAll()} disabled={loading}>새로고침</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {summary ? (
        <p className="muted">
          이번 주 총 연습: {formatDuration(summary.totalPracticeSec)} / 세션 수: {summary.sessionCount}
        </p>
      ) : null}
      <ul className="list split-list">
        {sessions.map((s) => (
          <li key={s.id}>
            {s.category} {s.bpm}BPM {formatDuration(s.durationSec)}
          </li>
        ))}
      </ul>
    </section>
  );
}
