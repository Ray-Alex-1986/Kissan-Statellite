# --- Build stage: bundle the React app --------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Invoke the Vite CLI directly (same approach as the host build).
RUN node node_modules/vite/bin/vite.js build

# --- Serve stage: static files + /api & /uploads reverse proxy --------------
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
