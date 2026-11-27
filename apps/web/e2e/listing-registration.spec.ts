import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { percentiles } from "../../../scripts/final-settlement.mjs";
import { matchesObservedBid, observationTimings } from "../../../scripts/browser-result-latency.mjs";
import { windowMarker } from "../../../scripts/outbox-delay-observation.mjs";
import { collectConcurrentRound } from "../../../scripts/collect-concurrent-browser.mjs";
import { summarizeConcurrentRun } from "../../../scripts/concurrent-browser-observation.mjs";
import { readConcurrentSql, judgeConcurrentSql } from "../../../scripts/concurrent-browser-sql.mjs";
import { expect, test, type APIRequestContext, type Browser, type Page, type WebSocket } from "@playwright/test";
import { parseBidResultMessage } from "../src/features/auction-realtime/auction-realtime-client";
import { createDirectFailureDiagnostics } from "./failure-correlation";
import { validateFailureProbe } from "../../../scripts/failure-correlation.mjs";

const enabled = Boolean(process.env.BIDFLOW_E2E_BASE_URL);
const webBaseUrl = process.env.BIDFLOW_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const apiBaseUrl = process.env.BIDFLOW_E2E_API_BASE_URL ?? "http://127.0.0.1:8080";
if(process.env.BIDFLOW_E2E_FAILURE_PROBE!==undefined&&!enabled)throw Error('INVALID_FAILURE_PROBE');

test.describe("상품 등록·입찰 Browser 흐름", () => {
  test.skip(!enabled, "BIDFLOW_E2E_BASE_URL로 local,e2e 실행 중인 Vite 주소를 지정해야 합니다.");
  test.beforeEach(({},info)=>{validateFailureProbe({flag:process.env.BIDFLOW_E2E_FAILURE_PROBE,web:webBaseUrl,api:apiBaseUrl,title:info.title,workers:info.config.workers,retries:info.project.retries});});

  test("등록한 경매에 입찰이 없으면 마감에 공개 유찰로 바뀐다", async ({ page, browser, request }) => {
    await setE2eClock(request, "2030-01-01T12:00:00Z");
    const auctionId = await registerAuction(page, "e2e-seller");

    await expect(page.getByRole("link", { name: "경매 상세 보기" })).toHaveAttribute("href", `/auctions/${auctionId}`);

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

  test("자동 입찰로 확정된 낙찰은 마감 이후 새 입찰로 바뀌지 않는다", async ({ page, browser, request }) => {
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
      await expect(bidderA.page.getByText("입찰이 승인되었습니다. 이 요청 처리 당시 최고 입찰자였습니다.")).toBeVisible({ timeout: 15_000 });
      await expect(bidderA.page.getByText("11,000원")).toBeVisible({ timeout: 15_000 });
      await expect(bidderA.page.locator('time[datetime="2030-01-01T12:35:00Z"]')).toBeVisible({ timeout: 15_000 });

      await submitAutoBid(bidderB.page, "20000");
      await expect(bidderB.page.getByText("입찰이 승인되었습니다. 이 요청 처리 당시 최고 입찰자가 아니었습니다.")).toBeVisible({ timeout: 15_000 });
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
        await expect(bidder.page.getByText("낙찰 · 21,000원", { exact: true })).toBeVisible();
        await expect(bidder.page.getByRole("form", { name: "입찰 요청" })).toHaveCount(0);
      }
      const closed = await readAuction(request, auctionId);
      expect(closed).toMatchObject({
        status: "ENDED", outcome: "SOLD", currentPrice: 21_000, finalPrice: 21_000, endsAt: "2030-01-01T12:35:00Z",
      });

      await setE2eClock(request, "2030-01-01T12:35:01Z");
      const [receipt, rejection] = await Promise.all([
        request.post(`${apiBaseUrl}/api/v1/auctions/${auctionId}/bid-requests`, {
          headers: { "X-Actor-Id": "e2e-bidder-b", "Idempotency-Key": randomUUID() },
          data: { bidKind: "DIRECT", amount: 35_000 },
        }),
        bidderB.socket.waitForEvent("framereceived", {
          timeout: 10_000,
          predicate: ({ payload }) => {
            const result = parseBidResultFrame(payload.toString());
            return result?.auctionId === auctionId && result.decision === "REJECTED";
          },
        }),
      ]);
      expect(receipt.status()).toBe(202);
      const acceptedForProcessing = await receipt.json();
      expect(acceptedForProcessing).toMatchObject({ bidRequestId: expect.any(String), status: "RECEIVED" });
      expect(parseBidResultFrame(rejection.payload.toString())).toMatchObject({
        bidRequestId: acceptedForProcessing.bidRequestId, reason: "AUCTION_ENDED", currentPrice: 21_000,
      });
      expect(await readAuction(request, auctionId)).toEqual(closed);

      const personal = (viewer: Page) => viewer.getByRole("region", { name: "본인 입찰 결과" });
      await expect(personal(bidderA.page)).toHaveText("내가 낙찰받았습니다.");
      await expect(personal(bidderB.page)).toHaveText("패찰했습니다.");

      await showAuctionDetail(page, auctionId);
      await expect(page.getByText("낙찰 · 21,000원", { exact: true })).toBeVisible();
      await expect(personal(page)).toHaveText("승인된 입찰 내역이 없습니다.");

      await bidderA.page.reload();
      await expect(bidderA.page.getByText("낙찰 · 21,000원", { exact: true })).toBeVisible();
      await expect(personal(bidderA.page)).toHaveCount(0);
      await signInLocal(bidderA.page, "e2e-bidder-a");
      await showAuctionDetail(bidderA.page, auctionId);
      await expect(personal(bidderA.page)).toHaveText("내가 낙찰받았습니다.");
    } finally {
      await bidderA.context.close();
      await bidderB.context.close();
    }
  });

  test("직접 입찰 재시도는 같은 요청이고 같은 사용자의 후속 입찰은 새 요청이다", async ({ page, browser, request },testInfo) => {
    const diagnostics=createDirectFailureDiagnostics(testInfo,webBaseUrl,apiBaseUrl);
    const actorA = "e2e-direct-a";
    let bidderA:Awaited<ReturnType<typeof openBidderPage>>|undefined,bidderB:Awaited<ReturnType<typeof openBidderPage>>|undefined;
    let originalFailure=false;
    try {
      await setE2eClock(request, "2030-01-01T12:00:00Z");
      const auctionId = await registerAuction(page, "e2e-seller-direct");
      diagnostics.register(auctionId);
      await setE2eClock(request, "2030-01-01T12:20:00Z");
      bidderA = await openBidderPage(browser, auctionId, actorA);
      diagnostics.page('A',bidderA.page,bidderA.socket);
      bidderB = await openBidderPage(browser, auctionId, "e2e-direct-b");
      diagnostics.page('B',bidderB.page,bidderB.socket);
      const first = await submitDirectBid(bidderA.page, auctionId, "12000",r=>diagnostics.record('A',12000,r));
      await expect(bidderA.page.getByText("입찰이 승인되었습니다. 이 요청 처리 당시 최고 입찰자였습니다.")).toBeVisible({ timeout: 10_000 });
      await expect(bidderA.page.getByText("12,000원")).toBeVisible({ timeout: 10_000 });

      const retry = async(amount: number) => {const response=await request.post(`${apiBaseUrl}/api/v1/auctions/${auctionId}/bid-requests`, {
        headers: { "X-Actor-Id": actorA, "Idempotency-Key": first.key },
        data: { bidKind: "DIRECT", amount },
      });await diagnostics.record('A',amount,response,first.key);return response;};
      for (let batch = 0; batch < 10; batch++) {
        const replays = await Promise.all(Array.from({ length: 10 }, () => retry(12_000)));
        for (const replay of replays) {
          expect(replay.status()).toBe(202);
          expect(await replay.json()).toMatchObject({ bidRequestId: first.id, status: "RECEIVED" });
        }
      }
      const conflict = await retry(99_000);
      expect(conflict.status()).toBe(409);
      expect(await conflict.json()).toEqual({ code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" });
      expect(await readAuction(request, auctionId)).toMatchObject({ currentPrice: 12_000 });

      await submitDirectBid(bidderB.page, auctionId, "13000",r=>diagnostics.record('B',13000,r));
      await expect(bidderA.page.getByText("13,000원")).toBeVisible({ timeout: 10_000 });
      await expect(bidderB.page.getByText("13,000원")).toBeVisible({ timeout: 10_000 });
      await expect(bidderA.page.getByText("입찰이 승인되었습니다. 이 요청 처리 당시 최고 입찰자였습니다.", { exact: true })).toBeVisible();
      await expect(bidderA.page.getByText(/현재 최고 입찰자/)).toHaveCount(0);

      const next = await submitDirectBid(bidderA.page, auctionId, "14000",r=>diagnostics.record('A',14000,r));
      expect(next.id).not.toBe(first.id);
      expect(next.key).not.toBe(first.key);
      await expect(bidderA.page.getByText("입찰이 승인되었습니다. 이 요청 처리 당시 최고 입찰자였습니다.")).toBeVisible({ timeout: 10_000 });
      await expect(bidderA.page.getByText("14,000원")).toBeVisible({ timeout: 10_000 });
      await expect(bidderB.page.getByText("14,000원")).toBeVisible({ timeout: 10_000 });
      diagnostics.verified();
      if(diagnostics.probe)throw new Error('BIDFLOW_EXPECTED_CORRELATION_FAILURE');
    } catch(error){
      originalFailure=true;
      try{await diagnostics.capture();}catch{}
      throw error;
    } finally {
      let cleanupFailed=false;
      try{diagnostics.dispose();}catch{cleanupFailed=true;}
      for(const bidder of [bidderA,bidderB])try{await bidder?.context.close();}catch{cleanupFailed=true;}
      if(cleanupFailed){try{testInfo.annotations.push({type:'failure-cleanup',description:'failed'});}catch{}if(!originalFailure)throw Error('E2E_CLEANUP_FAILED');}
    }
  });

  test("순차 입찰 20건의 개인 결과와 양쪽 화면 관측 지연을 기록한다", async ({ page, browser, request }, testInfo) => {
    test.skip(process.env.BIDFLOW_E2E_LATENCY !== "1", "BIDFLOW_E2E_LATENCY=1을 지정한 로컬 지연 관측 회차만 실행합니다.");
    test.setTimeout(120_000);
    const samples: { index: number; amount: number; requestId?: string; httpMs?: number; privateMs?: number; screenMs?: number;
      fineScreenMs?: number; fineMaxCheckGapMs?: number | null; fineCheckCount?: number;
      fineAfterPrivateMs?: number; baselineAfterPrivateMs?: number; baselineMinusFineMs?: number; error?: string }[] = [];
    const runId = randomUUID();
    let auctionId: string | undefined;
    let completed = false;
    let observationOpen = false;
    const closeObservation = () => {
      if (observationOpen) {
        process.stdout.write(windowMarker("bid", "close") + "\n");
        observationOpen = false;
      }
    };
    const contexts: Awaited<ReturnType<typeof openBidderPage>>[] = [];
    const startedAt = new Date().toISOString();
    try {
      await setE2eClock(request, "2030-01-01T12:00:00Z");
      auctionId = await registerAuction(page, `latency-seller-${runId}`);
      await setE2eClock(request, "2030-01-01T12:20:00Z");
      contexts.push(await openBidderPage(browser, auctionId, `latency-a-${runId}`));
      contexts.push(await openBidderPage(browser, auctionId, `latency-b-${runId}`));
      for (let index = 0; index < 20; index++) {
        const bidder = contexts[index % 2]!;
        const amount = 11_000 + index * 1_000;
        const sample: typeof samples[number] = { index, amount };
        samples.push(sample);
        const approval = bidder.page.getByText("입찰이 승인되었습니다. 이 요청 처리 당시 최고 입찰자였습니다.", { exact: true });
        await bidder.page.getByLabel("입찰 금액").fill(String(amount));
        await expect(approval).toHaveCount(0);
        const frames: { result: NonNullable<ReturnType<typeof parseBidResultFrame>>; receivedAt: number }[] = [];
        const receive = ({ payload }: { payload: string | Buffer }) => {
          const result = parseBidResultFrame(payload.toString());
          if (result) frames.push({ result, receivedAt: performance.now() });
        };
        bidder.socket.on("framereceived", receive);
        if (index === 0 && process.env.BIDFLOW_E2E_OBSERVATION === "1") {
          process.stdout.write(windowMarker("bid", "open") + "\n");
          observationOpen = true;
        }
        const start = performance.now();
        const remaining = () => Math.max(1, 10_000 - (performance.now() - start));
        try {
          const [response] = await Promise.all([
            bidder.page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/auctions/${auctionId}/bid-requests`
              && r.request().method() === "POST", { timeout: 10_000 }),
            bidder.page.getByRole("button", { name: "입찰 요청" }).click({ timeout: 10_000 }),
          ]);
          const receipt = await response.json();
          sample.httpMs = performance.now() - start;
          expect(response.status()).toBe(202);
          expect(receipt.status).toBe("RECEIVED");
          expect(receipt.bidRequestId).toMatch(/^[0-9a-f-]{36}$/);
          expect(samples.slice(0, -1).some(s => s.requestId === receipt.bidRequestId)).toBe(false);
          sample.requestId = receipt.bidRequestId;
          const hasResult = () => frames.some(frame => matchesObservedBid(frame.result,
            { requestId: sample.requestId, auctionId, amount }));
          const prices = contexts.map(viewer => viewer.page.getByText(`${amount.toLocaleString("ko-KR")}원`, { exact: true }));
          // Paired on the same event: retain the baseline while measuring a finer observation alongside it.
          const [baselineMs, fine] = await Promise.all([
            (async () => {
              await expect.poll(hasResult, { timeout: remaining() }).toBe(true);
              await expect(approval).toBeVisible({ timeout: remaining() });
              await Promise.all(prices.map(price => expect(price).toBeVisible({ timeout: remaining() })));
              return performance.now() - start;
            })(),
            (async () => {
              const checks: number[] = [];
              await expect.poll(async () => {
                const ready = hasResult() && (await Promise.all([approval, ...prices].map(locator => locator.isVisible()))).every(Boolean);
                checks.push(performance.now() - start);
                return ready;
              }, { timeout: remaining(), intervals: [25] }).toBe(true);
              const gaps = checks.slice(1).map((time, index) => time - checks[index]!);
              return { elapsed: performance.now() - start, count: checks.length, maxGap: gaps.length ? Math.max(...gaps) : null };
            })(),
          ]);
          sample.privateMs = frames.find(frame => matchesObservedBid(frame.result,
            { requestId: sample.requestId, auctionId, amount }))!.receivedAt - start;
          sample.screenMs = baselineMs;
          sample.fineScreenMs = fine.elapsed;
          sample.fineCheckCount = fine.count;
          sample.fineMaxCheckGapMs = fine.maxGap;
          Object.assign(sample, observationTimings(sample.privateMs, sample.fineScreenMs, sample.screenMs));
          expect(sample.screenMs).toBeLessThanOrEqual(10_000);
        } catch (error) {
          sample.error = "RECEIPT_RESULT_OR_SCREEN_FAILED";
          throw error;
        } finally { bidder.socket.off("framereceived", receive); }
      }
      closeObservation();
      expect(await readAuction(request, auctionId)).toMatchObject({ status: "ACTIVE", currentPrice: 30_000, auctionVersion: 21 });
      completed = true;
      expect(percentiles(samples.map(s => s.screenMs!)).p95).toBeLessThanOrEqual(2000);
    } finally {
      closeObservation();
      const finalSamples = samples.filter(s => s.screenMs !== undefined && !s.error);
      const evidence = { startedAt, completedAt: new Date().toISOString(), runId, auctionId,
        commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        chromium: browser.version(), completed: finalSamples.length, incomplete: 20 - finalSamples.length,
        p95WithinTarget: completed && percentiles(finalSamples.map(s => s.screenMs!)).p95 <= 2000,
        http: percentiles(finalSamples.map(s => s.httpMs!)), privateResult: percentiles(finalSamples.map(s => s.privateMs!)),
        screen: percentiles(finalSamples.map(s => s.screenMs!)), samples };
      Object.assign(evidence, { observation: { baseline: "Playwright default poll/locator assertions", fineIntervalsMs: [25],
        pairedOnSameRequest: true }, fineScreen: percentiles(finalSamples.map(s => s.fineScreenMs!)),
        fineAfterPrivate: percentiles(finalSamples.map(s => s.fineAfterPrivateMs!)),
        baselineAfterPrivate: percentiles(finalSamples.map(s => s.baselineAfterPrivateMs!)) });
      const evidencePath = testInfo.outputPath("browser-result-latency.json");
      await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
      await testInfo.attach("browser-result-latency", { path: evidencePath, contentType: "application/json" });
      await Promise.all(contexts.map(viewer => viewer.context.close()));
    }
  });

  test("동시 두 사용자 입찰 10회의 개인 결과와 화면 수렴을 관측한다", async ({ page, browser, request }, testInfo) => {
    test.skip(process.env.BIDFLOW_E2E_CONCURRENT_LATENCY !== "1", "명시적 로컬 동시 관측 플래그가 필요합니다.");
    test.setTimeout(300_000);
    expect(testInfo.config.workers).toBe(1);
    expect(testInfo.project.retries).toBe(0);
    expect(webBaseUrl).toBe("http://127.0.0.1:5173");
    expect(apiBaseUrl).toBe("http://127.0.0.1:8080");
    const smoke = process.env.BIDFLOW_E2E_CONCURRENT_SMOKE === "1";
    const runId = randomUUID();
    const observations: Parameters<typeof summarizeConcurrentRun>[0] = [];
    const sqlChecks: { index: number; valid: boolean; error?: string }[] = [];
    const collectionErrors: { index: number; error: string }[] = [];
    const fixtures: { index: number; auctionId: string }[] = [];
    const startedAt = new Date().toISOString();
    let phase = "FIXTURE", finished = false;
    try {
      for (let index = 0; index < (smoke ? 1 : 10); index++) {
        phase = "FIXTURE";
        await setE2eClock(request, "2030-01-01T12:00:00Z");
        const auctionId = await registerAuction(page, `concurrent-seller-${runId}`);
        fixtures.push({ index, auctionId });
        await setE2eClock(request, "2030-01-01T12:20:00Z");
        const initial = await readAuction(request, auctionId) as { auctionVersion: number; currentPrice: number; endsAt: string };
        expect(initial).toMatchObject({ auctionVersion: 1, currentPrice: 10000, endsAt: "2030-01-01T12:30:00Z" });
        const actors = { A: `concurrent-a-${runId}`, B: `concurrent-b-${runId}` };
        const submissionKeys = new Set<string>();
        const viewers: Awaited<ReturnType<typeof openBidderPage>>[] = [];
        try {
          viewers.push(await openBidderPage(browser, auctionId, actors.A));
          viewers.push(await openBidderPage(browser, auctionId, actors.B));
          await Promise.all(viewers.map((viewer, i) => viewer.page.getByLabel("입찰 금액").fill(String(11000 + i * 1000))));
          phase = "COLLECTION";
          const collection = await collectConcurrentRound({ index, auctionId, now: () => performance.now(),
            subscribe(receive) {
              const listeners = viewers.map((viewer, i) => {
                const listener = ({ payload }: { payload: string | Buffer }) => {
                  const result = parseBidResultFrame(payload.toString());
                  if (result) receive(i === 0 ? "A" : "B", result);
                };
                viewer.socket.on("framereceived", listener);
                return () => viewer.socket.off("framereceived", listener);
              });
              return () => { listeners.forEach(remove => remove()); };
            },
            async submit(bidder, { onStart, onPost, remaining, signal }) {
              const viewer = viewers[bidder === "A" ? 0 : 1]!;
              const matches = (url: string) => new URL(url).pathname === `/api/v1/auctions/${auctionId}/bid-requests`;
              const sent = (r: import("@playwright/test").Request) => { if (r.method() === "POST" && matches(r.url())) onPost(); };
              viewer.page.on("request", sent);
              const detach = () => { viewer.page.off("request", sent); };
              signal.addEventListener("abort", detach, { once: true });
              try {
                const response = viewer.page.waitForResponse(r => r.request().method() === "POST" && matches(r.url()), { timeout: remaining() });
                onStart();
                const [receipt] = await Promise.all([response, viewer.page.getByRole("button", { name: "입찰 요청" }).click({ timeout: remaining() })]);
                const key = await receipt.request().headerValue("idempotency-key");
                if (!key || !/^[0-9a-f-]{36}$/.test(key) || submissionKeys.has(key)) throw new Error("멱등 키 누락 또는 중복");
                submissionKeys.add(key);
                const body = await receipt.json();
                return { httpStatus: receipt.status(), receiptStatus: body.status, requestId: body.bidRequestId };
              } finally { signal.removeEventListener("abort", detach); detach(); }
            },
            async observeScreen({ input, remaining }) {
              const decisions: { bidder: string; decision: string }[] = [];
              for (const [i, viewer] of viewers.entries()) {
                const bidder = i === 0 ? "A" : "B";
                const receipt = input.receipts.find(r => r.bidder === bidder)!;
                const matched = () => input.frames.find(f => f.bidder === bidder && f.result.auctionId === auctionId
                  && f.result.bidRequestId === receipt.requestId);
                await expect.poll(() => Boolean(matched()), { timeout: remaining() }).toBe(true);
                const decision = matched()!.result.decision;
                if (decision !== "ACCEPTED" && decision !== "REJECTED") throw new Error("개인 판정 누락");
                if (decision === "ACCEPTED") {
                  await expect(viewer.page.getByRole("status").filter({ hasText: "입찰이 승인되었습니다." })).toBeVisible({ timeout: remaining() });
                } else {
                  await expect(viewer.page.getByRole("alert")).toHaveText("입찰이 거절되었습니다.", { timeout: remaining() });
                }
                decisions.push({ bidder, decision });
              }
              await Promise.all(viewers.map(viewer => expect(viewer.page.getByText("12,000원", { exact: true })).toBeVisible({ timeout: remaining() })));
              return { prices: [12000, 12000], decisions };
            },
          });
          observations.push(collection.input);
          if (collection.error) collectionErrors.push({ index, error: collection.error });
          expect(collection.error).toBeNull();
          expect(collection.verdict.valid).toBe(true);
          phase = "SQL";
          const snapshot = await readConcurrentSql(auctionId, collection.input.receipts.map(r => r.requestId));
          const sql = judgeConcurrentSql(collection.input, snapshot, actors, initial.endsAt);
          sqlChecks.push({ index, ...sql });
          expect(sql.valid).toBe(true);
        } finally { await Promise.all(viewers.map(viewer => viewer.context.close())); }
      }
      finished = true;
      if (!smoke) expect(summarizeConcurrentRun(observations).p95WithinTarget).toBe(true);
    } finally {
      const summary = summarizeConcurrentRun(observations);
      const sqlVerified = sqlChecks.length === (smoke ? 1 : 10) && sqlChecks.every(check => check.valid);
      const evidence = { ...summary, sqlVerified, valid: !smoke && finished && !collectionErrors.length && summary.observationValid && sqlVerified,
        smoke, smokeVerified: smoke && finished && sqlVerified && !collectionErrors.length,
        runId, startedAt, completedAt: new Date().toISOString(), phase,
        commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        node: process.version, chromium: browser.version(), fixtures, sqlChecks, collectionErrors, observations };
      const path = testInfo.outputPath("concurrent-browser-latency.json");
      await writeFile(path, JSON.stringify(evidence, null, 2));
      await testInfo.attach("concurrent-browser-latency", { path, contentType: "application/json" });
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

  test("OpenSearch 복합 필터와 정렬을 적용하고 실제 경매 상세를 연다", async ({ page, request }) => {
    test.skip(process.env.BIDFLOW_E2E_SEARCH !== "1", "검색 E2E는 make local-up-search 및 BIDFLOW_E2E_SEARCH=1이 필요합니다.");

    await setE2eClock(request, "2030-01-01T12:00:00Z");
    const token = `e2ecamera${randomUUID().replaceAll("-", "")}`;
    const title = `${token} Basic`;
    const premium = `${token} Premium`;
    const outside = `${token} Outside`;
    const auctionId = await registerAuction(page, "e2e-seller-search", title);
    const premiumId = await registerAuction(page, "e2e-seller-search", premium, "14000");
    const outsideId = await registerAuction(page, "e2e-seller-search", outside, "20000");
    const searchUrl = `${apiBaseUrl}/api/v1/listings/search?${new URLSearchParams({ q: token })}`;
    await expect.poll(async () => {
      const response = await request.get(searchUrl);
      if (!response.ok()) return `검색 API HTTP ${response.status()}`;
      const result: { items: { title: string; auctionId: string | null }[] } = await response.json();
      return result.items.map(item => item.auctionId).sort();
    }, { timeout: 15_000, message: "필터를 설정하기 전에 세 상품 모두 색인되어야 합니다." }).toEqual([auctionId, premiumId, outsideId].sort());

    await page.goBack();
    await page.getByRole("main").getByRole("link", { name: "경매 둘러보기" }).click();
    await page.getByLabel("검색어", { exact: true }).fill(token);
    await page.getByLabel("카테고리", { exact: true }).selectOption("DIGITAL");
    await page.getByLabel("경매 상태", { exact: true }).selectOption("SCHEDULED");
    await page.getByLabel("최소 가격 (원)").fill("10000");
    await page.getByLabel("최대 가격 (원)").fill("14000");
    await page.getByLabel("마감 시각 이전 (UTC)").fill("2030-01-01T12:30");
    await page.getByLabel("정렬", { exact: true }).selectOption("PRICE_DESC");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    const results = page.getByRole("listitem");
    await expect(results).toHaveCount(2);
    await expect(results.nth(0).getByRole("link", { name: premium, exact: true })).toBeVisible();
    await expect(results.nth(1).getByRole("link", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: outside, exact: true })).toHaveCount(0);
    const link = page.getByRole("link", { name: title, exact: true });
    await expect(link).toHaveAttribute("href", `/auctions/${auctionId}`);
    await link.click();
    await expect(page).toHaveURL(`${webBaseUrl}/auctions/${auctionId}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "입찰 요청" })).toBeVisible();
    await page.goBack();
    await page.reload();
    await expect(page.getByLabel("최대 가격 (원)")).toHaveValue("14000");
    await expect(results).toHaveCount(2);
    await expect(results.nth(0).getByRole("link", { name: premium, exact: true })).toBeVisible();
  });
});

async function openBidderPage(browser: Browser, auctionId: string, actorId: string) {
  const context = await browser.newContext({ baseURL: webBaseUrl });
  try {
    const page = await context.newPage();
    await signInLocal(page, actorId);
    const [socket] = await Promise.all([waitForAuctionSubscriptions(page, auctionId), showAuctionDetail(page, auctionId)]);
    return { context, page, socket };
  } catch (error) { await context.close(); throw error; }
}

async function signInLocal(page: Page, actorId: string) {
  await page.goto("/login");
  await page.getByLabel("로컬 개발자 ID").fill(actorId);
  await page.getByRole("button", { name: "로컬 로그인" }).click();
  await page.waitForURL("/");
}

async function showAuctionDetail(page: Page, auctionId: string) {
  await page.evaluate((id) => {
    window.history.pushState({}, "", `/auctions/${id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, auctionId);
  await expect(page.getByRole("heading", { name: "e2e-camera" })).toBeVisible();
}

async function submitAutoBid(page: Page, amount: string): Promise<void> {
  await page.getByLabel("입찰 방식").selectOption("AUTO_MAX");
  await page.getByLabel("입찰 금액").fill(amount);
  await page.getByRole("button", { name: "입찰 요청" }).click();
  await expect(page.getByRole("status")).toContainText("입찰 요청을 접수했습니다. 요청 번호:");
}

async function submitDirectBid(page: Page, auctionId: string, amount: string,observe?:(response:import('@playwright/test').Response)=>Promise<void>) {
  await page.getByLabel("입찰 금액").fill(amount);
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/auctions/${auctionId}/bid-requests`
      && response.request().method() === "POST"),
    page.getByRole("button", { name: "입찰 요청" }).click(),
  ]);
  if(observe)await observe(response);
  expect(response.status()).toBe(202);
  const key = await response.request().headerValue("idempotency-key");
  const result: { bidRequestId?: string } = await response.json();
  if (!key || !result.bidRequestId) throw new Error("직접 입찰의 멱등 키 또는 요청 ID가 누락됐습니다.");
  return { key, id: result.bidRequestId };
}

async function registerAuction(page: Page, sellerId: string, title = "e2e-camera", startingPrice = "10000"): Promise<string> {
  await signInLocal(page, sellerId);
  await page.getByRole("main").getByRole("link", { name: "상품 등록하기" }).click();

  await page.getByLabel("상품 제목").fill(title);
  await page.getByLabel("상품 설명").fill("Playwright가 등록 흐름을 검증하는 테스트 상품입니다.");
  await page.getByLabel("카테고리").selectOption("DIGITAL");
  await page.getByLabel("상품 상태").selectOption("GOOD");
  await page.getByLabel("시작가 (원)").fill(startingPrice);
  await page.getByLabel("시작 시각 (UTC)").fill("2030-01-01T12:10");
  await page.getByLabel("마감 시각 (UTC)").fill("2030-01-01T12:30");
  await page.getByLabel("사진 추가").setInputFiles({ name: "camera.png", mimeType: "image/png", buffer: Buffer.from("e2e-image") });

  await expect(page.getByText("업로드 완료")).toBeVisible();
  await page.getByRole("button", { name: "상품 등록" }).click();
  await expect(page.getByRole("status")).toHaveText("상품을 등록했어요.");
  const detailLink = page.getByRole("link", { name: "경매 상세 보기" });
  await expect(detailLink).toHaveAttribute("href", /^\/auctions\/[0-9a-f-]{36}$/);
  const auctionId = (await detailLink.getAttribute("href"))!.split("/").at(-1)!;
  if (process.env.BIDFLOW_E2E_STARTUP_OBSERVATION === "1") {
    process.stdout.write(JSON.stringify({ startupObservation: "auction", auctionId }) + "\n");
  }
  return auctionId;
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

function parseBidResultFrame(payload: string) {
  const message = /^MESSAGE\r?\n[\s\S]*?\r?\n\r?\n([^\0]+)\0?$/.exec(payload);
  return message?.[1] ? parseBidResultMessage(message[1]) : null;
}

function waitForAuctionSubscriptions(page: Page, auctionId: string): Promise<WebSocket> {
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
          resolve(socket);
        }
      });
    });
  });
}
