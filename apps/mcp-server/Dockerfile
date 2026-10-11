FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY . .
RUN pnpm --filter @gideon-defender/mcp-server install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @gideon-defender/mcp-server run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/mcp-server/dist-owned/ ./dist-owned/
COPY --from=build --chown=node:node /workspace/apps/mcp-server/package.json ./package.json
USER node
EXPOSE 2718
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:2718/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "dist-owned/bin/mcp-server.js"]
