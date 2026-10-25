# Consensus: the web page and the API on port 3500, its config and data in the /data volume (the plan "Docker Image";
# the config folder and Scope Public: plan Run Shapes, Step 1).
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY bin ./bin
COPY src ./src
COPY public ./public
COPY .guides ./.guides

# The config folder belongs to the node user, who runs the server.
RUN mkdir -p /data && chown node:node /data
USER node

VOLUME /data
EXPOSE 3500

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:3500/api/clerk || exit 1

CMD [ "node", "bin/consensus.js", "serve", "--config", "/data", "--scope", "public", "--port", "3500", "--headless" ]
