# 物料开发认证管理系统 —— 云托管(CloudRun) 容器镜像
# 运行时需 Node >= 22.5（node:sqlite），采用 Node 24 LTS 以稳定支持
FROM node:24-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SERVE_STATIC=1

WORKDIR /app

# 先装依赖，充分利用镜像层缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制应用源码（node_modules/data/uploads 由 .dockerignore 排除）
COPY . .

EXPOSE 3000

# 单机模式：同时托管前端页面(public) 与 /api、/uploads
CMD ["node", "server.js"]
