import { Collection, WalletBar } from "./Collection";
import React, { lazy, Suspense, useState, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Adventure } from "./Adventure";
import { Story } from "./Story";
import { Battle } from "./Battle";
import { Characters, LearningNotice } from "./Training";
import { Auth } from "./Auth";
import { Social } from "./Social";
import { Settings, SettingsProvider } from "./Settings";
const Game = lazy(() => import("./Game").then((module) => ({ default: module.Game })));
import "./style.css";
function App() {
  const [user, setUser] = useState<{
    id: string;
    nickname: string;
    world: { id: string; progress: { chests?: string[] } };
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => {
    fetch("/api/me")
      .then(async (r) => setUser(r.ok ? await r.json() : null))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(load, [load]);
  const [inPuzzle, setInPuzzle] = useState(false);
  const puzzleChanged = useCallback((value: boolean) => setInPuzzle(value), []);
  const [inDialogue, setInDialogue] = useState(false);
  const dialogueChanged = useCallback((value: boolean) => setInDialogue(value), []);
  const [inBattle, setInBattle] = useState(false);
  const battleChanged = useCallback((value: boolean) => setInBattle(value), []);
  const [ownWorld, setOwnWorld] = useState(true);
  const worldChanged = useCallback((value: boolean) => setOwnWorld(value), []);
  const [connected, setConnected] = useState(false);
  const [menu, setMenu] = useState("탐험");
  useEffect(() => {
    const open = () => setMenu("캐릭터");
    window.addEventListener("training:open", open);
    return () => window.removeEventListener("training:open", open);
  }, []);
  const status = useCallback((v: boolean) => setConnected(v), []);
  return (
    <SettingsProvider key={user?.id ?? "guest"} enabled={Boolean(user)}><main>
      <aside>
        <a className="brand">
          ✺
          <span>
            SOLARA<small>소라빛 여름</small>
          </span>
        </a>
        <div className="chapter">YOUR SUMMER, YOUR STORY</div>
        <nav>
          {[
            "탐험",
            "캐릭터",
            "강화",
            "캐릭터 뽑기",
            "인벤토리",
            "친구 및 멀티플레이",
            "모험 일지",
            "지역 지도",
            "설정",
          ].map((n, i) => (
            <button
              aria-label={n}
              className={menu === n ? "active" : ""}
              key={n}
              onClick={() => setMenu(n)}
            >
              <span>{["◈", "♧", "✧", "✦", "▣", "♧", "▤", "◇", "⚙"][i]}</span>
              {n}
              <b>›</b>
            </button>
          ))}
        </nav>
        <footer>
          <i className={connected ? "online" : ""} />
          {connected ? "게임 서버 연결됨" : "서버 연결 중"}
          <small>개발 빌드 · 0.1.0</small>
        </footer>
      </aside>
      <section className="content">
        <header>
          <div>
            여름의 시작 <span>/</span> 산호 해안
          </div>
          {user && <WalletBar />}
          <span className="badge">
            {user
              ? ownWorld
                ? `${user.nickname}의 개인 월드`
                : "친구의 월드 방문 중"
              : "소라빛 여름"}
          </span>
        </header>
        <section className="heading">
          <div className="eyebrow">THE CORAL COAST</div>
          <h1>당신의 여름이 시작되는 곳.</h1>
          <p>파도 소리를 따라, 아직 만나지 못한 이야기 속으로.</p>
        </section>
        <div className="viewport">
          {user && (
            <Suspense fallback={<div className="game-loading">해안을 불러오는 중…</div>}><Game
              onWorldChange={worldChanged}
              onConnection={status}
              active={menu === "탐험" && !inBattle && !inDialogue && !inPuzzle}
            /></Suspense>
          )}
          <div className="location">
            ☀ 산호 해안<small>맑음 · 여름 휴양지</small>
          </div>
          <div className="hint">
            WASD / 방향키 · 터치로 이동 · 상자 근처에서 E
          </div>
        </div>
        {user && <Story inBattle={inBattle} journalOpen={menu === "모험 일지"} onCloseJournal={() => setMenu("탐험")} onOpenJournal={() => setMenu("모험 일지")} onActiveChange={dialogueChanged} />}
        {user && <Adventure mapOpen={menu === "지역 지도"} onCloseMap={() => setMenu("탐험")} onActiveChange={puzzleChanged} inBattle={inBattle} />}
        <section className="bottom">
          <div>
            <small>EXPLORE AT YOUR OWN PACE</small>
            <h2>작은 발걸음, 새로운 발견</h2>
            <p>해변과 숲에서 상자를 찾아 가까이 다가가세요.</p>
          </div>
          <div className="notice">
            <b>개인 월드 탐험</b>
            <p>
              위치와 상자 개봉 상태가 자동 저장됩니다.
              <br />
              친구를 초대해 최대 4명까지 함께 탐험하세요.
            </p>
          </div>
          <button
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              setUser(null);
            }}
          >
            로그아웃
          </button>
        </section>
        {user && (
          <LearningNotice
            hidden={menu === "캐릭터"}
            onOpen={() => setMenu("캐릭터")}
          />
        )}
        {user && <Battle onActiveChange={battleChanged} connected={connected} />}
        {user && menu === "캐릭터" && (
          <Characters onClose={() => setMenu("탐험")} />
        )}
        {user && ["강화", "캐릭터 뽑기", "인벤토리"].includes(menu) && (
          <Collection
            menu={menu as "강화" | "캐릭터 뽑기" | "인벤토리"}
            onClose={() => setMenu("탐험")}
          />
        )}
        {loaded && !user && <Auth onLogin={load} />}
        {user && (
          <Social
            open={menu === "친구 및 멀티플레이"}
            onClose={() =>
              setMenu(
                menu === "친구 및 멀티플레이" ? "탐험" : "친구 및 멀티플레이",
              )
            }
          />
        )}
        {user && menu === "설정" && <Settings onClose={() => setMenu("탐험")} />}
      </section>
    </main></SettingsProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
