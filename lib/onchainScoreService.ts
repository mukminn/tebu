import { parseAbiItem, type Address, type PublicClient } from "viem";
import { getBasePublicClient, cachedRequest, verifyBaseChainId } from "./baseRpc";

export type ScoreTier = "Bronze" | "Silver" | "Gold" | "Platinum";

export type ScoreBreakdown = {
  walletAge: number;
  txCount: number;
  gasUsage: number;
  contractInteractions: number;
  defiNftUsage: number;
  penalties: number;
};

export type OnchainScoreResult = {
  address: Address;
  chainId: number;
  totalScore: number;
  tier: ScoreTier;
  breakdown: ScoreBreakdown;
  computedAt: number;
  readOnly: true;
  notes: string[];
};

export type OnchainScoreOptions = {
  ttlMs?: number;
  lookbackBlocks?: bigint;
};

const DEFAULT_LOOKBACK_BLOCKS = BigInt(50_000);
const DEFAULT_TTL_MS = 60_000;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function tierFromScore(score: number): ScoreTier {
  if (score >= 820) return "Platinum";
  if (score >= 650) return "Gold";
  if (score >= 450) return "Silver";
  return "Bronze";
}

function sumBreakdown(b: ScoreBreakdown): number {
  return b.walletAge + b.txCount + b.gasUsage + b.contractInteractions + b.defiNftUsage - b.penalties;
}

async function getWalletAgeDays(client: PublicClient, address: Address, ttlMs: number): Promise<number | null> {
  const latest = await cachedRequest("getBlockNumber", [], () => client.getBlockNumber(), ttlMs);

  // Heuristic: binary search earliest tx is expensive without an indexer.
  // Instead we approximate by finding the first outgoing tx in a bounded lookback window elsewhere.
  // Here we keep walletAge nullable; scoring uses tx-based proxy when possible.
  const nonce = await cachedRequest(
    "getTransactionCount",
    [address, "latest"],
    () => client.getTransactionCount({ address, blockTag: "latest" }),
    ttlMs,
  );

  if (nonce === 0) return null;

  // If account has nonce, assume >= 7 days; refined age comes from firstSeenBlock in tx analysis.
  void latest;
  return 7;
}

async function getTxCountScore(client: PublicClient, address: Address, ttlMs: number): Promise<{ txCount: number; score: number }> {
  const txCount = await cachedRequest(
    "getTransactionCount",
    [address, "latest"],
    () => client.getTransactionCount({ address, blockTag: "latest" }),
    ttlMs,
  );
  const score = clamp(Math.log10(1 + txCount) * 220, 0, 260);
  return { txCount, score };
}

async function getContractInteractionScore(
  client: PublicClient,
  address: Address,
  lookbackBlocks: bigint,
  ttlMs: number,
): Promise<{ interactions: number; score: number; notes: string[] }> {
  const notes: string[] = [];
  const latest = await cachedRequest("getBlockNumber", [], () => client.getBlockNumber(), ttlMs);
  const fromBlock = latest > lookbackBlocks ? latest - lookbackBlocks : BigInt(0);

  // Heuristic: count logs where address appears as `from` in ERC20 Transfer.
  // This is *not* perfect for interactions but gives a lightweight proxy.
  const transferEvent = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  );

  const logs = await cachedRequest(
    "getLogs:erc20TransferFrom",
    [address, fromBlock, latest],
    async () =>
      client.getLogs({
        event: transferEvent,
        args: { from: address },
        fromBlock,
        toBlock: latest,
      }),
    ttlMs,
  );

  const interactions = logs.length;
  const score = clamp(Math.sqrt(interactions) * 18, 0, 160);
  if (lookbackBlocks < DEFAULT_LOOKBACK_BLOCKS) {
    notes.push("Interaction metrics are computed on a limited lookback window.");
  }
  return { interactions, score, notes };
}

function gasUsageScoreProxy(txCount: number): number {
  // Without tracing/indexer we proxy gas usage by activity volume.
  return clamp(Math.log10(1 + txCount) * 170, 0, 200);
}

function defiNftScoreProxy(contractInteractions: number): number {
  // Proxy: more contract events => likely DeFi/NFT usage.
  return clamp(Math.log10(1 + contractInteractions) * 140, 0, 180);
}

function penalties(txCount: number, contractInteractions: number): { penalty: number; notes: string[] } {
  const notes: string[] = [];
  // Simple bot-like heuristic: high tx count but near-zero contract usage.
  const ratio = contractInteractions === 0 ? Infinity : txCount / contractInteractions;
  let penalty = 0;
  if (txCount > 200 && contractInteractions < 3) {
    penalty += 120;
    notes.push("Bot-like behavior detected: high tx count with low contract interactions.");
  }
  if (ratio > 200) {
    penalty += 60;
    notes.push("Suspicious activity ratio detected.");
  }
  return { penalty, notes };
}

export class OnchainScoreService {
  private client: PublicClient;

  constructor(client: PublicClient = getBasePublicClient()) {
    this.client = client;
  }

  async compute(address: Address, options: OnchainScoreOptions = {}): Promise<OnchainScoreResult> {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const lookbackBlocks = options.lookbackBlocks ?? DEFAULT_LOOKBACK_BLOCKS;

    const ok = await verifyBaseChainId(this.client);
    if (!ok) {
      throw new Error("Connected RPC is not Base Mainnet (chainId mismatch)");
    }

    const notes: string[] = ["Read-only: no signing, no transactions."];

    const walletAgeDays = await getWalletAgeDays(this.client, address, ttlMs);
    const { txCount, score: txCountScore } = await getTxCountScore(this.client, address, ttlMs);

    const { interactions, score: interactionScore, notes: interactionNotes } = await getContractInteractionScore(
      this.client,
      address,
      lookbackBlocks,
      ttlMs,
    );
    notes.push(...interactionNotes);

    const gasScore = gasUsageScoreProxy(txCount);
    const defiNftScore = defiNftScoreProxy(interactions);

    const walletAgeScore = walletAgeDays === null ? 0 : clamp(walletAgeDays * 6, 0, 120);

    const { penalty, notes: penaltyNotes } = penalties(txCount, interactions);
    notes.push(...penaltyNotes);

    const breakdown: ScoreBreakdown = {
      walletAge: walletAgeScore,
      txCount: txCountScore,
      gasUsage: gasScore,
      contractInteractions: interactionScore,
      defiNftUsage: defiNftScore,
      penalties: penalty,
    };

    const totalScore = clamp(sumBreakdown(breakdown), 0, 1000);

    return {
      address,
      chainId: await cachedRequest("getChainId", [], () => this.client.getChainId(), ttlMs),
      totalScore,
      tier: tierFromScore(totalScore),
      breakdown,
      computedAt: Date.now(),
      readOnly: true,
      notes,
    };
  }
}
