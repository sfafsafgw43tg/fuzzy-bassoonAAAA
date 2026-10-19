FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY services/android-build ./services/android-build
COPY apps/octobrowser/src/main/android-custom-build.ts ./apps/octobrowser/src/main/android-custom-build.ts
RUN npx tsc --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck --outDir services/android-build/dist services/android-build/src/*.ts
USER node
EXPOSE 8787
