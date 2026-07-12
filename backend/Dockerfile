# sicr3p backend
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
# Aplica migraciones al arrancar (idempotente) y levanta el servidor.
CMD ["npm", "start"]
