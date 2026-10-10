// import { defineConfig } from "vite";
// import react from "@vitejs/plugin-react";
// import path from "path";
// import { fileURLToPath } from "url";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// export default defineConfig({
//   plugins: [react()],
//   resolve: {
//     alias: {
//       "@": path.resolve(__dirname, "src"),
//     },
//   },
//   server: {
//     proxy: {
//       "/dev-api": {
//         target: "https://i14e104.p.ssafy.io",
//         changeOrigin: true,
//       },
//       "/ws": {
//         target: "https://i14e104.p.ssafy.io",
//         changeOrigin: true,
//         ws: true,
//       },
//     },
//   },
// });
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
  // 웹소켓 전용 (경로가 /dev-api/ws 로 올 경우)
  "/dev-api/ws": {
    target: "https://i14e104.p.ssafy.io",
    changeOrigin: true,
    ws: true,
    rewrite: (path) => path.replace(/^\/dev-api/, ""),
  },
  // 일반 API 전용
  "/dev-api": {
    target: "https://i14e104.p.ssafy.io",
    changeOrigin: true,
  },
  // 로컬 백엔드 (localhost:8080) - VITE_API_BASE_URL 을 비워두면 상대경로로 여기로 프록시됨
  // AI 채팅만 다른 서버로 보낼 수 있게 분리. 기본 8080(톰캣 A), AI_CHAT_PORT=8081 이면 WebFlux B
  "/api/v1/ai-chat": {
    target: `http://localhost:${process.env.AI_CHAT_PORT || "8080"}`,
    changeOrigin: true,
  },
  "/api": {
    target: "http://localhost:8080",
    changeOrigin: true,
  },
  "/oauth2": {
    target: "http://localhost:8080",
    changeOrigin: true,
  },
  "/login/oauth2": {
    target: "http://localhost:8080",
    changeOrigin: true,
  },
  "/audio": {
    target: "http://localhost:8080",
    changeOrigin: true,
  },
  "/ws": {
    target: "http://localhost:8080",
    changeOrigin: true,
    ws: true,
  },
  },
}
});
