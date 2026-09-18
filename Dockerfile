# ---- build ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps using the committed lockfile for reproducible builds.
COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only production node_modules are needed to run the compiled output.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
