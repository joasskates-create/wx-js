FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/payments.db
RUN groupadd --system app && useradd --system --gid app --create-home app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
RUN mkdir -p /app/data && chown -R app:app /app
USER app
EXPOSE 3000
CMD ["node", "dist/server.js"]
