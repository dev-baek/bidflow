import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

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

  test("자동 최대가 경쟁은 마감을 연장하고 새 마감에 공개 낙찰을 확정한다", async ({ page, browser, request }) => {
    await setE2eClock(request, "2030-01-01T12:00:00Z");
    const auctionId = await registerAuction(page, "e2e-seller-bid");
    const unextendedAuctionId = await registerAuction(page, "e2e-seller-control");
    await setE2eClock(request, "2030-01-01T12:24:00Z");
    const controlBid = await request.post(`${apiBaseUrl}/api/v1/auctions/${unextendedAuctionId}/bid-requests`, {
      headers: { "X-Actor-Id": "e2e-bidder-control", "Idempotency-Key": unextendedAuctionId },
      data: { bidKind: "DIRECT", amount: 12_000 },
    });
    expect(controlBid.status()).toBe(202);
    await expect.poll(() => readAuction(request, unextendedAuctionId), { timeout: 10_000 })
      .toMatchObject({ status: "ACTIVE", currentPrice: 12_000, endsAt: "2030-01-01T12:30:00Z" });
    await setE2eClock(request, "2030-01-01T12:29:00Z");

    const bidderA = await openBidderPage(browser, auctionId, "e2e-bidder-a");
    const bidderB = await openBidderPage(browser, auctionId, "e2e-bidder-b");
    try {
      await submitAutoBid(bidderA.page, "30000");
      await expect(bidderA.page.getByText("입찰이 승인되었습니다. 현재 최고 입찰자입니다.")).toBeVisible({ timeout: 15_000 });
      await expect(bidderA.page.getByText("11,000원")).toBeVisible({ timeout: 15_000 });
      await expect(bidderA.page.locator('time[datetime="2030-01-01T12:35:00Z"]')).toBeVisible({ timeout: 15_000 });

      await submitAutoBid(bidderB.page, "20000");
      await expect(bidderB.page.getByText("입찰이 승인되었습니다. 현재 최고 입찰자가 아닙니다.")).toBeVisible({ timeout: 15_000 });
      await expect(bidderA.page.getByText("21,000원")).toBeVisible({ timeout: 15_000 });
      await expect(bidderB.page.getByText("21,000원")).toBeVisible({ timeout: 15_000 });
      await expect(bidderB.page.getByText("30,000원")).toHaveCount(0);

      await setE2eClock(request, "2030-01-01T12:30:00Z");
      // An unextended auction closing proves that the scheduler ran at the original deadline.
      await expect.poll(() => readAuction(request, unextendedAuctionId), { timeout: 10_000 })
        .toMatchObject({ status: "ENDED", outcome: "SOLD", finalPrice: 12_000 });
      expect(await readAuction(request, auctionId)).toMatchObject({
        status: "ACTIVE", endsAt: "2030-01-01T12:35:00Z", currentPrice: 21_000, outcome: null,
      });

      await setE2eClock(request, "2030-01-01T12:35:00Z");
      for (const bidder of [bidderA, bidderB]) {
        await expect(bidder.page.getByText("ENDED", { exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(bidder.page.getByRole("status")).toHaveText("낙찰 · 21,000원");
        await expect(bidder.page.getByRole("form", { name: "입찰 요청" })).toHaveCount(0);
      }
      expect(await readAuction(request, auctionId)).toMatchObject({
        status: "ENDED", outcome: "SOLD", currentPrice: 21_000, finalPrice: 21_000, endsAt: "2030-01-01T12:35:00Z",
      });
    } finally {
      await bidderA.context.close();
      await bidderB.context.close();
    }
  });
});

async function openBidderPage(browser: Browser, auctionId: string, actorId: string) {
  const context = await browser.newContext({ baseURL: webBaseUrl });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("로컬 개발자 ID").fill(actorId);
  await page.getByRole("button", { name: "로컬 로그인" }).click();
  await page.waitForURL("/");
  const subscribed = waitForAuctionSubscriptions(page, auctionId);
  await page.evaluate((id) => {
    window.history.pushState({}, "", `/auctions/${id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, auctionId);
  await expect(page.getByRole("heading", { name: "e2e-camera" })).toBeVisible();
  await subscribed;
  return { context, page };
}

async function submitAutoBid(page: Page, amount: string): Promise<void> {
  await page.getByLabel("입찰 방식").selectOption("AUTO_MAX");
  await page.getByLabel("입찰 금액").fill(amount);
  await page.getByRole("button", { name: "입찰 요청" }).click();
  await expect(page.getByRole("status")).toContainText("입찰 요청을 접수했습니다. 요청 번호:");
}

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

async function readAuction(request: APIRequestContext, auctionId: string): Promise<unknown> {
  const response = await request.get(`${apiBaseUrl}/api/v1/auctions/${auctionId}`);
  await expect(response).toBeOK();
  return response.json();
}

function waitForAuctionSubscriptions(page: Page, auctionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const destinations = new Set<string>();
    const timer = setTimeout(() => reject(new Error("경매 공개·개인 토픽 구독을 확인하지 못했습니다.")), 5_000);
    page.on("websocket", (socket) => {
      socket.on("framesent", (frame) => {
        if (typeof frame.payload === "string" && frame.payload.includes(`destination:/topic/auctions/${auctionId}`)) {
          destinations.add("public");
        }
        if (typeof frame.payload === "string" && frame.payload.includes("destination:/user/queue/bid-results")) {
          destinations.add("private");
        }
        if (destinations.size === 2) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  });
}
