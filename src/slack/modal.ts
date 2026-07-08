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
  EodThreadLifecycleStatus,
  EhsFormValues,
  JiraDocNode,
  JiraTextNode,
  EodReportFormValues,
  EodThreadContext,
  EodYesNo,
  SelectableIssueType,
  SupportedIssueType,
  WorkflowDefinition,
  WorkflowParentIssueType
} from "../types/workflow.js";
import { CALLBACKS } from "./constants.js";
import { richTextInputBlock } from "./richText.js";

const EOD_ASSET_TYPES: EodAssetType[] = [
  "Kiln",
  "Hood",
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
const CHANNEL_CONVERSATION_TYPES: Array<"public"> = ["public"];
const SLACK_OPTION_TEXT_LIMIT = 75;

function truncateSlackOptionLine(text: string, limit = SLACK_OPTION_TEXT_LIMIT): string {
  if (text.length <= limit) {
    return text;
  }

  if (limit <= 3) {
    return text.slice(0, limit);
  }

  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function normalizeSlackLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

function buildQueryAwareOptionText(summary: string, query?: string): string {
  if (summary.length <= SLACK_OPTION_TEXT_LIMIT) {
    return summary;
  }

  const normalizedQuery = query?.trim().toLowerCase();

  if (!normalizedQuery) {
    return truncateSlackOptionLine(summary);
  }

  const matchIndex = summary.toLowerCase().indexOf(normalizedQuery);

  if (matchIndex === -1) {
    return truncateSlackOptionLine(summary);
  }

  const ellipsis = "...";
  const contextBudget = SLACK_OPTION_TEXT_LIMIT - normalizedQuery.length - ellipsis.length * 2;

  if (contextBudget <= 0) {
    return truncateSlackOptionLine(summary);
  }

  const leftBudget = Math.floor(contextBudget / 2);
  const rightBudget = contextBudget - leftBudget;
  const desiredStart = Math.max(0, matchIndex - leftBudget);
  const desiredEnd = Math.min(summary.length, matchIndex + normalizedQuery.length + rightBudget);
  const slice = summary.slice(desiredStart, desiredEnd).trim();
  const prefix = desiredStart > 0 ? ellipsis : "";
  const suffix = desiredEnd < summary.length ? ellipsis : "";

  return truncateSlackOptionLine(`${prefix}${slice}${suffix}`);
}

export function buildIssueSelectOption(issueKey: string, issueSummary?: string, query?: string): PlainTextOption {
  const normalizedSummary = issueSummary?.trim();
  const text = normalizedSummary
    ? buildQueryAwareOptionText(normalizeSlackLabel(normalizedSummary), query)
    : issueKey;

  return {
    text: {
      type: "plain_text",
      text
    },
    value: issueKey
  };
}

function buildSelectedIssuePreview(issueTypeLabel: string, issueKey?: string, issueLabel?: string): KnownBlock | undefined {
  if (!issueKey || !issueLabel) {
    return undefined;
  }

  const normalizedLabel = normalizeSlackLabel(issueLabel);
  const previewText = normalizedLabel.startsWith(`${issueKey} - `) ? normalizedLabel : `${issueKey} - ${normalizedLabel}`;

  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Selected ${issueTypeLabel}*\n${previewText}`
    }
  };
}

export function usesTubeCountForEod(context: Pick<EodThreadContext, "assetType">): boolean {
  return context.assetType === "Boiler";
}

export function getEodProgressFieldLabel(context: Pick<EodThreadContext, "assetType">): string {
  return usesTubeCountForEod(context) ? "# of Tubes Scanned" : "sqft. % done";
}

export function formatEodProgressValue(
  context: Pick<EodThreadContext, "assetType">,
  value: number | string
): string {
  return usesTubeCountForEod(context) ? String(value) : `${String(value)}%`;
}

export function formatEodProgressCodeValue(context: Pick<EodThreadContext, "assetType">, value: number): string {
  return `\`${formatEodProgressValue(context, value)}\``;
}

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

function attachmentHelpBlock(blockId: string, text: string): KnownBlock {
  return {
    type: "section",
    block_id: blockId,
    text: {
      type: "mrkdwn",
      text
    }
  };
}

function attachmentInputBlock(blockId: string, actionId: string, label: string): KnownBlock {
  return {
    type: "input",
    block_id: blockId,
    optional: true,
    element: {
      type: "file_input",
      action_id: actionId,
      max_files: 10
    },
    label: {
      type: "plain_text",
      text: label
    }
  } as KnownBlock;
}

function jiraText(text: string, marks?: JiraTextNode["marks"]): JiraTextNode {
  return {
    type: "text",
    text,
    ...(marks?.length ? { marks } : {})
  };
}

function jiraParagraph(label: string, value: string): JiraDocNode {
  return {
    type: "paragraph",
    content: [jiraText(`${label}: `, [{ type: "strong" }]), jiraText(value)]
  };
}

export interface ModalStateValues {
  channelId?: string;
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
  requireChannelSelection?: boolean;
}

function isWorkflowWithBugFields(workflow: WorkflowDefinition): boolean {
  return workflow.jiraProjectKey === "RB" || workflow.jiraProjectKey === "UIM";
}

function requiresBugFields(workflow: WorkflowDefinition, issueType: SelectableIssueType): boolean {
  return isWorkflowWithBugFields(workflow) && issueType === "Bug";
}

function blockerTypeLabel(workflow: WorkflowDefinition): string {
  if (workflow.jiraProjectKey === "RB") {
    return "RUG Blocker Type";
  }

  if (workflow.jiraProjectKey === "UIM") {
    return "UAE Blocker Type";
  }

  return "Blocker Type";
}

function downtimeLabel(workflow: WorkflowDefinition): string {
  if (workflow.jiraProjectKey === "RB") {
    return "RUG Ops Downtime (hours)";
  }

  if (workflow.jiraProjectKey === "UIM") {
    return "UAE Ops Downtime (hours)";
  }

  return "Ops Downtime (hours)";
}

function bugFieldPlaceholder(workflow: WorkflowDefinition): string {
  if (workflow.jiraProjectKey === "RB") {
    return "Required for Reporting/Job Board Bugs";
  }

  if (workflow.jiraProjectKey === "UIM") {
    return "Required for UAE Inspection Mobilization Bugs";
  }

  return "Required for Bugs";
}

function usesEhsIntake(workflow: WorkflowDefinition, issueType: SelectableIssueType): boolean {
  return workflow.intakeForm === "ehs" && issueType === "Task";
}

function shouldShowIssueTypeSelector(workflow: WorkflowDefinition): boolean {
  return workflow.allowedIssueTypes.length > 1;
}

export function getWorkflowParentIssueType(workflow: WorkflowDefinition): WorkflowParentIssueType {
  return workflow.parentIssueType ?? "Epic";
}

export function workflowRequiresSeparateEodAssetTask(workflow: WorkflowDefinition): boolean {
  return (workflow.eodAssetSelectionMode ?? "child_task") === "child_task";
}

function getWorkflowParentIssueLabel(workflow: WorkflowDefinition): string {
  return getWorkflowParentIssueType(workflow) === "Task" ? "Parent Inspection" : "Parent Epic";
}

function getWorkflowParentSearchPlaceholder(workflow: WorkflowDefinition): string {
  return getWorkflowParentIssueType(workflow) === "Task" ? "Search Jira Tasks" : "Search Jira Epics";
}

function hasSeparateEodAssetTask(context: Pick<EodThreadContext, "parentTaskKey" | "parentTaskSummary">): boolean {
  return Boolean(context.parentTaskKey?.trim() || context.parentTaskSummary?.trim());
}

function getEodAssetDisplayLabel(
  context: Pick<EodThreadContext, "parentEpicKey" | "parentEpicLabel" | "parentTaskKey" | "parentTaskLabel" | "parentTaskSummary">
): string {
  return (
    context.parentTaskLabel ??
    context.parentTaskSummary ??
    context.parentTaskKey ??
    context.parentEpicLabel ??
    context.parentEpicKey
  );
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
  const parentIssueLabel = getWorkflowParentIssueLabel(defaultWorkflow);
  const selectedParentEpicPreview = buildSelectedIssuePreview(parentIssueLabel, state.parentEpicKey, state.parentEpicLabel);
  const selectedAssetTaskPreview = workflowRequiresSeparateEodAssetTask(defaultWorkflow)
    ? buildSelectedIssuePreview("Asset Task", state.eodTaskKey, state.eodTaskLabel)
    : undefined;
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
    ...(metadata.requireChannelSelection
      ? [
          {
            type: "section" as const,
            text: {
              type: "mrkdwn" as const,
              text:
                "*Choose Channel*\nWe couldn't determine where to post this workflow's Slack follow-up. Pick a public channel to continue."
            }
          },
          {
            type: "input" as const,
            block_id: CALLBACKS.channelBlock,
            element: {
              type: "conversations_select" as const,
              action_id: CALLBACKS.channelAction,
              initial_conversation: state.channelId ?? metadata.channelId,
              filter: {
                include: CHANNEL_CONVERSATION_TYPES
              },
              placeholder: {
                type: "plain_text" as const,
                text: "Choose the Slack channel for this report"
              }
            },
            label: {
              type: "plain_text" as const,
              text: "Channel"
            }
          }
        ]
      : []),
    {
      type: "section",
      block_id: CALLBACKS.epicBlock,
      text: {
        type: "mrkdwn",
        text: `*${parentIssueLabel}*`
      },
      accessory: {
        type: "external_select",
        action_id: CALLBACKS.epicAction,
        min_query_length: 0,
        initial_option:
          state.parentEpicKey && state.parentEpicLabel
            ? buildIssueSelectOption(state.parentEpicKey, state.parentEpicLabel)
            : undefined,
        placeholder: {
          type: "plain_text",
          text: getWorkflowParentSearchPlaceholder(defaultWorkflow)
        }
      }
    },
    ...(selectedParentEpicPreview ? [selectedParentEpicPreview] : []),
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
    if (workflowRequiresSeparateEodAssetTask(defaultWorkflow)) {
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
                ? buildIssueSelectOption(state.eodTaskKey, state.eodTaskLabel)
                : undefined,
            placeholder: {
              type: "plain_text",
              text: "Search child Tasks under the selected parent"
            }
          }
        },
        ...(selectedAssetTaskPreview ? [selectedAssetTaskPreview] : [])
      );
    }

    blocks.push({
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
      });
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
      ),
      attachmentHelpBlock(
        "bug_attachments_help",
        "*Attachments (optional)*\nUpload screenshots, documents, or other files to include with the Slack confirmation and the Jira issue. Add files after you finish changing the form because Slack clears uploads when the modal refreshes."
      ),
      attachmentInputBlock(
        CALLBACKS.bugAttachmentsBlock,
        CALLBACKS.bugAttachmentsAction,
        "Attachments (optional)"
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
  const status: EodThreadLifecycleStatus = parsed.status === "closed" ? "closed" : "active";
  const reportIssueKey =
    typeof parsed.reportIssueKey === "string" && parsed.reportIssueKey.trim().length > 0
      ? parsed.reportIssueKey
      : undefined;
  const lastCoveragePercent =
    typeof parsed.lastCoveragePercent === "number" && Number.isFinite(parsed.lastCoveragePercent)
      ? parsed.lastCoveragePercent
      : undefined;
  const closedOutByUserId =
    typeof parsed.closedOutByUserId === "string" && parsed.closedOutByUserId.trim().length > 0
      ? parsed.closedOutByUserId
      : undefined;
  const closedOutAt =
    typeof parsed.closedOutAt === "string" && parsed.closedOutAt.trim().length > 0 ? parsed.closedOutAt : undefined;

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
    parentTaskSummary: parsed.parentTaskSummary,
    assetType: parsed.assetType,
    requesterId: parsed.requesterId,
    channelId: parsed.channelId,
    threadTs: parsed.threadTs,
    status,
    reportIssueKey,
    lastCoveragePercent,
    closedOutByUserId,
    closedOutAt
  };
}

export function buildEodReportModal(context: EodThreadContext) {
  const parentInspectionLabel = context.parentEpicLabel ?? context.parentEpicKey;
  const parentTaskLabel = getEodAssetDisplayLabel(context);
  const progressFieldLabel = getEodProgressFieldLabel(context);
  const usesTubeCount = usesTubeCountForEod(context);
  const summaryLines = [`*Parent Inspection:* ${parentInspectionLabel}`];

  if (hasSeparateEodAssetTask(context) && parentTaskLabel) {
    summaryLines.push(`*Asset:* ${parentTaskLabel}`);
  }

  summaryLines.push(`*Asset Type:* ${context.assetType}`);

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
      text: "Submit"
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
          text: summaryLines.join("\n")
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
      richTextInputBlock(
        CALLBACKS.eodFullDayOverviewBlock,
        CALLBACKS.eodFullDayOverviewAction,
        "Full Day Overview",
        "Add timing, crew movement, and operational notes for the day"
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
      {
        type: "input",
        block_id: CALLBACKS.eodScansCompletedBlock,
        element: {
          type: "number_input",
          action_id: CALLBACKS.eodScansCompletedAction,
          is_decimal_allowed: false,
          min_value: "0",
          ...(usesTubeCount ? {} : { max_value: "100" }),
          placeholder: {
            type: "plain_text",
            text: "0"
          }
        },
        label: {
          type: "plain_text",
          text: progressFieldLabel
        }
      },
      {
        type: "input",
        block_id: CALLBACKS.eodScanningTimeBlock,
        element: {
          type: "number_input",
          action_id: CALLBACKS.eodScanningTimeAction,
          is_decimal_allowed: true,
          min_value: "0",
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
        CALLBACKS.eodNotesBlock,
        CALLBACKS.eodNotesAction,
        "Notes (optional)",
        "Additional notes",
        undefined,
        true,
        true
      ),
      attachmentHelpBlock(
        "eod_attachments_help",
        "*Attachments (optional)*\nUpload photos, scans, or supporting documents to include in this Slack thread and on the Jira issue."
      ),
      attachmentInputBlock(
        CALLBACKS.eodAttachmentsBlock,
        CALLBACKS.eodAttachmentsAction,
        "Attachments (optional)"
      )
    ]
  };
}

export function formatEodReportDetails(context: EodThreadContext, values: EodReportFormValues): string {
  const progressFieldLabel = getEodProgressFieldLabel(context);
  const lines = [`Parent Inspection: ${context.parentEpicLabel ?? context.parentEpicKey}`];

  if (hasSeparateEodAssetTask(context)) {
    lines.push(`Asset: ${getEodAssetDisplayLabel(context)}`);
  }

  lines.push(
    `Asset Type: ${context.assetType}`,
    `Date: ${values.date}`,
    `Full Day Overview:\n${values.fullDayOverview}`,
    `JSA Submitted: ${values.jsaSubmitted}`,
    `${progressFieldLabel}: ${formatEodProgressValue(context, values.numberOfScansCompleted)}`,
    `Total Scanning Time (Hours): ${values.totalScanningTimeHours}`
  );

  if (values.notes?.trim()) {
    lines.push(`Notes:\n${values.notes.trim()}`);
  }

  return lines.join("\n");
}

export function buildEodDescriptionContent(context: EodThreadContext, values: EodReportFormValues): JiraDocNode[] {
  const progressFieldLabel = getEodProgressFieldLabel(context);
  const content: JiraDocNode[] = [jiraParagraph("Parent Inspection", context.parentEpicLabel ?? context.parentEpicKey)];

  if (hasSeparateEodAssetTask(context)) {
    content.push(jiraParagraph("Asset", getEodAssetDisplayLabel(context)));
  }

  content.push(
    jiraParagraph("Asset Type", context.assetType),
    jiraParagraph("Date", values.date),
    {
      type: "heading",
      attrs: {
        level: 2
      },
      content: [jiraText("Full Day Overview")]
    },
    ...(values.fullDayOverviewContent?.length
      ? values.fullDayOverviewContent
      : [
          {
            type: "paragraph",
            content: [jiraText(values.fullDayOverview)]
          } satisfies JiraDocNode
        ]),
    jiraParagraph("JSA Submitted", values.jsaSubmitted),
    jiraParagraph(progressFieldLabel, formatEodProgressValue(context, values.numberOfScansCompleted)),
    jiraParagraph("Total Scanning Time (Hours)", String(values.totalScanningTimeHours))
  );

  if (values.notes?.trim()) {
    content.push({
      type: "heading",
      attrs: {
        level: 2
      },
      content: [jiraText("Notes")]
    });
    content.push({
      type: "paragraph",
      content: [jiraText(values.notes.trim())]
    });
  }

  return content;
}

export function buildEodReportSummary(context: EodThreadContext, values: EodReportFormValues): string {
  const assetSummary = hasSeparateEodAssetTask(context)
    ? context.parentTaskSummary?.trim() || context.parentTaskLabel?.trim() || context.parentTaskKey || context.parentEpicKey
    : context.parentEpicLabel?.trim() || context.parentEpicKey;
  return `${values.date} ${context.assetType} ${assetSummary} EOD Report`.replace(/\s+/g, " ").trim();
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
