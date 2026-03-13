# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Pass backend URL at build time for docker-compose local testing
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ── Production stage (nginx serves the SPA) ───────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html

# nginx config: serve index.html for all routes (SPA routing)
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
