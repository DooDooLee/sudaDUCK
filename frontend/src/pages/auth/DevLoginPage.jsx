// [DEV ONLY] 카카오 로그인 없이 로컬 백엔드 테스트 계정으로 로그인하는 페이지 (로그인 후 /main)
// App.jsx 에서 import.meta.env.DEV 일 때만 /dev-login 라우트로 등록된다
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "@/api/api";

const TEST_USER = {
  userId: 1,
  email: "test@local.dev",
  name: "tester",
  nickname: "tester",
};

async function postJson(path, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`${res.status} ${typeof data === "string" ? data : JSON.stringify(data)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// 이미 가입된 유저면 서버가 401(/error 경유) 을 주므로 실패는 조용히 무시
async function signupQuietly() {
  try {
    await postJson("/api/v1/auth/test-signup", TEST_USER);
  } catch {
    // ignore
  }
}

async function login() {
  return postJson("/api/v1/auth/test-login", {
    userId: TEST_USER.userId,
    email: TEST_USER.email,
  });
}

export default function DevLoginPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("테스트 계정으로 로그인 중...");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      try {
        let data;
        if (localStorage.getItem("accessToken")) {
          // 토큰이 이미 있으면 가입 생략, 로그인 실패 시에만 가입 후 재시도
          try {
            data = await login();
          } catch {
            await signupQuietly();
            data = await login();
          }
        } else {
          await signupQuietly();
          data = await login();
        }

        const accessToken = data?.accessToken;
        const refreshToken = data?.refreshToken;
        if (!accessToken) throw new Error("응답에 accessToken 이 없습니다.");

        localStorage.setItem("accessToken", accessToken);
        if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
        document.cookie = `access_token=${accessToken}; Path=/; SameSite=None; Secure`;

        navigate("/main", { replace: true });
      } catch (e) {
        console.error("[DevLogin] test-login 실패:", e);
        setStatus(`로그인 실패: ${e?.message || e}`);
      }
    };

    run();
  }, [navigate]);

  return (
    <div style={{ padding: "50px", textAlign: "center" }}>
      <h2>[DEV] 테스트 로그인</h2>
      <p>{status}</p>
    </div>
  );
}
