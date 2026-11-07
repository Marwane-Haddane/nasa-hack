FROM node:20-alpine

WORKDIR /app

# Copy package configurations
COPY frontend/package*.json ./

# Install frontend dependencies
RUN npm install

# Copy frontend source code and configs
COPY frontend/ ./

# Expose Vite dev server port
EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
