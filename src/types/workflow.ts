export type SupportedIssueType = "Bug" | "EOD Report" | "Task" | "Epic";
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

export interface WorkflowDefinition {
  key: string;
  label: string;
  jiraProjectKey: string;
  allowedIssueTypes: SelectableIssueType[];
  epicSearchJql: string;
  intakeForm?: "generic" | "ehs";
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

export interface JiraParagraphNode {
  type: "paragraph";
  content: JiraTextNode[];
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
  issueType: SelectableIssueType;
  parentEpicKey: string;
  summary: string;
  details: string;
  descriptionContent?: JiraDocNode[];
  requesterName?: string;
  blockerType?: BlockerType;
  opsDowntimeHours?: number;
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
  numberOfScansCompleted: number;
  totalScanningTimeHours: number;
  notes?: string;
}

export interface EodThreadContext {
  workflowKey: string;
  parentEpicKey: string;
  parentEpicLabel?: string;
  parentTaskKey: string;
  parentTaskLabel?: string;
  parentTaskSummary: string;
  assetType: EodAssetType;
  requesterId: string;
  channelId: string;
  threadTs: string;
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
