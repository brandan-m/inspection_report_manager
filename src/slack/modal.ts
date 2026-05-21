import type { KnownBlock, PlainTextOption } from "@slack/types";
import { listWorkflows } from "../config/workflows.js";
import {
  buildEhsTaskBlocks,
  buildEhsTaskDescriptionContent,
  type EhsModalStateValues,
  formatEhsTaskDetails
} from "../ehs/form.js";
import type {
  BlockerType,
  EodAssetType,
  EhsFormValues,
  JiraDocNode,
  EodReportFormValues,
  EodThreadContext,
  EodYesNo,
  SelectableIssueType,
  SupportedIssueType,
  WorkflowDefinition
} from "../types/workflow.js";
import { CALLBACKS } from "./constants.js";

const EOD_ASSET_TYPES: EodAssetType[] = [
  "Kiln",
  "Hood",
  "Above Ground Storage Tank",
  "Tank",
  "Drum",
  "Vessel",
  "Piping",
  "SDA",
  "Silo",
  "Boiler",
  "Heat Exchangers",
  "Stacks",
  "Spheres",
  "Towers"
];
const EOD_YES_NO: EodYesNo[] = ["Yes", "No"];

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

export interface ModalStateValues {
  parentEpicKey?: string;
  parentEpicLabel?: string;
  eodTaskKey?: string;
  eodTaskLabel?: string;
  eodAssetType?: EodAssetType;
  selectedIssueType?: SelectableIssueType;
  summary?: string;
  details?: string;
  blockerType?: BlockerType;
  opsDowntimeHours?: string;
  ehs?: EhsModalStateValues;
}

export interface ModalMetadata {
  workflowKey: string;
  channelId?: string;
}

function requiresBugFields(workflow: WorkflowDefinition, issueType: SelectableIssueType): boolean {
  return (workflow.jiraProjectKey === "RB" || workflow.jiraProjectKey === "APIDD") && issueType === "Bug";
}

function blockerTypeLabel(workflow: WorkflowDefinition): string {
  return workflow.jiraProjectKey === "APIDD" ? "API Blocker Type" : "RUG Blocker Type";
}

function downtimeLabel(workflow: WorkflowDefinition): string {
  return workflow.jiraProjectKey === "APIDD" ? "API Ops Downtime (hours)" : "RUG Ops Downtime (hours)";
}

function bugFieldPlaceholder(workflow: WorkflowDefinition): string {
  return workflow.jiraProjectKey === "APIDD"
    ? "Required for API Data Delivery Bugs"
    : "Required for Reporting/Job Board Bugs";
}

function usesEhsIntake(workflow: WorkflowDefinition, issueType: SelectableIssueType): boolean {
  return workflow.intakeForm === "ehs" && issueType === "Task";
}

function shouldShowIssueTypeSelector(workflow: WorkflowDefinition): boolean {
  return workflow.allowedIssueTypes.length > 1;
}

export function shouldCollectEodInThread(issueType: SelectableIssueType): boolean {
  return issueType === "EOD Report";
}

export function buildCreateIssueModal(
  defaultWorkflow: WorkflowDefinition,
  state: ModalStateValues = {},
  metadata: Partial<ModalMetadata> = {}
) {
  const selectedIssueType = state.selectedIssueType ?? defaultWorkflow.allowedIssueTypes[0];
  const blocks: KnownBlock[] = [
    {
      type: "section",
      block_id: CALLBACKS.workflowBlock,
      text: {
        type: "mrkdwn",
        text: "*Workflow*"
      },
      accessory: {
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
      }
    },
    {
      type: "section",
      block_id: CALLBACKS.epicBlock,
      text: {
        type: "mrkdwn",
        text: "*Parent Epic*"
      },
      accessory: {
        type: "external_select",
        action_id: CALLBACKS.epicAction,
        min_query_length: 0,
        initial_option:
          state.parentEpicKey && state.parentEpicLabel
            ? {
                text: {
                  type: "plain_text",
                  text: state.parentEpicLabel.slice(0, 75)
                },
                value: state.parentEpicKey
              }
            : undefined,
        placeholder: {
          type: "plain_text",
          text: "Search Jira Epics"
        }
      }
    },
  ];

  if (shouldShowIssueTypeSelector(defaultWorkflow)) {
    blocks.push({
      type: "section",
      block_id: CALLBACKS.issueTypeBlock,
      text: {
        type: "mrkdwn",
        text: "*Issue Type*"
      },
      accessory: {
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
      }
    });
  }

  if (requiresBugFields(defaultWorkflow, selectedIssueType)) {
    blocks.splice(3, 0, {
      type: "input",
      block_id: CALLBACKS.blockerTypeBlock,
      element: {
        type: "static_select",
        action_id: CALLBACKS.blockerTypeAction,
        initial_option: state.blockerType
          ? {
              text: {
                type: "plain_text",
                text: state.blockerType
              },
              value: state.blockerType
            }
          : undefined,
        placeholder: {
          type: "plain_text",
          text: bugFieldPlaceholder(defaultWorkflow)
        },
        options: blockerTypeOptions()
      },
      label: {
        type: "plain_text",
        text: blockerTypeLabel(defaultWorkflow)
      }
    });

    blocks.splice(4, 0, {
      type: "input",
      block_id: CALLBACKS.downtimeBlock,
      element: {
        type: "number_input",
        action_id: CALLBACKS.downtimeAction,
        is_decimal_allowed: true,
        initial_value: state.opsDowntimeHours,
        placeholder: {
          type: "plain_text",
          text: bugFieldPlaceholder(defaultWorkflow)
        }
      },
      label: {
        type: "plain_text",
        text: downtimeLabel(defaultWorkflow)
      }
    });
  }

  if (usesEhsIntake(defaultWorkflow, selectedIssueType)) {
    blocks.push(...buildEhsTaskBlocks(state.ehs));
  } else if (shouldCollectEodInThread(selectedIssueType)) {
    blocks.push(
      {
        type: "section",
        block_id: CALLBACKS.eodTaskBlock,
        text: {
          type: "mrkdwn",
          text: "*Asset Task*"
        },
        accessory: {
          type: "external_select",
          action_id: CALLBACKS.eodTaskAction,
          min_query_length: 0,
          initial_option:
            state.eodTaskKey && state.eodTaskLabel
              ? {
                  text: {
                    type: "plain_text",
                    text: state.eodTaskLabel.slice(0, 75)
                  },
                  value: state.eodTaskKey
                }
              : undefined,
          placeholder: {
            type: "plain_text",
            text: "Search child Tasks under the parent Epic"
          }
        }
      },
      {
        type: "input",
        block_id: CALLBACKS.eodAssetTypeBlock,
        element: {
          type: "static_select",
          action_id: CALLBACKS.eodAssetTypeAction,
          initial_option: selectedOption(state.eodAssetType),
          placeholder: {
            type: "plain_text",
            text: "Choose asset type"
          },
          options: simpleOptions(EOD_ASSET_TYPES)
        },
        label: {
          type: "plain_text",
          text: "Asset Type"
        }
      }
    );
  } else if (!shouldCollectEodInThread(selectedIssueType)) {
    blocks.push(
      plainTextInputBlock(
        CALLBACKS.summaryBlock,
        CALLBACKS.summaryAction,
        "Summary",
        "Short issue summary",
        state.summary
      ),
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

  return {
    type: "modal" as const,
    callback_id: CALLBACKS.createIssueView,
    private_metadata: JSON.stringify({
      workflowKey: metadata.workflowKey ?? defaultWorkflow.key,
      channelId: metadata.channelId
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
    !parsed.assetType ||
    !parsed.requesterId ||
    !parsed.channelId ||
    !parsed.threadTs
  ) {
    throw new Error("EOD thread context is incomplete.");
  }

  return {
    workflowKey: parsed.workflowKey,
    parentEpicKey: parsed.parentEpicKey,
    parentEpicLabel: parsed.parentEpicLabel,
    parentTaskKey: parsed.parentTaskKey,
    parentTaskLabel: parsed.parentTaskLabel,
    assetType: parsed.assetType,
    requesterId: parsed.requesterId,
    channelId: parsed.channelId,
    threadTs: parsed.threadTs
  };
}

export function buildEodReportModal(context: EodThreadContext) {
  const parentInspectionLabel = context.parentEpicLabel ?? context.parentEpicKey;
  const parentTaskLabel = context.parentTaskLabel ?? context.parentTaskKey ?? "Not selected";

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
          text:
            `*Parent Inspection:* ${parentInspectionLabel}\n` +
            `*Asset:* ${parentTaskLabel}\n` +
            `*Asset Type:* ${context.assetType}`
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
      {
        type: "input",
        block_id: CALLBACKS.eodJsaSubmittedBlock,
        element: {
          type: "static_select",
          action_id: CALLBACKS.eodJsaSubmittedAction,
          placeholder: {
            type: "plain_text",
            text: "Choose status"
          },
          options: simpleOptions(EOD_YES_NO)
        },
        label: {
          type: "plain_text",
          text: "JSA Submitted"
        }
      },
      plainTextInputBlock(
        CALLBACKS.eodCalibrationCompletedBlock,
        CALLBACKS.eodCalibrationCompletedAction,
        "Calibration Completed",
        "Calibration completion detail"
      ),
      {
        type: "input",
        block_id: CALLBACKS.eodScansCompletedBlock,
        element: {
          type: "number_input",
          action_id: CALLBACKS.eodScansCompletedAction,
          is_decimal_allowed: false,
          placeholder: {
            type: "plain_text",
            text: "0"
          }
        },
        label: {
          type: "plain_text",
          text: "Number of Scans Completed"
        }
      },
      {
        type: "input",
        block_id: CALLBACKS.eodScanningTimeBlock,
        element: {
          type: "number_input",
          action_id: CALLBACKS.eodScanningTimeAction,
          is_decimal_allowed: true,
          placeholder: {
            type: "plain_text",
            text: "0"
          }
        },
        label: {
          type: "plain_text",
          text: "Total Scanning Time (Hours)"
        }
      },
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

export function formatEodReportDetails(context: EodThreadContext, values: EodReportFormValues): string {
  const lines = [
    `Parent Inspection: ${context.parentEpicLabel ?? context.parentEpicKey}`,
    `Asset: ${context.parentTaskLabel ?? context.parentTaskKey ?? "Not selected"}`,
    `Asset Type: ${context.assetType}`,
    `Date: ${values.date}`,
    `Asset Number: ${values.assetNumber}`,
    `Crew On-Site: ${values.crewOnSite}`,
    `JSA Submitted: ${values.jsaSubmitted}`,
    `Calibration Completed: ${values.calibrationCompleted}`,
    `Number of Scans Completed: ${values.numberOfScansCompleted}`,
    `Total Scanning Time (Hours): ${values.totalScanningTimeHours}`,
    `Crew Off-Site: ${values.crewOffSite}`
  ];

  if (values.notes?.trim()) {
    lines.push(`Notes: ${values.notes.trim()}`);
  }

  return lines.join("\n");
}

export function buildEodReportSummary(context: EodThreadContext, values: EodReportFormValues): string {
  return `${values.date} ${context.assetType} ${values.assetNumber} EOD Report`;
}

export function selectedIssueTypeFromValue(value: string): Exclude<SupportedIssueType, "Epic"> {
  if (value !== "Bug" && value !== "EOD Report" && value !== "Task") {
    throw new Error(`Unsupported issue type: ${value}`);
  }

  return value;
}

export function usesEhsSpecificFields(
  workflow: WorkflowDefinition,
  issueType: Exclude<SupportedIssueType, "Epic">
): boolean {
  return usesEhsIntake(workflow, issueType);
}

export function requiresReportingBugFields(
  workflow: WorkflowDefinition,
  issueType: Exclude<SupportedIssueType, "Epic">
): boolean {
  return requiresBugFields(workflow, issueType);
}

export function requiresBugSpecificFields(
  workflow: WorkflowDefinition,
  issueType: Exclude<SupportedIssueType, "Epic">
): boolean {
  return requiresBugFields(workflow, issueType);
}

export function formatEhsDetails(values: EhsFormValues): string {
  return formatEhsTaskDetails(values);
}

export function buildEhsDescriptionContent(values: EhsFormValues): JiraDocNode[] {
  return buildEhsTaskDescriptionContent(values);
}
