import { isUuid } from './final-settlement.mjs';
import { judgeConcurrentRound } from './concurrent-browser-observation.mjs';

const decision = value => ['ACCEPTED', 'REJECTED'].includes(value) ? value : null;
const number = value => Number.isFinite(value) ? value : null;
const identifier = value => isUuid(value) ? value : null;
const bidderLabel = value => ['A', 'B'].includes(value) ? value : null;

/**
 * @typedef {{bidder:string, amount:number, startedMs?:number, postMs?:number,
 *   httpCompletedMs?:number, httpStatus?:number|null, receiptStatus?:string|null, requestId?:string|null}} Receipt
 * @typedef {{index:number, auctionId:string, receipts:Receipt[], frames:Array<{bidder:string|null, receivedMs:number,
 *   result:{type:string|null, bidRequestId:string|null, auctionId:string|null, auctionVersion:number|null,
 *   decision:string|null, reason:string|null, currentPrice:number|null, isHighestBidder:boolean|null}}>,
 *   screen?:{completedMs:number, prices:Array<number|null>, decisions:Array<{bidder:string|null, decision:string|null}>}}} RoundInput
 */

/** @param {{index:number, auctionId:string, now:()=>number, timeoutMs?:number,
 * subscribe:(receive:(bidder:string, result:unknown)=>void)=>(()=>void),
 * submit:(bidder:string, context:{onStart:()=>void, onPost:()=>void, signal:AbortSignal, remaining:()=>number})=>Promise<{httpStatus:number, receiptStatus:string, requestId:string}>,
 * observeScreen:(context:{input:RoundInput, signal:AbortSignal, remaining:()=>number})=>Promise<{prices:number[], decisions:Array<{bidder:string, decision:string}>}>
 * }} options */
export async function collectConcurrentRound({ index, auctionId, now, subscribe, submit, observeScreen, timeoutMs = 10000 }) {
  if (!Number.isInteger(index) || index < 0 || index > 9 || !isUuid(auctionId)
    || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000
    || [now, subscribe, submit, observeScreen].some(fn => typeof fn !== 'function')) throw Error('invalid collection input');
  const origin = now();
  if (!Number.isFinite(origin)) throw Error('invalid clock');
  const elapsed = () => now() - origin;
  const remaining = () => Math.max(1, Math.floor(timeoutMs - elapsed()));
  /** @type {RoundInput} */
  const input = { index, auctionId, receipts: [], frames: [] };
  const controller = new AbortController();
  let closed = false, detach, error = null, stage = 'SUBSCRIPTION_FAILED', timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { error = 'OBSERVATION_TIMEOUT'; reject(Error('deadline')); }, timeoutMs);
  });
  try {
    detach = subscribe((bidder, result) => {
      if (closed) return;
      // Only parsed, allowlisted fields cross into the evidence object.
      input.frames.push({ bidder: bidderLabel(bidder), receivedMs: elapsed(), result: {
        type: result?.type === 'bid.result' ? 'bid.result' : null,
        bidRequestId: identifier(result?.bidRequestId), auctionId: identifier(result?.auctionId),
        auctionVersion: number(result?.auctionVersion), decision: decision(result?.decision),
        reason: result?.reason === null ? null : ['BID_TOO_LOW', 'SELF_BID'].includes(result?.reason) ? result.reason : 'UNEXPECTED_REASON',
        currentPrice: number(result?.currentPrice),
        isHighestBidder: typeof result?.isHighestBidder === 'boolean' ? result.isHighestBidder : null,
      } });
    });
    if (typeof detach !== 'function') throw Error('missing detach');
    stage = 'SUBMISSION_FAILED';
    await Promise.race([deadline, Promise.all(['A', 'B'].map(async (bidder, i) => {
      const receipt = { bidder, amount: 11000 + i * 1000 };
      input.receipts.push(receipt);
      const response = await submit(bidder, { signal: controller.signal, remaining,
        onStart() {
          if (closed) return;
          if (receipt.startedMs !== undefined) error = 'MULTIPLE_STARTS';
          else receipt.startedMs = elapsed();
        },
        onPost() {
          if (closed) return;
          if (receipt.postMs !== undefined) error = 'MULTIPLE_POSTS';
          else receipt.postMs = elapsed();
        } });
      if (!closed) Object.assign(receipt, { httpCompletedMs: elapsed(),
        httpStatus: Number.isInteger(response?.httpStatus) ? response.httpStatus : null,
        receiptStatus: response?.receiptStatus === 'RECEIVED' ? 'RECEIVED' : null,
        requestId: identifier(response?.requestId) });
    }))]);
    stage = 'SCREEN_OBSERVATION_FAILED';
    const screen = await Promise.race([deadline,
      observeScreen({ input, signal: controller.signal, remaining })]);
    input.screen = { completedMs: elapsed(), prices: Array.isArray(screen?.prices) ? screen.prices.map(number) : [],
      decisions: Array.isArray(screen?.decisions) ? screen.decisions.map(s => ({ bidder: bidderLabel(s?.bidder), decision: decision(s?.decision) })) : [] };
    if (elapsed() >= timeoutMs) error = 'OBSERVATION_TIMEOUT';
  } catch { error ??= stage; }
  finally {
    closed = true;
    clearTimeout(timer);
    controller.abort();
    try { detach?.(); } catch { error = 'LISTENER_CLEANUP_FAILED'; }
  }
  const verdict = judgeConcurrentRound(input);
  if (error) { verdict.valid = false; verdict.errors.push(error); }
  else if (!verdict.valid) error = 'OBSERVATION_INVALID';
  return { input, verdict, error };
}
