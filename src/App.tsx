import { useMemo, useState } from "react";
import { ChordsView } from "./features/chords/ui/ChordsView";
import { ScalesView } from "./features/scales/ui/ScalesView";
import { PhrasesView } from "./features/phrases/ui/PhrasesView";
import { ProgressView } from "./features/progress/ui/ProgressView";
import { TopMetronomeBar } from "./features/metronome/ui/TopMetronomeBar";
import { DrumMachineView } from "./features/drums/ui/DrumMachineView";
import { SheetPlayView } from "./features/drums/ui/SheetPlayView";
import { DrumSettingsView } from "./features/drums/ui/DrumSettingsView";

type PracticeMode = "guitar" | "drums";
type MenuKey = "chords" | "scales" | "phrases" | "progress";
type DrumMenuKey = "drum_machine" | "sheet_play" | "drum_settings";

const MENUS: Array<{ key: MenuKey; label: string; cue: string; description: string }> = [
  { key: "scales", label: "스케일", cue: "스케일", description: "스케일 포지션과 지판 음을 연습합니다." },
  { key: "chords", label: "코드", cue: "코드", description: "코드 보이싱과 운지 패턴을 확인합니다." },
  { key: "phrases", label: "프레이즈", cue: "프레이즈", description: "프레이즈를 만들고 반복 연습합니다." },
  { key: "progress", label: "연습기록", cue: "연습기록", description: "연습 세션 기록과 통계를 확인합니다." }
];
const PRACTICE_MODES: Array<{ key: PracticeMode; label: string }> = [
  { key: "guitar", label: "기타 연습" },
  { key: "drums", label: "드럼 연습" }
];
const DRUM_MENUS: Array<{ key: DrumMenuKey; label: string }> = [
  { key: "drum_machine", label: "드럼 머신" },
  { key: "sheet_play", label: "악보만들기" },
  { key: "drum_settings", label: "드럼 설정" }
];

export function App() {
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("guitar");
  const [menu, setMenu] = useState<MenuKey>("scales");
  const [drumMenu, setDrumMenu] = useState<DrumMenuKey>("drum_machine");
  const forceDrumMachineFourBeats = practiceMode === "drums" && drumMenu === "drum_machine";

  const activeView = useMemo(() => {
    switch (menu) {
      case "chords":
        return <ChordsView />;
      case "scales":
        return <ScalesView />;
      case "phrases":
        return <PhrasesView />;
      case "progress":
        return <ProgressView />;
      default:
        return <ScalesView />;
    }
  }, [menu]);

  const activeDrumView = useMemo(() => {
    switch (drumMenu) {
      case "drum_machine":
        return <DrumMachineView />;
      case "sheet_play":
        return <SheetPlayView />;
      case "drum_settings":
        return <DrumSettingsView />;
      default:
        return <DrumMachineView />;
    }
  }, [drumMenu]);

  return (
    <main className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="grain" />

      <header className="hero">
        <div className="hero-top-row">
          <nav className="practice-mode-bar" aria-label="연습 모드 선택">
            {PRACTICE_MODES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`practice-mode-btn ${practiceMode === item.key ? "active" : ""}`}
                aria-pressed={practiceMode === item.key}
                onClick={() => setPracticeMode(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="hero-title-row">
            <h1 className="title">J.Guitar and Drum Practice App</h1>
            <p className="eyebrow">FOR TEAM.PENTATONIC</p>
          </div>
        </div>
      </header>

      {practiceMode === "guitar" ? (
        <div className="studio-grid">
          <aside className="control-stack">
            <TopMetronomeBar forceFourBeats={false} />
            <nav className="menu-bar" aria-label="기타 연습 메뉴">
              {MENUS.map((item, idx) => (
                <button
                  key={item.key}
                  className={`menu-btn ${menu === item.key ? "active" : ""}`}
                  onClick={() => setMenu(item.key)}
                >
                  <small className="menu-index">{String(idx + 1).padStart(2, "0")}</small>
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </aside>

          <section className="screen">
            <div className="screen-body">{activeView}</div>
          </section>
        </div>
      ) : (
        <div className="studio-grid">
          <aside className="control-stack">
            <TopMetronomeBar forceFourBeats={forceDrumMachineFourBeats} />
            <nav className="menu-bar" aria-label="드럼 연습 메뉴">
              {DRUM_MENUS.map((item, idx) => (
                <button
                  key={item.key}
                  className={`menu-btn ${drumMenu === item.key ? "active" : ""}`}
                  onClick={() => setDrumMenu(item.key)}
                >
                  <small className="menu-index">{String(idx + 1).padStart(2, "0")}</small>
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </aside>

          <section className="screen">
            <div className="screen-body">{activeDrumView}</div>
          </section>
        </div>
      )}
    </main>
  );
}
