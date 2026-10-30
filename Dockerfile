# Multi-stage build for Doks Collaborative Workspace
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY agent/package.json ./agent/
COPY web/package.json ./web/
COPY tests/package.json ./tests/

# Install dependencies for build
RUN npm ci

# Copy source tree
COPY . .

# Build standalone protected server and web distribution
RUN npm run pack:release

# Minimal production runtime (< 120MB)
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    DOKS_HOST=0.0.0.0 \
    PORT=4780 \
    DOKS_DATA_DIR=/app/data

# Create directory for persistent vault and board data
RUN mkdir -p /app/data

# Copy built artifacts from builder stage
COPY --from=builder /app/release ./release

EXPOSE 4780

VOLUME ["/app/data"]

CMD ["node", "release/doks-server.cjs"]
