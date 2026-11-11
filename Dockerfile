# Debian (а не Alpine): на Alpine внутренняя сеть Railway (postgres.railway.internal) не находится без доп. настройки
FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
