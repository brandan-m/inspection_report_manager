export type SupportedIssueType = "Bug" | "EOD Report" | "Task" | "Epic";
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
export type EodCoverageUnit = "ft^2" | "m^2";
export type EodStatus = "Not Started" | "In Progress" | "Complete" | "Blocked";

export interface WorkflowDefinition {
  key: string;
  label: string;
  jiraProjectKey: string;
  allowedIssueTypes: SelectableIssueType[];
  epicSearchJql: string;
  intakeForm?: "generic" | "ehs";
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
  parentEpicLabel?: string;
  requesterId: string;
  channelId: string;
  threadTs: string;
}

export interface EhsFormValues {
  drugTesting?: string;
  backgroundChecks?: string;
  forms?: string;
  idRequirements: string[];
  idOther?: string;
  trainingSiteSpecific?: string;
  trainingOther1?: string;
  trainingOther2?: string;
  trainingOther3?: string;
  ppeRequirements: string[];
  fourGasRequirements: string[];
  fourGasOther?: string;
  fiveGasRequirements: string[];
  fiveGasOther?: string;
  generalRequirements?: string;
  vehicles?: string;
  loto?: string;
  confinedSpace?: string;
  hazardAssessment?: string;
  geckoJsa?: string;
  submitTo?: string;
  customerProvidedJsa?: string;
  electrical?: string;
  permits?: string;
  incidentReporting?: string;
  heatStress?: string;
  environmental?: string;
  housekeeping?: string;
  barricades?: string;
  scaffoldingTags: string[];
  droppedObjects?: string;
  jobSpecific?: string;
  siteContact?: string;
  sitePhoneNumber?: string;
  siteEmail?: string;
  safetyContact?: string;
  safetyPhoneNumber?: string;
  safetyEmail?: string;
  additionalHazards?: string;
  previousIncidents?: string;
}
