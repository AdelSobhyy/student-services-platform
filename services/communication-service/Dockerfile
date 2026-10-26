FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM dependencies AS test
COPY src ./src
COPY test ./test
RUN npm test

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=test --chown=node:node /app/src ./src
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/ready',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
