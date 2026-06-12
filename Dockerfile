# WarParty co-op-server för Fly.io (Stockholm/arn). Servern är hosting-agnostisk —
# samma kod som körts på Render. Kräver repo-layouten /app/server + /app/shared
# (room-sim require:ar '../../shared/*'). Konto-datan skrivs till volymen /data
# (ACCOUNTS_DATA_DIR) → överlever deploys/omstarter, till skillnad från Render.
FROM node:20-alpine

WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server
COPY shared ./shared

ENV NODE_ENV=production
ENV ACCOUNTS_DATA_DIR=/data

EXPOSE 8080
WORKDIR /app/server
CMD ["node", "server.js"]
