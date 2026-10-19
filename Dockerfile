FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY tsconfig.base.json vitest.config.ts ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3001
USER node
CMD ["npm", "start"]
