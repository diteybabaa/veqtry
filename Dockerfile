# Single long-lived Node process — the layout the 2-Step flow expects, because
# lib/twofa.ts keeps session state in memory (see README). Works on Railway,
# Render, Fly.io, ECS, or any Docker host; not used by Amplify.
#
#   docker build -t recaptcha-hero .
#   docker run -p 3000:3000 --env-file .env.local recaptcha-hero
#
# .env.local is excluded by .dockerignore on purpose: pass secrets as real
# environment variables (--env-file, or the platform's env settings).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs
EXPOSE 3000
CMD ["npm", "start"]
