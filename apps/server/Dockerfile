# graao match server (Colyseus + Rapier). Build from the repository root:
#   docker build -f apps/server/Dockerfile -t graao-server .
# Rooms live in this one process's memory: run exactly ONE instance (no load balancing across machines).

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/game-data/package.json packages/game-data/
COPY packages/game-core/package.json packages/game-core/
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile --filter "@graao/server..."
COPY packages packages
COPY apps/server apps/server
RUN pnpm --filter @graao/server build

FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production PORT=2567
COPY apps/server/runtime-package.json package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /repo/apps/server/dist/ ./
USER node
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
