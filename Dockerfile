FROM oven/bun:1.3-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/nhaxe.db
VOLUME /app/data
EXPOSE 3000
CMD ["bun", "src/server.ts"]
