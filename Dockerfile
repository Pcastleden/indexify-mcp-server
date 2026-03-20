FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production=false
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm prune --production
ENV MCP_TRANSPORT=sse
ENV PORT=3100
EXPOSE 3100
CMD ["node", "dist/index.js"]