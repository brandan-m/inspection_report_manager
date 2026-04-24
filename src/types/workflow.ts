export type SupportedIssueType = "Bug" | "EOD Report" | "Epic";

export interface WorkflowDefinition {
  key: string;
  label: string;
  jiraProjectKey: string;
  allowedIssueTypes: SupportedIssueType[];
  epicSearchJql: string;
}

export interface CreateIssueInput {
  workflow: WorkflowDefinition;
  issueType: Exclude<SupportedIssueType, "Epic">;
  parentEpicKey: string;
  summary: string;
  details: string;
  requesterName?: string;
  blockerType?: "Customer" | "Operations" | "Environmental" | "Other";
  opsDowntimeHours?: number;
}

export interface EpicOption {
  key: string;
  summary: string;
}
