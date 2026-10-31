import * as fs from 'fs';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  type: string;
}

export interface ParsedConversation {
  messages: ConversationMessage[];
  sessionId: string;
  projectPath: string;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
}

/**
 * Reads and parses Claude Code conversation JSONL files
 */
export class ConversationReader {
  /**
   * Parse a JSONL conversation file into structured messages
   */
  parseJSONL(filePath: string): ParsedConversation {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());

    const messages: ConversationMessage[] = [];
    let sessionId = '';
    let projectPath = '';

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Extract metadata from first valid entry
        if (!sessionId && entry.sessionId) {
          sessionId = entry.sessionId;
        }
        if (!projectPath && entry.cwd) {
          projectPath = entry.cwd;
        }

        // Parse user messages
        if (entry.type === 'user' && entry.message) {
          const content = this.extractText(entry.message);
          if (content) {
            messages.push({
              role: 'user',
              content,
              timestamp: entry.timestamp || '',
              type: 'user'
            });
          }
        }

        // Parse assistant messages
        if (entry.type === 'assistant' && entry.message) {
          const content = this.extractText(entry.message);
          if (content) {
            messages.push({
              role: 'assistant',
              content,
              timestamp: entry.timestamp || '',
              type: 'assistant'
            });
          }
        }
      } catch (e) {
        // Skip malformed lines — log for debugging
        console.debug('Skipping malformed JSONL line:', e instanceof Error ? e.message : e);
      }
    }

    return {
      messages,
      sessionId,
      projectPath,
      totalMessages: messages.length,
      userMessages: messages.filter(m => m.role === 'user').length,
      assistantMessages: messages.filter(m => m.role === 'assistant').length
    };
  }

  /**
   * Extract text content from a message object (handles various formats)
   */
  private extractText(message: any): string {
    if (!message || typeof message !== 'object') return '';
    if (typeof message === 'string') return message;
    if (!message.content) return '';

    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((c: any) => c.type === 'text' && c.text)
        .map((c: any) => c.text)
        .join('\n\n');
    }

    return '';
  }

}
