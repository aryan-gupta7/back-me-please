import { ConversationMessage } from './conversationReader';

export interface KnowledgeGap {
  concept: string;
  reason: string;
  importance: 'critical' | 'important' | 'nice-to-have';
  recommendedReads: RecommendedRead[];
}

export interface RecommendedRead {
  title: string;
  url: string;
  type: 'article' | 'docs' | 'spec' | 'tutorial' | 'video';
  description: string;
}

/**
 * Analyzes conversation to identify concepts the developer
 * may not fully understand, and recommends reading material.
 */
export class KnowledgeAnalyzer {
  /**
   * Identify knowledge gaps based on what was built vs. what was discussed.
   * Returns at most 4 gaps, prioritizing critical and important ones.
   */
  analyze(messages: ConversationMessage[]): KnowledgeGap[] {
    const gaps: KnowledgeGap[] = [];
    const allText = messages.map(m => m.content).join('\n');

    // Map of technologies/concepts to check
    const concepts = this.identifyConcepts(allText);

    for (const concept of concepts) {
      const gap = this.assessUnderstanding(concept, messages);
      if (gap) {
        gaps.push(gap);
      }
    }

    // Sort by importance: critical first, then important, then nice-to-have
    const importanceOrder = { critical: 0, important: 1, 'nice-to-have': 2 };
    gaps.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]);

    // Return at most 4 gaps to avoid overwhelming the user
    return gaps.slice(0, 4);
  }

  /**
   * Identify technical concepts mentioned in the conversation
   */
  private identifyConcepts(text: string): string[] {
    const concepts: string[] = [];

    // Common concepts worth understanding deeply
    const conceptPatterns: Record<string, RegExp> = {
      'JWT / Authentication': /jwt|json.web.token|authentication|auth/i,
      'OAuth': /oauth|openid|sso|single.sign/i,
      'Database Design': /database|schema|migration|index|normaliz/i,
      'API Design': /rest|graphql|api.endpoint|swagger|openapi/i,
      'Encryption': /encrypt|decrypt|hash|bcrypt|cipher|tls|ssl/i,
      'Caching': /cache|redis|memcache|cdn|stale.while/i,
      'Concurrency': /async|parallel|thread|race.condition|mutex|lock/i,
      'Containerization': /docker|kubernetes|container|pod|helm/i,
      'CI/CD': /ci.cd|pipeline|deploy|github.actions|jenkins/i,
      'State Management': /redux|zustand|context|state.mobx|recoil/i,
      'WebSockets': /websocket|socket.io|real.time|long.poll/i,
      'GraphQL': /graphql|resolver|schema.type|apollo|hasura/i,
      'Microservices': /microservice|service.mesh|grpc|message.queue/i,
      'Testing': /unit.test|integration.test|e2e|jest|pytest|cypress/i,
      'TypeScript': /typescript|type.generic|interface|type.guard/i,
    };

    for (const [name, pattern] of Object.entries(conceptPatterns)) {
      if (pattern.test(text)) {
        concepts.push(name);
      }
    }

    return concepts;
  }

  /**
   * Assess whether the developer shows understanding of a concept.
   * Detects gaps from both:
   * 1. User using a concept without asking questions
   * 2. Assistant introducing a concept the user doesn't engage with
   */
  private assessUnderstanding(
    concept: string,
    messages: ConversationMessage[]
  ): KnowledgeGap | null {
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const allUserText = userMessages.map(m => m.content).join('\n').toLowerCase();
    const allAssistantText = assistantMessages.map(m => m.content).join('\n').toLowerCase();
    const keyword = this.getConceptKeyword(concept);

    // Check if the user asked clarifying questions about this concept
    const askedQuestions = userMessages.some(m =>
      m.content.includes('?') &&
      m.content.toLowerCase().includes(keyword)
    );

    // Check if the user discussed tradeoffs
    const discussedTradeoffs = allUserText.includes('tradeoff') ||
      allUserText.includes('vs') ||
      allUserText.includes('pros') ||
      allUserText.includes('cons') ||
      allUserText.includes('advantage') ||
      allUserText.includes('disadvantage');

    // Gap type 1: User used concept without deep engagement
    const userUsedConcept = allUserText.includes(keyword);
    if (userUsedConcept && !askedQuestions && !discussedTradeoffs) {
      return {
        concept,
        reason: `You used ${concept} but didn't ask clarifying questions or discuss tradeoffs. Understanding the fundamentals helps avoid costly mistakes.`,
        importance: this.getImportance(concept),
        recommendedReads: this.getReads(concept)
      };
    }

    // Gap type 2: Assistant introduced concept, user never engaged with it
    const assistantIntroduced = allAssistantText.includes(keyword);
    const userEngaged = allUserText.includes(keyword) || askedQuestions;
    if (assistantIntroduced && !userEngaged) {
      return {
        concept,
        reason: `Your AI introduced ${concept} but you didn't ask about it. Understanding this prevents security and architectural mistakes.`,
        importance: this.getImportance(concept),
        recommendedReads: this.getReads(concept)
      };
    }

    return null;
  }

  private getConceptKeyword(concept: string): string {
    const map: Record<string, string> = {
      'JWT / Authentication': 'jwt',
      'OAuth': 'oauth',
      'Database Design': 'database',
      'API Design': 'api',
      'Encryption': 'encrypt',
      'Caching': 'cache',
      'Concurrency': 'async',
      'Containerization': 'docker',
      'CI/CD': 'deploy',
      'State Management': 'state',
      'WebSockets': 'websocket',
      'GraphQL': 'graphql',
      'Microservices': 'microservice',
      'Testing': 'test',
      'TypeScript': 'typescript',
    };
    return map[concept] || concept.toLowerCase();
  }

  private getImportance(concept: string): 'critical' | 'important' | 'nice-to-have' {
    const critical = ['JWT / Authentication', 'Encryption', 'OAuth'];
    const important = ['Database Design', 'API Design', 'Concurrency', 'Testing'];

    if (critical.includes(concept)) return 'critical';
    if (important.includes(concept)) return 'important';
    return 'nice-to-have';
  }

  private getReads(concept: string): RecommendedRead[] {
    const reads: Record<string, RecommendedRead[]> = {
      'JWT / Authentication': [
        {
          title: 'JWT Best Practices (RFC 8725)',
          url: 'https://datatracker.ietf.org/doc/html/rfc8725',
          type: 'spec',
          description: 'The official security considerations for JWT implementations'
        },
        {
          title: 'Common JWT Security Vulnerabilities',
          url: 'https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/',
          type: 'article',
          description: 'Real-world JWT attacks and how to prevent them'
        }
      ],
      'OAuth': [
        {
          title: 'OAuth 2.0 Simplified',
          url: 'https://aaronparecki.com/oauth-2-simplified/',
          type: 'article',
          description: 'Clear explanation of OAuth flows and when to use each'
        }
      ],
      'Database Design': [
        {
          title: 'Database Indexing Explained',
          url: 'https://use-the-index-luke.com/',
          type: 'tutorial',
          description: 'How database indexes work and how to design them'
        }
      ],
      'API Design': [
        {
          title: 'REST API Design Best Practices',
          url: 'https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design',
          type: 'docs',
          description: 'Microsoft\'s guide to designing RESTful APIs'
        }
      ],
      'Encryption': [
        {
          title: 'How Encryption Works (Practical Guide)',
          url: 'https://www.encryptionconsulting.com/education-center/what-is-encryption/',
          type: 'article',
          description: 'Understanding symmetric vs asymmetric encryption'
        }
      ],
      'Containerization': [
        {
          title: 'Docker Getting Started',
          url: 'https://docs.docker.com/get-started/',
          type: 'tutorial',
          description: 'Official Docker tutorial for beginners'
        }
      ],
    };

    return reads[concept] || [
      {
        title: `Search: ${concept} best practices`,
        url: `https://www.google.com/search?q=${encodeURIComponent(concept + ' best practices 2024')}`,
        type: 'article',
        description: `Find current best practices for ${concept}`
      }
    ];
  }
}
