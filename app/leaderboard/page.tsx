"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { OnchainScoreService, type OnchainScoreResult } from "@/lib/onchainScoreService";
import styles from "./page.module.css";

type Row = {
  address: Address;
  score: number;
  tier: OnchainScoreResult["tier"];
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function LeaderboardPage() {
  const [input, setInput] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [sort, setSort] = useState<"score" | "address">("score");

  const normalized = useMemo(() => {
    if (!input) return [];
    return input
      .split(/[\s,]+/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => isAddress(s)) as Address[];
  }, [input]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "address") return a.address.localeCompare(b.address);
      return b.score - a.score;
    });
    return copy;
  }, [rows, sort]);

  const compute = async () => {
    setError("");
    setIsLoading(true);
    try {
      const svc = new OnchainScoreService();
      const results = await Promise.all(normalized.map((a) => svc.compute(a)));
      setRows(
        results.map((r) => ({
          address: r.address,
          score: Math.round(r.totalScore),
          tier: r.tier,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to compute leaderboard");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Leaderboard</h1>
          <p className={styles.subtitle}>Paste wallet addresses (comma/space separated). Read-only Base scoring.</p>
        </div>
        <div className={styles.links}>
          <Link className={styles.link} href="/dashboard">
            Dashboard
          </Link>
          <Link className={styles.link} href="/">
            Home
          </Link>
        </div>
      </div>

      <div className={styles.card}>
        <textarea
          className={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0xabc... 0xdef..."
          spellCheck={false}
          rows={3}
        />
        <div className={styles.row}>
          <button className={styles.button} type="button" onClick={compute} disabled={!normalized.length || isLoading}>
            {isLoading ? "Scoring…" : "Compute"}
          </button>
          <div className={styles.sortRow}>
            <span className={styles.sortLabel}>Sort:</span>
            <button
              type="button"
              className={sort === "score" ? styles.sortActive : styles.sort}
              onClick={() => setSort("score")}
            >
              Score
            </button>
            <button
              type="button"
              className={sort === "address" ? styles.sortActive : styles.sort}
              onClick={() => setSort("address")}
            >
              Address
            </button>
          </div>
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <div className={styles.th}>Rank</div>
          <div className={styles.th}>Wallet</div>
          <div className={styles.th}>Tier</div>
          <div className={styles.thRight}>Score</div>
        </div>

        {sorted.length ? (
          sorted.map((r, i) => (
            <Link key={r.address} className={styles.tr} href={`/wallet/${r.address}`}>
              <div className={styles.td}>{i + 1}</div>
              <div className={styles.tdMono}>{shortAddress(r.address)}</div>
              <div className={styles.td}>
                <span className={styles.tier}>{r.tier}</span>
              </div>
              <div className={styles.tdRight}>{r.score}</div>
            </Link>
          ))
        ) : (
          <div className={styles.empty}>No data yet.</div>
        )}
      </div>
    </div>
  );
}
