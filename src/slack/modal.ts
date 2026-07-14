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
  DataOpsCloseoutFormValues,
  DataOpsProgressFormValues,
  DataOpsValidationState,
  DataOpsValidationThreadContext,
  EodAssetType,
  SingleThreadEodAssetState,
  SingleThreadEodContext,
  EodThreadLifecycleStatus,
  EhsFormValues,
  JiraDocNode,
  JiraInlineNode,
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

function usesUaeInspectionMobilizationEodFields(
  context: Pick<EodThreadContext, "workflowKey"> | Pick<WorkflowDefinition, "key">
): boolean {
  if ("key" in context) {
    return context.key === "uae_inspection_mobilization";
  }

  return context.workflowKey === "uae_inspection_mobilization";
}

export function getEodProgressFieldLabel(
  context: Pick<EodThreadContext, "assetType"> & Partial<Pick<EodThreadContext, "workflowKey">>
): string {
  if (typeof context.workflowKey === "string" && usesUaeInspectionMobilizationEodFields({ workflowKey: context.workflowKey })) {
    return "Scanning Area Coverage";
  }

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

function radioOption(value: string, text: string, description: string) {
  return {
    text: {
      type: "plain_text" as const,
      text
    },
    value,
    description: {
      type: "plain_text" as const,
      text: truncateSlackOptionLine(description, 75)
    }
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
  eodTotalTubeCount?: string;
  enableDataOpsValidation?: boolean;
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

export interface SingleThreadEodModalStateValues {
  taskKey?: string;
  taskLabel?: string;
  assetType?: EodAssetType;
  totalTubeCount?: string;
}

export interface DataOpsProgressModalStateValues {
  slug?: string;
  ownerSlackUserId?: string;
  percentCaptured?: string;
  percentUploaded?: string;
  percentValidated?: string;
  percentPrep?: string;
  percentQa?: string;
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

export function shouldUseSingleThreadEod(issueType: SelectableIssueType): boolean {
  return issueType === "[TEST] Single Thread EOD";
}

function shouldStartEodIntake(issueType: SelectableIssueType): boolean {
  return shouldCollectEodInThread(issueType) || shouldUseSingleThreadEod(issueType);
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

    blocks.push(
      {
        type: "input",
        block_id: CALLBACKS.eodAssetTypeBlock,
        dispatch_action: true,
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
      },
      ...(state.eodAssetType === "Boiler"
        ? [
            {
              type: "input" as const,
              block_id: CALLBACKS.eodTotalTubeCountBlock,
              element: {
                type: "number_input" as const,
                action_id: CALLBACKS.eodTotalTubeCountAction,
                is_decimal_allowed: false,
                min_value: "1",
                initial_value: state.eodTotalTubeCount,
                placeholder: {
                  type: "plain_text" as const,
                  text: "Enter the total tube count for this boiler"
                }
              },
              label: {
                type: "plain_text" as const,
                text: "Total # of Tubes"
              }
            }
          ]
        : [])
    );
  } else if (shouldUseSingleThreadEod(selectedIssueType)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*[TEST] Single Thread EOD*\nThis creates one root Slack thread for the selected Parent Epic. Use the `Generate EOD Report` button in that thread to file asset-level EOD reports."
      }
    });
    blocks.push({
      type: "input",
      block_id: CALLBACKS.singleThreadEodDataOpsBlock,
      element: {
        type: "radio_buttons",
        action_id: CALLBACKS.singleThreadEodDataOpsAction,
        initial_option: state.enableDataOpsValidation
          ? radioOption(
              "enabled",
              "Create Data Ops threads",
              "Start validation threads for each asset after its first EOD report."
            )
          : radioOption(
              "disabled",
              "Regular EOD only",
              "Keep the existing test single-thread EOD behavior without Data Ops validation threads."
            ),
        options: [
          radioOption(
            "enabled",
            "Create Data Ops threads",
            "Start validation threads for each asset after its first EOD report."
          ),
          radioOption(
            "disabled",
            "Regular EOD only",
            "Keep the existing test single-thread EOD behavior without Data Ops validation threads."
          )
        ]
      },
      label: {
        type: "plain_text",
        text: "Data Ops Validation"
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
      channelId: metadata.channelId,
      requireChannelSelection: metadata.requireChannelSelection
    }),
    title: {
      type: "plain_text" as const,
      text: "Create Gecko Report"
    },
    submit: {
      type: "plain_text" as const,
      text: shouldStartEodIntake(selectedIssueType) ? "Start Intake" : "Create"
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

export function encodeSingleThreadEodContext(context: SingleThreadEodContext): string {
  return JSON.stringify({
    wk: context.workflowKey,
    pe: context.parentEpicKey,
    pl: context.parentEpicLabel,
    ch: context.channelId,
    ts: context.threadTs,
    dv: context.enableDataOpsValidation ? 1 : 0,
    a: context.assets.map((asset) => ({
      k: asset.parentTaskKey,
      s: asset.parentTaskSummary,
      t: asset.assetType,
      p: asset.lastProgressValue,
      tt: asset.totalTubeCount,
      r: asset.reportIssueKey,
      d: asset.dataOps
        ? {
            ts: asset.dataOps.threadTs,
            jk: asset.dataOps.jiraIssueKey,
            js: asset.dataOps.jiraStatusName,
            sl: asset.dataOps.slug,
            pc: asset.dataOps.percentCaptured,
            pu: asset.dataOps.percentUploaded,
            pv: asset.dataOps.percentValidated,
            pp: asset.dataOps.percentPrep,
            pq: asset.dataOps.percentQa,
            ow: asset.dataOps.ownerSlackUserId,
            dq: asset.dataOps.dataQuality,
            fu: asset.dataOps.forecastUrl,
            cu: asset.dataOps.cantileverUrl,
            cb: asset.dataOps.closedOutByUserId,
            ca: asset.dataOps.closedOutAt
          }
        : undefined
    }))
  });
}

function decodeDataOpsValidationState(value: unknown): DataOpsValidationState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const dataOps = value as {
    ts?: unknown;
    jk?: unknown;
    js?: unknown;
    sl?: unknown;
    pc?: unknown;
    pu?: unknown;
    pv?: unknown;
    pp?: unknown;
    pq?: unknown;
    ow?: unknown;
    dq?: unknown;
    fu?: unknown;
    cu?: unknown;
    cb?: unknown;
    ca?: unknown;
  };

  if (typeof dataOps.ts !== "string" || dataOps.ts.trim().length === 0) {
    return undefined;
  }

  const numberOrUndefined = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? input : undefined;
  const stringOrUndefined = (input: unknown) =>
    typeof input === "string" && input.trim().length > 0 ? input : undefined;

  return {
    threadTs: dataOps.ts,
    jiraIssueKey: stringOrUndefined(dataOps.jk),
    jiraStatusName: stringOrUndefined(dataOps.js),
    slug: stringOrUndefined(dataOps.sl),
    percentCaptured: numberOrUndefined(dataOps.pc),
    percentUploaded: numberOrUndefined(dataOps.pu),
    percentValidated: numberOrUndefined(dataOps.pv),
    percentPrep: numberOrUndefined(dataOps.pp),
    percentQa: numberOrUndefined(dataOps.pq),
    ownerSlackUserId: stringOrUndefined(dataOps.ow),
    dataQuality: stringOrUndefined(dataOps.dq),
    forecastUrl: stringOrUndefined(dataOps.fu),
    cantileverUrl: stringOrUndefined(dataOps.cu),
    closedOutByUserId: stringOrUndefined(dataOps.cb),
    closedOutAt: stringOrUndefined(dataOps.ca)
  };
}

function decodeSingleThreadEodAssetState(value: unknown): SingleThreadEodAssetState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const asset = value as {
    k?: unknown;
    s?: unknown;
    t?: unknown;
    p?: unknown;
    tt?: unknown;
    r?: unknown;
    d?: unknown;
  };

  if (
    typeof asset.k !== "string" ||
    typeof asset.s !== "string" ||
    asset.s.trim().length === 0 ||
    !parseEodAssetType(typeof asset.t === "string" ? asset.t : undefined)
  ) {
    return undefined;
  }

  return {
    parentTaskKey: asset.k,
    parentTaskSummary: asset.s,
    assetType: asset.t as EodAssetType,
    lastProgressValue: typeof asset.p === "number" && Number.isFinite(asset.p) ? asset.p : undefined,
    totalTubeCount: typeof asset.tt === "number" && Number.isFinite(asset.tt) && asset.tt > 0 ? asset.tt : undefined,
    reportIssueKey: typeof asset.r === "string" && asset.r.trim().length > 0 ? asset.r : undefined,
    dataOps: decodeDataOpsValidationState(asset.d)
  };
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
  const totalTubeCount =
    typeof parsed.totalTubeCount === "number" && Number.isFinite(parsed.totalTubeCount) && parsed.totalTubeCount > 0
      ? parsed.totalTubeCount
      : undefined;

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
    jiraParentKey: typeof parsed.jiraParentKey === "string" && parsed.jiraParentKey.trim().length > 0 ? parsed.jiraParentKey : undefined,
    parentTaskKey: parsed.parentTaskKey,
    parentTaskLabel: parsed.parentTaskLabel,
    parentTaskSummary: parsed.parentTaskSummary,
    assetType: parsed.assetType,
    totalTubeCount,
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

export function decodeSingleThreadEodContext(value: string): SingleThreadEodContext {
  const parsed = JSON.parse(value) as {
    wk?: unknown;
    pe?: unknown;
    pl?: unknown;
    ch?: unknown;
    ts?: unknown;
    dv?: unknown;
    a?: unknown;
  };

  if (
    typeof parsed.wk !== "string" ||
    typeof parsed.pe !== "string" ||
    typeof parsed.ch !== "string" ||
    typeof parsed.ts !== "string"
  ) {
    throw new Error("Single-thread EOD context is incomplete.");
  }

  const assets = Array.isArray(parsed.a)
    ? parsed.a
        .map((asset) => decodeSingleThreadEodAssetState(asset))
        .filter((asset): asset is SingleThreadEodAssetState => Boolean(asset))
    : [];

  return {
    workflowKey: parsed.wk,
    parentEpicKey: parsed.pe,
    parentEpicLabel: typeof parsed.pl === "string" && parsed.pl.trim().length > 0 ? parsed.pl : undefined,
    channelId: parsed.ch,
    threadTs: parsed.ts,
    assets,
    enableDataOpsValidation: parsed.dv === 1
  };
}

export function encodeDataOpsValidationThreadContext(context: DataOpsValidationThreadContext): string {
  return JSON.stringify(context);
}

export function decodeDataOpsValidationThreadContext(value: string): DataOpsValidationThreadContext {
  const parsed = JSON.parse(value) as Partial<DataOpsValidationThreadContext>;

  if (
    !parsed.workflowKey ||
    !parsed.parentEpicKey ||
    !parsed.channelId ||
    !parsed.threadTs ||
    !parsed.sourceThreadTs ||
    !parsed.parentTaskKey ||
    !parsed.parentTaskSummary ||
    !parsed.assetType
  ) {
    throw new Error("Data Ops validation thread context is incomplete.");
  }

  return {
    workflowKey: parsed.workflowKey,
    parentEpicKey: parsed.parentEpicKey,
    parentEpicLabel: parsed.parentEpicLabel,
    channelId: parsed.channelId,
    threadTs: parsed.threadTs,
    sourceThreadTs: parsed.sourceThreadTs,
    parentTaskKey: parsed.parentTaskKey,
    parentTaskLabel: parsed.parentTaskLabel,
    parentTaskSummary: parsed.parentTaskSummary,
    assetType: parsed.assetType,
    reportIssueKey:
      typeof parsed.reportIssueKey === "string" && parsed.reportIssueKey.trim().length > 0
        ? parsed.reportIssueKey
        : undefined,
    dataOps: {
      jiraIssueKey:
        typeof parsed.dataOps?.jiraIssueKey === "string" && parsed.dataOps.jiraIssueKey.trim().length > 0
          ? parsed.dataOps.jiraIssueKey
          : undefined,
      jiraStatusName:
        typeof parsed.dataOps?.jiraStatusName === "string" && parsed.dataOps.jiraStatusName.trim().length > 0
          ? parsed.dataOps.jiraStatusName
          : undefined,
      slug: typeof parsed.dataOps?.slug === "string" && parsed.dataOps.slug.trim().length > 0 ? parsed.dataOps.slug : undefined,
      percentCaptured:
        typeof parsed.dataOps?.percentCaptured === "number" && Number.isFinite(parsed.dataOps.percentCaptured)
          ? parsed.dataOps.percentCaptured
          : undefined,
      percentUploaded:
        typeof parsed.dataOps?.percentUploaded === "number" && Number.isFinite(parsed.dataOps.percentUploaded)
          ? parsed.dataOps.percentUploaded
          : undefined,
      percentValidated:
        typeof parsed.dataOps?.percentValidated === "number" && Number.isFinite(parsed.dataOps.percentValidated)
          ? parsed.dataOps.percentValidated
          : undefined,
      percentPrep:
        typeof parsed.dataOps?.percentPrep === "number" && Number.isFinite(parsed.dataOps.percentPrep)
          ? parsed.dataOps.percentPrep
          : undefined,
      percentQa:
        typeof parsed.dataOps?.percentQa === "number" && Number.isFinite(parsed.dataOps.percentQa)
          ? parsed.dataOps.percentQa
          : undefined,
      ownerSlackUserId:
        typeof parsed.dataOps?.ownerSlackUserId === "string" && parsed.dataOps.ownerSlackUserId.trim().length > 0
          ? parsed.dataOps.ownerSlackUserId
          : undefined,
      dataQuality:
        typeof parsed.dataOps?.dataQuality === "string" && parsed.dataOps.dataQuality.trim().length > 0
          ? parsed.dataOps.dataQuality
          : undefined,
      forecastUrl:
        typeof parsed.dataOps?.forecastUrl === "string" && parsed.dataOps.forecastUrl.trim().length > 0
          ? parsed.dataOps.forecastUrl
          : undefined,
      cantileverUrl:
        typeof parsed.dataOps?.cantileverUrl === "string" && parsed.dataOps.cantileverUrl.trim().length > 0
          ? parsed.dataOps.cantileverUrl
          : undefined,
      closedOutByUserId:
        typeof parsed.dataOps?.closedOutByUserId === "string" && parsed.dataOps.closedOutByUserId.trim().length > 0
          ? parsed.dataOps.closedOutByUserId
          : undefined,
      closedOutAt:
        typeof parsed.dataOps?.closedOutAt === "string" && parsed.dataOps.closedOutAt.trim().length > 0
          ? parsed.dataOps.closedOutAt
          : undefined
    }
  };
}

export function buildEodReportModal(context: EodThreadContext) {
  const parentInspectionLabel = context.parentEpicLabel ?? context.parentEpicKey;
  const parentTaskLabel = getEodAssetDisplayLabel(context);
  const progressFieldLabel = getEodProgressFieldLabel(context);
  const usesTubeCount = usesTubeCountForEod(context);
  const usesUaeFields = usesUaeInspectionMobilizationEodFields(context);
  const summaryLines = [`*Parent Inspection:* ${parentInspectionLabel}`];

  if (hasSeparateEodAssetTask(context) && parentTaskLabel) {
    summaryLines.push(`*Asset:* ${parentTaskLabel}`);
  }

  summaryLines.push(`*Asset Type:* ${context.assetType}`);

  if (usesTubeCount && typeof context.totalTubeCount === "number") {
    summaryLines.push(`*Total Tubes:* ${context.totalTubeCount}`);
  }

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
      ...(usesUaeFields
        ? [
            plainTextInputBlock(
              CALLBACKS.summaryBlock,
              CALLBACKS.summaryAction,
              "Asset Number",
              "Enter asset number"
            ),
            plainTextInputBlock(
              CALLBACKS.eodCrewOnSiteBlock,
              CALLBACKS.eodCrewOnSiteAction,
              "Crew onsite time",
              "Enter crew onsite time"
            ),
            plainTextInputBlock(
              CALLBACKS.eodPermitApprovedBlock,
              CALLBACKS.eodPermitApprovedAction,
              "Permit Approval time",
              "Enter permit approval time"
            ),
            plainTextInputBlock(
              CALLBACKS.eodCalibrationCompletedBlock,
              CALLBACKS.eodCalibrationCompletedAction,
              "Calibration completed",
              "Enter calibration completed time or status"
            )
          ]
        : []),
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
        dispatch_action: true,
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
      ...(usesUaeFields
        ? [
            {
              type: "input" as const,
              block_id: CALLBACKS.eodCoverageBlock,
              element: {
                type: "number_input" as const,
                action_id: CALLBACKS.eodCoverageAction,
                is_decimal_allowed: false,
                min_value: "0",
                placeholder: {
                  type: "plain_text" as const,
                  text: "0"
                }
              },
              label: {
                type: "plain_text" as const,
                text: "Number of Scans completed"
              }
            },
            plainTextInputBlock(
              CALLBACKS.eodUploadStatusBlock,
              CALLBACKS.eodUploadStatusAction,
              "Data Upload Status",
              "Enter data upload status"
            ),
            plainTextInputBlock(
              CALLBACKS.eodValidationStatusBlock,
              CALLBACKS.eodValidationStatusAction,
              "Data Validation Status",
              "Enter data validation status"
            ),
            plainTextInputBlock(
              CALLBACKS.eodReportStatusBlock,
              CALLBACKS.eodReportStatusAction,
              "Report Status",
              "Enter report status"
            ),
            plainTextInputBlock(
              CALLBACKS.eodCrewOffSiteBlock,
              CALLBACKS.eodCrewOffSiteAction,
              "Crew off-site time",
              "Enter crew off-site time"
            )
          ]
        : []),
      {
        type: "input",
        block_id: CALLBACKS.eodScanningTimeBlock,
        dispatch_action: true,
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

export function buildSingleThreadEodReportModal(
  context: SingleThreadEodContext,
  state: SingleThreadEodModalStateValues = {}
) {
  const usesTubeCount = state.assetType === "Boiler";
  const progressFieldLabel =
    state.assetType ? getEodProgressFieldLabel({ assetType: state.assetType }) : "sqft. % done";
  return {
    type: "modal" as const,
    callback_id: CALLBACKS.singleThreadEodReportView,
    private_metadata: encodeSingleThreadEodContext(context),
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
          text:
            `*Parent Inspection:* ${context.parentEpicLabel ?? context.parentEpicKey}\n` +
            "*Choose the asset and asset type for this report.*"
        }
      },
      {
        type: "section",
        block_id: CALLBACKS.singleThreadEodTaskBlock,
        text: {
          type: "mrkdwn",
          text: "*Asset Task*"
        },
        accessory: {
          type: "external_select",
          action_id: CALLBACKS.singleThreadEodTaskAction,
          min_query_length: 0,
          initial_option:
            state.taskKey && state.taskLabel ? buildIssueSelectOption(state.taskKey, state.taskLabel) : undefined,
          placeholder: {
            type: "plain_text",
            text: "Search child Tasks under the parent Epic"
          }
        }
      },
      {
        type: "input",
        block_id: CALLBACKS.singleThreadEodAssetTypeBlock,
        dispatch_action: true,
        element: {
          type: "static_select",
          action_id: CALLBACKS.singleThreadEodAssetTypeAction,
          initial_option: selectedOption(state.assetType),
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
      },
      ...(usesTubeCount
        ? [
            {
              type: "input" as const,
              block_id: CALLBACKS.eodTotalTubeCountBlock,
              element: {
                type: "number_input" as const,
                action_id: CALLBACKS.eodTotalTubeCountAction,
                is_decimal_allowed: false,
                min_value: "1",
                initial_value: state.totalTubeCount,
                placeholder: {
                  type: "plain_text" as const,
                  text: "Enter the total tube count for this boiler"
                }
              },
              label: {
                type: "plain_text" as const,
                text: "Total # of Tubes"
              }
            }
          ]
        : []),
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
          text: usesTubeCount ? progressFieldLabel : "sqft. % done"
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
        "single_thread_eod_attachments_help",
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

function formatDataOpsPercent(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function optionalNumberInitialValue(value?: string) {
  return value && value.trim().length > 0 ? { initial_value: value } : {};
}

export function buildDataOpsProgressModal(
  context: DataOpsValidationThreadContext,
  state: DataOpsProgressModalStateValues = {}
) {
  const initialSlug = state.slug ?? context.dataOps.slug;
  const initialOwnerSlackUserId = state.ownerSlackUserId ?? context.dataOps.ownerSlackUserId;

  return {
    type: "modal" as const,
    callback_id: CALLBACKS.dataOpsProgressView,
    private_metadata: encodeDataOpsValidationThreadContext(context),
    title: {
      type: "plain_text" as const,
      text: "Update Progress"
    },
    submit: {
      type: "plain_text" as const,
      text: "Save"
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
            `*Parent Inspection:* ${context.parentEpicLabel ?? context.parentEpicKey}\n` +
            `*Asset:* ${context.parentTaskLabel ?? context.parentTaskSummary}\n` +
            `*Component Type:* ${context.assetType}`
        }
      },
      plainTextInputBlock(
        CALLBACKS.dataOpsSlugBlock,
        CALLBACKS.dataOpsSlugAction,
        "Slug",
        "Asset slug",
        initialSlug
      ),
      {
        type: "input" as const,
        block_id: CALLBACKS.dataOpsOwnerBlock,
        element: {
          type: "users_select" as const,
          action_id: CALLBACKS.dataOpsOwnerAction,
          ...(initialOwnerSlackUserId ? { initial_user: initialOwnerSlackUserId } : {}),
          placeholder: {
            type: "plain_text" as const,
            text: "Choose the Data Ops owner"
          }
        },
        label: {
          type: "plain_text" as const,
          text: "Owner"
        }
      },
      {
        type: "input" as const,
        block_id: CALLBACKS.dataOpsCapturedBlock,
        element: {
          type: "number_input" as const,
          action_id: CALLBACKS.dataOpsCapturedAction,
          is_decimal_allowed: true,
          min_value: "0",
          max_value: "100",
          ...optionalNumberInitialValue(
            state.percentCaptured ?? formatDataOpsPercent(context.dataOps.percentCaptured)
          ),
          placeholder: {
            type: "plain_text" as const,
            text: "0"
          }
        },
        label: {
          type: "plain_text" as const,
          text: "% Captured"
        }
      },
      {
        type: "input" as const,
        block_id: CALLBACKS.dataOpsUploadedBlock,
        element: {
          type: "number_input" as const,
          action_id: CALLBACKS.dataOpsUploadedAction,
          is_decimal_allowed: true,
          min_value: "0",
          max_value: "100",
          ...optionalNumberInitialValue(
            state.percentUploaded ?? formatDataOpsPercent(context.dataOps.percentUploaded)
          ),
          placeholder: {
            type: "plain_text" as const,
            text: "0"
          }
        },
        label: {
          type: "plain_text" as const,
          text: "% Uploaded"
        }
      },
      {
        type: "input" as const,
        block_id: CALLBACKS.dataOpsValidatedBlock,
        element: {
          type: "number_input" as const,
          action_id: CALLBACKS.dataOpsValidatedAction,
          is_decimal_allowed: true,
          min_value: "0",
          max_value: "100",
          ...optionalNumberInitialValue(
            state.percentValidated ?? formatDataOpsPercent(context.dataOps.percentValidated)
          ),
          placeholder: {
            type: "plain_text" as const,
            text: "0"
          }
        },
        label: {
          type: "plain_text" as const,
          text: "% Validated"
        }
      },
      {
        type: "input" as const,
        block_id: CALLBACKS.dataOpsPrepBlock,
        element: {
          type: "number_input" as const,
          action_id: CALLBACKS.dataOpsPrepAction,
          is_decimal_allowed: true,
          min_value: "0",
          max_value: "100",
          ...optionalNumberInitialValue(
            state.percentPrep ?? formatDataOpsPercent(context.dataOps.percentPrep)
          ),
          placeholder: {
            type: "plain_text" as const,
            text: "0"
          }
        },
        label: {
          type: "plain_text" as const,
          text: "% Prep"
        }
      },
      {
        type: "input" as const,
        block_id: CALLBACKS.dataOpsQaBlock,
        element: {
          type: "number_input" as const,
          action_id: CALLBACKS.dataOpsQaAction,
          is_decimal_allowed: true,
          min_value: "0",
          max_value: "100",
          ...optionalNumberInitialValue(state.percentQa ?? formatDataOpsPercent(context.dataOps.percentQa)),
          placeholder: {
            type: "plain_text" as const,
            text: "0"
          }
        },
        label: {
          type: "plain_text" as const,
          text: "% QA"
        }
      }
    ]
  };
}

export function buildDataOpsCloseoutModal(context: DataOpsValidationThreadContext) {
  return {
    type: "modal" as const,
    callback_id: CALLBACKS.dataOpsCloseoutView,
    private_metadata: encodeDataOpsValidationThreadContext(context),
    title: {
      type: "plain_text" as const,
      text: "Close Out Thread"
    },
    submit: {
      type: "plain_text" as const,
      text: "Close Out"
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
            `*Asset:* ${context.parentTaskLabel ?? context.parentTaskSummary}\n` +
            "*Add the final Data Ops closeout details for this validation thread.*"
        }
      },
      plainTextInputBlock(
        CALLBACKS.dataOpsQualityBlock,
        CALLBACKS.dataOpsQualityAction,
        "Data Quality",
        "Final data quality notes",
        context.dataOps.dataQuality,
        true
      ),
      plainTextInputBlock(
        CALLBACKS.dataOpsForecastUrlBlock,
        CALLBACKS.dataOpsForecastUrlAction,
        "Forecast URL",
        "https://...",
        context.dataOps.forecastUrl
      ),
      plainTextInputBlock(
        CALLBACKS.dataOpsCantileverUrlBlock,
        CALLBACKS.dataOpsCantileverUrlAction,
        "Cantilever URL",
        "https://...",
        context.dataOps.cantileverUrl
      )
    ]
  };
}

export function buildDataOpsIssueSummary(context: DataOpsValidationThreadContext): string {
  return `${context.parentTaskSummary} Data Ops Validation`.replace(/\s+/g, " ").trim();
}

export function formatDataOpsIssueDetails(
  context: DataOpsValidationThreadContext,
  values: DataOpsProgressFormValues
): string {
  const lines = [
    `Parent Inspection: ${context.parentEpicLabel ?? context.parentEpicKey}`,
    `Asset: ${context.parentTaskSummary}`,
    `Component Type: ${context.assetType}`,
    `Slug: ${values.slug}`,
    `Owner: ${values.ownerSlackUserId}`
  ];

  if (context.reportIssueKey) {
    lines.push(`Latest EOD Report: ${context.reportIssueKey}`);
  }

  if (context.dataOps.dataQuality) {
    lines.push(`Data Quality: ${context.dataOps.dataQuality}`);
  }

  if (context.dataOps.forecastUrl) {
    lines.push(`Forecast URL: ${context.dataOps.forecastUrl}`);
  }

  if (context.dataOps.cantileverUrl) {
    lines.push(`Cantilever URL: ${context.dataOps.cantileverUrl}`);
  }

  return lines.join("\n");
}

export function buildDataOpsDescriptionContent(
  context: DataOpsValidationThreadContext,
  values: DataOpsProgressFormValues,
  ownerContent?: JiraInlineNode[],
  updatedByContent?: JiraInlineNode[]
): JiraDocNode[] {
  const content: JiraDocNode[] = [
    jiraParagraph("Parent Inspection", context.parentEpicLabel ?? context.parentEpicKey),
    jiraParagraph("Asset", context.parentTaskSummary),
    jiraParagraph("Component Type", context.assetType),
    jiraParagraph("Slug", values.slug),
    {
      type: "paragraph",
      content: [
        jiraText("Owner: ", [{ type: "strong" }]),
        ...(ownerContent?.length ? ownerContent : [jiraText(values.ownerSlackUserId)])
      ]
    },
    {
      type: "paragraph",
      content: [
        jiraText("Last Updated from Slack by: ", [{ type: "strong" }]),
        ...(updatedByContent?.length ? updatedByContent : [jiraText("Unknown")])
      ]
    }
  ];

  if (context.reportIssueKey) {
    content.push(jiraParagraph("Latest EOD Report", context.reportIssueKey));
  }

  if (context.dataOps.dataQuality) {
    content.push(jiraParagraph("Data Quality", context.dataOps.dataQuality));
  }

  if (context.dataOps.forecastUrl) {
    content.push(jiraParagraph("Forecast URL", context.dataOps.forecastUrl));
  }

  if (context.dataOps.cantileverUrl) {
    content.push(jiraParagraph("Cantilever URL", context.dataOps.cantileverUrl));
  }

  return content;
}

export function applyDataOpsCloseoutToContext(
  context: DataOpsValidationThreadContext,
  values: DataOpsCloseoutFormValues,
  closedOutByUserId: string,
  closedOutAt: string
): DataOpsValidationThreadContext {
  return {
    ...context,
    dataOps: {
      ...context.dataOps,
      dataQuality: values.dataQuality.trim(),
      forecastUrl: values.forecastUrl.trim(),
      cantileverUrl: values.cantileverUrl.trim(),
      closedOutByUserId,
      closedOutAt
    }
  };
}

export function formatEodReportDetails(context: EodThreadContext, values: EodReportFormValues): string {
  const progressFieldLabel = getEodProgressFieldLabel(context);
  const usesUaeFields = usesUaeInspectionMobilizationEodFields(context);
  const lines = [`Parent Inspection: ${context.parentEpicLabel ?? context.parentEpicKey}`];

  if (hasSeparateEodAssetTask(context)) {
    lines.push(`Asset: ${getEodAssetDisplayLabel(context)}`);
  }

  lines.push(
    `Asset Type: ${context.assetType}`,
    ...(usesTubeCountForEod(context) && typeof context.totalTubeCount === "number"
      ? [`Total Tubes: ${context.totalTubeCount}`]
      : []),
    `Date: ${values.date}`,
    ...(usesUaeFields
      ? [
          `Asset Number: ${values.assetNumber ?? ""}`,
          `Crew onsite time: ${values.crewOnsiteTime ?? ""}`,
          `Permit Approval time: ${values.permitApprovalTime ?? ""}`,
          `Calibration completed: ${values.calibrationCompleted ?? ""}`,
          `Number of Scans completed: ${values.scanCount !== undefined ? String(values.scanCount) : ""}`
        ]
      : []),
    `Full Day Overview:\n${values.fullDayOverview}`,
    `JSA Submitted: ${values.jsaSubmitted}`,
    `${progressFieldLabel}: ${formatEodProgressValue(context, values.numberOfScansCompleted)}`,
    ...(usesUaeFields
      ? [
          `Data Upload Status: ${values.dataUploadStatus ?? ""}`,
          `Data Validation Status: ${values.dataValidationStatus ?? ""}`,
          `Report Status: ${values.reportStatus ?? ""}`,
          `Crew off-site time: ${values.crewOffSiteTime ?? ""}`
        ]
      : []),
    `Total Scanning Time (Hours): ${values.totalScanningTimeHours}`
  );

  if (values.notes?.trim()) {
    lines.push(`Notes:\n${values.notes.trim()}`);
  }

  return lines.join("\n");
}

export function buildEodDescriptionContent(context: EodThreadContext, values: EodReportFormValues): JiraDocNode[] {
  const progressFieldLabel = getEodProgressFieldLabel(context);
  const usesUaeFields = usesUaeInspectionMobilizationEodFields(context);
  const content: JiraDocNode[] = [jiraParagraph("Parent Inspection", context.parentEpicLabel ?? context.parentEpicKey)];

  if (hasSeparateEodAssetTask(context)) {
    content.push(jiraParagraph("Asset", getEodAssetDisplayLabel(context)));
  }

  content.push(
    jiraParagraph("Asset Type", context.assetType),
    ...(usesTubeCountForEod(context) && typeof context.totalTubeCount === "number"
      ? [jiraParagraph("Total Tubes", String(context.totalTubeCount))]
      : []),
    jiraParagraph("Date", values.date),
    ...(usesUaeFields
      ? [
          jiraParagraph("Asset Number", values.assetNumber ?? ""),
          jiraParagraph("Crew onsite time", values.crewOnsiteTime ?? ""),
          jiraParagraph("Permit Approval time", values.permitApprovalTime ?? ""),
          jiraParagraph("Calibration completed", values.calibrationCompleted ?? ""),
          jiraParagraph(
            "Number of Scans completed",
            values.scanCount !== undefined ? String(values.scanCount) : ""
          )
        ]
      : []),
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
    ...(usesUaeFields
      ? [
          jiraParagraph("Data Upload Status", values.dataUploadStatus ?? ""),
          jiraParagraph("Data Validation Status", values.dataValidationStatus ?? ""),
          jiraParagraph("Report Status", values.reportStatus ?? ""),
          jiraParagraph("Crew off-site time", values.crewOffSiteTime ?? "")
        ]
      : []),
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
  if (value !== "Bug" && value !== "EOD Report" && value !== "[TEST] Single Thread EOD" && value !== "Task") {
    throw new Error(`Unsupported issue type: ${value}`);
  }

  return value;
}

function parseEodAssetType(value?: string): EodAssetType | undefined {
  return value === "Kiln" ||
    value === "Hood" ||
    value === "Tank" ||
    value === "Drum" ||
    value === "Vessel" ||
    value === "Piping" ||
    value === "SDA" ||
    value === "Silo" ||
    value === "Boiler" ||
    value === "Heat Exchangers" ||
    value === "Stacks" ||
    value === "Spheres" ||
    value === "Towers"
    ? value
    : undefined;
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
