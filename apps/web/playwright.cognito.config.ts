import { defineConfig } from "@playwright/test";

const baseURL = "http://localhost:4175";

export default defineConfig({
  testDir: "./e2e-cognito",
  workers: 1,
  retries: 0,
  use: { baseURL, serviceWorkers: "block" },
  webServer: {
    command: "npm exec -- vite build --outDir dist/cognito-smoke && npm exec -- vite preview --outDir dist/cognito-smoke --host localhost --port 4175 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      VITE_AUTH_MODE: "cognito",
      VITE_API_BASE_URL: "https://api.bidflow.test",
      VITE_WS_BASE_URL: "wss://api.bidflow.test",
      VITE_COGNITO_ISSUER: "https://issuer.bidflow.test/pool",
      VITE_COGNITO_ORIGIN: "https://login.bidflow.test",
      VITE_COGNITO_CLIENT_ID: "browserTest",
      VITE_COGNITO_REDIRECT_URI: baseURL + "/auth/callback",
    },
  },
});
