import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4176";

export default defineConfig({
  testDir: "./e2e-ui",
  workers: 1,
  outputDir: "test-results-ui",
  reporter: [["list"], ["html", { outputFolder: "playwright-report-ui", open: "never" }]],
  use: { baseURL, screenshot: "only-on-failure", serviceWorkers: "block" },
  webServer: {
    command: "npm exec -- vite --host 127.0.0.1 --port 4176 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      VITE_AUTH_MODE: "local",
      VITE_API_BASE_URL: baseURL,
      VITE_WS_BASE_URL: "ws://127.0.0.1:4176",
    },
  },
});
