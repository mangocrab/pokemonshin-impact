import { useCallback, useEffect, useState } from "react";
type SocialState = {
  userId: string;
  access: string;
  currentWorld: { id: string; owner: string; isOwner: boolean } | null;
  players: { id: string; nickname: string; isOwner: boolean }[];
  friends: {
    id: string;
    status: string;
    incoming: boolean;
    online: boolean;
    other: { id: string; username: string; nickname: string };
  }[];
  entries: {
    id: string;
    kind: string;
    incoming: boolean;
    sender: string;
    receiver: string;
  }[];
};
export function Social({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<SocialState | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/social");
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      setData(value);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "친구 목록을 불러올 수 없습니다.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("social:changed", refresh);
    const timer = setInterval(refresh, 10000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("social:changed", refresh);
    };
  }, [load]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  async function action(name: string, body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/social/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setMessage(result.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  const incoming =
    (data?.friends.filter((f) => f.status === "pending" && f.incoming).length ??
      0) + (data?.entries.filter((e) => e.incoming).length ?? 0);
  if (!open)
    return incoming ? (
      <button className="social-notification" onClick={onClose}>
        ✉ 초대·친구 요청 {incoming}개 · 확인하기
      </button>
    ) : null;
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="친구 및 멀티플레이"
    >
      <article className="social-panel">
        <div className="social-title">
          <div>
            <small>SUMMER IS BETTER TOGETHER</small>
            <h2>친구 및 멀티플레이</h2>
          </div>
          <button onClick={onClose}>닫기</button>
        </div>
        <p>
          월드 소유자 포함 최대 4명 · 초대와 진입 신청은 5분 동안 유효합니다.
        </p>
        <p role="alert">{error}</p>
        <p className="social-message">{message}</p>
        {data && (
          <>
            <section>
              <h3>
                {data.currentWorld
                  ? `${data.currentWorld.owner}의 월드`
                  : "월드 연결 대기 중"}{" "}
                · {data.players.length}/4
              </h3>
              <ul>
                {data.players.map((p) => (
                  <li key={p.id}>
                    {p.nickname} {p.isOwner ? "· 월드 소유자" : "· 방문자"}
                  </li>
                ))}
              </ul>
              {data.currentWorld && !data.currentWorld.isOwner && (
                <button disabled={busy} onClick={() => action("leave", {})}>
                  개인 월드로 돌아가기
                </button>
              )}
            </section>
            <section>
              <h3>내 월드 접근 설정</h3>
              <select
                aria-label="내 월드 접근 설정"
                value={data.access}
                disabled={busy}
                onChange={(e) => action("access", { access: e.target.value })}
              >
                <option value="invite">친구 초대만 허용</option>
                <option value="request">진입 신청 허용</option>
                <option value="blocked">멀티플레이 차단</option>
              </select>
              <p>차단으로 변경하면 현재 방문자도 자신의 월드로 돌아갑니다.</p>
            </section>
            <section>
              <h3>친구 추가</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void action("friend", { username: form.get("username") });
                }}
              >
                <input
                  name="username"
                  aria-label="친구 아이디"
                  placeholder="정확한 계정 아이디"
                  minLength={3}
                  maxLength={24}
                  required
                />
                <button disabled={busy}>친구 요청 보내기</button>
              </form>
              <ul>
                {data.friends.map((f) => (
                  <li key={f.id}>
                    <b>{f.other.nickname}</b>{" "}
                    <span>
                      @{f.other.username} · {f.online ? "접속 중" : "오프라인"}
                    </span>
                    {f.status === "accepted" ? (
                      <button
                        disabled={busy || !f.online}
                        onClick={() =>
                          action("invite", { username: f.other.username })
                        }
                      >
                        내 월드에 초대
                      </button>
                    ) : f.incoming ? (
                      <div>
                        <button
                          disabled={busy}
                          onClick={() =>
                            action("friend-answer", {
                              id: f.id,
                              decision: "accept",
                            })
                          }
                        >
                          친구 수락
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            action("friend-answer", {
                              id: f.id,
                              decision: "reject",
                            })
                          }
                        >
                          친구 거절
                        </button>
                      </div>
                    ) : (
                      <span> · 친구 응답 대기 중</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3>다른 월드에 진입 신청</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action("request", {
                    username: new FormData(e.currentTarget).get("username"),
                  });
                }}
              >
                <input
                  name="username"
                  aria-label="월드 소유자 아이디"
                  placeholder="월드 소유자의 정확한 아이디"
                  minLength={3}
                  maxLength={24}
                  required
                />
                <button disabled={busy}>진입 신청 보내기</button>
              </form>
            </section>
            <section>
              <h3>월드 초대와 진입 신청</h3>
              {!data.entries.length && <p>대기 중인 초대나 신청이 없습니다.</p>}
              <ul>
                {data.entries.map((e) => (
                  <li key={e.id}>
                    <b>{e.incoming ? e.sender : e.receiver}</b> ·{" "}
                    {e.kind === "invite" ? "월드 초대" : "진입 신청"}
                    {e.incoming ? (
                      <div>
                        <button
                          disabled={busy}
                          onClick={() =>
                            action("entry-answer", {
                              id: e.id,
                              decision: "accept",
                            })
                          }
                        >
                          {e.kind === "invite" ? "초대 수락" : "진입 승인"}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            action("entry-answer", {
                              id: e.id,
                              decision: "reject",
                            })
                          }
                        >
                          거절
                        </button>
                      </div>
                    ) : (
                      <span> · 응답 대기 중</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <p>
              방문자는 자유롭게 탐험할 수 있지만 상자와 영구 진행도는 변경할 수
              없습니다. 소유자가 떠나면 자동 복귀합니다.
            </p>
          </>
        )}
      </article>
    </div>
  );
}
