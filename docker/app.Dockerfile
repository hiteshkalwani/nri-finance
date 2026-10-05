# Production-like app image for the local integration check: the exact Vercel build output,
# served on :3000 by scripts/serve-vercel-output.mjs with Vercel's routing and headers.
FROM node:22-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@latest && corepack enable
WORKDIR /repo
# Manifests first, so the install layer is reused until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/test-utils/package.json packages/test-utils/
RUN pnpm install --frozen-lockfile
COPY . .
# The browser bundle embeds these, and the CSP is derived from the URL; both are public values.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN pnpm build:vercel

FROM node:22-slim
WORKDIR /app
COPY --from=build /repo/.vercel/output ./output
COPY scripts/serve-vercel-output.mjs ./
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "serve-vercel-output.mjs", "output"]
