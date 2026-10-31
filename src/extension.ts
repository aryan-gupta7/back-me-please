import * as vscode from 'vscode';
import { SessionFinder } from './sessionFinder';
import { ConversationReader, ParsedConversation } from './conversationReader';
import { DecisionExtractor } from './decisionExtractor';
import { ClaimVerifier } from './claimVerifier';
import { KnowledgeAnalyzer } from './knowledgeAnalyzer';
import { SidebarPanel } from './sidebarPanel';

export function activate(context: vscode.ExtensionContext) {
  console.log('Wispr Audit extension activated');

  const sessionFinder = new SessionFinder();
  const conversationReader = new ConversationReader();
  const decisionExtractor = new DecisionExtractor();
  const knowledgeAnalyzer = new KnowledgeAnalyzer();

  // Command: Open the audit panel
  const openPanelCmd = vscode.commands.registerCommand(
    'wisprAudit.openPanel',
    () => {
      SidebarPanel.createOrShow(context.extensionUri);
    }
  );

  // Command: Run the full audit
  const runAuditCmd = vscode.commands.registerCommand(
    'wisprAudit.runAudit',
    async () => {
      const panel = SidebarPanel.createOrShow(context.extensionUri);
      panel.showLoading('Finding Claude Code session...');

      try {
        // Step 1: Find the current session
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        let session = sessionFinder.getSessionForWorkspace(workspacePath);

        if (!session) {
          // Multiple sessions active and no workspace match — let user pick
          const allSessions = sessionFinder.getActiveSessions();
          if (allSessions.length > 1) {
            const picked = await vscode.window.showQuickPick(
              allSessions.map(s => ({
                label: `$(terminal) ${s.cwd}`,
                description: `Started ${new Date(s.startedAt).toLocaleTimeString()}`,
                session: s
              }))
            );
            if (!picked) return;
            session = picked.session;
          } else {
            panel.showError(
              'No active Claude Code session found. Make sure Claude Code is running in this workspace.'
            );
            return;
          }
        }

        // Step 2: Read the conversation
        panel.showLoading('Reading conversation...');
        const convPath = sessionFinder.getConversationPath(session);

        if (!convPath) {
          panel.showError(
            `No conversation data found for session ${session.sessionId.slice(0, 8)}.`
          );
          return;
        }

        const conversation = conversationReader.parseJSONL(convPath);

        if (conversation.messages.length === 0) {
          panel.showError('Conversation is empty — nothing to audit yet.');
          return;
        }

        // Steps 3-6: Run the audit pipeline
        await runAuditPipeline(panel, conversation, decisionExtractor, knowledgeAnalyzer);

      } catch (error) {
        panel.showError(
          `Audit failed: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }
  );

  context.subscriptions.push(openPanelCmd, runAuditCmd);
}

/**
 * Run the full audit pipeline on a parsed conversation.
 */
async function runAuditPipeline(
  panel: SidebarPanel,
  conversation: ParsedConversation,
  decisionExtractor: DecisionExtractor,
  knowledgeAnalyzer: KnowledgeAnalyzer
) {
  // Step 3: Extract decisions
  panel.showLoading(`Extracting decisions from ${conversation.messages.length} messages...`);
  const decisions = decisionExtractor.extract(conversation.messages);

  // Step 4: Verify claims
  panel.showLoading(`Verifying ${decisions.length} claims...`);
  const verifier = new ClaimVerifier();
  const verifications = await verifier.verify(decisions);

  // Step 5: Analyze knowledge gaps
  panel.showLoading('Analyzing knowledge gaps...');
  const gaps = knowledgeAnalyzer.analyze(conversation.messages);

  // Step 6: Display results
  panel.updateResults(conversation, verifications, gaps);

  // Show summary notification
  const flagged = verifications.filter(
    v => v.status === 'stale' || v.status === 'incorrect'
  ).length;

  if (flagged > 0) {
    vscode.window.showWarningMessage(
      `Audit complete: ${flagged} claim${flagged > 1 ? 's' : ''} need${flagged === 1 ? 's' : ''} attention.`
    );
  } else {
    vscode.window.showInformationMessage(
      `Audit complete: All ${verifications.length} claims verified. ✅`
    );
  }
}

export function deactivate() {}
