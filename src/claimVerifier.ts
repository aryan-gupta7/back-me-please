import { Decision } from './decisionExtractor';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface VerificationResult {
  decision: Decision;
  status: 'verified' | 'stale' | 'incorrect' | 'unverifiable' | 'pending';
  detail: string;
  alternatives?: string[];
  sources?: string[];
}

/**
 * Verifies claims by delegating to Claude CLI.
 * Uses `claude -p` with the user's existing Claude Code setup —
 * no additional API keys needed.
 */
export class ClaimVerifier {
  private useCLI: boolean;
  private apiKey?: string;

  constructor(useCLI = true, apiKey?: string) {
    this.useCLI = useCLI;
    this.apiKey = apiKey;
  }

  /**
   * Verify a batch of decisions
   */
  async verify(decisions: Decision[]): Promise<VerificationResult[]> {
    if (decisions.length === 0) {
      return [];
    }

    if (this.useCLI) {
      return this.verifyViaCLI(decisions);
    } else {
      return this.verifyViaAPI(decisions);
    }
  }

  /**
   * Verify claims using Claude CLI (claude -p)
   */
  private async verifyViaCLI(decisions: Decision[]): Promise<VerificationResult[]> {
    const claimsList = decisions
      .map((d, i) => `${i + 1}. "${d.claim}" (type: ${d.claimType}, about: ${d.technology})`)
      .join('\n');

    const prompt = `You are a fact-checker for software development decisions. Verify the following claims made during a coding session.

For each claim, determine:
- Is the claim accurate? (verified / stale / incorrect / unverifiable)
- If stale or incorrect, what is the correct information?
- Are there newer or better alternatives?

Claims to verify:
${claimsList}

For each claim, output ONE line in this exact format:
CLAIM <n>: <status> | <detail> | alternatives: <alt1, alt2>

Where status is one of: verified, stale, incorrect, unverifiable.
Keep each line concise (under 200 characters for detail).
Example:
CLAIM 1: incorrect | FISM was published in 2013 by Kabbur et al., not 2024 by He et al. | alternatives: LightGCN (2020), UltraGCN (2021)`;

    const tmpFile = path.join(os.tmpdir(), `wispr-audit-${Date.now()}.txt`);
    try {
      // Write prompt to temp file to avoid shell escaping issues
      fs.writeFileSync(tmpFile, prompt);

      const result = execSync(
        `claude -p "$(cat ${tmpFile})" --bare`,
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
      ).toString();

      return this.parseVerificationResponse(result, decisions);
    } catch (error) {
      // If CLI fails, return all as unverifiable
      return decisions.map(d => ({
        decision: d,
        status: 'unverifiable' as const,
        detail: `Verification failed: ${error instanceof Error ? error.message : 'unknown error'}`
      }));
    } finally {
      // Always clean up the temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  /**
   * Verify claims using Claude API directly (if user provides key)
   */
  private async verifyViaAPI(decisions: Decision[]): Promise<VerificationResult[]> {
    if (!this.apiKey) {
      return decisions.map(d => ({
        decision: d,
        status: 'unverifiable' as const,
        detail: 'No API key configured'
      }));
    }

    const claimsList = decisions
      .map((d, i) => `${i + 1}. "${d.claim}"`)
      .join('\n');

    const prompt = `Verify these software development claims. For each, respond with: status (verified/stale/incorrect/unverifiable), detail, alternatives.

Claims:
${claimsList}

Respond as JSON array: [{"index": 1, "status": "...", "detail": "...", "alternatives": [...]}]`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data: any = await response.json();
      const text = data.content?.[0]?.text || '';
      return this.parseVerificationResponse(text, decisions);
    } catch (error) {
      return decisions.map(d => ({
        decision: d,
        status: 'unverifiable' as const,
        detail: `API call failed: ${error instanceof Error ? error.message : 'unknown'}`
      }));
    }
  }

  /**
   * Parse the LLM's verification response.
   * Tries multiple formats in order: line-based, JSON array, JSON code block, plain text.
   */
  private parseVerificationResponse(
    response: string,
    decisions: Decision[]
  ): VerificationResult[] {
    // Strategy 1: Line-based format "CLAIM <n>: <status> | <detail>"
    const lineResults = this.parseLineFormat(response, decisions);
    if (lineResults.length > 0) return lineResults;

    // Strategy 2: JSON object wrapper (from --output-format json)
    try {
      const wrapper = JSON.parse(response);
      if (wrapper.result && typeof wrapper.result === 'string') {
        return this.parseTextStrategies(wrapper.result, decisions);
      }
      if (Array.isArray(wrapper)) {
        return this.parseJSONArray(wrapper, decisions);
      }
    } catch {
      // Not JSON, continue to text strategies
    }

    // Strategy 3: Plain text strategies
    return this.parseTextStrategies(response, decisions);
  }

  /**
   * Parse line-based format: "CLAIM 1: incorrect | detail text | alternatives: a, b"
   */
  private parseLineFormat(text: string, decisions: Decision[]): VerificationResult[] {
    const lines = text.split('\n').filter(l => /^CLAIM\s+\d+/i.test(l.trim()));
    if (lines.length === 0) return [];

    return lines.map(line => {
      const match = line.trim().match(/^CLAIM\s+(\d+)\s*:\s*(\w+)\s*\|\s*(.*?)(?:\s*\|\s*alternates?:\s*(.*))?$/i);
      if (!match) return null;

      const idx = parseInt(match[1]) - 1;
      const status = match[2].toLowerCase();
      const detail = match[3].trim();
      const alternatives = match[4] ? match[4].split(',').map(s => s.trim()) : [];

      return {
        decision: decisions[idx] || decisions[0],
        status: ['verified', 'stale', 'incorrect', 'unverifiable'].includes(status)
          ? status as any
          : 'unverifiable',
        detail,
        alternatives
      };
    }).filter(Boolean) as VerificationResult[];
  }

  /**
   * Try JSON array and JSON code block strategies on text
   */
  private parseTextStrategies(text: string, decisions: Decision[]): VerificationResult[] {
    // Try JSON code block
    const codeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (codeBlock) {
      try {
        const parsed = JSON.parse(codeBlock[1].trim());
        if (Array.isArray(parsed)) return this.parseJSONArray(parsed, decisions);
      } catch { /* not valid JSON */ }
    }

    // Try raw JSON array
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        return this.parseJSONArray(JSON.parse(jsonMatch[0]), decisions);
      } catch { /* not valid JSON */ }
    }

    // Fallback: return text as unverifiable
    return decisions.map(d => ({
      decision: d,
      status: 'unverifiable' as const,
      detail: text.slice(0, 300)
    }));
  }

  /**
   * Parse a JSON array of verification results
   */
  private parseJSONArray(arr: any[], decisions: Decision[]): VerificationResult[] {
    return arr.map((item: any, i: number) => ({
      decision: decisions[item.index - 1] || decisions[item.index] || decisions[i],
      status: item.status || 'unverifiable',
      detail: item.detail || 'No detail provided',
      alternatives: item.alternatives || []
    }));
  }
}
