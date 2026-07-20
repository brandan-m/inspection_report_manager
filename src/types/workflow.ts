export type JiraIssueType = "Bug" | "EOD Report" | "Task" | "Data Ops" | "Epic";
export type SupportedIssueType = JiraIssueType | "[TEST] Single Thread EOD";
export type SelectableIssueType = Exclude<SupportedIssueType, "Epic">;
export type BlockerType = "Customer" | "Operations" | "Environmental" | "Other";
export type EodAssetType =
  | "Kiln"
  | "Hood"
  | "Tank"
  | "Drum"
  | "Vessel"
  | "Piping"
  | "SDA"
  | "Silo"
  | "Boiler"
  | "Heat Exchangers"
  | "Stacks"
  | "Spheres"
  | "Towers";
export type EodYesNo = "Yes" | "No";
export type EodThreadLifecycleStatus = "active" | "closed";
export type WorkflowParentIssueType = "Epic" | "Task";
export type EodAssetSelectionMode = "child_task" | "parent_issue";

export interface WorkflowDefinition {
  key: string;
  label: string;
  jiraProjectKey: string;
  allowedIssueTypes: SelectableIssueType[];
  epicSearchJql: string;
  intakeForm?: "generic" | "ehs";
  parentIssueType?: WorkflowParentIssueType;
  eodAssetSelectionMode?: EodAssetSelectionMode;
}

export type JiraTextMark =
  | {
      type: "strong";
    }
  | {
      type: "em";
    }
  | {
      type: "code";
    }
  | {
      type: "strike";
    }
  | {
      type: "link";
      attrs: {
        href: string;
      };
    };

export interface JiraTextNode {
  type: "text";
  text: string;
  marks?: JiraTextMark[];
}

export interface JiraMentionNode {
  type: "mention";
  attrs: {
    id: string;
    text: string;
  };
}

export type JiraInlineNode = JiraTextNode | JiraMentionNode;

export interface JiraParagraphNode {
  type: "paragraph";
  content: JiraInlineNode[];
}

export interface JiraHeadingNode {
  type: "heading";
  attrs: {
    level: 2;
  };
  content: JiraTextNode[];
}

export interface JiraListItemNode {
  type: "listItem";
  content: JiraParagraphNode[];
}

export interface JiraBulletListNode {
  type: "bulletList";
  content: JiraListItemNode[];
}

export interface JiraOrderedListNode {
  type: "orderedList";
  attrs?: {
    order: number;
  };
  content: JiraListItemNode[];
}

export interface JiraBlockquoteNode {
  type: "blockquote";
  content: JiraParagraphNode[];
}

export interface JiraCodeBlockNode {
  type: "codeBlock";
  content: JiraTextNode[];
}

export type JiraDocNode =
  | JiraParagraphNode
  | JiraHeadingNode
  | JiraBulletListNode
  | JiraOrderedListNode
  | JiraBlockquoteNode
  | JiraCodeBlockNode;

export interface CreateIssueInput {
  workflow: WorkflowDefinition;
  issueType: Exclude<JiraIssueType, "Epic">;
  parentEpicKey: string;
  jiraParentKey?: string;
  summary: string;
  details: string;
  descriptionContent?: JiraDocNode[];
  requesterContent?: JiraInlineNode[];
  requesterName?: string;
  blockerType?: BlockerType;
  opsDowntimeHours?: number;
  customFields?: Record<string, unknown>;
}

export interface EpicOption {
  key: string;
  summary: string;
}

export interface IssueOption {
  key: string;
  summary: string;
}

export interface EodReportFormValues {
  date: string;
  fullDayOverview: string;
  fullDayOverviewContent?: JiraDocNode[];
  jsaSubmitted: EodYesNo;
  assetNumber?: string;
  crewOnsiteTime?: string;
  permitApprovalTime?: string;
  calibrationCompleted?: string;
  scanCount?: number;
  numberOfScansCompleted: number;
  dataUploadStatus?: string;
  dataValidationStatus?: string;
  reportStatus?: string;
  crewOffSiteTime?: string;
  totalScanningTimeHours: number;
  notes?: string;
}

export interface EodThreadContext {
  workflowKey: string;
  parentEpicKey: string;
  parentEpicLabel?: string;
  jiraParentKey?: string;
  parentTaskKey?: string;
  parentTaskLabel?: string;
  parentTaskSummary?: string;
  assetType: EodAssetType;
  totalTubeCount?: number;
  requesterId: string;
  channelId: string;
  threadTs: string;
  status?: EodThreadLifecycleStatus;
  reportIssueKey?: string;
  lastCoveragePercent?: number;
  closedOutByUserId?: string;
  closedOutAt?: string;
}

export interface DataOpsValidationState {
  threadTs: string;
  jiraIssueKey?: string;
  jiraStatusName?: string;
  slug?: string;
  percentCaptured?: number;
  percentUploaded?: number;
  percentValidated?: number;
  percentPrep?: number;
  percentQa?: number;
  ownerSlackUserId?: string;
  dataQuality?: string;
  forecastUrl?: string;
  cantileverUrl?: string;
  closedOutByUserId?: string;
  closedOutAt?: string;
}

export interface SingleThreadEodAssetState {
  parentTaskKey: string;
  parentTaskSummary: string;
  assetType: EodAssetType;
  lastProgressValue?: number;
  totalTubeCount?: number;
  reportIssueKey?: string;
  dataOps?: DataOpsValidationState;
}

export interface SingleThreadEodContext {
  workflowKey: string;
  parentEpicKey: string;
  parentEpicLabel?: string;
  channelId: string;
  threadTs: string;
  assets: SingleThreadEodAssetState[];
  enableDataOpsValidation?: boolean;
}

export interface DataOpsValidationThreadContext {
  workflowKey: string;
  parentEpicKey: string;
  parentEpicLabel?: string;
  channelId: string;
  threadTs: string;
  sourceThreadTs: string;
  parentTaskKey: string;
  parentTaskLabel?: string;
  parentTaskSummary: string;
  assetType: EodAssetType;
  reportIssueKey?: string;
  dataOps: Omit<DataOpsValidationState, "threadTs">;
}

export interface DataOpsProgressFormValues {
  slug: string;
  ownerSlackUserId: string;
  percentUploaded: number;
  percentValidated: number;
  percentPrep: number;
  percentQa: number;
}

export interface DataOpsCloseoutFormValues {
  dataQuality: string;
  forecastUrl: string;
  cantileverUrl: string;
}

export interface EhsFormValues {
  drugTestingSelections: string[];
  drugTestingInfo?: string;
  backgroundCheckSelections: string[];
  formsSelections: string[];
  formsInfo?: string;
  idRequirements: string[];
  idOther?: string;
  trainingRequirements?: string;
  ppeRequirements: string[];
  ppeSpecialRequirements: string[];
  ppeOther?: string;
  monitorRequirements: string[];
  soloGasRequirements: string[];
  fiveGasDetails: string[];
  fiveGasOther?: string;
  generalRequirements?: string;
  vehicles?: string;
  loto?: string;
  confinedSpace?: string;
  hazardAssessment?: string;
  submitTo?: string;
  jsaRequirements: string[];
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
