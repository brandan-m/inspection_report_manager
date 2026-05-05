import type { KnownBlock, PlainTextOption } from "@slack/types";
import { listWorkflows } from "../config/workflows.js";
import type {
  BlockerType,
  EodAssetType,
  EodCoverageUnit,
  EodReportFormValues,
  EodStatus,
  EodThreadContext,
  EodYesNo,
  SelectableIssueType,
  SupportedIssueType,
  WorkflowDefinition
} from "../types/workflow.js";
import { CALLBACKS } from "./constants.js";

const EOD_ASSET_TYPES: EodAssetType[] = [
  "Building",
  "Conveyor",
  "Crusher",
  "Stockpile",
  "Tank",
  "Other"
];
const EOD_YES_NO: EodYesNo[] = ["Yes", "No"];
const EOD_COVERAGE_UNITS: EodCoverageUnit[] = ["sq ft", "sq m", "acres", "hectares"];
const EOD_STATUSES: EodStatus[] = ["Not Started", "In Progress", "Complete", "Blocked"];

function workflowOptions(): PlainTextOption[] {
  return listWorkflows().map((workflow) => ({
    text: {
      type: "plain_text",
      text: workflow.label
    },
    value: workflow.key
  }));
}

function issueTypeOptions(workflow: WorkflowDefinition): PlainTextOption[] {
  return workflow.allowedIssueTypes.map((issueType) => ({
    text: {
      type: "plain_text",
      text: issueType
    },
    value: issueType
  }));
}

function blockerTypeOptions(): PlainTextOption[] {
  return ["Customer", "Operations", "Environmental", "Other"].map((value) => ({
    text: {
      type: "plain_text",
      text: value
    },
    value
  }));
}

function simpleOptions(values: string[]): PlainTextOption[] {
  return values.map((value) => ({
    text: {
      type: "plain_text",
      text: value
    },
    value
  }));
}

function selectedOption(value: string | undefined): PlainTextOption | undefined {
  if (!value) {
    return undefined;
  }

  return {
    text: {
      type: "plain_text",
      text: value
    },
    value
  };
}

function plainTextInputBlock(
  blockId: string,
  actionId: string,
  label: string,
  placeholder: string,
  value?: string,
  multiline = false,
  optional = false
): KnownBlock {
  return {
    type: "input",
    block_id: blockId,
    optional,
    element: {
      type: "plain_text_input",
      action_id: actionId,
      multiline,
      initial_value: value,
      placeholder: {
        type: "plain_text",
        text: placeholder
      }
    },
    label: {
      type: "plain_text",
      text: label
    }
  };
}

function staticSelectBlock(
  blockId: string,
  actionId: string,
  label: string,
  placeholder: string,
  options: PlainTextOption[],
  initialValue?: string,
  optional = false
): KnownBlock {
  return {
    type: "input",
    block_id: blockId,
    optional,
    element: {
      type: "static_select",
      action_id: actionId,
      initial_option: selectedOption(initialValue),
      placeholder: {
        type: "plain_text",
        text: placeholder
      },
      options
    },
    label: {
      type: "plain_text",
      text: label
    }
  };
}

export interface ModalStateValues {
  parentEpicKey?: string;
  parentEpicLabel?: string;
  selectedIssueType?: SelectableIssueType;
  summary?: string;
  details?: string;
  blockerType?: BlockerType;
  opsDowntimeHours?: string;
}

export interface ModalMetadata {
  workflowKey: string;
  channelId?: string;
}

function shouldShowReportingBugFields(
  workflow: WorkflowDefinition,
  issueType: SelectableIssueType
): boolean {
  return workflow.jiraProjectKey === "RB" && issueType === "Bug";
}

export function shouldCollectEodInThread(issueType: SelectableIssueType): boolean {
  return issueType === "EOD Report";
}

export function buildCreateIssueModal(
  defaultWorkflow: WorkflowDefinition,
  state: ModalStateValues = {},
  metadata?: ModalMetadata
) {
  const selectedIssueType = state.selectedIssueType ?? defaultWorkflow.allowedIssueTypes[0];
  const blocks: KnownBlock[] = [
    {
      type: "input",
      block_id: CALLBACKS.workflowBlock,
      dispatch_action: true,
      element: {
        type: "static_select",
        action_id: CALLBACKS.workflowAction,
        initial_option: {
          text: {
            type: "plain_text",
            text: defaultWorkflow.label
          },
          value: defaultWorkflow.key
        },
        options: workflowOptions()
      },
      label: {
        type: "plain_text",
        text: "Workflow"
      }
    },
    {
      type: "input",
      block_id: CALLBACKS.epicBlock,
      element: {
        type: "external_select",
        action_id: CALLBACKS.epicAction,
        min_query_length: 0,
        placeholder: {
          type: "plain_text",
          text: "Search Jira Epics"
        }
      },
      label: {
        type: "plain_text",
        text: "Parent Epic"
      }
    },
    {
      type: "input",
      block_id: CALLBACKS.issueTypeBlock,
      dispatch_action: true,
      element: {
        type: "static_select",
        action_id: CALLBACKS.issueTypeAction,
        initial_option: {
          text: {
            type: "plain_text",
            text: selectedIssueType
          },
          value: selectedIssueType
        },
        options: issueTypeOptions(defaultWorkflow)
      },
      label: {
        type: "plain_text",
        text: "Issue Type"
      }
    },
    plainTextInputBlock(
      CALLBACKS.summaryBlock,
      CALLBACKS.summaryAction,
      "Summary",
      "Short issue summary",
      state.summary
    )
  ];

  if (!shouldCollectEodInThread(selectedIssueType)) {
    blocks.push(
      plainTextInputBlock(
        CALLBACKS.detailsBlock,
        CALLBACKS.detailsAction,
        "Details",
        "Add details for the Jira issue",
        state.details,
        true
      )
    );
  }

  if (shouldShowReportingBugFields(defaultWorkflow, selectedIssueType)) {
    blocks.splice(
      4,
      0,
      staticSelectBlock(
        CALLBACKS.blockerTypeBlock,
        CALLBACKS.blockerTypeAction,
        "RUG Blocker Type",
        "Required for Reporting/Job Board Bugs",
        blockerTypeOptions(),
        state.blockerType
      ),
      plainTextInputBlock(
        CALLBACKS.downtimeBlock,
        CALLBACKS.downtimeAction,
        "RUG Ops Downtime (hours)",
        "Required for Reporting/Job Board Bugs",
        state.opsDowntimeHours
      )
    );
  }

  return {
    type: "modal" as const,
    callback_id: CALLBACKS.createIssueView,
    private_metadata: JSON.stringify({
      workflowKey: defaultWorkflow.key,
      ...(metadata?.channelId ? { channelId: metadata.channelId } : {})
    }),
    title: {
      type: "plain_text" as const,
      text: "Create Gecko Report"
    },
    submit: {
      type: "plain_text" as const,
      text: shouldCollectEodInThread(selectedIssueType) ? "Start Intake" : "Create"
    },
    close: {
      type: "plain_text" as const,
      text: "Cancel"
    },
    blocks
  };
}

export function encodeEodThreadContext(context: EodThreadContext): string {
  return JSON.stringify(context);
}

export function decodeEodThreadContext(value: string): EodThreadContext {
  const parsed = JSON.parse(value) as Partial<EodThreadContext>;

  if (
    !parsed.workflowKey ||
    !parsed.parentEpicKey ||
    !parsed.summary ||
    !parsed.requesterId ||
    !parsed.channelId ||
    !parsed.threadTs
  ) {
    throw new Error("EOD thread context is incomplete.");
  }

  return {
    workflowKey: parsed.workflowKey,
    parentEpicKey: parsed.parentEpicKey,
    summary: parsed.summary,
    requesterId: parsed.requesterId,
    channelId: parsed.channelId,
    threadTs: parsed.threadTs
  };
}

export function buildEodThreadStartBlocks(context: EodThreadContext): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*EOD intake started*\n*Parent Epic:* ${context.parentEpicKey}\n*Summary:* ${context.summary}\n*Requested by:* <@${context.requesterId}>`
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: CALLBACKS.eodStartButton,
          text: {
            type: "plain_text",
            text: "Complete EOD Intake"
          },
          style: "primary",
          value: encodeEodThreadContext(context)
        }
      ]
    }
  ];
}

export function buildEodReportModal(context: EodThreadContext) {
  return {
    type: "modal" as const,
    callback_id: CALLBACKS.eodReportView,
    private_metadata: encodeEodThreadContext(context),
    title: {
      type: "plain_text" as const,
      text: "EOD Intake"
    },
    submit: {
      type: "plain_text" as const,
      text: "Create Jira Issue"
    },
    close: {
      type: "plain_text" as const,
      text: "Cancel"
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Parent Epic:* ${context.parentEpicKey}\n*Summary:* ${context.summary}`
        }
      },
      {
        type: "input",
        block_id: CALLBACKS.eodDateBlock,
        element: {
          type: "datepicker",
          action_id: CALLBACKS.eodDateAction
        },
        label: {
          type: "plain_text",
          text: "Date"
        }
      },
      staticSelectBlock(
        CALLBACKS.eodAssetTypeBlock,
        CALLBACKS.eodAssetTypeAction,
        "Asset Type",
        "Choose asset type",
        simpleOptions(EOD_ASSET_TYPES)
      ),
      plainTextInputBlock(
        CALLBACKS.eodAssetNumberBlock,
        CALLBACKS.eodAssetNumberAction,
        "Asset number",
        "Asset number"
      ),
      plainTextInputBlock(
        CALLBACKS.eodCrewOnSiteBlock,
        CALLBACKS.eodCrewOnSiteAction,
        "Crew On-Site",
        "Crew arrival time or detail"
      ),
      staticSelectBlock(
        CALLBACKS.eodJsaSubmittedBlock,
        CALLBACKS.eodJsaSubmittedAction,
        "JSA Submitted",
        "Choose status",
        simpleOptions(EOD_YES_NO)
      ),
      plainTextInputBlock(
        CALLBACKS.eodPermitApprovedBlock,
        CALLBACKS.eodPermitApprovedAction,
        "Permit Approved",
        "Permit approval detail"
      ),
      plainTextInputBlock(
        CALLBACKS.eodCalibrationCompletedBlock,
        CALLBACKS.eodCalibrationCompletedAction,
        "Calibration Completed",
        "Calibration completion detail"
      ),
      plainTextInputBlock(
        CALLBACKS.eodScansCompletedBlock,
        CALLBACKS.eodScansCompletedAction,
        "Number of Scans Completed",
        "0"
      ),
      plainTextInputBlock(
        CALLBACKS.eodScanningTimeBlock,
        CALLBACKS.eodScanningTimeAction,
        "Total Scanning Time (Hours)",
        "0"
      ),
      plainTextInputBlock(
        CALLBACKS.eodCoverageBlock,
        CALLBACKS.eodCoverageAction,
        "Scanning Area Coverage",
        "0"
      ),
      staticSelectBlock(
        CALLBACKS.eodCoverageUnitsBlock,
        CALLBACKS.eodCoverageUnitsAction,
        "Covered Area Units",
        "Choose units",
        simpleOptions(EOD_COVERAGE_UNITS)
      ),
      staticSelectBlock(
        CALLBACKS.eodUploadStatusBlock,
        CALLBACKS.eodUploadStatusAction,
        "Data Upload Status",
        "Choose status",
        simpleOptions(EOD_STATUSES)
      ),
      staticSelectBlock(
        CALLBACKS.eodValidationStatusBlock,
        CALLBACKS.eodValidationStatusAction,
        "Data Validation Status",
        "Choose status",
        simpleOptions(EOD_STATUSES)
      ),
      staticSelectBlock(
        CALLBACKS.eodReportStatusBlock,
        CALLBACKS.eodReportStatusAction,
        "Report Status",
        "Choose status",
        simpleOptions(EOD_STATUSES)
      ),
      plainTextInputBlock(
        CALLBACKS.eodCrewOffSiteBlock,
        CALLBACKS.eodCrewOffSiteAction,
        "Crew Off-Site",
        "Crew departure time or detail"
      ),
      plainTextInputBlock(
        CALLBACKS.eodNotesBlock,
        CALLBACKS.eodNotesAction,
        "Notes (optional)",
        "Additional notes",
        undefined,
        true,
        true
      )
    ]
  };
}

export function formatEodReportDetails(values: EodReportFormValues): string {
  const lines = [
    `Date: ${values.date}`,
    `Asset Type: ${values.assetType}`,
    `Asset Number: ${values.assetNumber}`,
    `Crew On-Site: ${values.crewOnSite}`,
    `JSA Submitted: ${values.jsaSubmitted}`,
    `Permit Approved: ${values.permitApproved}`,
    `Calibration Completed: ${values.calibrationCompleted}`,
    `Number of Scans Completed: ${values.numberOfScansCompleted}`,
    `Total Scanning Time (Hours): ${values.totalScanningTimeHours}`,
    `Scanning Area Coverage: ${values.scanningAreaCoverage}`,
    `Covered Area Units: ${values.coveredAreaUnits}`,
    `Data Upload Status: ${values.dataUploadStatus}`,
    `Data Validation Status: ${values.dataValidationStatus}`,
    `Report Status: ${values.reportStatus}`,
    `Crew Off-Site: ${values.crewOffSite}`
  ];

  if (values.notes?.trim()) {
    lines.push(`Notes: ${values.notes.trim()}`);
  }

  return lines.join("\n");
}

export function selectedIssueTypeFromValue(value: string): Exclude<SupportedIssueType, "Epic"> {
  if (value !== "Bug" && value !== "EOD Report") {
    throw new Error(`Unsupported issue type: ${value}`);
  }

  return value;
}

export function requiresReportingBugFields(
  workflow: WorkflowDefinition,
  issueType: Exclude<SupportedIssueType, "Epic">
): boolean {
  return shouldShowReportingBugFields(workflow, issueType);
}

export function requiresBugSpecificFields(
  workflow: WorkflowDefinition,
  issueType: Exclude<SupportedIssueType, "Epic">
): boolean {
  return requiresReportingBugFields(workflow, issueType);
}
