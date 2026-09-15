import { defineConfig } from "@playwright/test";

const baseURL = process.env.EPISTACK_E2E_BASE_URL || "http://localhost:4173";
const useExternalServer = Boolean(process.env.EPISTACK_E2E_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: useExternalServer ? undefined : {
    command: "EPISTACK_BROWSER_TEST=1 npm run dev -- --host 127.0.0.1 --port 4173",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
