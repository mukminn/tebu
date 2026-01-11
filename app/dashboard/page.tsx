"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { isAddress, type Address } from "viem";
import type { OnchainScoreResult } from "@/lib/onchainScoreService";
import styles from "./page.module.css";

async function fetchScore(address: Address): Promise<OnchainScoreResult> {
  const res = await fetch(`/api/score?address=${address}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Score request failed (${res.status})`);
  return (await res.json()) as OnchainScoreResult;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function TierBadge({ tier }: { tier: OnchainScoreResult["tier"] }) {
  return <span className={styles.tierBadge}>{tier}</span>;
}

function ProgressRing({ value, max }: { value: number; max: number }) {
  const size = 92;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const dash = c * (1 - pct);

  return (
    <svg width={size} height={size} className={styles.ring} viewBox={`0 0 ${size} ${size}`}>
      <circle className={styles.ringTrack} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
      <circle
        className={styles.ringValue}
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={dash}
      />
    </svg>
  );
}

function Radar({ breakdown }: { breakdown: OnchainScoreResult["breakdown"] }) {
  const max = 260;
  const points = [
    { label: "Age", value: breakdown.walletAge },
    { label: "Tx", value: breakdown.txCount },
    { label: "Gas", value: breakdown.gasUsage },
    { label: "Apps", value: breakdown.contractInteractions },
    { label: "DeFi/NFT", value: breakdown.defiNftUsage },
  ];

  const size = 220;
  const center = size / 2;
  const radius = 78;

  const poly = points
    .map((p, i) => {
      const t = (Math.PI * 2 * i) / points.length - Math.PI / 2;
      const k = Math.max(0, Math.min(1, p.value / max));
      const x = center + Math.cos(t) * radius * k;
      const y = center + Math.sin(t) * radius * k;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className={styles.radarWrap}>
      <svg width={size} height={size} className={styles.radar} viewBox={`0 0 ${size} ${size}`}>
        {[0.25, 0.5, 0.75, 1].map((k) => (
          <circle key={k} className={styles.radarGrid} cx={center} cy={center} r={radius * k} />
        ))}
        {points.map((p, i) => {
          const t = (Math.PI * 2 * i) / points.length - Math.PI / 2;
          const x = center + Math.cos(t) * radius;
          const y = center + Math.sin(t) * radius;
          return (
            <line
              key={p.label}
              className={styles.radarAxis}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
            />
          );
        })}
        <polygon className={styles.radarPoly} points={poly} />
      </svg>

      <div className={styles.radarLabels}>
        {points.map((p) => (
          <div key={p.label} className={styles.radarLabel}>
            <div className={styles.radarLabelTitle}>{p.label}</div>
            <div className={styles.radarLabelValue}>{Math.round(p.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className={styles.skeletonCard}>
      <div className={styles.skeletonLine} />
      <div className={styles.skeletonLine} />
      <div className={styles.skeletonLineShort} />
    </div>
  );
}

export default function DashboardPage() {
  const [input, setInput] = useState<string>("");
  const [result, setResult] = useState<OnchainScoreResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const address = useMemo(() => {
    if (!input) return null;
    if (!isAddress(input)) return null;
    return input as Address;
  }, [input]);

  const canCompute = !!address && !isPending;

  const compute = () => {
    if (!address) return;
    setError("");
    startTransition(async () => {
      try {
        const score = await fetchScore(address);
        setResult(score);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Failed to compute score");
      }
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Onchain Score</h1>
          <p className={styles.subtitle}>Base Mainnet · Read-only · No signing</p>
        </div>
        <div className={styles.links}>
          <Link className={styles.link} href="/">
            Home
          </Link>
          <Link className={styles.link} href="/leaderboard">
            Leaderboard
          </Link>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.inputRow}>
          <input
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value.trim())}
            placeholder="0x… wallet address"
            spellCheck={false}
          />
          <button className={styles.button} type="button" onClick={compute} disabled={!canCompute}>
            {isPending ? "Scoring…" : "Compute"}
          </button>
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.notice}>
          This page only reads public onchain data. It will never ask you to sign a message or send a transaction.
        </div>
      </div>

      {isPending ? <Skeleton /> : null}

      {result ? (
        <div className={styles.grid}>
          <div className={styles.scoreCard}>
            <div className={styles.scoreHeader}>
              <div className={styles.scoreTitle}>
                <div className={styles.scoreName}>{shortAddress(result.address)}</div>
                <div className={styles.scoreMeta}>
                  <TierBadge tier={result.tier} />
                  <span className={styles.chainTag}>Base #{result.chainId}</span>
                </div>
              </div>
              <div className={styles.scoreRingWrap}>
                <ProgressRing value={result.totalScore} max={1000} />
                <div className={styles.scoreValue}>{Math.round(result.totalScore)}</div>
                <div className={styles.scoreMax}>/1000</div>
              </div>
            </div>

            <div className={styles.breakdown}>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>Wallet Age</div>
                <div className={styles.metricValue}>{Math.round(result.breakdown.walletAge)}</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>Tx Count</div>
                <div className={styles.metricValue}>{Math.round(result.breakdown.txCount)}</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>Gas Usage</div>
                <div className={styles.metricValue}>{Math.round(result.breakdown.gasUsage)}</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>Interactions</div>
                <div className={styles.metricValue}>{Math.round(result.breakdown.contractInteractions)}</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>DeFi / NFT</div>
                <div className={styles.metricValue}>{Math.round(result.breakdown.defiNftUsage)}</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>Penalties</div>
                <div className={styles.metricValue}>-{Math.round(result.breakdown.penalties)}</div>
              </div>
            </div>

            <div className={styles.actions}>
              <Link className={styles.secondaryButton} href={`/wallet/${result.address}`}>
                View Wallet Profile
              </Link>
            </div>

            {result.notes.length ? (
              <div className={styles.notes}>
                {result.notes.map((n) => (
                  <div key={n} className={styles.note}>
                    {n}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <div className={styles.chartTitle}>Category Radar</div>
              <div className={styles.chartSub}>Lightweight heuristic (no indexer)</div>
            </div>
            <Radar breakdown={result.breakdown} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
