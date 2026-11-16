import { expect, test } from "@playwright/test";

const enabled = Boolean(process.env.BIDFLOW_E2E_BASE_URL);

test.describe("상품 등록 Browser 흐름", () => {
  test.skip(!enabled, "BIDFLOW_E2E_BASE_URL로 local,e2e 실행 중인 Vite 주소를 지정해야 합니다.");

  test("로컬 판매자가 이미지를 업로드하고 경매 ID를 받는다", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("로컬 개발자 ID").fill("e2e-seller");
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
    await expect(page.getByRole("status")).toContainText("경매 ID:");
  });
});
