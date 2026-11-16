import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

const enabled = Boolean(process.env.BIDFLOW_E2E_BASE_URL);
const webBaseUrl = process.env.BIDFLOW_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const apiBaseUrl = process.env.BIDFLOW_E2E_API_BASE_URL ?? "http://127.0.0.1:8080";

test.describe("상품 등록·입찰 Browser 흐름", () => {
  test.skip(!enabled, "BIDFLOW_E2E_BASE_URL로 local,e2e 실행 중인 Vite 주소를 지정해야 합니다.");

  test("등록한 경매에 입찰이 없으면 마감에 공개 유찰로 바뀐다", async ({ page, browser, request }) => {
    await setE2eClock(request, "2030-01-01T12:00:00Z");
    const auctionId = await registerAuction(page, "e2e-seller");

    await expect(page.getByRole("status")).toContainText(`경매 ID: ${auctionId}`);

    await setE2eClock(request, "2030-01-01T12:29:59Z");
    const observer = await openBidderPage(browser, auctionId, "e2e-unsold-observer");
    try {
      expect(await readAuction(request, auctionId)).toMatchObject({ status: "SCHEDULED", outcome: null });

      await setE2eClock(request, "2030-01-01T12:30:00Z");
      await expect(observer.page.getByText("ENDED", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(observer.page.getByRole("status")).toHaveText("유찰");
      await expect(observer.page.getByRole("form", { name: "입찰 요청" })).toHaveCount(0);
      expect(await readAuction(request, auctionId)).toMatchObject({
        status: "ENDED", outcome: "UNSOLD", finalPrice: null, endsAt: "2030-01-01T12:30:00Z",
      });
    } finally {
      await observer.context.close();
    }
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

  test("직접 입찰 재시도는 같은 요청이고 같은 사용자의 후속 입찰은 새 요청이다", async ({ page, browser, request }) => {
    await setE2eClock(request, "2030-01-01T12:00:00Z");
    const auctionId = await registerAuction(page, "e2e-seller-direct");
    await setE2eClock(request, "2030-01-01T12:20:00Z");

    const actorA = "e2e-direct-a";
    const bidderA = await openBidderPage(browser, auctionId, actorA);
    const bidderB = await openBidderPage(browser, auctionId, "e2e-direct-b");
    try {
      const first = await submitDirectBid(bidderA.page, auctionId, "12000");
      await expect(bidderA.page.getByText("입찰이 승인되었습니다. 현재 최고 입찰자입니다.")).toBeVisible({ timeout: 10_000 });
      await expect(bidderA.page.getByText("12,000원")).toBeVisible({ timeout: 10_000 });

      const replay = await request.post(`${apiBaseUrl}/api/v1/auctions/${auctionId}/bid-requests`, {
        headers: { "X-Actor-Id": actorA, "Idempotency-Key": first.key },
        data: { bidKind: "DIRECT", amount: 12_000 },
      });
      expect(replay.status()).toBe(202);
      expect(await replay.json()).toMatchObject({ bidRequestId: first.id });

      await submitDirectBid(bidderB.page, auctionId, "13000");
      await expect(bidderA.page.getByText("13,000원")).toBeVisible({ timeout: 10_000 });

      const next = await submitDirectBid(bidderA.page, auctionId, "14000");
      expect(next.id).not.toBe(first.id);
      expect(next.key).not.toBe(first.key);
      await expect(bidderA.page.getByText("입찰이 승인되었습니다. 현재 최고 입찰자입니다.")).toBeVisible({ timeout: 10_000 });
      await expect(bidderA.page.getByText("14,000원")).toBeVisible({ timeout: 10_000 });
      await expect(bidderB.page.getByText("14,000원")).toBeVisible({ timeout: 10_000 });
    } finally {
      await bidderA.context.close();
      await bidderB.context.close();
    }
  });

  test("WebSocket 연결을 복구하면 끊긴 사이 놓친 현재가를 REST에서 읽는다", async ({ page, browser, request }) => {
    await setE2eClock(request, "2030-01-01T12:00:00Z");
    let offline = false;
    let disconnect: (() => Promise<void>) | undefined;
    await page.routeWebSocket("**/ws", socket => {
      if (offline) return socket.close();
      socket.connectToServer();
      disconnect = () => socket.close();
    });
    const auctionId = await registerAuction(page, "e2e-reconnect-observer");
    await setE2eClock(request, "2030-01-01T12:20:00Z");
    const subscribed = waitForAuctionSubscriptions(page, auctionId);
    await page.evaluate(id => {
      window.history.pushState({}, "", `/auctions/${id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, auctionId);
    await subscribed;
    await expect(page.getByText("10,000원")).toBeVisible();
    offline = true;
    if (!disconnect) throw new Error("관찰 브라우저의 WebSocket을 찾지 못했습니다.");
    await disconnect();

    const bidder = await openBidderPage(browser, auctionId, "e2e-reconnect-bidder");
    try {
      await submitDirectBid(bidder.page, auctionId, "12000");
      await expect(bidder.page.getByText("12,000원")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("10,000원")).toBeVisible();

      const reloaded = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/v1/auctions/${auctionId}` && response.ok(),
      { timeout: 12_000 });
      offline = false;
      expect(await (await reloaded).json()).toMatchObject({ auctionId, currentPrice: 12_000 });
      await expect(page.getByText("12,000원")).toBeVisible();
    } finally {
      await bidder.context.close();
    }
  });

  test("등록한 상품을 OpenSearch로 검색해 실제 경매 상세를 연다", async ({ page, request }) => {
    test.skip(process.env.BIDFLOW_E2E_SEARCH !== "1", "검색 E2E는 make local-up-search 및 BIDFLOW_E2E_SEARCH=1이 필요합니다.");

    await setE2eClock(request, "2030-01-01T12:00:00Z");
    const title = `e2ecamera${randomUUID().replaceAll("-", "")}`;
    const auctionId = await registerAuction(page, "e2e-seller-search", title);
    const searchUrl = `${apiBaseUrl}/api/v1/listings/search?${new URLSearchParams({ q: title })}`;
    await expect.poll(async () => {
      const response = await request.get(searchUrl);
      if (!response.ok()) return `검색 API HTTP ${response.status()}`;
      const result: { items: { title: string; auctionId: string | null }[] } = await response.json();
      return result.items.find(item => item.title === title)?.auctionId;
    }, { timeout: 15_000, message: "등록한 상품이 검색 API에 올바른 경매 ID로 반영되어야 합니다." }).toBe(auctionId);

    await page.goBack();
    await page.getByRole("link", { name: "상품 검색 화면 열기" }).click();
    await page.getByLabel("검색어").fill(title);
    await page.getByRole("button", { name: "검색", exact: true }).click();
    const link = page.getByRole("link", { name: title, exact: true });
    await expect(link).toHaveAttribute("href", `/auctions/${auctionId}`);
    await link.click();
    await expect(page).toHaveURL(`${webBaseUrl}/auctions/${auctionId}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "입찰 요청" })).toBeVisible();
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

async function submitDirectBid(page: Page, auctionId: string, amount: string) {
  await page.getByLabel("입찰 금액").fill(amount);
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/auctions/${auctionId}/bid-requests`
      && response.request().method() === "POST"),
    page.getByRole("button", { name: "입찰 요청" }).click(),
  ]);
  expect(response.status()).toBe(202);
  const key = await response.request().headerValue("idempotency-key");
  const result: { bidRequestId?: string } = await response.json();
  if (!key || !result.bidRequestId) throw new Error("직접 입찰의 멱등 키 또는 요청 ID가 누락됐습니다.");
  return { key, id: result.bidRequestId };
}

async function registerAuction(page: Page, sellerId: string, title = "e2e-camera"): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("로컬 개발자 ID").fill(sellerId);
  await page.getByRole("button", { name: "로컬 로그인" }).click();
  await page.waitForURL("/");
  await page.getByRole("link", { name: "상품 등록 화면 열기" }).click();

  await page.getByLabel("상품 제목").fill(title);
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
