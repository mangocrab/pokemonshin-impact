import { useState } from "react";
export function Auth({ onLogin }: { onLogin: () => void }) {
  const [register, setRegister] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal auth-overlay" role="dialog" aria-modal="true" aria-label={register ? "회원가입" : "로그인"}>
      <img className="auth-key-art" src="/art/key-visual.webp" alt="별빛 해안의 해린과 미라" fetchPriority="high" />
      <div className="auth-identity"><span aria-hidden="true">✦</span><b>SOLARA</b><small>소라빛 여름</small><p>별빛을 따라, 너만의 여름으로.</p></div>
      <article className="auth-panel">
        <small>WELCOME TO SOLARA</small>
        <h2>{register ? "새로운 여름의 시작" : "다시 만난 여름"}</h2>
        <p>나만의 해안으로 떠나세요.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const data = Object.fromEntries(new FormData(e.currentTarget));
            try {
              const r = await fetch(
                "/api/" + (register ? "register" : "login"),
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(data),
                },
              );
              const body = await r.json();
              if (!r.ok) throw new Error(body.error);
              onLogin();
            } catch (e) {
              setError(e instanceof Error ? e.message : "연결 실패");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            name="username"
            placeholder="아이디 (영문·숫자·_)"
            required
            minLength={3}
            maxLength={24}
            autoComplete="username"
            aria-label="아이디"
          />
          {register && (
            <input
              name="nickname"
              placeholder="닉네임"
              required
              maxLength={20}
              aria-label="닉네임"
            />
          )}
          <input
            name="password"
            type="password"
            placeholder="비밀번호 (10자 이상)"
            required
            minLength={10}
            maxLength={128}
            autoComplete={register ? "new-password" : "current-password"}
            aria-label="비밀번호"
          />
          <p role="alert">{error}</p>
          <button disabled={busy}>
            {busy ? "연결 중…" : register ? "회원가입" : "로그인"}
          </button>
        </form>
        <button
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "이미 계정이 있어요" : "처음 오셨나요? 회원가입"}
        </button>
      </article>
    </div>
  );
}
