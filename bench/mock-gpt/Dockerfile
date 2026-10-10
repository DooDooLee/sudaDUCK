FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
ENV NODE_ENV=production PORT=9000
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=2s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
USER node
CMD ["node", "server.js"]
