import { ConversationMessage } from './conversationReader';

export interface Decision {
  claim: string;
  context: string;
  technology: string;
  claimType: 'temporal' | 'comparison' | 'capability' | 'recommendation';
  confidence: 'high' | 'medium' | 'low';
}

// Keywords that indicate a technology-relevant claim vs generic usage
const TECH_INDICATORS = [
  'algorithm', 'library', 'framework', 'package', 'tool', 'database',
  'server', 'api', 'protocol', 'language', 'runtime', 'compiler',
  'model', 'method', 'approach', 'pattern', 'architecture',
  'module', 'component', 'service', 'stack', 'platform', 'engine',
  'alternative', 'migration', 'upgrade', 'replace',
  'neural', 'transformer', 'embedding', 'vector', 'index', 'cache',
  'auth', 'encrypt', 'token', 'session', 'middleware', 'routing',
  'graphql', 'rest', 'grpc', 'websocket', 'docker', 'kubernetes',
];

/**
 * Extracts decision points and claims from conversation messages.
 * Uses heuristic pattern matching — no LLM call needed for extraction.
 * This keeps the extension fast and offline-capable.
 */
export class DecisionExtractor {
  /**
   * Extract all claims and decisions from the conversation
   */
  extract(messages: ConversationMessage[]): Decision[] {
    const decisions: Decision[] = [];

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;

      const extracted = this.extractFromText(msg.content);
      decisions.push(...extracted);
    }

    // Deduplicate, clean, validate, and filter
    const deduped = this.deduplicate(decisions);
    const fuzzyDeduped = this.fuzzyDeduplicate(deduped);
    const cleaned = fuzzyDeduped.map(d => this.cleanClaim(d));
    const valid = cleaned.filter(d => this.isValidClaim(d));
    return this.filterRelevant(valid);
  }

  /**
   * Remove claims that are substrings of other claims.
   * If "Redis is faster than Memcached" and "Redis is faster than Memcached for this use case"
   * both exist, keep only the longer (more specific) one.
   */
  private fuzzyDeduplicate(decisions: Decision[]): Decision[] {
    return decisions.filter((d, i) => {
      const key = d.claim.toLowerCase().trim();
      for (let j = 0; j < decisions.length; j++) {
        if (i === j) continue;
        const other = decisions[j].claim.toLowerCase().trim();
        if (other.includes(key) && other.length > key.length + 10) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Check if a claim is a complete, verifiable statement (not a fragment)
   */
  private isValidClaim(d: Decision): boolean {
    const claim = d.claim.trim();
    const words = claim.split(/\s+/);

    // Must have at least 3 words (e.g. "JWT supports OAuth2")
    if (words.length < 3) return false;

    // Must not be just a verb phrase without a subject
    const firstWord = words[0].toLowerCase();
    if (/^(is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|could|should|may|might|can)$/i.test(firstWord)) {
      return false;
    }

    // For comparisons: must contain a comparison keyword AND two technology names
    if (d.claimType === 'comparison') {
      const hasComparisonWord = /\b(better|faster|worse|more|less|preferred|recommended|instead)\b/i.test(claim);
      // Count capitalized words (potential technology names)
      const capWords = claim.match(/\b[A-Z][a-z]*\b/g) || [];
      if (!hasComparisonWord || capWords.length < 2) return false;
    }

    // For temporal: must contain a year or a proper noun + year reference
    if (d.claimType === 'temporal') {
      const hasYear = /\b(20[12]\d)\b/.test(claim);
      const hasTemporalWord = /\b(new|latest|recent|modern|current|state.of.the.art|sota|released|introduced|published)\b/i.test(claim);
      if (!hasYear && !hasTemporalWord) return false;
    }

    return true;
  }

  /**
   * Clean up a claim: trim leading/trailing conjunctions, normalize whitespace.
   * Does NOT truncate to first capital letter — that destroys valid claims.
   */
  private cleanClaim(d: Decision): Decision {
    let claim = d.claim.trim();
    // Normalize whitespace
    claim = claim.replace(/\s+/g, ' ');
    // Remove leading conjunctions/prepositions that indicate mid-sentence capture
    claim = claim.replace(/^(and|or|but|so|it|its|is|are|was|this|that)\s+/i, '');
    // Remove trailing conjunctions/prepositions
    claim = claim.replace(/\s+(and|or|but|so|it|its|is|are|was|this|that)$/i, '');
    return { ...d, claim };
  }

  /**
   * Filter out claims that are not technology-relevant
   */
  private filterRelevant(decisions: Decision[]): Decision[] {
    return decisions.filter(d => {
      const text = (d.claim + ' ' + d.context).toLowerCase();
      // Must contain at least one tech indicator or a proper noun (capitalized word)
      const hasTechIndicator = TECH_INDICATORS.some(kw => text.includes(kw));
      const hasProperNoun = /[A-Z][a-z]+[A-Z]/.test(d.claim) || // CamelCase
        /\b(React|Vue|Angular|Next|Django|Flask|Rust|Go|Python|Node|Express|Mongo|Postgres|Redis|Kafka|AWS|GCP|Azure|Terraform|Ansible|Jest|Mocha|Pytest|Webpack|Vite|Babel|ESLint|Tailwind|Bootstrap|Material|Chakra|Styled|Prisma|TypeORM|Sequelize|Knex|Drizzle|GraphQL|Apollo|tRPC|Swagger|OpenAPI|JWT|OAuth|OAuth2|SAML|LDAP|HTTPS|gRPC|Protobuf|Avro|Thrift|SQL|NoSQL|MySQL|MariaDB|SQLite|Cockroach|Cassandra|DynamoDB|Neo4j|Elastic|Solr|Lucene|TensorFlow|PyTorch|JAX|Keras|Hugging|OpenAI|Anthropic|Gemini|Llama|Mistral|Claude|GPT|Copilot|Cursor|Windsurf)\b/i.test(d.claim);
      return hasTechIndicator || hasProperNoun;
    });
  }

  /**
   * Extract claims from a single message's text
   */
  private extractFromText(text: string): Decision[] {
    const decisions: Decision[] = [];

    // Pattern 1: Temporal claims — "TechnologyName (2024)" or "Name (Author et al., 2024)"
    const temporalPatterns = [
      /([A-Z][\w]*(?:\s+[\w]+){0,4})\s*\((?:[\w\s,\.]+\s+)?(\d{4})\)/g,  // "FISM (2024)" or "FISM (He et al., 2024)"
      /(\d{4})\s+(version|release|paper|model)/gi,  // "2024 version"
    ];

    for (const pattern of temporalPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        decisions.push({
          claim: match[0],
          context: this.getContext(text, match.index),
          technology: match[1] || match[0],
          claimType: 'temporal',
          confidence: 'medium'
        });
      }
    }

    // Pattern 2: Comparison claims — "X is better/faster than Y"
    // Only match proper nouns (capitalized tech names) on both sides
    const comparisonPatterns = [
      /([A-Z][\w]*(?:\s+[A-Z][\w]*)*)\s+(is\s+)?(better|faster|more\s+\w+|preferred|recommended)\s+(than|over)\s+([A-Z][\w]*(?:\s+[A-Z][\w]*)*)/g,
      /use\s+([A-Z][\w]*(?:\s+[A-Z][\w]*)*)\s+(instead|rather than|over)\s+([A-Z][\w]*(?:\s+[A-Z][\w]*)*)/g,
    ];

    for (const pattern of comparisonPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        decisions.push({
          claim: match[0],
          context: this.getContext(text, match.index),
          technology: match[1] || match[0],
          claimType: 'comparison',
          confidence: 'high'
        });
      }
    }

    // Pattern 3: Recommendation claims — "you should use X" / "I recommend X"
    // Each pattern handled separately because capture group indices differ
    const recPattern1 = /(you\s+should\s+use|i\s+recommend|i'?d\s+recommend|best\s+to\s+use|let'?s\s+use|we'?ll\s+use)\s+(?:using\s+)?([A-Z][\w]*(?:\s+[A-Z][\w]*)*)/g;
    const recPattern2 = /(the\s+)?(best|optimal|ideal|right)\s+(choice|option|tool|library|framework)\s+(is|for)\s+([A-Z][\w]*(?:\s+[A-Z][\w]*)*)/gi;

    let match;
    while ((match = recPattern1.exec(text)) !== null) {
      decisions.push({
        claim: match[0],
        context: this.getContext(text, match.index),
        technology: match[2] || match[0],
        claimType: 'recommendation',
        confidence: 'high'
      });
    }
    while ((match = recPattern2.exec(text)) !== null) {
      decisions.push({
        claim: match[0],
        context: this.getContext(text, match.index),
        technology: match[5] || match[0],
        claimType: 'recommendation',
        confidence: 'high'
      });
    }

    // Pattern 4: Capability claims — "X supports Y" (verb immediately after tech name)
    const capabilityPatterns = [
      /([A-Z][\w]*(?:\s+[A-Z][\w]*)*)\s+(supports?|provides?|enables?|allows?|offers?)\s+([\w\s]+)/g,
    ];

    for (const pattern of capabilityPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        decisions.push({
          claim: match[0],
          context: this.getContext(text, match.index),
          technology: match[1] || match[0],
          claimType: 'capability',
          confidence: 'medium'
        });
      }
    }

    return decisions;
  }

  /**
   * Get surrounding context for a match
   */
  private getContext(text: string, index: number, window = 100): string {
    const start = Math.max(0, index - window);
    const end = Math.min(text.length, index + window);
    return text.slice(start, end).replace(/\n/g, ' ').trim();
  }

  /**
   * Remove duplicate/similar claims and filter out fragments.
   * Also removes vague claims that don't reference a specific technology.
   */
  private deduplicate(decisions: Decision[]): Decision[] {
    const seen = new Set<string>();
    return decisions.filter(d => {
      const key = d.claim.toLowerCase().trim();
      if (seen.has(key)) return false;
      // Filter out fragments: claims that are too short
      if (key.length < 10) return false;
      // Must have at least 3 words
      if (key.split(/\s+/).length < 3) return false;
      // Must not start with a conjunction or preposition
      if (/^(and|or|the|a|an|is|are|was|were|it|its|this|that|s)$/i.test(key)) return false;
      // Must contain at least one proper noun (capitalized word) — no vague claims
      if (!/[A-Z]/.test(d.claim)) return false;
      // Must not be a generic phrase without a specific technology
      if (/^(the best|the right|the optimal|the ideal|the only)$/i.test(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
