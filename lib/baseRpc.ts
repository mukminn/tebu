import { base } from "viem/chains";
import {
  createPublicClient,
  fallback,
  http,
  type Address,
  type Hex,
} from "viem";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 30_000;

const memoryCache = new Map<string, CacheEntry<unknown>>();

function getCacheKey(method: string, params: unknown[]): string {
  return `${method}:${JSON.stringify(params)}`;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries: number; baseDelayMs: number } = { retries: 2, baseDelayMs: 300 },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= options.retries) break;
      const delay = options.baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function cacheGet<T>(key: string): T | undefined {
  const entry = memoryCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet<T>(key: string, value: T, ttlMs: number) {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

const rpcUrls = [
  process.env.NEXT_PUBLIC_BASE_RPC_URL,
  process.env.NEXT_PUBLIC_BASE_RPC_URL_FALLBACK,
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base.publicnode.com",
  "https://1rpc.io/base",
  "https://rpc.ankr.com/base",
].filter(Boolean) as string[];

function createTransport() {
  const transports = rpcUrls.map((url) => http(url));
  return transports.length > 1 ? fallback(transports) : transports[0] ?? http("https://mainnet.base.org");
}

let _client: unknown | undefined;

export function getBasePublicClient(): unknown {
  if (_client) return _client;
  _client = createPublicClient({
    chain: base,
    transport: createTransport(),
  });
  return _client;
}

export async function cachedRequest<T>(
  method: string,
  params: unknown[],
  request: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const key = getCacheKey(method, params);
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;
  const value = await request();
  cacheSet(key, value, ttlMs);
  return value;
}

type ChainIdReader = {
  getChainId: () => Promise<number>;
};

export async function verifyBaseChainId(client: unknown = getBasePublicClient()): Promise<boolean> {
  const reader = client as ChainIdReader;
  const chainId = await cachedRequest(
    "eth_chainId",
    [],
    async () => reader.getChainId(),
    60_000,
  );
  return chainId === base.id;
}

export type TransferLog = {
  address: Address;
  blockNumber: bigint;
  transactionHash: Hex;
  topics: readonly Hex[];
};
