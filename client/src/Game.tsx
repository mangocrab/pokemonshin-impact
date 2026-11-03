import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { CoastPresentation } from "./CoastPresentation";
import { artScale, TRAVELER_DISPLAY_SIZE } from "../../shared/art-layout";
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
    const chestArt = new Map<string, Phaser.GameObjects.Image>();
    const chestSprites = new Map<string, Phaser.GameObjects.Container>();
    function fitArt(sprite: Phaser.GameObjects.Image, width: number, height: number) {
      return sprite.setScale(artScale(sprite.frame.realWidth, sprite.frame.realHeight, width, height));
    }
    function refreshChests(ids: string[]) {
      window.dispatchEvent(new Event("world:loot"));
      opened = ids;
      setCount(ids.filter((id) => CHESTS.some((c) => c.id === id)).length);
      setSecretFound(ids.includes(SANCTUARY_CHEST.id));
      for (const [id, sprite] of chestArt) {
        const open = ids.includes(id);
        fitArt(sprite.setFrame(open ? "chest-open" : "chest"), 42, open ? 45 : 34);
      }
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
      preload() {
        this.load.atlas("world-art", "/art/world.webp", "/art/world.json");
        this.load.atlas("terrain-art", "/art/terrain.webp", "/art/terrain.json");
        this.load.atlas("traveler-art", "/art/traveler.webp", "/art/traveler.json");
        this.load.on("loaderror", () => setMessage("아트를 불러오지 못했습니다. 새로고침해 주세요."));
      }
      create() {
        this.presentation = new CoastPresentation(this);
        configure.current = () => this.presentation.configure(settingsRef.current, matchMedia("(prefers-reduced-motion: reduce)").matches);
        configure.current();
        for (const [x, y] of PALMS) {
          this.presentation.shadow(this.add.ellipse(x + 12, y + 7, 95, 30, 0x244a48, 0.13)).setDepth(-1);
          const palm = fitArt(this.add.image(x, y + 4, "world-art", "palm").setOrigin(0.5, 1), 145, 164).setDepth(y);
          this.presentation.foliage(palm, 0);
        }
        this.presentation.shadow(this.add.ellipse(1050, 675, 200, 40, 0x244a48, 0.15)).setDepth(-1);
        fitArt(this.add.image(1050, 675, "world-art", "cottage").setOrigin(0.5, 1), 208, 194).setDepth(675);
        this.add.text(990, 695, "산호빛 쉼터", { fontSize: "14px", color: "#42645b", backgroundColor: "#fff7dfcc" });
        for (const chest of [...CHESTS, SANCTUARY_CHEST]) {
          const painted = fitArt(this.add.image(0, 4, "world-art", "chest").setOrigin(0.5, 1), 42, 34);
          chestArt.set(chest.id, painted);
          const sprite = this.add.container(chest.x, chest.y, [
            this.presentation.shadow(this.add.ellipse(0, 5, 38, 12, 0x244a48, 0.17)), painted,
          ]).setDepth(chest.y);
          chestSprites.set(chest.id, sprite);
          if (chest.id === SANCTUARY_CHEST.id) sprite.setVisible(false);
        }
        this.presentation.shadow(this.add.ellipse(ENCOUNTER.x, ENCOUNTER.y + 6, 58, 20, 0x244a48, 0.18)).setDepth(-1);
        fitArt(this.add.image(ENCOUNTER.x, ENCOUNTER.y + 5, "world-art", "coral-crab").setOrigin(0.5, 1), 76, 62).setDepth(ENCOUNTER.y);
        this.add.text(ENCOUNTER.x, ENCOUNTER.y + 16, ENCOUNTER.name, { fontSize: "12px", color: "#704c3e", backgroundColor: "#fff7dfcc" }).setOrigin(0.5);
        const bloom = SANCTUARY_ENCOUNTER;
        this.presentation.shadow(this.add.ellipse(bloom.x, bloom.y + 6, 52, 18, 0x244a48, 0.17)).setDepth(-1);
        fitArt(this.add.image(bloom.x, bloom.y + 6, "world-art", "sanctuary-bloom").setOrigin(0.5, 1), 70, 76).setDepth(bloom.y);
        this.add.text(bloom.x, bloom.y + 22, bloom.name, { fontSize: "12px", color: "#365e46", backgroundColor: "#fff7dfcc" }).setOrigin(0.5);
        for (const npc of NPCS) {
          this.add.container(npc.x, npc.y, [
            this.presentation.shadow(this.add.ellipse(0, 6, 30, 11, 0x244a48, 0.18)),
            fitArt(this.add.image(0, 5, "world-art", npc.id).setOrigin(0.5, 1), 56, 86),
            this.add.text(0, -94, `${npc.name} · ${npc.title}`, { fontSize: "12px", color: "#244a48", backgroundColor: "#fffef5dd" }).setOrigin(0.5),
          ]).setDepth(npc.y);
        }
        fitArt(this.add.image(TIDE_PUZZLE.x, TIDE_PUZZLE.y + 10, "world-art", "altar").setOrigin(0.5, 1), 84, 86).setDepth(TIDE_PUZZLE.y);
        this.add.text(TIDE_PUZZLE.x, TIDE_PUZZLE.y - 91, "☀ ❧ ≈ ☾", { fontSize: "16px", color: "#526c76", backgroundColor: "#fff7dfcc" }).setOrigin(0.5).setDepth(TIDE_PUZZLE.y + 1);
        this.add.text(TIDE_PUZZLE.x, TIDE_PUZZLE.y + 22, TIDE_PUZZLE.name, { fontSize: "12px", color: "#365c59" }).setOrigin(0.5);
        gate = this.add.container(1570, 800, [fitArt(this.add.image(0, 0, "world-art", "lantern").setOrigin(0.5, 1), 44, 82), this.add.text(-23, -100, "잠긴 다리", { fontSize: "12px", color: "#5f6d53" })]).setDepth(800);
        this.player = this.add.container(800, 560, [
          this.presentation.shadow(this.add.ellipse(0, 7, 28, 11, 0x244a48, 0.2)),
          this.add.image(0, 5, "traveler-art", "south-0").setOrigin(0.5, 1).setDisplaySize(TRAVELER_DISPLAY_SIZE, TRAVELER_DISPLAY_SIZE),
        ]);
        this.presentation.traveler(this.player);
        this.cameras.main
          .setBounds(0, 0, WORLD.width, WORLD.height)
          .startFollow(this.player, true, 0.12, 0.12, 0, 100);
        this.keys = this.input.keyboard!.createCursorKeys();
        this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as typeof this.wasd;
        socket.on("world:position", (p: { x: number; y: number }) => {
          this.player.setPosition(p.x, p.y);
        });
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
                  this.add.image(0, 5, "traveler-art", "south-0").setOrigin(0.5, 1).setDisplaySize(TRAVELER_DISPLAY_SIZE, TRAVELER_DISPLAY_SIZE).setTint(0xe4eef3),
                  this.add
                    .text(0, -94, p.nickname, {
                      fontSize: "12px",
                      color: "#244a48",
                      backgroundColor: "#fffef5",
                    })
                    .setOrigin(0.5),
                ]);
                this.others.set(p.userId, sprite);
                this.presentation.traveler(sprite);
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
            this.presentation.traveler(this.player);
            refreshChests(ids);
            window.dispatchEvent(new Event("story:world"));
            setMessage(notice ?? "위치와 탐험 상태를 불러왔습니다.");
          },
        );
        talk.current = () => {
          const npc = nearbyNpc(this.player, regions);
          if (npc && ready && activeRef.current)
            window.dispatchEvent(new CustomEvent("npc:talk", { detail: { npcId: npc.id, worldId } }));
        };
        inspect.current = () => {
          if (ready && activeRef.current && nearPuzzle(this.player)) window.dispatchEvent(new CustomEvent("puzzle:inspect", { detail: { worldId, puzzleId: TIDE_PUZZLE.id } }));
        };
        interact.current = () => {
          if (owner && findChest(this.player)) void openNearby(this.player);
          else if (nearbyNpc(this.player, regions)) talk.current();
          else inspect.current();
        };
        this.input.keyboard!.on("keydown-E", () => interact.current());
        socket.connect();
      }
      update(t: number) {
        this.presentation.update(t, activeRef.current);
        // Renderer diagnostics: report the selected texture frames without exposing game state or controls.
        if (host.current) {
          const frame = String((this.player.getAt(1) as Phaser.GameObjects.Image).frame.name);
          const visitors = JSON.stringify([...this.others.values()].map((sprite) => String((sprite.getAt(1) as Phaser.GameObjects.Image).frame.name)));
          if (host.current.dataset.travelerFrame !== frame) host.current.dataset.travelerFrame = frame;
          if (host.current.dataset.visitorFrames !== visitors) host.current.dataset.visitorFrames = visitors;
        }
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
        setNpcName(ready && activeRef.current ? nearbyNpc(this.player, regions)?.talkLabel ?? "" : "");
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
                new CustomEvent(playerCount > 1 ? "coop:start" : "battle:start", { detail: { encounterId: nearEnemy.id } }),
              )
            }
          >
            {playerCount > 1 ? (nearEnemy.id === ENCOUNTER.id ? "협동 보스전 모집" : "안뜰 협동 보스전 모집") : `${nearEnemy.name}와 전투`}
          </button>
        )}
        {nearEnemy?.id === SANCTUARY_ENCOUNTER.id && <span>안뜰 도전 · 혼자 또는 최대 4인 협동</span>}
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
