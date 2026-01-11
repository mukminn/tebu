import { base } from "viem/chains";
import {
  createPublicClient,
  fallback,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type Transport,
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
].filter(Boolean) as string[];

function createTransport(): Transport {
  const transports = rpcUrls.map((url) => http(url));
  return transports.length > 1 ? fallback(transports) : transports[0] ?? http("https://mainnet.base.org");
}

let _client: PublicClient | undefined;

export function getBasePublicClient(): PublicClient {
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

export async function verifyBaseChainId(client: PublicClient = getBasePublicClient()): Promise<boolean> {
  const chainId = await cachedRequest(
    "eth_chainId",
    [],
    async () => client.getChainId(),
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
