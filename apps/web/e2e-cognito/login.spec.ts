import { expect, test, type Page } from "@playwright/test";

const app = "http://localhost:4175";
const login = "https://login.bidflow.test";
const api = "https://api.bidflow.test";
const accessToken = "synthetic-access-token";
const listing = {
  productId: "product-example", auctionId: "example", title: "브라우저 테스트 경매",
  categoryId: "DIGITAL", currentPrice: 10_000, endsAt: "2099-01-01T00:00:00Z", status: "ACTIVE",
};
const cors = {
  "access-control-allow-origin": app,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, idempotency-key",
};

async function fixture(page: Page, mismatch = false) {
  let challenge: string | null = null;
  const exchanges: URLSearchParams[] = [];
  const rest: Array<{ path: string; headers: Record<string, string> }> = [];
  const frames: string[] = [];
  let closed = 0;
  await page.routeWebSocket("**/*", (socket) => {
    if (socket.url() !== "wss://api.bidflow.test/ws") return socket.close();
    socket.onMessage((frame) => {
      frames.push(String(frame));
      if (String(frame).startsWith("CONNECT\n")) socket.send("CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0");
      if (String(frame).startsWith("DISCONNECT\n")) {
        const receipt = String(frame).match(/^receipt:(.+)$/m)?.[1];
        if (receipt) socket.send(`RECEIPT\nreceipt-id:${receipt}\n\n\0`);
      }
    });
    socket.onClose(() => { closed++; });
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === app) return route.continue();
    if (url.origin === login && url.pathname === "/oauth2/authorize") {
      expect(url.searchParams.get("client_id")).toBe("browserTest");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("redirect_uri")).toBe(app + "/auth/callback");
      challenge = url.searchParams.get("code_challenge");
      const callback = new URL(app + "/auth/callback");
      callback.search = new URLSearchParams({ code: "synthetic-code", state: mismatch ? "wrong" : url.searchParams.get("state") ?? "" }).toString();
      return route.fulfill({ status: 302, headers: { location: callback.href } });
    }
    if (url.origin === login && url.pathname === "/oauth2/token" && request.method() === "POST") {
      exchanges.push(new URLSearchParams(request.postData() ?? ""));
      return route.fulfill({ headers: cors, json: {
        access_token: accessToken, id_token: "synthetic-id-token", refresh_token: "synthetic-refresh-token",
        token_type: "Bearer", expires_in: 300,
      } });
    }
    if (url.origin === api && request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.origin === api) {
      const { pathname } = url;
      rest.push({ path: pathname, headers: await request.allHeaders() });
      if (pathname === "/api/v1/listings/search" && request.method() === "GET") {
        return route.fulfill({ headers: cors, json: { items: [listing], nextCursor: null } });
      }
      if (pathname === "/api/v1/auctions/example/bid-requests" && request.method() === "POST") {
        return route.fulfill({ status: 401, headers: cors, json: {} });
      }
      if (pathname !== "/api/v1/auctions/example" || request.method() !== "GET") return route.abort();
      return route.fulfill({ headers: cors, json: {
        ...listing, thumbnailObjectKey: null, auctionVersion: 1, outcome: null, finalPrice: null,
      } });
    }
    return route.abort();
  });
  return { exchanges, rest, frames, challenge: () => challenge, closed: () => closed };
}

test("Chromium performs PKCE and sends the access token only on protected REST and STOMP", async ({ page }) => {
  const auth = await fixture(page);
  await page.goto("/login");
  await expect(page.getByLabel("로컬 개발자 ID")).toHaveCount(0);
  await page.getByRole("button", { name: "로그인 계속하기" }).click();
  await expect(page.getByText("Cognito로 로그인했습니다.")).toBeVisible();
  await expect(page).toHaveURL(app + "/");
  expect(auth.exchanges).toHaveLength(1);
  const exchange = auth.exchanges[0]!;
  expect(exchange.get("code")).toBe("synthetic-code");
  expect(exchange.get("grant_type")).toBe("authorization_code");
  const verifier = exchange.get("code_verifier") ?? "";
  const challenge = auth.challenge() ?? "";
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  expect(atob(challenge.replaceAll("-", "+").replaceAll("_", "/")))
    .toBe(String.fromCharCode(...new Uint8Array(digest)));
  expect(await page.evaluate(() => [Object.values(sessionStorage), Object.values(localStorage)])).toEqual([[], []]);

  await page.getByRole("link", { name: "상품 검색 화면 열기" }).click();
  await page.getByLabel("검색어").fill("브라우저");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await page.getByRole("link", { name: listing.title }).click();
  await expect(page.getByRole("heading", { name: listing.title })).toBeVisible();
  await expect.poll(() => auth.frames.some(frame => frame.includes("destination:/user/queue/bid-results"))).toBe(true);
  expect(auth.frames.find(frame => frame.startsWith("CONNECT\n"))).toContain(`Authorization:Bearer ${accessToken}\n`);
  for (const path of ["/api/v1/listings/search", "/api/v1/auctions/example"]) {
    const request = auth.rest.find(entry => entry.path === path);
    expect(request).toBeDefined();
    expect(request?.headers.authorization).toBeUndefined();
    expect(request?.headers["x-actor-id"]).toBeUndefined();
  }
  await page.getByLabel("입찰 금액").fill("15000");
  await page.getByRole("button", { name: "입찰 요청" }).click();
  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
  const bid = auth.rest.find(request => request.path.endsWith("/bid-requests"));
  expect(bid?.headers.authorization).toBe(`Bearer ${accessToken}`);
  expect(bid?.headers["x-actor-id"]).toBeUndefined();
  expect(bid?.headers["idempotency-key"]).toBeTruthy();
  await expect.poll(auth.closed).toBe(1);
  await page.getByRole("link", { name: "로그인" }).click();
  await expect(page.getByRole("button", { name: "로그인 계속하기" })).toBeVisible();
});

test("Chromium rejects a mismatched callback without exchanging the code", async ({ page }) => {
  const auth = await fixture(page, true);
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 계속하기" }).click();
  await expect(page.getByRole("alert")).toHaveText("로그인에 실패했습니다. 다시 시도하세요.");
  await expect(page).toHaveURL(app + "/login");
  expect(auth.exchanges).toHaveLength(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
