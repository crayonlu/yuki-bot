FROM oven/bun:1

WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./

RUN bun install --frozen-lockfile

EXPOSE 3001

CMD ["bun", "run", "--filter", "@bot/server", "start"]
