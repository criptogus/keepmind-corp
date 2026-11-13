FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.corp.config.mts tsconfig.web.json ./
COPY src/renderer ./src/renderer
COPY corp ./corp
COPY tools/lib ./tools/lib
RUN npm run corp:build-brain && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
ENV NODE_ENV=production KEEPMIND_CORP_MODE=server KEEPMIND_CORP_HOST=0.0.0.0 KEEPMIND_CORP_PORT=8787 KEEPMIND_CORP_DATA=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/corp ./corp
COPY --from=build --chown=node:node /app/tools/lib ./tools/lib
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "const u=new URL(process.env.KEEPMIND_CORP_PUBLIC_URL);require('node:http').get('http://127.0.0.1:8787/api/health',{headers:{Host:u.host}},r=>{r.resume();if(r.statusCode!==200)process.exit(1)}).on('error',()=>process.exit(1))"
CMD ["node", "corp/server.mjs"]
