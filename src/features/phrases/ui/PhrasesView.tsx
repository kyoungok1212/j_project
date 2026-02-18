import { useEffect, useState } from "react";
import { createPhrase, getPhrases } from "../api";
import { buildDefaultPhrase } from "../service";
import type { Phrase } from "../types";

export function PhrasesView() {
  const [items, setItems] = useState<Phrase[]>([]);
  const [title, setTitle] = useState("A 마이너 릭");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const data = await getPhrases();
      setItems(data.items);
      setStatus(`${data.items.length}개 프레이즈를 불러왔습니다.`);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    setError("");
    setStatus("");
    setLoading(true);
    try {
      const payload = buildDefaultPhrase(title);
      const created = await createPhrase(payload);
      setStatus(`생성 완료: ${created.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h2>프레이즈 작업실</h2>
      <div className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="프레이즈 제목" />
        <button onClick={() => void create()} disabled={loading}>생성</button>
        <button onClick={() => void load()} disabled={loading}>새로고침</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {status ? <p className="ok">{status}</p> : null}
      <ul className="list split-list">
        {items.map((phrase) => (
          <li key={phrase.id}>
            {phrase.title} / {phrase.musicalKey} / {phrase.bpm} BPM
          </li>
        ))}
      </ul>
    </section>
  );
}
