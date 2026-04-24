ARG APP_HOME=/app

FROM node:20-slim AS build

ARG APP_HOME
WORKDIR ${APP_HOME}

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY config ./config
RUN npm run build

FROM node:20-slim AS runtime

ENV NODE_ENV=production

ARG APP_HOME
WORKDIR ${APP_HOME}

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build ${APP_HOME}/dist ./dist
COPY --from=build ${APP_HOME}/config ./config
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
