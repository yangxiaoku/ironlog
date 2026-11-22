FROM node:24-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY web/src ./web/src
COPY web/assets ./web/assets
COPY third_party/musclemap/LICENSE ./third_party/musclemap/LICENSE
COPY scripts/build-web.mjs ./scripts/build-web.mjs
RUN npm ci && npm run build -w @ironlog/shared && npm run build -w @ironlog/server && npm run build:web && npm prune --omit=dev

FROM node:24-alpine AS runtime
RUN apk add --no-cache libstdc++ && mkdir -p /app/data && chown node:node /app/data
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/app/data/gym.db
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/web/dist ./web/dist
COPY --from=build --chown=node:node /app/third_party/musclemap/LICENSE ./licenses/MuscleMap.txt
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/server/dist/index.js"]
