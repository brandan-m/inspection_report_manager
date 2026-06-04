import type { App, BlockAction, BlockSuggestion, ViewSubmitAction } from "@slack/bolt";
import { getWorkflowByKey, listWorkflows } from "../config/workflows.js";
import { env } from "../config/env.js";
import {
  getEhsCheckboxActionId,
  getEhsCheckboxBlockId,
  getEhsCheckboxInputKeys,
  getEhsReactiveCheckboxKeys,
  getEhsTextActionId,
  getEhsTextBlockId,
  getEhsTextInputKeys,
  type EhsModalStateValues
} from "../ehs/form.js";
import { createIssue } from "../jira/createIssue.js";
import { findJiraUserForSlackProfile } from "../jira/users.js";
import { buildEpicSearchJql, getIssueSummary, searchChildTasks, searchEpics } from "../jira/searchEpics.js";
import { linkIssuesByRelationship } from "../jira/issueLinks.js";
import type {
  BlockerType,
  EodAssetType,
  EhsFormValues,
  EodReportFormValues,
  EodThreadContext,
  JiraInlineNode,
  EodYesNo
} from "../types/workflow.js";
import { CALLBACKS } from "./constants.js";
import {
  buildEodDescriptionContent,
  buildEodReportSummary,
  buildCreateIssueModal,
  buildEodReportModal,
  buildEhsDescriptionContent,
  decodeEodThreadContext,
  formatEodReportDetails,
  formatEhsDetails,
  type ModalMetadata,
  requiresBugSpecificFields,
  selectedIssueTypeFromValue,
  shouldCollectEodInThread,
  usesEhsSpecificFields
} from "./modal.js";
import {
  type SlackRichTextBlock,
  richTextToJiraDocNodes,
  richTextToPlainText,
  richTextToResolvedJiraDocNodes
} from "./richText.js";

type ModalState = ViewSubmitAction["view"]["state"]["values"];
type DmBlocks = Array<{ type: "section"; text: { type: "mrkdwn"; text: string } }>;

function getSelectedOptionValue(
  action:
    | BlockAction["actions"][number]
    | ViewSubmitAction["view"]["state"]["values"][string][string]
    | undefined
): string | undefined {
  if (!action || !("selected_option" in action)) {
    return undefined;
  }

  return action.selected_option?.value;
}

function getPlainTextValue(
  stateValues: ModalState | undefined,
  blockId: string,
  actionId: string
): string | undefined {
  const action = stateValues?.[blockId]?.[actionId];

  if (action && "value" in action) {
    return action.value ?? undefined;
  }

  return undefined;
}

function getRichTextValue(
  stateValues: ModalState | undefined,
  blockId: string,
  actionId: string
): SlackRichTextBlock | undefined {
  const action = stateValues?.[blockId]?.[actionId] as
    | {
        rich_text_value?: SlackRichTextBlock;
      }
    | undefined;

  if (action?.rich_text_value?.type === "rich_text") {
    return action.rich_text_value;
  }

  return undefined;
}

function getSelectedOptionsValues(
  stateValues: ModalState | undefined,
  blockId: string,
  actionId: string
): string[] {
  const action = stateValues?.[blockId]?.[actionId];

  if (action && "selected_options" in action) {
    return action.selected_options?.map((option) => option.value) ?? [];
  }

  return [];
}

function getSelectedConversationValue(
  stateValues: ModalState | undefined,
  blockId: string,
  actionId: string
): string | undefined {
  const action = stateValues?.[blockId]?.[actionId];

  if (action && "selected_conversation" in action) {
    return action.selected_conversation ?? undefined;
  }

  return undefined;
}

function getDateValue(
  stateValues: ModalState | undefined,
  blockId: string,
  actionId: string
): string | undefined {
  const action = stateValues?.[blockId]?.[actionId];

  if (action && "selected_date" in action) {
    return action.selected_date ?? undefined;
  }

  return undefined;
}

function parseModalMetadata(view?: { private_metadata?: string }): ModalMetadata | undefined {
  if (!view?.private_metadata) {
    return undefined;
  }

  try {
    return JSON.parse(view.private_metadata) as ModalMetadata;
  } catch {
    return {
      workflowKey: view.private_metadata
    };
  }
}

function getWorkflowKeyFromViewMetadata(view?: { private_metadata?: string }): string | undefined {
  return parseModalMetadata(view)?.workflowKey;
}

function getChannelIdFromViewMetadata(view?: { private_metadata?: string }): string | undefined {
  return parseModalMetadata(view)?.channelId;
}

function getRequireChannelSelectionFromViewMetadata(view?: { private_metadata?: string }): boolean {
  return parseModalMetadata(view)?.requireChannelSelection ?? false;
}

function getChannelIdFromActionBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const payload = body as {
    channel?: { id?: string };
    channel_id?: string;
    container?: { channel_id?: string };
  };

  return payload.channel?.id ?? payload.channel_id ?? payload.container?.channel_id;
}

function getSelectedWorkflowKeyFromState(stateValues?: ViewSubmitAction["view"]["state"]["values"]): string {
  return (
    getSelectedOptionValue(stateValues?.[CALLBACKS.workflowBlock]?.[CALLBACKS.workflowAction]) ??
    listWorkflows()[0].key
  );
}

function getSelectedWorkflowKeyFromSuggestion(body: BlockSuggestion): string {
  const metadataWorkflowKey = getWorkflowKeyFromViewMetadata(body.view);

  if (metadataWorkflowKey) {
    return metadataWorkflowKey;
  }

  return (
    getSelectedOptionValue(
      body.view?.state.values?.[CALLBACKS.workflowBlock]?.[CALLBACKS.workflowAction]
    ) ?? listWorkflows()[0].key
  );
}

function getSelectedIssueTypeFromState(
  stateValues?: ViewSubmitAction["view"]["state"]["values"]
): Exclude<"Bug" | "EOD Report" | "Task" | "Epic", "Epic"> {
  return selectedIssueTypeFromValue(
    getSelectedOptionValue(stateValues?.[CALLBACKS.issueTypeBlock]?.[CALLBACKS.issueTypeAction]) ??
      "Bug"
  );
}

function getDefaultIssueTypeForWorkflow(workflowKey: string) {
  return getWorkflowByKey(workflowKey).allowedIssueTypes[0];
}

function parseBlockerType(value?: string): BlockerType | undefined {
  return value === "Customer" ||
    value === "Operations" ||
    value === "Environmental" ||
    value === "Other"
    ? value
    : undefined;
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

function parseEodYesNo(value?: string): EodYesNo | undefined {
  return value === "Yes" || value === "No" ? value : undefined;
}

function getEhsModalStateValues(stateValues?: ModalState): EhsModalStateValues {
  const state: EhsModalStateValues = {};

  for (const key of getEhsTextInputKeys()) {
    state[key] = getPlainTextValue(stateValues, getEhsTextBlockId(key), getEhsTextActionId(key)) as never;
  }

  for (const key of getEhsCheckboxInputKeys()) {
    state[key] = getSelectedOptionsValues(
      stateValues,
      getEhsCheckboxBlockId(key),
      getEhsCheckboxActionId(key)
    ) as never;
  }

  return state;
}

function getModalStateValues(stateValues?: ModalState) {
  const parentEpicSelection = stateValues?.[CALLBACKS.epicBlock]?.[CALLBACKS.epicAction];
  const parentTaskSelection = stateValues?.[CALLBACKS.eodTaskBlock]?.[CALLBACKS.eodTaskAction];
  const blockerTypeValue = getSelectedOptionValue(
    stateValues?.[CALLBACKS.blockerTypeBlock]?.[CALLBACKS.blockerTypeAction]
  );

  return {
    channelId: getSelectedConversationValue(stateValues, CALLBACKS.channelBlock, CALLBACKS.channelAction),
    selectedIssueType: getSelectedIssueTypeFromState(stateValues),
    parentEpicKey:
      parentEpicSelection && "selected_option" in parentEpicSelection
        ? parentEpicSelection.selected_option?.value ?? undefined
        : undefined,
    parentEpicLabel:
      parentEpicSelection && "selected_option" in parentEpicSelection
        ? parentEpicSelection.selected_option?.text?.text ?? undefined
        : undefined,
    eodTaskKey:
      parentTaskSelection && "selected_option" in parentTaskSelection
        ? parentTaskSelection.selected_option?.value ?? undefined
        : undefined,
    eodTaskLabel:
      parentTaskSelection && "selected_option" in parentTaskSelection
        ? parentTaskSelection.selected_option?.text?.text ?? undefined
        : undefined,
    eodAssetType: parseEodAssetType(
      getSelectedOptionValue(stateValues?.[CALLBACKS.eodAssetTypeBlock]?.[CALLBACKS.eodAssetTypeAction])
    ),
    summary: getPlainTextValue(stateValues, CALLBACKS.summaryBlock, CALLBACKS.summaryAction),
    details: getPlainTextValue(stateValues, CALLBACKS.detailsBlock, CALLBACKS.detailsAction),
    blockerType: parseBlockerType(blockerTypeValue),
    opsDowntimeHours: getPlainTextValue(stateValues, CALLBACKS.downtimeBlock, CALLBACKS.downtimeAction),
    ehs: getEhsModalStateValues(stateValues)
  };
}

function clearEodTaskSelectionIfParentChanged(
  state: ReturnType<typeof getModalStateValues>,
  nextParentEpicKey?: string
) {
  if (!nextParentEpicKey || state.parentEpicKey === nextParentEpicKey) {
    return state;
  }

  return {
    ...state,
    parentEpicKey: nextParentEpicKey,
    eodTaskKey: undefined,
    eodTaskLabel: undefined
  };
}

function formatJiraErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Could not create Jira issue.";
  }

  return error.message.replace(/^Jira request failed \(\d+\):\s*/, "");
}

function formatSlackApiErrorDetails(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const details = error as {
    data?: {
      error?: string;
      response_metadata?: {
        messages?: string[];
      };
    };
    message?: string;
  };

  const errorCode = details.data?.error ?? details.message ?? "unknown_error";
  const messages = details.data?.response_metadata?.messages ?? [];

  if (messages.length === 0) {
    return errorCode;
  }

  return `${errorCode}: ${messages.join(" | ")}`;
}

function escapeSlackText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function jiraTextNode(text: string): JiraInlineNode {
  return {
    type: "text",
    text
  };
}

function formatSlackMentionText(label?: string, fallbackId?: string): string {
  const trimmed = label?.trim();

  if (trimmed) {
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  }

  return fallbackId ? `<@${fallbackId}>` : "@unknown";
}

function createSlackToJiraMentionResolver(
  client: App["client"],
  logger: Pick<Console, "warn">
): (userId: string) => Promise<JiraInlineNode> {
  const cache = new Map<string, Promise<JiraInlineNode>>();

  return (userId: string) => {
    const cached = cache.get(userId);

    if (cached) {
      return cached;
    }

    const pending = (async () => {
      try {
        const response = await client.users.info({
          user: userId
        });
        const user = response.user as
          | {
              name?: string;
              real_name?: string;
              profile?: {
                email?: string;
                display_name?: string;
                display_name_normalized?: string;
                real_name?: string;
                real_name_normalized?: string;
              };
            }
          | undefined;
        const profile = user?.profile;
        const fallbackText = formatSlackMentionText(
          profile?.display_name_normalized ||
            profile?.display_name ||
            user?.name ||
            profile?.real_name_normalized ||
            profile?.real_name ||
            user?.real_name,
          userId
        );
        const jiraUser = await findJiraUserForSlackProfile({
          email: profile?.email,
          displayName: profile?.display_name_normalized || profile?.display_name || user?.name,
          realName: profile?.real_name_normalized || profile?.real_name || user?.real_name
        });

        if (!jiraUser) {
          logger.warn(`Could not resolve Slack user ${userId} to a Jira user.`);
          return jiraTextNode(fallbackText);
        }

        return {
          type: "mention",
          attrs: {
            id: jiraUser.accountId,
            text: formatSlackMentionText(jiraUser.displayName)
          }
        } satisfies JiraInlineNode;
      } catch (error) {
        logger.warn(
          `Could not resolve Slack user ${userId} for Jira mentions. ${formatSlackApiErrorDetails(error)}`
        );
        return jiraTextNode(`<@${userId}>`);
      }
    })();

    cache.set(userId, pending);
    return pending;
  };
}

const SLACK_ENTITY_PATTERN =
  /<(?:@[A-Z0-9]+(?:\|[^>\n]+)?|!(?:subteam\^[A-Z0-9]+(?:\|[^>\n]+)?|here|channel|everyone)|#[A-Z0-9]+(?:\|[^>\n]+)?)>/g;

function escapeSlackTextPreservingEntities(text: string): string {
  let lastIndex = 0;
  let escaped = "";

  for (const match of text.matchAll(SLACK_ENTITY_PATTERN)) {
    const start = match.index ?? 0;
    escaped += escapeSlackText(text.slice(lastIndex, start));
    escaped += match[0];
    lastIndex = start + match[0].length;
  }

  escaped += escapeSlackText(text.slice(lastIndex));
  return escaped;
}

function buildJiraIssueUrl(issueKey: string): string {
  return new URL(`/browse/${issueKey}`, env.JIRA_BASE_URL).toString();
}

function buildLinkedJiraLabel(issueKey?: string, label?: string): string {
  if (!issueKey) {
    return escapeSlackText(label?.trim() || "Not set");
  }

  const linkText = label?.trim() || issueKey;
  return `<${buildJiraIssueUrl(issueKey)}|${escapeSlackText(linkText)}>`;
}

function getEpicSummaryFromLabel(parentEpicLabel?: string, parentEpicKey?: string): string | undefined {
  if (!parentEpicLabel || !parentEpicKey) {
    return undefined;
  }

  const prefix = `${parentEpicKey} - `;
  return parentEpicLabel.startsWith(prefix) ? parentEpicLabel.slice(prefix.length) : parentEpicLabel;
}

function getParentInspectionLabel(context: Pick<EodThreadContext, "parentEpicKey" | "parentEpicLabel">): string {
  return context.parentEpicLabel?.trim() || context.parentEpicKey;
}

function getParentTaskLabel(
  context: Pick<EodThreadContext, "parentTaskKey" | "parentTaskLabel" | "parentTaskSummary">
): string {
  return context.parentTaskLabel?.trim() || context.parentTaskSummary.trim() || context.parentTaskKey;
}

function buildEodThreadStartMessage(context: EodThreadContext) {
  const parentInspection = buildLinkedJiraLabel(context.parentEpicKey, getParentInspectionLabel(context));
  const assetTask = buildLinkedJiraLabel(context.parentTaskKey, getParentTaskLabel(context));
  const text =
    `*EOD Intake :thread:*\n` +
    `*Parent Inspection:* ${parentInspection}\n` +
    `*Asset:* ${assetTask}\n` +
    `*Asset Type:* ${escapeSlackText(context.assetType)}\n` +
    `*Created by:* <@${context.requesterId}>`;

  return {
    text: `EOD intake started for ${context.parentEpicKey}.`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text
        }
      },
      {
        type: "actions" as const,
        elements: [
          {
            type: "button" as const,
            action_id: CALLBACKS.eodStartButton,
            text: {
              type: "plain_text" as const,
              text: "Generate EOD Report"
            },
            style: "danger" as const,
            value: JSON.stringify(context)
          }
        ]
      }
    ]
  };
}

function buildEodCompletionMessage(input: {
  issueKey: string;
  issueSummary: string;
  requesterId: string;
  context: EodThreadContext;
  values: EodReportFormValues;
}) {
  const issueLink = buildLinkedJiraLabel(input.issueKey, input.issueKey);
  const parentInspection = buildLinkedJiraLabel(
    input.context.parentEpicKey,
    getParentInspectionLabel(input.context)
  );
  const assetTask = buildLinkedJiraLabel(input.context.parentTaskKey, getParentTaskLabel(input.context));
  const headerLines = [
    `*EOD Report Generated*`,
    `*EOD Report:* ${issueLink} - ${escapeSlackText(input.issueSummary)}`,
    `*Parent Inspection:* ${parentInspection}`,
    `*Asset:* ${assetTask}`,
    `*Asset Type:* ${escapeSlackText(input.context.assetType)}`,
    `*Submitted by:* <@${input.requesterId}>`,
    `*Date:* ${escapeSlackText(input.values.date)}`,
    `*JSA Submitted:* ${escapeSlackText(input.values.jsaSubmitted)}`,
    `*Number of Scans Completed:* ${String(input.values.numberOfScansCompleted)}`,
    `*Total Scanning Time (Hours):* ${String(input.values.totalScanningTimeHours)}`
  ];

  return {
    text: `EOD Report generated: ${input.issueKey} for ${input.context.parentEpicKey}.`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: headerLines.join("\n")
        }
      },
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: `*Full Day Overview:*\n${escapeSlackTextPreservingEntities(input.values.fullDayOverview)}`
        }
      },
      ...(input.values.notes?.trim()
        ? [
            {
              type: "section" as const,
              text: {
                type: "mrkdwn" as const,
                text: `*Notes:*\n${escapeSlackTextPreservingEntities(input.values.notes.trim())}`
              }
            }
          ]
        : [])
    ]
  };
}

function buildIssueConfirmationMessage(input: {
  issueType: string;
  requesterId: string;
  issueKey: string;
  issueSummary: string;
  parentEpicKey: string;
  parentEpicSummary?: string;
}) {
  const issueLink = `<${buildJiraIssueUrl(input.issueKey)}|${escapeSlackText(input.issueKey)}>`;
  const epicLink = `<${buildJiraIssueUrl(input.parentEpicKey)}|${escapeSlackText(input.parentEpicKey)}>`;
  const epicSummary = input.parentEpicSummary
    ? ` - ${escapeSlackText(input.parentEpicSummary)}`
    : "";

  const text =
    `*${escapeSlackText(input.issueType)} has been filed*\n` +
    `*Reporter:* <@${input.requesterId}>\n` +
    `*Issue:* ${issueLink} - ${escapeSlackText(input.issueSummary)}\n` +
    `*Inspection:* ${epicLink}${epicSummary}`;

  return {
    text: `${input.issueType} filed: ${input.issueKey} under ${input.parentEpicKey}.`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text
        }
      }
    ]
  };
}

function buildHomeView() {
  return {
    type: "home" as const,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text:
            "*Gecko Reporting Workflow*\nCreate Jira Bugs, EOD Reports, and EHS Tasks from Slack for the configured workflow."
        }
      },
      {
        type: "actions" as const,
        elements: [
          {
            type: "button" as const,
            action_id: CALLBACKS.homeOpenButton,
            text: {
              type: "plain_text" as const,
              text: "Create Gecko Report"
            },
            style: "primary" as const
          }
        ]
      }
    ]
  };
}

function buildChannelEntryMessage() {
  return [
    {
      type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text:
            "*Gecko Reporting Workflow*\nUse this button to create Jira Bugs, EOD Reports, and EHS Tasks for the supported workflows."
        }
      },
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          action_id: CALLBACKS.channelOpenButton,
          text: {
            type: "plain_text" as const,
            text: "Create Gecko Report"
          },
          style: "primary" as const
        }
      ]
    }
  ];
}

function getEodChannelId(channelId?: string): string {
  if (!channelId) {
    throw new Error(
      "Could not determine the originating Slack channel for this EOD intake. Please launch the workflow from the target channel and try again."
    );
  }

  return channelId;
}

async function openCreateIssueModal(
  client: App["client"],
  triggerId: string,
  logger: Pick<Console, "info" | "error">,
  logContext: string,
  channelId?: string
) {
  const defaultWorkflow = listWorkflows()[0];

  await client.views.open({
    trigger_id: triggerId,
    view: buildCreateIssueModal(defaultWorkflow, {}, {
      workflowKey: defaultWorkflow.key,
      channelId
    })
  });

  logger.info(logContext);
}

async function updateModalView(
  client: App["client"],
  input: {
    viewId: string;
    hash?: string;
    view: Parameters<App["client"]["views"]["update"]>[0]["view"];
  },
  logger: Pick<Console, "warn" | "error">,
  context: string
) {
  try {
    await client.views.update({
      view_id: input.viewId,
      hash: input.hash,
      view: input.view
    });
    return;
  } catch (error) {
    logger.warn(`${context} failed with hash. Retrying without hash. ${formatSlackApiErrorDetails(error)}`);
  }

  try {
    await client.views.update({
      view_id: input.viewId,
      view: input.view
    });
  } catch (error) {
    logger.error(`${context} failed without hash as well. ${formatSlackApiErrorDetails(error)}`);
    throw error;
  }
}

async function sendDirectMessage(
  client: App["client"],
  userId: string,
  text: string,
  blocks?: DmBlocks
) {
  const conversation = await client.conversations.open({
    users: userId
  });

  if (!conversation.channel?.id) {
    throw new Error(`Could not open a DM conversation for user ${userId}.`);
  }

  await client.chat.postMessage({
    channel: conversation.channel.id,
    text,
    ...(blocks ? { blocks } : {})
  });
}

async function trySendDirectMessage(
  client: App["client"],
  userId: string,
  text: string,
  blocks: DmBlocks | undefined,
  logger: Pick<Console, "warn">
) {
  try {
    await sendDirectMessage(client, userId, text, blocks);
  } catch (error) {
    logger.warn(`Could not send DM confirmation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createEodThread(
  client: App["client"],
  context: Omit<EodThreadContext, "threadTs">
) {
  const starterText = `EOD intake started for ${context.parentEpicKey}`;
  const starter = await client.chat.postMessage({
    channel: context.channelId,
    text: starterText
  });

  if (!starter.ts) {
    throw new Error("Slack did not return a thread timestamp for the EOD intake.");
  }

  const threadContext: EodThreadContext = {
    ...context,
    threadTs: starter.ts
  };
  const starterMessage = buildEodThreadStartMessage(threadContext);

  await client.chat.update({
    channel: context.channelId,
    ts: starter.ts,
    text: starterMessage.text,
    blocks: starterMessage.blocks
  });

  return threadContext;
}

function summarizeCreateIssueSubmission(input: {
  workflowKey: string;
  jiraProjectKey: string;
  userId: string;
  channelId?: string;
  issueTypeValue?: string;
  parentEpicKey?: string;
  summary?: string | null;
  details?: string | null;
  blockerTypeValue?: string;
  downtimeValue: string;
  isEod: boolean;
  isEhsTask: boolean;
}) {
  return JSON.stringify({
    workflowKey: input.workflowKey,
    jiraProjectKey: input.jiraProjectKey,
    userId: input.userId,
    channelId: input.channelId ?? null,
    issueType: input.issueTypeValue ?? null,
    parentEpicKey: input.parentEpicKey ?? null,
    summaryLength: (input.summary ?? "").trim().length,
    detailsLength: (input.details ?? "").trim().length,
    blockerType: input.blockerTypeValue ?? null,
    downtimeValue: input.downtimeValue || null,
    isEod: input.isEod,
    isEhsTask: input.isEhsTask
  });
}

function validateEodForm(values: ModalState | undefined) {
  const errors: Record<string, string> = {};
  const date = getDateValue(values, CALLBACKS.eodDateBlock, CALLBACKS.eodDateAction);
  const fullDayOverviewValue = getRichTextValue(
    values,
    CALLBACKS.eodFullDayOverviewBlock,
    CALLBACKS.eodFullDayOverviewAction
  );
  const fullDayOverview = richTextToPlainText(fullDayOverviewValue);
  const fullDayOverviewContent = richTextToJiraDocNodes(fullDayOverviewValue);
  const jsaSubmitted = parseEodYesNo(
    getSelectedOptionValue(values?.[CALLBACKS.eodJsaSubmittedBlock]?.[CALLBACKS.eodJsaSubmittedAction])
  );
  const scansCompletedValue = getPlainTextValue(
    values,
    CALLBACKS.eodScansCompletedBlock,
    CALLBACKS.eodScansCompletedAction
  );
  const scanningTimeValue = getPlainTextValue(
    values,
    CALLBACKS.eodScanningTimeBlock,
    CALLBACKS.eodScanningTimeAction
  );
  const notes = getPlainTextValue(values, CALLBACKS.eodNotesBlock, CALLBACKS.eodNotesAction);

  if (!date) {
    errors[CALLBACKS.eodDateBlock] = "Date is required.";
  }

  if (!fullDayOverview.trim()) {
    errors[CALLBACKS.eodFullDayOverviewBlock] = "Full Day Overview is required.";
  }

  if (!jsaSubmitted) {
    errors[CALLBACKS.eodJsaSubmittedBlock] = "Choose whether JSA was submitted.";
  }

  if (!scansCompletedValue) {
    errors[CALLBACKS.eodScansCompletedBlock] = "Number of Scans Completed is required.";
  } else if (Number.isNaN(Number(scansCompletedValue))) {
    errors[CALLBACKS.eodScansCompletedBlock] = "Enter a valid number.";
  }

  if (!scanningTimeValue) {
    errors[CALLBACKS.eodScanningTimeBlock] = "Total Scanning Time is required.";
  } else if (Number.isNaN(Number(scanningTimeValue))) {
    errors[CALLBACKS.eodScanningTimeBlock] = "Enter a valid number.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      success: false as const,
      errors
    };
  }

  return {
    success: true as const,
    values: {
      date: date as string,
      fullDayOverview,
      fullDayOverviewContent,
      jsaSubmitted: jsaSubmitted as EodYesNo,
      numberOfScansCompleted: Number(scansCompletedValue),
      totalScanningTimeHours: Number(scanningTimeValue),
      notes: notes?.trim() || undefined
    } satisfies EodReportFormValues
  };
}

function validateEhsForm(values: ModalState | undefined) {
  const errors: Record<string, string> = {};
  const siteContact = getPlainTextValue(
    values,
    getEhsTextBlockId("siteContact"),
    getEhsTextActionId("siteContact")
  );
  const sitePhoneNumber = getPlainTextValue(
    values,
    getEhsTextBlockId("sitePhoneNumber"),
    getEhsTextActionId("sitePhoneNumber")
  );
  const siteEmail = getPlainTextValue(values, getEhsTextBlockId("siteEmail"), getEhsTextActionId("siteEmail"));

  if (!siteContact?.trim()) {
    errors[getEhsTextBlockId("siteContact")] = "Site Contact is required.";
  }

  if (!sitePhoneNumber?.trim()) {
    errors[getEhsTextBlockId("sitePhoneNumber")] = "Site Contact Phone Number is required.";
  }

  if (!siteEmail?.trim()) {
    errors[getEhsTextBlockId("siteEmail")] = "Site Contact Email is required.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      success: false as const,
      errors
    };
  }

  const ehsState = getEhsModalStateValues(values);
  const trim = (value?: string) => value?.trim() || undefined;

  return {
    success: true as const,
    summary: "Site Requirements",
    values: {
      drugTestingSelections: ehsState.drugTestingSelections ?? [],
      drugTestingInfo: trim(ehsState.drugTestingInfo),
      backgroundCheckSelections: ehsState.backgroundCheckSelections ?? [],
      formsSelections: ehsState.formsSelections ?? [],
      formsInfo: trim(ehsState.formsInfo),
      idRequirements: ehsState.idRequirements ?? [],
      idOther: trim(ehsState.idOther),
      trainingRequirements: trim(ehsState.trainingRequirements),
      ppeRequirements: ehsState.ppeRequirements ?? [],
      ppeSpecialRequirements: ehsState.ppeSpecialRequirements ?? [],
      ppeOther: trim(ehsState.ppeOther),
      monitorRequirements: ehsState.monitorRequirements ?? [],
      soloGasRequirements: ehsState.soloGasRequirements ?? [],
      fiveGasDetails: ehsState.fiveGasDetails ?? [],
      fiveGasOther: trim(ehsState.fiveGasOther),
      generalRequirements: trim(ehsState.generalRequirements),
      vehicles: trim(ehsState.vehicles),
      loto: trim(ehsState.loto),
      confinedSpace: trim(ehsState.confinedSpace),
      hazardAssessment: trim(ehsState.hazardAssessment),
      submitTo: trim(ehsState.submitTo),
      jsaRequirements: ehsState.jsaRequirements ?? [],
      electrical: trim(ehsState.electrical),
      permits: trim(ehsState.permits),
      incidentReporting: trim(ehsState.incidentReporting),
      heatStress: trim(ehsState.heatStress),
      environmental: trim(ehsState.environmental),
      housekeeping: trim(ehsState.housekeeping),
      barricades: trim(ehsState.barricades),
      scaffoldingTags: ehsState.scaffoldingTags ?? [],
      droppedObjects: trim(ehsState.droppedObjects),
      jobSpecific: trim(ehsState.jobSpecific),
      siteContact: trim(siteContact),
      sitePhoneNumber: trim(sitePhoneNumber),
      siteEmail: trim(siteEmail),
      safetyContact: trim(ehsState.safetyContact),
      safetyPhoneNumber: trim(ehsState.safetyPhoneNumber),
      safetyEmail: trim(ehsState.safetyEmail),
      additionalHazards: trim(ehsState.additionalHazards),
      previousIncidents: trim(ehsState.previousIncidents)
    } satisfies EhsFormValues
  };
}

export function registerSlackHandlers(app: App): void {
  app.use(async ({ body, next, logger }) => {
    const payload = body as {
      type?: string;
      callback_id?: string;
      actions?: Array<{ action_id?: string }>;
    };

    logger.info(
      `Incoming Slack payload type=${payload.type ?? "unknown"} callback_id=${
        payload.callback_id ?? "n/a"
      } action_ids=${payload.actions?.map((action) => action.action_id ?? "unknown").join(",") ?? "none"}`
    );

    await next();
  });

  app.event("app_home_opened", async ({ event, client, logger }) => {
    await client.views.publish({
      user_id: event.user,
      view: buildHomeView()
    });

    logger.info(`Published App Home for user ${event.user}`);
  });

  app.shortcut(CALLBACKS.globalShortcut, async ({ ack, body, client, logger }) => {
    await ack();
    await openCreateIssueModal(
      client,
      body.trigger_id,
      logger,
      `Opened modal for user ${body.user.id}`,
      getChannelIdFromActionBody(body)
    );
  });

  app.action(CALLBACKS.homeOpenButton, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("trigger_id" in body)) {
      logger.error("Home button interaction did not include a trigger_id.");
      return;
    }

    await openCreateIssueModal(
      client,
      body.trigger_id,
      logger,
      `Opened modal from App Home for user ${body.user.id}`
    );
  });

  app.command("/inspection_report_manager", async ({ ack, body, client, logger, respond }) => {
    await ack();

    try {
      await client.chat.postMessage({
        channel: body.channel_id,
        text: "Create a Jira report from this channel.",
        blocks: buildChannelEntryMessage()
      });

      logger.info(`Posted channel entry message in ${body.channel_id}`);
    } catch (error) {
      logger.error(`Could not post channel entry message: ${error instanceof Error ? error.message : String(error)}`);

      await respond({
        response_type: "ephemeral",
        text:
          "I couldn't post the report button in this channel. If this is a private channel, please invite @Gecko Reporting Workflow first, then try again."
      });
    }
  });

  app.action(CALLBACKS.channelOpenButton, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("trigger_id" in body)) {
      logger.error("Channel button interaction did not include a trigger_id.");
      return;
    }

    await openCreateIssueModal(
      client,
      body.trigger_id,
      logger,
      `Opened modal from channel message for user ${body.user.id}`,
      getChannelIdFromActionBody(body)
    );
  });

  app.action(CALLBACKS.workflowAction, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("view" in body) || !body.view) {
      logger.error("Workflow selection action did not include a modal view.");
      return;
    }

    const selectedWorkflowKey = getSelectedOptionValue(body.actions[0]);

    if (!selectedWorkflowKey) {
      logger.error("Workflow selection action did not include a selected workflow.");
      return;
    }

    const workflow = getWorkflowByKey(selectedWorkflowKey);
    const state = getModalStateValues(body.view.state.values);
    const nextSelectedIssueType = workflow.allowedIssueTypes.includes(state.selectedIssueType ?? "Bug")
      ? state.selectedIssueType
      : workflow.allowedIssueTypes[0];

    logger.info(
      `Attempting modal workflow update to ${workflow.key} with issueType=${nextSelectedIssueType ?? "n/a"} view=${body.view.id}`
    );

    try {
      await updateModalView(
        client,
        {
          viewId: body.view.id,
          hash: body.view.hash,
          view: buildCreateIssueModal(
            workflow,
            {
              ...state,
              selectedIssueType: nextSelectedIssueType
            },
            {
              workflowKey: workflow.key,
              channelId: state.channelId ?? getChannelIdFromViewMetadata(body.view),
              requireChannelSelection: getRequireChannelSelectionFromViewMetadata(body.view)
            }
          )
        },
        logger,
        `Failed modal workflow update for workflow ${workflow.key}`
      );
    } catch (error) {
      return;
    }

    logger.info(`Updated modal workflow to ${workflow.key}`);
  });

  app.action(CALLBACKS.issueTypeAction, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("view" in body) || !body.view) {
      logger.error("Issue type action did not include a modal view.");
      return;
    }

    const workflowKey = getWorkflowKeyFromViewMetadata(body.view) ?? listWorkflows()[0].key;
    const workflow = getWorkflowByKey(workflowKey);
    const selectedIssueTypeValue = getSelectedOptionValue(body.actions[0]);
    const state = getModalStateValues(body.view.state.values);
    const selectedIssueType = selectedIssueTypeFromValue(
      selectedIssueTypeValue ?? getDefaultIssueTypeForWorkflow(workflow.key)
    );

    logger.info(
      `Attempting modal issue type update for workflow ${workflow.key} to ${selectedIssueType} view=${body.view.id}`
    );

    try {
      await updateModalView(
        client,
        {
          viewId: body.view.id,
          hash: body.view.hash,
          view: buildCreateIssueModal(
            workflow,
            {
              ...state,
              selectedIssueType
            },
            {
              workflowKey: workflow.key,
              channelId: state.channelId ?? getChannelIdFromViewMetadata(body.view),
              requireChannelSelection: getRequireChannelSelectionFromViewMetadata(body.view)
            }
          )
        },
        logger,
        `Failed modal issue type update for workflow ${workflow.key} to ${selectedIssueType}`
      );
    } catch (error) {
      return;
    }

    logger.info(`Updated modal issue type for workflow ${workflow.key} to ${selectedIssueType}`);
  });

  app.action(CALLBACKS.epicAction, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("view" in body) || !body.view) {
      logger.error("Epic selection action did not include a modal view.");
      return;
    }

    const workflowKey = getWorkflowKeyFromViewMetadata(body.view) ?? listWorkflows()[0].key;
    const workflow = getWorkflowByKey(workflowKey);
    const state = getModalStateValues(body.view.state.values);
    const selectedParentEpicKey = getSelectedOptionValue(body.actions[0]);
    const selectedParentEpicLabel =
      "selected_option" in body.actions[0] ? body.actions[0].selected_option?.text?.text : undefined;
    const nextState = clearEodTaskSelectionIfParentChanged(state, selectedParentEpicKey);
    const selectedIssueType = workflow.allowedIssueTypes.includes(nextState.selectedIssueType ?? "Bug")
      ? nextState.selectedIssueType
      : workflow.allowedIssueTypes[0];

    logger.info(
      `Attempting modal epic update for workflow ${workflow.key} to epic=${selectedParentEpicKey ?? "n/a"} view=${body.view.id}`
    );

    try {
      await updateModalView(
        client,
        {
          viewId: body.view.id,
          hash: body.view.hash,
          view: buildCreateIssueModal(
            workflow,
            {
              ...nextState,
              parentEpicKey: selectedParentEpicKey,
              parentEpicLabel: selectedParentEpicLabel,
              selectedIssueType
            },
            {
              workflowKey: workflow.key,
              channelId: nextState.channelId ?? getChannelIdFromViewMetadata(body.view),
              requireChannelSelection: getRequireChannelSelectionFromViewMetadata(body.view)
            }
          )
        },
        logger,
        `Failed modal epic update for workflow ${workflow.key}`
      );
    } catch {
      return;
    }

    logger.info(`Updated modal epic for workflow ${workflow.key} to ${selectedParentEpicKey ?? "n/a"}`);
  });

  for (const key of getEhsReactiveCheckboxKeys()) {
    app.action(getEhsCheckboxActionId(key), async ({ ack, body, client, logger }) => {
      await ack();

      if (!("view" in body) || !body.view) {
        logger.error(`EHS checkbox action ${String(key)} did not include a modal view.`);
        return;
      }

      const workflowKey = getWorkflowKeyFromViewMetadata(body.view) ?? listWorkflows()[0].key;
      const workflow = getWorkflowByKey(workflowKey);
      const state = getModalStateValues(body.view.state.values);
      const selectedIssueType = workflow.allowedIssueTypes.includes(state.selectedIssueType ?? "Bug")
        ? state.selectedIssueType
        : workflow.allowedIssueTypes[0];

      try {
        await updateModalView(
          client,
          {
            viewId: body.view.id,
            hash: body.view.hash,
            view: buildCreateIssueModal(
              workflow,
              {
                ...state,
                selectedIssueType
              },
              {
                workflowKey: workflow.key,
                channelId: state.channelId ?? getChannelIdFromViewMetadata(body.view),
                requireChannelSelection: getRequireChannelSelectionFromViewMetadata(body.view)
              }
            )
          },
          logger,
          `Failed EHS modal refresh for action ${String(key)}`
        );
      } catch (error) {
        return;
      }
    });
  }

  app.action(CALLBACKS.eodStartButton, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("trigger_id" in body)) {
      logger.error("EOD start action did not include a trigger_id.");
      return;
    }

    if (!("actions" in body) || !Array.isArray(body.actions) || body.actions.length === 0) {
      logger.error("EOD start action did not include any actions.");
      return;
    }

    const action = body.actions[0];
    const contextValue = action && "value" in action ? action.value : undefined;

    if (!contextValue) {
      logger.error("EOD start action did not include thread context.");
      return;
    }

    const context = decodeEodThreadContext(contextValue);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildEodReportModal(context)
    });

    logger.info(`Opened EOD intake modal for thread ${context.threadTs}`);
  });

  app.options(CALLBACKS.epicAction, async ({ ack, body, logger }) => {
    try {
      const workflowKey = getSelectedWorkflowKeyFromSuggestion(body);
      const workflow = getWorkflowByKey(workflowKey);
      const query = (body.value ?? "").trim();

      logger.info(
        `Received Epic lookup request for workflow ${workflow.key} with query="${query}" action=${body.action_id ?? "n/a"}`
      );

      const jql = buildEpicSearchJql(workflow, query);
      const epics = await searchEpics(workflow, query);

      await ack({
        options: epics.map((epic) => ({
          text: {
            type: "plain_text",
            text: `${epic.key} - ${epic.summary}`.slice(0, 75)
          },
          value: epic.key
        }))
      });

      logger.info(`Returned ${epics.length} Epic options for workflow ${workflow.key} using JQL: ${jql}`);
    } catch (error) {
      logger.error(`Failed to load Epic options for query "${body.value ?? ""}".`, error);
      await ack({ options: [] });
    }
  });

  app.options(CALLBACKS.eodTaskAction, async ({ ack, body, logger }) => {
    try {
      const workflowKey = getSelectedWorkflowKeyFromSuggestion(body);
      const workflow = getWorkflowByKey(workflowKey);
      const parentEpicKey = getSelectedOptionValue(
        body.view?.state.values?.[CALLBACKS.epicBlock]?.[CALLBACKS.epicAction]
      );
      const query = (body.value ?? "").trim();

      if (!parentEpicKey) {
        await ack({ options: [] });
        return;
      }

      const tasks = await searchChildTasks(workflow, parentEpicKey, query);

      await ack({
        options: tasks.map((task) => ({
          text: {
            type: "plain_text",
            text: `${task.key} - ${task.summary}`.slice(0, 75)
          },
          value: task.key
        }))
      });

      logger.info(
        `Returned ${tasks.length} child Task options for parent ${parentEpicKey} in workflow ${workflow.key}`
      );
    } catch (error) {
      logger.error(`Failed to load child Task options for query "${body.value ?? ""}".`, error);
      await ack({ options: [] });
    }
  });

  app.action(CALLBACKS.eodTaskAction, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("view" in body) || !body.view) {
      logger.error("EOD task selection action did not include a modal view.");
      return;
    }

    const workflowKey = getWorkflowKeyFromViewMetadata(body.view) ?? listWorkflows()[0].key;
    const workflow = getWorkflowByKey(workflowKey);
    const state = getModalStateValues(body.view.state.values);
    const selectedTaskKey = getSelectedOptionValue(body.actions[0]);
    const selectedTaskLabel =
      "selected_option" in body.actions[0] ? body.actions[0].selected_option?.text?.text : undefined;
    const selectedIssueType = workflow.allowedIssueTypes.includes(state.selectedIssueType ?? "Bug")
      ? state.selectedIssueType
      : workflow.allowedIssueTypes[0];

    logger.info(
      `Attempting modal EOD task update for workflow ${workflow.key} to task=${selectedTaskKey ?? "n/a"} view=${body.view.id}`
    );

    try {
      await updateModalView(
        client,
        {
          viewId: body.view.id,
          hash: body.view.hash,
          view: buildCreateIssueModal(
            workflow,
            {
              ...state,
              eodTaskKey: selectedTaskKey,
              eodTaskLabel: selectedTaskLabel,
              selectedIssueType
            },
            {
              workflowKey: workflow.key,
              channelId: state.channelId ?? getChannelIdFromViewMetadata(body.view),
              requireChannelSelection: getRequireChannelSelectionFromViewMetadata(body.view)
            }
          )
        },
        logger,
        `Failed modal EOD task update for workflow ${workflow.key}`
      );
    } catch {
      return;
    }

    logger.info(`Updated modal EOD task for workflow ${workflow.key} to ${selectedTaskKey ?? "n/a"}`);
  });

  app.view(CALLBACKS.createIssueView, async ({ ack, body, client, logger, view }) => {
    const workflowKey =
      getWorkflowKeyFromViewMetadata(view) ?? getSelectedWorkflowKeyFromState(view.state.values);
    const stateChannelId = getSelectedConversationValue(
      view.state.values,
      CALLBACKS.channelBlock,
      CALLBACKS.channelAction
    );
    const channelId = stateChannelId ?? getChannelIdFromViewMetadata(view);
    const values = view.state.values;
    const workflow = getWorkflowByKey(workflowKey);
    const parentEpicLabel =
      values[CALLBACKS.epicBlock]?.[CALLBACKS.epicAction] &&
      "selected_option" in values[CALLBACKS.epicBlock][CALLBACKS.epicAction]
        ? values[CALLBACKS.epicBlock][CALLBACKS.epicAction].selected_option?.text?.text
        : undefined;
    const parentEpicKey =
      values[CALLBACKS.epicBlock]?.[CALLBACKS.epicAction] &&
      "selected_option" in values[CALLBACKS.epicBlock][CALLBACKS.epicAction]
        ? values[CALLBACKS.epicBlock][CALLBACKS.epicAction].selected_option?.value
        : undefined;
    const parentTaskLabel =
      values[CALLBACKS.eodTaskBlock]?.[CALLBACKS.eodTaskAction] &&
      "selected_option" in values[CALLBACKS.eodTaskBlock][CALLBACKS.eodTaskAction]
        ? values[CALLBACKS.eodTaskBlock][CALLBACKS.eodTaskAction].selected_option?.text?.text
        : undefined;
    const parentTaskKey =
      values[CALLBACKS.eodTaskBlock]?.[CALLBACKS.eodTaskAction] &&
      "selected_option" in values[CALLBACKS.eodTaskBlock][CALLBACKS.eodTaskAction]
        ? values[CALLBACKS.eodTaskBlock][CALLBACKS.eodTaskAction].selected_option?.value
        : undefined;
    const issueTypeValue =
      values[CALLBACKS.issueTypeBlock]?.[CALLBACKS.issueTypeAction] &&
      "selected_option" in values[CALLBACKS.issueTypeBlock][CALLBACKS.issueTypeAction]
        ? values[CALLBACKS.issueTypeBlock][CALLBACKS.issueTypeAction].selected_option?.value
        : workflow.allowedIssueTypes[0];
    const selectedThreadAssetType = parseEodAssetType(
      getSelectedOptionValue(values[CALLBACKS.eodAssetTypeBlock]?.[CALLBACKS.eodAssetTypeAction])
    );
    const summary =
      values[CALLBACKS.summaryBlock]?.[CALLBACKS.summaryAction] &&
      "value" in values[CALLBACKS.summaryBlock][CALLBACKS.summaryAction]
        ? values[CALLBACKS.summaryBlock][CALLBACKS.summaryAction].value
        : "";
    const blockerTypeValue =
      values[CALLBACKS.blockerTypeBlock]?.[CALLBACKS.blockerTypeAction] &&
      "selected_option" in values[CALLBACKS.blockerTypeBlock][CALLBACKS.blockerTypeAction]
        ? values[CALLBACKS.blockerTypeBlock][CALLBACKS.blockerTypeAction].selected_option?.value
        : undefined;
    const downtimeValue =
      getPlainTextValue(values, CALLBACKS.downtimeBlock, CALLBACKS.downtimeAction) ?? "";
    const details = getPlainTextValue(values, CALLBACKS.detailsBlock, CALLBACKS.detailsAction) ?? "";

    const selectedIssueType = issueTypeValue ? selectedIssueTypeFromValue(issueTypeValue) : undefined;
    const isEod = selectedIssueType === "EOD Report";
    const isEhsTask = selectedIssueType ? usesEhsSpecificFields(workflow, selectedIssueType) : false;
    const submissionSummary = summarizeCreateIssueSubmission({
      workflowKey: workflow.key,
      jiraProjectKey: workflow.jiraProjectKey,
      userId: body.user.id,
      channelId,
      issueTypeValue,
      parentEpicKey,
      summary,
      details,
      blockerTypeValue,
      downtimeValue,
      isEod,
      isEhsTask
    });

    logger.info(`Received create issue submission ${submissionSummary}`);

    if (!parentEpicKey || !issueTypeValue || (!isEod && !isEhsTask && !summary)) {
      logger.info(
        `Rejecting create issue submission for missing required top-level fields ${JSON.stringify({
          workflowKey: workflow.key,
          userId: body.user.id,
          parentEpicKeyMissing: !parentEpicKey,
          issueTypeMissing: !issueTypeValue,
          summaryMissing: !isEod && !isEhsTask && !summary
        })}`
      );
      await ack({
        response_action: "errors",
        errors: {
          ...(parentEpicKey ? {} : { [CALLBACKS.epicBlock]: "Please choose a parent Epic." }),
          ...(issueTypeValue ? {} : { [CALLBACKS.issueTypeBlock]: "Please choose an issue type." }),
          ...(isEod || isEhsTask || summary
            ? {}
            : { [CALLBACKS.summaryBlock]: "Summary is required." })
        }
      });
      return;
    }

    if (!selectedIssueType) {
      logger.info(
        `Rejecting create issue submission because issue type could not be parsed ${JSON.stringify({
          workflowKey: workflow.key,
          userId: body.user.id,
          issueTypeValue: issueTypeValue ?? null
        })}`
      );
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.issueTypeBlock]: "Please choose an issue type."
        }
      });
      return;
    }

    if (!isEod && !isEhsTask && !details) {
      logger.info(
        `Rejecting create issue submission for missing details ${JSON.stringify({
          workflowKey: workflow.key,
          userId: body.user.id,
          issueType: selectedIssueType
        })}`
      );
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.detailsBlock]: "Details are required."
        }
      });
      return;
    }

    if (isEod && !selectedThreadAssetType) {
      await ack({
        response_action: "errors",
        errors: {
          ...(selectedThreadAssetType
            ? {}
            : { [CALLBACKS.eodAssetTypeBlock]: "Please choose an asset type." })
        }
      });
      return;
    }

    if (isEod && !parentTaskKey) {
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.eodTaskBlock]: "Please choose an asset task."
        }
      });
      return;
    }

    if (requiresBugSpecificFields(workflow, selectedIssueType)) {
      const errors: Record<string, string> = {};
      const blockerTypeLabel =
        workflow.jiraProjectKey === "APIDD" ? "API Blocker Type" : "RUG Blocker Type";

      if (!blockerTypeValue) {
        errors[CALLBACKS.blockerTypeBlock] = `Choose an ${blockerTypeLabel}.`;
      }

      if (!downtimeValue) {
        errors[CALLBACKS.downtimeBlock] = "Enter the downtime in hours.";
      } else if (Number.isNaN(Number(downtimeValue))) {
        errors[CALLBACKS.downtimeBlock] = "Downtime must be a number.";
      }

      if (Object.keys(errors).length > 0) {
        logger.info(
          `Rejecting bug submission for missing workflow-specific fields ${JSON.stringify({
            workflowKey: workflow.key,
            userId: body.user.id,
            issueType: selectedIssueType,
            errors
          })}`
        );
        await ack({
          response_action: "errors",
          errors
        });
        return;
      }
    }

    const ehsValidation = isEhsTask ? validateEhsForm(values) : undefined;

    if (ehsValidation && !ehsValidation.success) {
      logger.info(
        `Rejecting EHS submission for validation errors ${JSON.stringify({
          workflowKey: workflow.key,
          userId: body.user.id,
          errors: ehsValidation.errors
        })}`
      );
      await ack({
        response_action: "errors",
        errors: ehsValidation.errors
      });
      return;
    }

    if (!channelId) {
      logger.info(
        `Prompting for fallback channel selection before completing submission ${JSON.stringify({
          workflowKey: workflow.key,
          userId: body.user.id,
          issueType: selectedIssueType,
          parentEpicKey
        })}`
      );
      await ack({
        response_action: "update",
        view: buildCreateIssueModal(
          workflow,
          {
            ...getModalStateValues(values),
            selectedIssueType
          },
          {
            workflowKey: workflow.key,
            requireChannelSelection: true
          }
        )
      });
      return;
    }

    await ack();
    logger.info(
      `Accepted create issue submission and beginning processing ${JSON.stringify({
        workflowKey: workflow.key,
        userId: body.user.id,
        issueType: selectedIssueType,
        parentEpicKey,
        channelId: channelId ?? null
      })}`
    );

    try {
      if (isEod) {
        if (!parentTaskKey) {
          throw new Error("Asset task is required for EOD intake.");
        }

        const selectedParentTaskKey = parentTaskKey;
        const parentTaskSummary = await getIssueSummary(selectedParentTaskKey);
        logger.info(
          `Creating EOD intake thread ${JSON.stringify({
            workflowKey: workflow.key,
            userId: body.user.id,
            parentEpicKey,
            channelId: getEodChannelId(channelId)
          })}`
        );
        const threadContext = await createEodThread(client, {
          workflowKey: workflow.key,
          parentEpicKey,
          parentEpicLabel,
          parentTaskKey: selectedParentTaskKey,
          parentTaskLabel,
          parentTaskSummary,
          assetType: selectedThreadAssetType as EodAssetType,
          requesterId: body.user.id,
          channelId: getEodChannelId(channelId)
        });

        await trySendDirectMessage(
          client,
          body.user.id,
          `Started EOD intake thread for ${parentEpicKey} in <#${threadContext.channelId}>. Open the thread and click "Generate EOD Report" to finish the Jira issue.`,
          undefined,
          logger
        );

        logger.info(`Started EOD intake thread ${threadContext.threadTs} for ${parentEpicKey}`);
        return;
      }

      let issueSummary = summary ?? "";
      let issueDetails = details ?? "";
      let descriptionContent = undefined;

      if (ehsValidation?.success) {
        issueSummary = ehsValidation.summary;
        issueDetails = formatEhsDetails(ehsValidation.values);
        descriptionContent = buildEhsDescriptionContent(ehsValidation.values);
      }

      logger.info(
        `Creating Jira issue ${JSON.stringify({
          workflowKey: workflow.key,
          jiraProjectKey: workflow.jiraProjectKey,
          userId: body.user.id,
          issueType: selectedIssueType,
          parentEpicKey,
          summaryLength: issueSummary.trim().length,
          detailsLength: issueDetails.trim().length,
          blockerType: blockerTypeValue ?? null,
          opsDowntimeHours: downtimeValue ? Number(downtimeValue) : null,
          hasDescriptionContent: Boolean(descriptionContent)
        })}`
      );

      const issue = await createIssue({
        workflow,
        issueType: selectedIssueType,
        parentEpicKey,
        summary: issueSummary,
        details: issueDetails,
        descriptionContent,
        requesterName: body.user.id,
        blockerType: parseBlockerType(blockerTypeValue),
        opsDowntimeHours: downtimeValue ? Number(downtimeValue) : undefined
      });

      logger.info(`Created Jira issue ${issue.key}`);

      const confirmationMessage = buildIssueConfirmationMessage({
        issueType: selectedIssueType,
        requesterId: body.user.id,
        issueKey: issue.key,
        issueSummary: issueSummary,
        parentEpicKey,
        parentEpicSummary: getEpicSummaryFromLabel(parentEpicLabel, parentEpicKey)
      });

      if (channelId) {
        try {
          await client.chat.postMessage({
            channel: channelId,
            ...confirmationMessage
          });
        } catch (error) {
          logger.warn("Could not post Jira issue confirmation to the originating Slack channel.", error);
        }
      } else {
        logger.info(
          `Skipping channel confirmation for Jira issue ${issue.key} because no originating channel was captured.`
        );
      }

      await trySendDirectMessage(
        client,
        body.user.id,
        confirmationMessage.text,
        confirmationMessage.blocks,
        logger
      );
    } catch (error) {
      logger.error(
        `Could not create Jira issue for workflow ${workflow.key} issueType ${selectedIssueType}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await trySendDirectMessage(
        client,
        body.user.id,
        `Could not continue the workflow: ${formatJiraErrorMessage(error)}`,
        undefined,
        logger
      );
    }
  });

  app.view(CALLBACKS.eodReportView, async ({ ack, body, client, logger, view }) => {
    let context: EodThreadContext;
    const fullDayOverviewValue = getRichTextValue(
      view.state.values,
      CALLBACKS.eodFullDayOverviewBlock,
      CALLBACKS.eodFullDayOverviewAction
    );

    try {
      context = decodeEodThreadContext(view.private_metadata);
    } catch (error) {
      logger.error(error);
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.eodDateBlock]: "Could not load the thread context. Please start the EOD intake again."
        }
      });
      return;
    }

    const validation = validateEodForm(view.state.values);

    if (!validation.success) {
      logger.info(
        `Rejecting EOD report submission for validation errors ${JSON.stringify({
          workflowKey: context.workflowKey,
          userId: body.user.id,
          threadTs: context.threadTs,
          errors: validation.errors
        })}`
      );
      await ack({
        response_action: "errors",
        errors: validation.errors
      });
      return;
    }

    await ack();
    logger.info(
      `Accepted EOD report submission ${JSON.stringify({
        workflowKey: context.workflowKey,
        userId: body.user.id,
        threadTs: context.threadTs,
        channelId: context.channelId,
        parentEpicKey: context.parentEpicKey
      })}`
    );

    try {
      const workflow = getWorkflowByKey(context.workflowKey);
      const summary = buildEodReportSummary(context, validation.values);
      const details = formatEodReportDetails(context, validation.values);
      const resolveSlackUserMention = createSlackToJiraMentionResolver(client, logger);
      const resolvedFullDayOverviewContent = await richTextToResolvedJiraDocNodes(fullDayOverviewValue, {
        resolveUserMention: resolveSlackUserMention
      });
      const requesterContent = [await resolveSlackUserMention(body.user.id)];
      logger.info(
        `Creating EOD Jira issue ${JSON.stringify({
          workflowKey: workflow.key,
          jiraProjectKey: workflow.jiraProjectKey,
          userId: body.user.id,
          threadTs: context.threadTs,
          parentEpicKey: context.parentEpicKey,
          summaryLength: summary.trim().length,
          detailsLength: details.trim().length
        })}`
      );
      const issue = await createIssue({
        workflow,
        issueType: "EOD Report",
        parentEpicKey: context.parentEpicKey,
        summary,
        details,
        descriptionContent: buildEodDescriptionContent(context, {
          ...validation.values,
          fullDayOverviewContent:
            resolvedFullDayOverviewContent.length > 0
              ? resolvedFullDayOverviewContent
              : validation.values.fullDayOverviewContent
        }),
        requesterContent,
        requesterName: body.user.id
      });

      if (context.parentTaskKey) {
        try {
          await linkIssuesByRelationship({
            issueKey: issue.key,
            relatedIssueKey: context.parentTaskKey,
            relationshipText: "Connects to"
          });
          logger.info(`Linked EOD Jira issue ${issue.key} to asset task ${context.parentTaskKey} as "Connects to".`);
        } catch (error) {
          logger.warn(
            `Could not link EOD Jira issue ${issue.key} to asset task ${context.parentTaskKey}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      const completionMessage = buildEodCompletionMessage({
        issueKey: issue.key,
        issueSummary: summary,
        requesterId: body.user.id,
        context,
        values: validation.values
      });

      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: context.threadTs,
        ...completionMessage
      });

      await trySendDirectMessage(
        client,
        body.user.id,
        `Created Jira issue ${issue.key} in project ${workflow.jiraProjectKey}.`,
        undefined,
        logger
      );

      logger.info(`Created EOD Jira issue ${issue.key} for thread ${context.threadTs}`);
    } catch (error) {
      logger.error(error);

      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: context.threadTs,
        text: `Could not create the Jira issue: ${formatJiraErrorMessage(error)}`
      });

      await trySendDirectMessage(
        client,
        body.user.id,
        `Could not create Jira issue: ${formatJiraErrorMessage(error)}`,
        undefined,
        logger
      );
    }
  });
}
