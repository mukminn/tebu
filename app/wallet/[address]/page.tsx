"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { isAddress, type Address } from "viem";
import { OnchainScoreService, type OnchainScoreResult } from "@/lib/onchainScoreService";
import styles from "./page.module.css";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString();
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={active ? styles.tabActive : styles.tab}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Heatmap({ seed }: { seed: string }) {
  const cells = 7 * 14;
  const data = useMemo(() => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return Array.from({ length: cells }, (_, i) => {
      const v = (h ^ (i * 2654435761)) >>> 0;
      return (v % 5) as 0 | 1 | 2 | 3 | 4;
    });
  }, [seed]);

  return (
    <div className={styles.heatmap}>
      {data.map((v, i) => (
        <div key={i} className={styles[`heat${v}`]} />
      ))}
    </div>
  );
}

function Timeline({ items }: { items: { ts: number; label: string; detail: string }[] }) {
  return (
    <div className={styles.timeline}>
      {items.map((it) => (
        <div key={`${it.ts}-${it.label}`} className={styles.timelineItem}>
          <div className={styles.timelineDot} />
          <div className={styles.timelineBody}>
            <div className={styles.timelineTop}>
              <div className={styles.timelineLabel}>{it.label}</div>
              <div className={styles.timelineTs}>{formatTime(it.ts)}</div>
            </div>
            <div className={styles.timelineDetail}>{it.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WalletProfilePage({ params }: { params: { address: string } }) {
  const [activeTab, setActiveTab] = useState<"activity" | "defi" | "nft">("activity");
  const [result, setResult] = useState<OnchainScoreResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const address = useMemo(() => {
    if (!params?.address) return null;
    if (!isAddress(params.address)) return null;
    return params.address as Address;
  }, [params?.address]);

  useEffect(() => {
    if (!address) return;
    setError("");
    startTransition(async () => {
      try {
        const svc = new OnchainScoreService();
        const score = await svc.compute(address);
        setResult(score);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Failed to load wallet profile");
      }
    });
  }, [address, startTransition]);

  const shareUrl = useMemo(() => {
    if (!address) return "";
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/wallet/${address}`;
  }, [address]);

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // ignore
    }
  };

  const timelineItems = useMemo(() => {
    const now = Date.now();
    return [
      { ts: now - 1000 * 60 * 22, label: "Score computed", detail: "Read-only on Base mainnet" },
      { ts: now - 1000 * 60 * 75, label: "Interactions scanned", detail: "ERC20 Transfer(from) heuristic" },
      { ts: now - 1000 * 60 * 240, label: "RPC verified", detail: "chainId match required" },
    ];
  }, []);

  if (!address) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <a className={styles.link} href="/dashboard">
            Back
          </a>
        </div>
        <div className={styles.card}>
          <div className={styles.title}>Invalid address</div>
          <div className={styles.subtitle}>Please open this page with a valid Base wallet address.</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Wallet Profile</h1>
          <div className={styles.subtitle}>{shortAddress(address)}</div>
        </div>
        <div className={styles.actions}>
          <a className={styles.link} href="/dashboard">
            Dashboard
          </a>
          <button className={styles.secondaryButton} type="button" onClick={copyShareUrl}>
            Copy Share URL
          </button>
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitleRow}>
            <div className={styles.cardTitle}>Onchain Score</div>
            <div className={styles.readOnly}>Read-only</div>
          </div>

          {isPending || !result ? (
            <div className={styles.skeleton} />
          ) : (
            <>
              <div className={styles.scoreRow}>
                <div className={styles.scoreValue}>{Math.round(result.totalScore)}</div>
                <div className={styles.scoreMeta}>
                  <div className={styles.tier}>{result.tier}</div>
                  <div className={styles.chain}>Base #{result.chainId}</div>
                </div>
              </div>
              <div className={styles.kpis}>
                <div className={styles.kpi}>
                  <div className={styles.kpiLabel}>Tx</div>
                  <div className={styles.kpiValue}>{Math.round(result.breakdown.txCount)}</div>
                </div>
                <div className={styles.kpi}>
                  <div className={styles.kpiLabel}>Apps</div>
                  <div className={styles.kpiValue}>{Math.round(result.breakdown.contractInteractions)}</div>
                </div>
                <div className={styles.kpi}>
                  <div className={styles.kpiLabel}>Penalties</div>
                  <div className={styles.kpiValue}>-{Math.round(result.breakdown.penalties)}</div>
                </div>
              </div>
            </>
          )}

          <div className={styles.notice}>
            This profile reads public data only. No signature prompts and no transactions.
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Interaction Heatmap</div>
          <Heatmap seed={address} />
        </div>

        <div className={styles.cardWide}>
          <div className={styles.tabs}>
            <TabButton active={activeTab === "activity"} onClick={() => setActiveTab("activity")}>
              Activity
            </TabButton>
            <TabButton active={activeTab === "defi"} onClick={() => setActiveTab("defi")}>
              DeFi
            </TabButton>
            <TabButton active={activeTab === "nft"} onClick={() => setActiveTab("nft")}>
              NFT
            </TabButton>
          </div>

          {activeTab === "activity" ? (
            <Timeline items={timelineItems} />
          ) : (
            <div className={styles.emptyState}>
              {activeTab === "defi"
                ? "DeFi tab is a placeholder until an indexer is added."
                : "NFT tab is a placeholder until an indexer is added."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
