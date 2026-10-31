import * as vscode from 'vscode';
import { VerificationResult } from './claimVerifier';
import { KnowledgeGap } from './knowledgeAnalyzer';
import { ParsedConversation } from './conversationReader';

/**
 * Creates and manages the sidebar webview panel for audit results
 */
export class SidebarPanel {
  public static currentPanel: SidebarPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private isUpdating = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getLoadingHTML();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.Beside;

    if (SidebarPanel.currentPanel) {
      SidebarPanel.currentPanel.panel.reveal(column);
      return SidebarPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'wisprAudit',
      'Wispr Audit',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    SidebarPanel.currentPanel = new SidebarPanel(panel, extensionUri);
    return SidebarPanel.currentPanel;
  }

  /**
   * Update the panel with audit results.
   * Guards against concurrent audits overwriting each other.
   */
  updateResults(
    conversation: ParsedConversation,
    verifications: VerificationResult[],
    knowledgeGaps: KnowledgeGap[]
  ) {
    if (this.isUpdating) return;
    this.isUpdating = true;
    try {
      this.panel.webview.html = this.getResultsHTML(conversation, verifications, knowledgeGaps);
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Show loading state
 */
  showLoading(message: string = 'Auditing...') {
    this.panel.webview.html = this.getLoadingHTML(message);
  }

  /**
   * Show error state
   */
  showError(message: string) {
    this.panel.webview.html = this.getErrorHTML(message);
  }

  private dispose() {
    SidebarPanel.currentPanel = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }

  // ─── HTML Generators ─────────────────────────────────────────

  private getLoadingHTML(message: string = 'Auditing...'): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
    .loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 70vh; gap: 16px; }
    .spinner {
      width: 36px; height: 36px;
      border: 3px solid var(--vscode-panel-border);
      border-top-color: var(--vscode-button-background);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading p { opacity: 0.7; font-size: 13px; margin: 0; }
    .pulse { animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <p class="pulse">${message}</p>
  </div>
</body>
</html>`;
  }

  private getErrorHTML(message: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
    .error { padding: 16px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 6px; }
  </style>
</head>
<body>
  <div class="error">
    <h3>⚠️ Audit Error</h3>
    <p>${message}</p>
  </div>
</body>
</html>`;
  }

  private getResultsHTML(
    conversation: ParsedConversation,
    verifications: VerificationResult[],
    knowledgeGaps: KnowledgeGap[]
  ): string {
    const verified = verifications.filter(v => v.status === 'verified').length;
    const stale = verifications.filter(v => v.status === 'stale').length;
    const incorrect = verifications.filter(v => v.status === 'incorrect').length;
    const unverifiable = verifications.filter(v => v.status === 'unverifiable').length;

    const statusIcon = (status: string) => {
      switch (status) {
        case 'verified': return '✅';
        case 'stale': return '⚠️';
        case 'incorrect': return '❌';
        default: return '❓';
      }
    };

    const importanceColor = (imp: string) => {
      switch (imp) {
        case 'critical': return '#f44';
        case 'important': return '#fa0';
        default: return '#888';
      }
    };

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      padding: 0 16px 24px 16px;
      color: var(--vscode-foreground);
      font-size: 13px;
      line-height: 1.5;
    }

    /* Header */
    .header {
      padding: 20px 0 16px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 16px;
    }
    .header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header .meta {
      font-size: 11px;
      opacity: 0.6;
      margin-top: 6px;
    }

    /* Summary cards */
    .summary {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 20px;
    }
    .stat {
      padding: 12px;
      border-radius: 8px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      text-align: center;
    }
    .stat-count {
      font-size: 24px;
      font-weight: 700;
      line-height: 1.2;
    }
    .stat-label {
      font-size: 11px;
      opacity: 0.7;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Section headers */
    .section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.7;
      margin: 20px 0 10px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .section-title .count {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
    }

    /* Claim cards */
    .item {
      padding: 12px 14px;
      margin-bottom: 8px;
      border-radius: 8px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-left: 4px solid transparent;
      transition: background 0.2s;
    }
    .item:hover { background: var(--vscode-list-hoverBackground); }
    .item.verified { border-left-color: #4c9; }
    .item.stale { border-left-color: #e8a000; }
    .item.incorrect { border-left-color: #f44; }
    .item.unverifiable { border-left-color: #888; }

    .status-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-badge.verified { background: rgba(68,204,153,0.15); color: #4c9; }
    .status-badge.stale { background: rgba(232,160,0,0.15); color: #e8a000; }
    .status-badge.incorrect { background: rgba(244,68,68,0.15); color: #f44; }
    .status-badge.unverifiable { background: rgba(136,136,136,0.15); color: #888; }

    .claim {
      font-weight: 600;
      margin-bottom: 6px;
      font-size: 13px;
    }
    .detail {
      opacity: 0.85;
      font-size: 12px;
      line-height: 1.6;
    }
    .alternatives {
      margin-top: 8px;
      font-size: 12px;
      padding: 6px 10px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
    }
    .alternatives strong { opacity: 0.7; }

    /* Knowledge gaps */
    .gap {
      padding: 12px 14px;
      margin-bottom: 8px;
      border-radius: 8px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-left: 4px solid transparent;
    }
    .gap-critical { border-left-color: #f44; }
    .gap-important { border-left-color: #e8a000; }
    .gap-nice-to-have { border-left-color: #888; }

    .gap-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .gap-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .gap-importance {
      font-size: 10px;
      opacity: 0.6;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .read-link {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      font-size: 12px;
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      padding: 4px 0;
    }
    .read-link:hover { text-decoration: underline; }
    .read-icon { flex-shrink: 0; }

    .empty {
      opacity: 0.5;
      font-style: italic;
      padding: 16px;
      text-align: center;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>🔍 Audit Results</h2>
    <div class="meta">
      Session ${conversation.sessionId.slice(0, 8)}... &nbsp;·&nbsp;
      ${conversation.totalMessages} messages &nbsp;·&nbsp;
      ${conversation.projectPath.split('/').pop()}
    </div>
  </div>

  <!-- Summary -->
  <div class="summary">
    <div class="stat">
      <div class="stat-count" style="color:#4c9">${verified}</div>
      <div class="stat-label">Verified</div>
    </div>
    <div class="stat">
      <div class="stat-count" style="color:#e8a000">${stale}</div>
      <div class="stat-label">Stale</div>
    </div>
    <div class="stat">
      <div class="stat-count" style="color:#f44">${incorrect}</div>
      <div class="stat-label">Incorrect</div>
    </div>
    <div class="stat">
      <div class="stat-count" style="color:#888">${unverifiable}</div>
      <div class="stat-label">Unverifiable</div>
    </div>
  </div>

  <!-- Verification Results -->
  <div class="section-title">
    Claim Verification
    <span class="count">${verifications.length}</span>
  </div>
  ${verifications.length === 0
    ? '<div class="empty">No claims detected.<br>Try having your LLM make specific technology recommendations.</div>'
    : verifications.map(v => `
      <div class="item ${v.status}">
        <span class="status-badge ${v.status}">${v.status}</span>
        <div class="claim">${this.escapeHtml(v.decision.claim)}</div>
        <div class="detail">${this.escapeHtml(v.detail)}</div>
        ${v.alternatives && v.alternatives.length > 0 ? `
          <div class="alternatives">
            <strong>Alternatives:</strong> ${v.alternatives.map(a => this.escapeHtml(a)).join(', ')}
          </div>
        ` : ''}
      </div>
    `).join('')}

  <!-- Knowledge Gaps -->
  <div class="section-title">
    Knowledge Gaps
    <span class="count">${knowledgeGaps.length}</span>
  </div>
  ${knowledgeGaps.length === 0
    ? '<div class="empty">No obvious knowledge gaps.<br>Good job asking questions!</div>'
    : knowledgeGaps.map(g => `
      <div class="gap gap-${g.importance}">
        <div class="gap-header">
          <span class="gap-dot" style="background:${importanceColor(g.importance)}"></span>
          ${this.escapeHtml(g.concept)}
          <span class="gap-importance">${g.importance}</span>
        </div>
        <div class="detail">${this.escapeHtml(g.reason)}</div>
        ${g.recommendedReads.map(r => `
          <a class="read-link" href="${this.escapeHtml(r.url)}">
            <span class="read-icon">📚</span>
            ${this.escapeHtml(r.title)}
          </a>
        `).join('')}
      </div>
    `).join('')}
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    const div = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => div[c as keyof typeof div]);
  }
}
