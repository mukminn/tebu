import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { OnchainScoreService, type OnchainScoreResult } from "@/lib/onchainScoreService";

type CacheEntry = {
  value: OnchainScoreResult;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60_000;

function getFromCache(address: string): OnchainScoreResult | null {
  const v = cache.get(address.toLowerCase());
  if (!v) return null;
  if (Date.now() > v.expiresAt) {
    cache.delete(address.toLowerCase());
    return null;
  }
  return v.value;
}

function setCache(address: string, value: OnchainScoreResult, ttlMs: number) {
  cache.set(address.toLowerCase(), { value, expiresAt: Date.now() + ttlMs });
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
    // cache handled by our in-memory cache
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new Error(`Basescan HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return json;
}

async function basescanTxListFirstTimestamp(address: Address, apiKey: string): Promise<number | null> {
  const url = new URL("https://api.basescan.org/api");
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", address);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "99999999");
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", "1");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("apikey", apiKey);

  const json = await fetchJson(url.toString());
  const result = Array.isArray((json as { result?: unknown })?.result) ? (json as { result: unknown[] }).result : [];
  if (!result.length) return null;
  const first = result[0] as { timeStamp?: unknown };
  const ts = Number(first?.timeStamp);
  if (!Number.isFinite(ts)) return null;
  return ts;
}

async function basescanTokenTxCountLookback(address: Address, apiKey: string, max: number): Promise<number> {
  const url = new URL("https://api.basescan.org/api");
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "tokentx");
  url.searchParams.set("address", address);
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(max));
  url.searchParams.set("sort", "desc");
  url.searchParams.set("apikey", apiKey);

  const json = await fetchJson(url.toString());
  const result = Array.isArray((json as { result?: unknown })?.result) ? (json as { result: unknown[] }).result : [];
  return result.length;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const addressParam = searchParams.get("address")?.trim() ?? "";
  const ttlMs = Number(searchParams.get("ttlMs") ?? "") || DEFAULT_TTL_MS;

  if (!addressParam || !isAddress(addressParam)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const cached = getFromCache(addressParam);
  if (cached) return NextResponse.json(cached);

  const address = addressParam as Address;
  const apiKey = process.env.BASESCAN_API_KEY;

  // Always have a fallback (RPC scoring) so UI never hard-fails.
  const rpcFallback = async (): Promise<OnchainScoreResult> => {
    const svc = new OnchainScoreService();
    return svc.compute(address);
  };

  if (!apiKey) {
    const score = await rpcFallback();
    setCache(address, score, ttlMs);
    return NextResponse.json(score);
  }

  try {
    const [firstTs, tokenTxCount] = await Promise.all([
      basescanTxListFirstTimestamp(address, apiKey),
      basescanTokenTxCountLookback(address, apiKey, 100),
    ]);

    // Use RPC engine as base, but reduce log pressure by overriding interaction proxy with Basescan data.
    const baseScore = await rpcFallback();

    const now = Math.floor(Date.now() / 1000);
    const walletAgeDays = firstTs ? Math.max(0, Math.floor((now - firstTs) / 86400)) : null;

    const walletAgeScore = walletAgeDays === null ? 0 : Math.max(0, Math.min(120, walletAgeDays * 4));
    const interactionScore = Math.max(0, Math.min(160, Math.sqrt(tokenTxCount) * 22));

    const breakdown = {
      ...baseScore.breakdown,
      walletAge: walletAgeScore,
      contractInteractions: interactionScore,
    };

    const totalScore = Math.max(
      0,
      Math.min(
        1000,
        breakdown.walletAge +
          breakdown.txCount +
          breakdown.gasUsage +
          breakdown.contractInteractions +
          breakdown.defiNftUsage -
          breakdown.penalties,
      ),
    );

    const score: OnchainScoreResult = {
      ...baseScore,
      totalScore,
      breakdown,
      notes: [...(baseScore.notes ?? []), "Basescan: account txlist + tokentx used for age/interactions."],
    };

    setCache(address, score, ttlMs);
    return NextResponse.json(score);
  } catch {
    const score = await rpcFallback();
    setCache(address, score, ttlMs);
    return NextResponse.json(score);
  }
}
