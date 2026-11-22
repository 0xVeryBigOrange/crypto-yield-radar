FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci --include=dev && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && chown -R node:node /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./public
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
