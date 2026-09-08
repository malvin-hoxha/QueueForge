FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./

COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/publisher/package.json apps/publisher/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json

RUN npm ci

COPY . .

RUN cd packages/database && \
    DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    npx prisma generate