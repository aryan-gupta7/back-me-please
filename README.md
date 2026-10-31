# 🔍 Wispr Audit

**Verify your LLM's decisions before you build on them.**

A VS Code extension that audits your AI coding agent's conversation — catching stale claims, incorrect recommendations, and knowledge gaps.

## The Problem

You ask your AI coding agent: *"What's the best algorithm for recommendations?"*

It says: *"Use FISM (He et al., 2024) — it's the latest and most performant."*

You trust it. Your team builds for three months. Then someone checks the paper.

**FISM is from 2013. Not 2024. The cited authors are wrong. The paper doesn't exist.**

Three months of work. Built on a hallucination.

## The Solution

Wispr Audit. One button. It reads what your AI told you, extracts every claim, and verifies them.

- ❌ *"FISM (He et al., 2024)"* → **INCORRECT** — Actually KDD 2013 by Kabbur, Ning & Karypis
- ⚠️ *"Recommend using FISM"* → **STALE** — Superseded by LightGCN, UltraGCN
- ❌ *"MongoDB is better than PostgreSQL"* → **OVERSIMPLIFIED** — Depends on use case
- ✅ *"LightGCN (2020)"* → **VERIFIED** — Correct attribution

It also detects **knowledge gaps** — concepts your AI introduced that you didn't ask about — and recommends reading material.

## Features

| Feature | What it does |
|---|---|
| **Claim Extraction** | Parses conversation to find technology recommendations, date claims, and comparisons |
| **Claim Verification** | Cross-checks claims against current information via Claude |
| **Knowledge Gap Detection** | Identifies concepts you used without understanding deeply |
| **Reading Recommendations** | Suggests articles and docs to close knowledge gaps |

## How to Use

1. Have Claude Code (or any AI coding agent) running in your workspace
2. Open the Wispr Audit panel from the activity bar (shield icon)
3. Click **Run Audit**
4. Review flagged claims and knowledge gaps

## Installation (Development)

```bash
git clone https://github.com/yourusername/wispr-audit
cd wispr-audit
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

## Requirements

- VS Code 1.80+
- Claude Code running in the workspace (for session detection)

## Built With

Built for the [Wispr Challenge](https://wemakedevs.com) hackathon — entirely using voice via Wispr Flow.

## License

MIT
