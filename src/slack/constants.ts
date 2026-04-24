export const CALLBACKS = {
  globalShortcut: "create_gecko_report",
  createIssueView: "create_gecko_report_view",
  workflowBlock: "workflow_block",
  workflowAction: "workflow_select",
  epicBlock: "epic_block",
  epicAction: "epic_select",
  issueTypeBlock: "issue_type_block",
  issueTypeAction: "issue_type_select",
  summaryBlock: "summary_block",
  summaryAction: "summary_input",
  detailsBlock: "details_block",
  detailsAction: "details_input"
} as const;
