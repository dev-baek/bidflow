import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const enabled = Boolean(process.env.BIDFLOW_E2E_BASE_URL);
const webBaseUrl = process.env.BIDFLOW_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const apiBaseUrl = process.env.BIDFLOW_E2E_API_BASE_URL ?? "http://127.0.0.1:8080";

test.describe("상품 등록·입찰 Browser 흐름", () => {
  test.skip(!enabled, "BIDFLOW_E2E_BASE_URL로 local,e2e 실행 중인 Vite 주소를 지정해야 합니다.");

  test("로컬 판매자가 이미지를 업로드하고 경매 ID를 받는다", async ({ page, request }) => {
    await setE2eClock(request, "2030-01-01T12:00:00Z");
    const auctionId = await registerAuction(page, "e2e-seller");

    await expect(page.getByRole("status")).toContainText(`경매 ID: ${auctionId}`);
  });

  test("활성 경매에서 자동 최대가 입찰을 접수하고 공개 현재가를 갱신한다", async ({ page, browser, request }) => {
    await setE2eClock(request, "2030-01-01T12:00:00Z");
    const auctionId = await registerAuction(page, "e2e-seller-bid");
    await setE2eClock(request, "2030-01-01T12:11:00Z");

    const bidderContext = await browser.newContext({ baseURL: webBaseUrl });
    const bidderPage = await bidderContext.newPage();
    try {
      await bidderPage.goto("/login");
      await bidderPage.getByLabel("로컬 개발자 ID").fill("e2e-bidder-a");
      await bidderPage.getByRole("button", { name: "로컬 로그인" }).click();
      await bidderPage.waitForURL("/");
      const subscribed = waitForAuctionSubscription(bidderPage, auctionId);
      await bidderPage.evaluate((id) => {
        window.history.pushState({}, "", `/auctions/${id}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, auctionId);

      await expect(bidderPage.getByRole("heading", { name: "e2e-camera" })).toBeVisible();
      await subscribed;
      await bidderPage.getByLabel("입찰 방식").selectOption("AUTO_MAX");
      await bidderPage.getByLabel("입찰 금액").fill("30000");
      await bidderPage.getByRole("button", { name: "입찰 요청" }).click();

      await expect(bidderPage.getByRole("status")).toContainText("입찰 요청을 접수했습니다. 요청 번호:");
      await expect(bidderPage.getByText("11,000원")).toBeVisible({ timeout: 15_000 });
    } finally {
      await bidderContext.close();
    }
  });
});

async function registerAuction(page: Page, sellerId: string): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("로컬 개발자 ID").fill(sellerId);
  await page.getByRole("button", { name: "로컬 로그인" }).click();
  await page.waitForURL("/");
  await page.getByRole("link", { name: "상품 등록 화면 열기" }).click();

  await page.getByLabel("상품 제목").fill("e2e-camera");
  await page.getByLabel("상품 설명").fill("Playwright가 등록 흐름을 검증하는 테스트 상품입니다.");
  await page.getByLabel("카테고리").selectOption("DIGITAL");
  await page.getByLabel("상품 상태").selectOption("GOOD");
  await page.getByLabel("시작가 (원)").fill("10000");
  await page.getByLabel("시작 시각 (UTC)").fill("2030-01-01T12:10");
  await page.getByLabel("종료 시각 (UTC)").fill("2030-01-01T12:30");
  await page.getByLabel("이미지").setInputFiles({ name: "camera.png", mimeType: "image/png", buffer: Buffer.from("e2e-image") });

  await expect(page.getByText("UPLOADED")).toBeVisible();
  await page.getByRole("button", { name: "상품 등록" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("경매 ID:");
  const match = (await status.textContent())?.match(/경매 ID: ([0-9a-f-]{36})/);
  if (!match?.[1]) throw new Error("등록 성공 응답에서 경매 ID를 찾을 수 없습니다.");
  return match[1];
}

async function setE2eClock(request: APIRequestContext, instant: string): Promise<void> {
  const response = await request.post(`${apiBaseUrl}/api/internal/e2e/clock`, {
    data: { instant },
    headers: { "X-Actor-Id": "e2e-clock-controller" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

function waitForAuctionSubscription(page: Page, auctionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("경매 공개 토픽 구독을 확인하지 못했습니다.")), 5_000);
    page.on("websocket", (socket) => {
      socket.on("framesent", (frame) => {
        if (typeof frame.payload === "string" && frame.payload.includes(`destination:/topic/auctions/${auctionId}`)) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  });
}
