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
      } catch {
        // Skip malformed lines
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

  /**
   * Get a summary of the conversation (first and last few messages)
   */
  getSummary(conv: ParsedConversation): string {
    const lines: string[] = [];
    lines.push(`Session: ${conv.sessionId.slice(0, 8)}...`);
    lines.push(`Project: ${conv.projectPath}`);
    lines.push(`Messages: ${conv.totalMessages} (${conv.userMessages} user, ${conv.assistantMessages} assistant)`);
    lines.push('');

    // Show first 3 messages
    lines.push('--- Start of conversation ---');
    for (const msg of conv.messages.slice(0, 3)) {
      const preview = msg.content.slice(0, 200).replace(/\n/g, ' ');
      lines.push(`[${msg.role}] ${preview}${msg.content.length > 200 ? '...' : ''}`);
    }

    if (conv.messages.length > 6) {
      lines.push(`... (${conv.messages.length - 6} more messages) ...`);
    }

    // Show last 3 messages
    lines.push('--- End of conversation ---');
    for (const msg of conv.messages.slice(-3)) {
      const preview = msg.content.slice(0, 200).replace(/\n/g, ' ');
      lines.push(`[${msg.role}] ${preview}${msg.content.length > 200 ? '...' : ''}`);
    }

    return lines.join('\n');
  }
}
