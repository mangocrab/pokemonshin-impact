import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { CoastPresentation } from "./CoastPresentation";
import { useSettings } from "./Settings";
import { graphicsOptions } from "../../shared/settings";
import { SANCTUARY, SANCTUARY_CHEST, TIDE_PUZZLE, nearPuzzle, nearSanctuaryChest } from "../../shared/adventure";
import { NPCS, nearbyNpc } from "../../shared/story";
import { ENCOUNTER, SANCTUARY_ENCOUNTER, nearbyEncounter, type Encounter } from "../../shared/combat";
import { io } from "socket.io-client";
import { WORLD, CHESTS, PALMS, nearbyChest, type Position } from "../../shared/world";
export function Game({
  onConnection,
  active = true,
  onWorldChange,
}: {
  onConnection: (v: boolean) => void;
  active?: boolean;
  onWorldChange: (isOwner: boolean) => void;
}) {
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const configure = useRef<() => void>(() => {});
  useEffect(() => { configure.current(); }, [settings]);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => { setSystemReduced(media.matches); configure.current(); };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const options = graphicsOptions(settings, systemReduced);
  const [nearEnemy, setNearEnemy] = useState<Encounter | undefined>();
  const [isOwner, setIsOwner] = useState(true);
  const [playerCount, setPlayerCount] = useState(1);
  const [puzzleNear, setPuzzleNear] = useState(false), [regionNames, setRegionNames] = useState<string[]>([]), [secretFound, setSecretFound] = useState(false), [area, setArea] = useState("산호 해안");
  const inspect = useRef<() => void>(() => {});
  const [npcName, setNpcName] = useState("");
  const talk = useRef<() => void>(() => {});
  const [nearby, setNearby] = useState("");
  const [message, setMessage] = useState("해안에 접속하는 중입니다.");
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const interact = useRef<() => void>(() => {});
  const activeRef = useRef(active);
  activeRef.current = active;
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const socket = io({ autoConnect: false });
    let opened: string[] = [],
      worldId = "",
      ready = false,
      pending = false;
    let ownId = "",
      owner = true, regions: string[] = [];
    let gate: Phaser.GameObjects.Container | undefined;
    function applyRegions(ids: string[]) {
      regions = ids; setRegionNames(ids);
      gate?.setVisible(!ids.includes(SANCTUARY.id));
      chestSprites.get(SANCTUARY_CHEST.id)?.setVisible(ids.includes(SANCTUARY.id));
    }
    const findChest = (p: Position) => nearbyChest(p, opened) ?? nearSanctuaryChest(p, opened, regions);
    const chestSprites = new Map<string, Phaser.GameObjects.Container>();
    function refreshChests(ids: string[]) {
      window.dispatchEvent(new Event("world:loot"));
      opened = ids;
      setCount(ids.filter((id) => CHESTS.some((c) => c.id === id)).length);
      setSecretFound(ids.includes(SANCTUARY_CHEST.id));
      for (const [id, sprite] of chestSprites)
        sprite.setAlpha(ids.includes(id) ? 0.4 : 1);
    }
    async function openNearby(position: Position) {
      const chest = findChest(position);
      if (!chest || pending || !ready || !activeRef.current || !owner) return;
      pending = true;
      setBusy(true);
      try {
        const r = await fetch("/api/world/chest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ worldId, chestId: chest.id }),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        refreshChests(result.chests);
        if (result.opened) window.dispatchEvent(new CustomEvent("audio:cue", { detail: "treasure" }));
        setMessage(
          result.opened
            ? `${chest.name}을 열었습니다.`
            : "이미 개봉한 상자입니다.",
        );
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "상자를 열 수 없습니다.",
        );
      } finally {
        pending = false;
        setBusy(false);
      }
    }
    socket.on("economy:changed", () => window.dispatchEvent(new Event("economy:changed")));
    socket.on("characters:changed", () =>
      window.dispatchEvent(new Event("characters:changed")),
    );
    socket.on("battle:state", (state) =>
      window.dispatchEvent(new CustomEvent("battle:state", { detail: state })),
    );
    socket.on("world:chests", refreshChests);
    socket.on("adventure:changed", (data: { worldId: string; regions: string[] }) => {
      if (data.worldId !== worldId) return;
      applyRegions(data.regions);
      window.dispatchEvent(new Event("adventure:changed"));
    });
    socket.on("story:changed", () => {
      window.dispatchEvent(new Event("story:changed"));
      window.dispatchEvent(new Event("economy:changed"));
    });
    socket.on("social:changed", () =>
      window.dispatchEvent(new Event("social:changed")),
    );
    socket.on("world:error", setMessage);
    socket.on("connect_error", () =>
      setMessage(
        "서버에 연결할 수 없습니다. 다시 로그인하거나 잠시 후 시도하세요.",
      ),
    );
    socket.on("disconnect", () => {
      ready = false;
      setNearby("");
      setNpcName("");
      setPuzzleNear(false);
      window.dispatchEvent(new Event("story:world"));
    });
    socket.on("connect", () => onConnection(false));
    socket.on("disconnect", () => onConnection(false));
    class Coast extends Phaser.Scene {
      presentation!: CoastPresentation;
      player!: Phaser.GameObjects.Container;
      keys!: Phaser.Types.Input.Keyboard.CursorKeys;
      wasd!: Record<string, Phaser.Input.Keyboard.Key>;
      sent = 0;
      others = new Map<string, Phaser.GameObjects.Container>();
      create() {
        this.presentation = new CoastPresentation(this);
        configure.current = () => this.presentation.configure(settingsRef.current, matchMedia("(prefers-reduced-motion: reduce)").matches);
        configure.current();
        for (const [x, y] of PALMS) {
          this.presentation.shadow(this.add.ellipse(x + 14, y + 22, 110, 34, 0x264a43, 0.15)).setDepth(-1);
          this.add
            .rectangle(x, y - 38, 15, 95, 0x9d7651)
            .setAngle(9)
            .setDepth(y);
          for (let i = 0; i < 6; i++) {
            const leaf = this.add
              .ellipse(
                x + Math.cos(i) * 30,
                y - 90 + Math.sin(i) * 14,
                100,
                23,
                0x458d6c,
              )
              .setAngle(i * 60)
              .setDepth(y + 1);
            this.presentation.foliage(leaf, i * 60);
          }
        }

        this.presentation.shadow(this.add.ellipse(1070, 670, 220, 55, 0x264a43, 0.16)).setDepth(-1);
        this.add.rectangle(1050, 620, 170, 110, 0xdbb582).setDepth(675);
        this.add
          .triangle(1050, 534, 0, 80, 100, 0, 200, 80, 0xbd7257)
          .setDepth(676);
        this.add.rectangle(1050, 638, 30, 73, 0x796b60).setDepth(677);
        this.add.text(990, 690, "산호빛 쉼터", {
          fontSize: "18px",
          color: "#42645b",
        });
        for (const chest of [...CHESTS, SANCTUARY_CHEST]) {
          const sprite = this.add
            .container(chest.x, chest.y, [
              this.presentation.shadow(this.add.ellipse(0, 10, 38, 15, 0x244a48, 0.2)),
              this.add.rectangle(0, 0, 32, 23, 0xa47746),
              this.add.rectangle(0, -7, 34, 10, 0xe6c366),
              this.add.rectangle(0, 0, 5, 14, 0xf7df93),
            ])
            .setDepth(chest.y);
          chestSprites.set(chest.id, sprite);
          if (chest.id === SANCTUARY_CHEST.id) sprite.setVisible(false);
        }
        this.presentation.shadow(this.add.ellipse(ENCOUNTER.x, ENCOUNTER.y + 8, 48, 18, 0x244a48, 0.2)).setDepth(-1);
        this.add
          .ellipse(ENCOUNTER.x, ENCOUNTER.y - 8, 38, 28, 0xc9775d)
          .setDepth(ENCOUNTER.y);
        this.add
          .text(ENCOUNTER.x, ENCOUNTER.y - 54, "♋", {
            fontSize: "40px",
            color: "#a75d48",
          })
          .setOrigin(0.5)
          .setDepth(ENCOUNTER.y + 1);
        this.add
          .text(ENCOUNTER.x, ENCOUNTER.y + 22, ENCOUNTER.name, {
            fontSize: "12px",
            color: "#704c3e",
          })
          .setOrigin(0.5);
        const bloom = SANCTUARY_ENCOUNTER;
        this.add.container(bloom.x, bloom.y, [
          this.presentation.shadow(this.add.ellipse(0, 9, 46, 18, 0x244a48, 0.2)),
          ...Array.from({ length: 6 }, (_, i) => this.add.ellipse(Math.cos(i * Math.PI / 3) * 15, -14 + Math.sin(i * Math.PI / 3) * 15, 22, 18, 0xe9b96e)),
          this.add.circle(0, -14, 12, 0x6a9f70),
          this.add.text(0, 25, bloom.name, { fontSize: "12px", color: "#365e46" }).setOrigin(0.5),
        ]).setDepth(bloom.y);
        for (const npc of NPCS) {
          this.add.container(npc.x, npc.y, [
            this.presentation.shadow(this.add.ellipse(3, 8, 30, 12, 0x244a48, 0.2)),
            this.add.rectangle(0, -7, 21, 26, npc.color),
            this.add.circle(0, -28, 10, 0xeec9a4),
            this.add.ellipse(0, -37, 34, 9, 0xf5dfaa),
            this.add.rectangle(5, -16, 7, 17, 0xf2bd83),
            this.add.text(0, -62, `${npc.name} · ${npc.title}`, { fontSize: "12px", color: "#244a48", backgroundColor: "#fffef5dd" }).setOrigin(0.5),
          ]).setDepth(npc.y);
        }
        this.add.rectangle(TIDE_PUZZLE.x, TIDE_PUZZLE.y - 5, 50, 36, 0x8797a1).setDepth(TIDE_PUZZLE.y);
        this.add.text(TIDE_PUZZLE.x, TIDE_PUZZLE.y - 45, "☀ ❧ ≈ ☾", { fontSize: "20px", color: "#526c76" }).setOrigin(0.5).setDepth(TIDE_PUZZLE.y + 1);
        this.add.text(TIDE_PUZZLE.x, TIDE_PUZZLE.y + 22, TIDE_PUZZLE.name, { fontSize: "12px", color: "#365c59" }).setOrigin(0.5);
        gate = this.add.container(1570, 800, [this.add.rectangle(0, 0, 10, 80, 0x947452), this.add.text(-20, -65, "잠긴 다리", { fontSize: "12px", color: "#5f6d53" })]).setDepth(900);
        this.player = this.add.container(800, 560, [
          this.presentation.shadow(this.add.ellipse(0, 9, 28, 12, 0x244a48, 0.25)),
          this.add.circle(0, -12, 12, 0x3b6375),
          this.add.rectangle(0, -2, 18, 20, 0xffffff),
          this.add.circle(0, -24, 10, 0xf0c6a2),
          this.add.ellipse(0, -31, 29, 10, 0xf4de9f),
        ]);
        this.cameras.main
          .setBounds(0, 0, WORLD.width, WORLD.height)
          .startFollow(this.player, true, 0.12, 0.12, 0, 100);
        this.keys = this.input.keyboard!.createCursorKeys();
        this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as typeof this.wasd;
        socket.on("world:position", (p: { x: number; y: number }) =>
          this.player.setPosition(p.x, p.y),
        );
        socket.on(
          "world:players",
          (
            players: { userId: string; nickname: string; position: Position }[],
          ) => {
            setPlayerCount(players.length);
            for (const [id, sprite] of this.others) {
              if (!players.some((p) => p.userId === id && id !== ownId)) {
                sprite.destroy();
                this.others.delete(id);
              }
            }
            for (const p of players) {
              if (p.userId === ownId) continue;
              let sprite = this.others.get(p.userId);
              if (!sprite) {
                sprite = this.add.container(p.position.x, p.position.y, [
                  this.presentation.shadow(this.add.ellipse(0, 9, 28, 12, 0x244a48, 0.25)),
                  this.add.rectangle(0, -2, 18, 20, 0x6b96a0),
                  this.add.circle(0, -24, 10, 0xf0c6a2),
                  this.add.ellipse(0, -31, 29, 10, 0xe8ae89),
                  this.add
                    .text(0, -55, p.nickname, {
                      fontSize: "12px",
                      color: "#244a48",
                      backgroundColor: "#fffef5",
                    })
                    .setOrigin(0.5),
                ]);
                this.others.set(p.userId, sprite);
              }
              sprite
                .setPosition(p.position.x, p.position.y)
                .setDepth(p.position.y);
            }
          },
        );
        socket.on(
          "world:ready",
          ({
            position,
            worldId: id,
            opened: ids,
            regions: unlocked,
            isOwner: host,
            userId,
            message: notice,
          }) => {
            ownId = userId;
            owner = host;
            setIsOwner(host);
            onWorldChange(host);
            for (const sprite of this.others.values()) sprite.destroy();
            this.others.clear();
            window.dispatchEvent(new Event("battle:refresh"));
            worldId = id;
            applyRegions(unlocked ?? []);
            ready = true;
            onConnection(true);
            this.player.setPosition(position.x, position.y);
            refreshChests(ids);
            window.dispatchEvent(new Event("story:world"));
            setMessage(notice ?? "위치와 탐험 상태를 불러왔습니다.");
          },
        );
        talk.current = () => {
          const npc = nearbyNpc(this.player);
          if (npc && ready && activeRef.current)
            window.dispatchEvent(new CustomEvent("npc:talk", { detail: { npcId: npc.id, worldId } }));
        };
        inspect.current = () => {
          if (ready && activeRef.current && nearPuzzle(this.player)) window.dispatchEvent(new CustomEvent("puzzle:inspect", { detail: { worldId, puzzleId: TIDE_PUZZLE.id } }));
        };
        interact.current = () => {
          if (owner && findChest(this.player)) void openNearby(this.player);
          else if (nearbyNpc(this.player)) talk.current();
          else inspect.current();
        };
        this.input.keyboard!.on("keydown-E", () => interact.current());
        socket.connect();
      }
      update(t: number) {
        if (activeRef.current) this.presentation.update(t);
        this.player.setDepth(this.player.y);
        if (t - this.sent < 50) return;
        this.sent = t;
        let x =
            Number(this.keys.right.isDown || this.wasd.D.isDown) -
            Number(this.keys.left.isDown || this.wasd.A.isDown),
          y =
            Number(this.keys.down.isDown || this.wasd.S.isDown) -
            Number(this.keys.up.isDown || this.wasd.W.isDown);
        if (this.input.activePointer.isDown) {
          const p = this.input.activePointer.positionToCamera(
            this.cameras.main,
          ) as Phaser.Math.Vector2;
          const d = new Phaser.Math.Vector2(
            p.x - this.player.x,
            p.y - this.player.y,
          );
          if (d.length() > 10) {
            d.normalize();
            x = d.x;
            y = d.y;
          }
        }
        const chest =
          ready && activeRef.current && owner
            ? findChest(this.player)
            : undefined;
        setNearby(chest?.name ?? "");
        setPuzzleNear(ready && activeRef.current && nearPuzzle(this.player));
        setArea(this.player.x > SANCTUARY.boundary ? SANCTUARY.name : "산호 해안");
        setNpcName(ready && activeRef.current ? nearbyNpc(this.player)?.talkLabel ?? "" : "");
        setNearEnemy(ready && owner && activeRef.current ? nearbyEncounter(this.player, regions) : undefined);
        if (!activeRef.current) {
          x = 0;
          y = 0;
        }
        if (ready) socket.emit("world:move", { x, y });
      }
    }
    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: host.current!,
      backgroundColor: "#69c9c6",
      scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
      scene: Coast,
      render: { antialias: true, maxLights: 1 },
      audio: { noAudio: true },
      fps: { limit: 30 },
    });
    return () => {
      configure.current = () => {};
      inspect.current = () => {};
      talk.current = () => {};
      interact.current = () => {};
      socket.disconnect();
      game.destroy(true);
    };
  }, [onConnection, onWorldChange]);
  return (
    <>
      <div className="game" ref={host} data-quality={settings.quality} data-lighting={String(options.lighting)} data-shadows={String(options.shadows)} data-motion={String(options.motion)} />
      <div className="exploration-hud">
        <span>
          {isOwner ? "내 월드" : "방문 중 · 상자 개봉 제한"} · {playerCount}/4
        </span>
        <span>
          발견한 상자 {count} / {CHESTS.length}
        </span>
        {nearEnemy && (
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(playerCount > 1 && nearEnemy.id === ENCOUNTER.id ? "coop:start" : "battle:start", { detail: { encounterId: nearEnemy.id } }),
              )
            }
          >
            {playerCount > 1 && nearEnemy.id === ENCOUNTER.id ? "협동 보스전 모집" : `${nearEnemy.name}와 전투`}
          </button>
        )}
        {nearEnemy?.id === SANCTUARY_ENCOUNTER.id && <span>안뜰 도전 · 1인 전투 · 방문자가 있으면 시작할 수 없습니다</span>}
        {puzzleNear && <button onClick={() => inspect.current()}>[E] 세 파도의 종 조사</button>}
        {regionNames.includes(SANCTUARY.id) && <span>{area} · 안뜰의 선물 {secretFound ? 1 : 0}/1</span>}
        {npcName && <button onClick={() => talk.current()}>[E] {npcName}</button>}
        {nearby && (
          <button disabled={busy} onClick={() => interact.current()}>
            {busy ? "개봉 중…" : `[E] ${nearby} 열기`}
          </button>
        )}
        <span role="status">{message}</span>
      </div>
    </>
  );
}
