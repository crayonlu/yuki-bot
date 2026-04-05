FROM oven/bun:1

WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./

RUN bun install --frozen-lockfile

EXPOSE 4173

CMD ["bun", "run", "--filter", "@bot/dashboard", "dev", "--host", "0.0.0.0", "--port", "4173"]
