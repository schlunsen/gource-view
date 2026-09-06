# Single-stage build: install all deps, build frontend, run server
FROM node:20-alpine
RUN apk add --no-cache git chromium ffmpeg font-noto
WORKDIR /app

# Install ALL dependencies (dev + prod) so vite can build
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build the frontend
COPY . .
RUN npx vite build
# Unit tests gate the image: a failing test fails the CI build.
RUN npm test

# Remove dev dependencies to slim the image
RUN npm prune --production

# Copy server code
COPY server/ ./server/

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs
ENV PORT=8080
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
EXPOSE 8080
CMD ["node", "server/index.js"]
