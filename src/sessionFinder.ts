import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface SessionMeta {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
  status: string;
  startedAt: number;
  version: string;
}

/**
 * Finds active Claude Code sessions by reading session metadata files
 * from ~/.claude/sessions/
 */
export class SessionFinder {
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
  }

  /**
   * Get all active (busy) Claude Code sessions
   */
  getActiveSessions(): SessionMeta[] {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.sessionsDir);
    const sessions: SessionMeta[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(this.sessionsDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // Only include interactive sessions that are busy
        if (data.kind === 'interactive' && data.status === 'busy') {
          sessions.push(data);
        }
      } catch (e) {
        console.debug('Skipping malformed session file:', e instanceof Error ? e.message : e);
      }
    }

    return sessions;
  }

  /**
   * Get the most recent active session, optionally filtered by cwd
   */
  getSessionForWorkspace(workspacePath?: string): SessionMeta | null {
    const sessions = this.getActiveSessions();

    if (sessions.length === 0) return null;

    // If workspace specified, find session matching that cwd
    if (workspacePath) {
      const matching = sessions.find(s => s.cwd === workspacePath);
      if (matching) return matching;
    } else if (sessions.length === 1) {
      // Only one session active and no workspace — use it
      return sessions[0];
    }

    // Multiple sessions and no workspace match — return null so caller can prompt
    return null;
  }

  /**
   * Get the conversation JSONL file path for a session
   */
  getConversationPath(session: SessionMeta): string | null {
    // Convert cwd to the directory name format Claude uses
    // /home/user/wispr_chall -> -home-user-wispr-chall
    // Claude replaces /, _, and spaces with -, keeping leading -
    const encoded = '-' + session.cwd.slice(1).replace(/[\/_\s]/g, '-');

    const projectDir = path.join(
      os.homedir(),
      '.claude',
      'projects',
      encoded
    );

    const jsonlPath = path.join(projectDir, `${session.sessionId}.jsonl`);

    if (fs.existsSync(jsonlPath)) {
      return jsonlPath;
    }

    // Try finding any jsonl in that directory
    if (fs.existsSync(projectDir)) {
      const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
      if (files.length > 0) {
        // Return the most recently modified
        files.sort((a, b) => {
          const aStat = fs.statSync(path.join(projectDir, a));
          const bStat = fs.statSync(path.join(projectDir, b));
          return bStat.mtimeMs - aStat.mtimeMs;
        });
        return path.join(projectDir, files[0]);
      }
    }

    return null;
  }
}
