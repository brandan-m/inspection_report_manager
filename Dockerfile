ARG APP_HOME=/app
ARG ARTIFACTORY_URL=https://geckorobotics.jfrog.io/artifactory/api/npm/npm/
ARG ARTIFACTORY_USER
ARG ARTIFACTORY_PASS
ARG ARTIFACTORY_EMAIL

FROM node:20-slim AS build

ARG APP_HOME
ARG ARTIFACTORY_URL
ARG ARTIFACTORY_USER
ARG ARTIFACTORY_PASS
ARG ARTIFACTORY_EMAIL
WORKDIR ${APP_HOME}

COPY package.json package-lock.json tsconfig.json ./
RUN ENCODED_PASS="$(printf '%s' "${ARTIFACTORY_PASS}" | base64 | tr -d '\n')" \
    && printf '%s\n' \
      "registry=${ARTIFACTORY_URL}" \
      "//geckorobotics.jfrog.io/artifactory/api/npm/npm/:username=${ARTIFACTORY_USER}" \
      "//geckorobotics.jfrog.io/artifactory/api/npm/npm/:_password=${ENCODED_PASS}" \
      "//geckorobotics.jfrog.io/artifactory/api/npm/npm/:email=${ARTIFACTORY_EMAIL}" \
      "//geckorobotics.jfrog.io/artifactory/api/npm/npm/:always-auth=true" \
      > /root/.npmrc \
    && npm ci \
    && rm /root/.npmrc

COPY src ./src
COPY config ./config
RUN npm run build

FROM node:20-slim AS runtime

ENV NODE_ENV=production

ARG APP_HOME
ARG ARTIFACTORY_URL
ARG ARTIFACTORY_USER
ARG ARTIFACTORY_PASS
ARG ARTIFACTORY_EMAIL
WORKDIR ${APP_HOME}

COPY package.json package-lock.json ./
RUN ENCODED_PASS="$(printf '%s' "${ARTIFACTORY_PASS}" | base64 | tr -d '\n')" \
    && printf '%s\n' \
      "registry=${ARTIFACTORY_URL}" \
      "//geckorobotics.jfrog.io/artifactory/api/npm/npm/:username=${ARTIFACTORY_USER}" \
      "//geckorobotics.jfrog.io/artifactory/api/npm/npm/:_password=${ENCODED_PASS}" \
      "//geckorobotics.jfrog.io/artifactory/api/npm/npm/:email=${ARTIFACTORY_EMAIL}" \
      "//geckorobotics.jfrog.io/artifactory/api/npm/npm/:always-auth=true" \
      > /root/.npmrc \
    && npm ci --omit=dev \
    && rm /root/.npmrc

COPY --from=build ${APP_HOME}/dist ./dist
COPY --from=build ${APP_HOME}/config ./config
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
