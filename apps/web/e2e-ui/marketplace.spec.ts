import { expect, test, type Locator, type Page } from "@playwright/test";
import { auctionPhoto, auctionPhotoWidth } from "../e2e-fixtures/auction-photo";

const title = "회귀 테스트 카메라";
const auction = {
  productId: "photo-fixture", auctionId: "test-camera", title, categoryId: "DIGITAL",
  currentPrice: 32_000, status: "ACTIVE", endsAt: "2026-12-01T12:30:00Z",
  auctionVersion: 3, hasThumbnail: true, outcome: null, finalPrice: null,
};

async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date("2026-12-01T12:12:00Z"));
  let searchUnavailable = true;
  await page.routeWebSocket("**/ws", socket => {
    socket.onMessage(frame => {
      if (String(frame).startsWith("CONNECT\n")) socket.send("CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0");
    });
  });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/listings/search") {
      const q = url.searchParams.get("q");
      if (q === "재시도" && searchUnavailable) {
        return route.fulfill({ status: 503, json: {} });
      }
      return route.fulfill({ json: { items: q === "빈 결과" ? [] : [auction], nextCursor: null } });
    }
    if (url.pathname === "/api/v1/auctions/test-camera") return route.fulfill({ json: auction });
    if (url.pathname === "/api/v1/auctions/test-camera/images") return route.fulfill({ json: { imageIds: ["front", "back"] } });
    if (/^\/api\/v1\/auctions\/test-camera\/images\/(thumbnail|front|back)$/.test(url.pathname)) {
      return route.fulfill({ contentType: auctionPhoto.mimeType, body: auctionPhoto.buffer });
    }
    return route.fulfill({ status: url.pathname.endsWith("/failed") ? 503 : 404, json: {} });
  });
  return { recoverSearch: () => { searchUnavailable = false; } };
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
}

async function visibleFocus(control: Locator) {
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS("outline-width", "2px");
  await expect(control).toHaveCSS("outline-style", "solid");
  expect(await control.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const x = (bounds.left + bounds.right) / 2;
    const y = (bounds.top + bounds.bottom) / 2;
    return element.contains(document.elementFromPoint(x, y));
  })).toBe(true);
}

for (const width of [320, 390, 768, 1280]) {
  test(`${width}px: 홈·검색·상세·로그인·출품·404에서 포커스와 가로 폭을 유지한다`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.goto("/");
    const homeSearch = page.getByRole("search", { name: "홈 상품 검색" });
    await expect(homeSearch).toBeVisible();
    await noHorizontalOverflow(page);
    await homeSearch.getByRole("searchbox").fill("카메라");
    await page.keyboard.press("Tab");
    const search = homeSearch.getByRole("button", { name: "검색" });
    await visibleFocus(search);
    expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");
    const titleLink = page.getByRole("link", { name: title });
    await expect(titleLink).toBeVisible();
    await noHorizontalOverflow(page);
    if (width < 768) {
      const toggle = page.getByRole("button", { name: "검색 조건", exact: true });
      await expect(page.getByLabel("카테고리")).toBeHidden();
      await toggle.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Tab");
      await visibleFocus(page.getByLabel("카테고리"));
      await page.keyboard.press("Shift+Tab");
      await expect(toggle).toBeFocused();
      await toggle.press("Space");
    }
    await titleLink.press("Enter");
    const gallery = page.getByRole("region", { name: "출품 사진" });
    const summary = page.getByRole("region", { name: "경매 정보" });
    await expect(gallery.getByRole("img", { name: `${title} 사진 1` })).toHaveJSProperty("naturalWidth", auctionPhotoWidth);
    await expect(summary.getByText("32,000원")).toBeVisible();
    await expect(summary.getByText("남은 시간 18분")).toBeVisible();
    await expect(summary.locator("time")).toHaveAttribute("datetime", auction.endsAt);
    const photoBox = (await gallery.boundingBox())!;
    const tradeBox = (await summary.boundingBox())!;
    expect(width < 1024 ? photoBox.y < tradeBox.y : photoBox.x < tradeBox.x && photoBox.y === tradeBox.y).toBe(true);
    await noHorizontalOverflow(page);
    await gallery.getByRole("button", { name: "사진 1 보기" }).focus();
    await page.keyboard.press("Tab");
    const next = gallery.getByRole("button", { name: "사진 2 보기" });
    await visibleFocus(next);
    await page.keyboard.press("Enter");
    await expect(next).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.getByRole("img", { name: `${title} 사진 2` })).toHaveJSProperty("naturalWidth", auctionPhotoWidth);
    if (width === 390 || width === 1280) {
      await testInfo.attach(`detail-${width}`, {
        body: await page.screenshot({ fullPage: true, type: "jpeg", quality: 84 }),
        contentType: "image/jpeg",
      });
    }
    await summary.getByRole("link", { name: "로그인하고 입찰하기" }).press("Enter");
    const actor = page.getByLabel("로컬 개발자 ID");
    await expect(actor).toBeVisible();
    await noHorizontalOverflow(page);
    await actor.fill("ui-fixture-seller");
    await actor.press("Enter");
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "상품 등록" }).click();
    await expect(page.getByRole("heading", { name: "상품 등록" })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole("button", { name: "상품 등록", exact: true }).press("Enter");
    const picker = page.getByLabel("사진 추가");
    await expect(picker).toBeFocused();
    await expect(page.locator(".listing-photo-picker")).toHaveCSS("outline-width", "2px");
    await expect(picker).toHaveAccessibleDescription(/이미지는 1장 이상 10장 이하/);
    await expect(page.getByLabel("상품 제목")).toHaveAccessibleDescription(/제목은 2자 이상/);
    await page.goto("/unknown");
    await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
    await noHorizontalOverflow(page);
  });
}

test("검색 빈 결과·일시 실패, 상세 404·일시 실패를 구분한다", async ({ page }) => {
  const { recoverSearch } = await fixture(page);
  await page.goto("/listings?q=" + encodeURIComponent("빈 결과"));
  await expect(page.getByText("조건에 맞는 상품이 없습니다.")).toBeVisible();
  await page.goto("/listings?q=" + encodeURIComponent("재시도"));
  await expect(page.getByRole("alert")).toHaveText(/검색 서비스를 일시적으로/);
  recoverSearch();
  await page.getByRole("button", { name: "다시 시도" }).press("Enter");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await page.goto("/auctions/missing");
  await expect(page.getByRole("heading", { name: "경매를 찾을 수 없습니다" })).toBeVisible();
  await page.goto("/auctions/failed");
  await expect(page.getByRole("alert")).toHaveText("경매 정보를 불러오지 못했습니다.");
  await expect(page.getByRole("button", { name: "다시 조회" })).toBeVisible();
});
