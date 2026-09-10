import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 生产构建产物挂载在 Express 的 /app 前缀下（见根 server.js 的 frontend dist 托管）
// 开发模式下 Vite 站 5173，/api 与 /uploads 反代到本机后端 3000（同 host，session cookie 可复用）
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
