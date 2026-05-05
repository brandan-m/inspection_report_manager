export type SupportedIssueType = "Bug" | "EOD Report" | "Epic";
export type SelectableIssueType = Exclude<SupportedIssueType, "Epic">;
export type BlockerType = "Customer" | "Operations" | "Environmental" | "Other";
export type EodAssetType =
  | "Building"
  | "Conveyor"
  | "Crusher"
  | "Stockpile"
  | "Tank"
  | "Other";
export type EodYesNo = "Yes" | "No";
export type EodCoverageUnit = "sq ft" | "sq m" | "acres" | "hectares";
export type EodStatus = "Not Started" | "In Progress" | "Complete" | "Blocked";

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

export interface EodReportFormValues {
  date: string;
  assetType: EodAssetType;
  assetNumber: string;
  crewOnSite: string;
  jsaSubmitted: EodYesNo;
  permitApproved: string;
  calibrationCompleted: string;
  numberOfScansCompleted: number;
  totalScanningTimeHours: number;
  scanningAreaCoverage: number;
  coveredAreaUnits: EodCoverageUnit;
  dataUploadStatus: EodStatus;
  dataValidationStatus: EodStatus;
  reportStatus: EodStatus;
  crewOffSite: string;
  notes?: string;
}

export interface EodThreadContext {
  workflowKey: string;
  parentEpicKey: string;
  summary: string;
  requesterId: string;
  channelId: string;
  threadTs: string;
}
