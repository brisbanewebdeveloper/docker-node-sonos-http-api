FROM node:18-alpine

WORKDIR /app

ARG ENDPOINT
ENV ENDPOINT=${ENDPOINT:-http://localhost:5005}

COPY node-sonos /app

RUN apk add --no-cache curl && \
  mkdir cache && \
  chown -R node:node static cache && \
  npm install --omit=dev && \
  rm -rf /tmp/* /root/.npm

EXPOSE 5005

USER node

HEALTHCHECK --interval=1m --timeout=2s \
  CMD curl -LSfs ${ENDPOINT}/zones || exit 1

CMD npm start
