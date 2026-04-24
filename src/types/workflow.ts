export type SupportedIssueType = "Bug" | "EOD Report" | "Epic";
export type SelectableIssueType = Exclude<SupportedIssueType, "Epic">;
export type BlockerType = "Customer" | "Operations" | "Environmental" | "Other";

export interface WorkflowDefinition {
  key: string;
  label: string;
  jiraProjectKey: string;
  allowedIssueTypes: SelectableIssueType[];
  epicSearchJql: string;
}

export interface CreateIssueInput {
  workflow: WorkflowDefinition;
  issueType: SelectableIssueType;
  parentEpicKey: string;
  summary: string;
  details: string;
  requesterName?: string;
  blockerType?: BlockerType;
  opsDowntimeHours?: number;
}

export interface EpicOption {
  key: string;
  summary: string;
}
