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
import { uploadAttachmentToIssue } from "../jira/attachments.js";
import { createIssue } from "../jira/createIssue.js";
import { updateIssue } from "../jira/updateIssue.js";
import { findJiraUserForSlackProfile } from "../jira/users.js";
import { buildParentSearchJql, getIssueDetails, getIssueSummary, searchChildTasks, searchParentIssues } from "../jira/searchEpics.js";
import { linkIssuesByRelationship } from "../jira/issueLinks.js";
import type {
  BlockerType,
  DataOpsCloseoutFormValues,
  DataOpsProgressFormValues,
  DataOpsValidationState,
  DataOpsValidationThreadContext,
  EodAssetType,
  SelectableIssueType,
  EhsFormValues,
  EodReportFormValues,
  EodThreadContext,
  JiraInlineNode,
  EodYesNo,
  SingleThreadEodAssetState,
  SingleThreadEodContext
} from "../types/workflow.js";
import { CALLBACKS } from "./constants.js";
import {
  applyDataOpsCloseoutToContext,
  buildDataOpsCloseoutModal,
  buildDataOpsDescriptionContent,
  buildDataOpsIssueSummary,
  buildDataOpsProgressModal,
  formatDataOpsIssueDetails,
  buildIssueSelectOption,
  buildEodDescriptionContent,
  buildEodReportSummary,
  buildCreateIssueModal,
  decodeDataOpsValidationThreadContext,
  buildEodReportModal,
  buildSingleThreadEodReportModal,
  buildEhsDescriptionContent,
  encodeDataOpsValidationThreadContext,
  decodeEodThreadContext,
  decodeSingleThreadEodContext,
  encodeSingleThreadEodContext,
  formatEodProgressCodeValue,
  formatEodProgressValue,
  formatEodReportDetails,
  getEodProgressFieldLabel,
  usesTubeCountForEod,
  formatEhsDetails,
  type ModalMetadata,
  type SingleThreadEodModalStateValues,
  requiresBugSpecificFields,
  selectedIssueTypeFromValue,
  shouldCollectEodInThread,
  shouldUseSingleThreadEod,
  usesEhsSpecificFields,
  workflowRequiresSeparateEodAssetTask
} from "./modal.js";
import { downloadSlackFile, shareSlackFile } from "./attachments.js";
import {
  type SlackRichTextBlock,
  richTextToJiraDocNodes,
  richTextToPlainText,
  richTextToResolvedJiraDocNodes
} from "./richText.js";

type ModalState = ViewSubmitAction["view"]["state"]["values"];
type DmBlocks = Array<{ type: "section"; text: { type: "mrkdwn"; text: string } }>;

const DATA_TEAM_USERGROUP_IDENTIFIERS = [
  "data_team",
  "@data_team",
  "data-team",
  "data team"
] as const;

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

function getSelectedOptionLabel(
  action:
    | BlockAction["actions"][number]
    | ViewSubmitAction["view"]["state"]["values"][string][string]
    | undefined
): string | undefined {
  if (!action || !("selected_option" in action)) {
    return undefined;
  }

  const selectedOption = action.selected_option;
  const text = selectedOption?.text?.text?.trim();
  const description =
    selectedOption && "description" in selectedOption ? selectedOption.description?.text?.trim() : undefined;

  if (text && description) {
    return `${text} ${description}`.trim();
  }

  return text || description || undefined;
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

function decodeEodContextForLogging(privateMetadata?: string): EodThreadContext | undefined {
  if (!privateMetadata) {
    return undefined;
  }

  try {
    return decodeEodThreadContext(privateMetadata);
  } catch {
    return undefined;
  }
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

function getSelectedUserValue(
  stateValues: ModalState | undefined,
  blockId: string,
  actionId: string
): string | undefined {
  const action = stateValues?.[blockId]?.[actionId];

  if (action && "selected_user" in action) {
    return action.selected_user ?? undefined;
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

function getSelectedFileIds(
  stateValues: ModalState | undefined,
  blockId: string,
  actionId: string
): string[] {
  const action = stateValues?.[blockId]?.[actionId] as
    | {
        files?: Array<{
          id?: string;
        }>;
        selected_files?: string[];
      }
    | undefined;

  const uploadedFileIds = Array.isArray(action?.files)
    ? action.files
        .map((file) => file?.id)
        .filter((fileId): fileId is string => typeof fileId === "string" && fileId.length > 0)
    : [];

  if (uploadedFileIds.length > 0) {
    return uploadedFileIds;
  }

  if (!Array.isArray(action?.selected_files)) {
    return [];
  }

  return action.selected_files.filter((fileId): fileId is string => typeof fileId === "string");
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
): SelectableIssueType {
  return selectedIssueTypeFromValue(
    getSelectedOptionValue(stateValues?.[CALLBACKS.issueTypeBlock]?.[CALLBACKS.issueTypeAction]) ??
      "Bug"
  );
}

function getDefaultIssueTypeForWorkflow(workflowKey: string): SelectableIssueType {
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
      getSelectedOptionLabel(parentEpicSelection),
    eodTaskKey:
      parentTaskSelection && "selected_option" in parentTaskSelection
        ? parentTaskSelection.selected_option?.value ?? undefined
        : undefined,
    eodTaskLabel:
      getSelectedOptionLabel(parentTaskSelection),
    eodAssetType: parseEodAssetType(
      getSelectedOptionValue(stateValues?.[CALLBACKS.eodAssetTypeBlock]?.[CALLBACKS.eodAssetTypeAction])
    ),
    eodTotalTubeCount: getPlainTextValue(
      stateValues,
      CALLBACKS.eodTotalTubeCountBlock,
      CALLBACKS.eodTotalTubeCountAction
    ),
    enableDataOpsValidation:
      getSelectedOptionValue(
        stateValues?.[CALLBACKS.singleThreadEodDataOpsBlock]?.[CALLBACKS.singleThreadEodDataOpsAction]
      ) === "enabled",
    summary: getPlainTextValue(stateValues, CALLBACKS.summaryBlock, CALLBACKS.summaryAction),
    details: getPlainTextValue(stateValues, CALLBACKS.detailsBlock, CALLBACKS.detailsAction),
    blockerType: parseBlockerType(blockerTypeValue),
    opsDowntimeHours: getPlainTextValue(stateValues, CALLBACKS.downtimeBlock, CALLBACKS.downtimeAction),
    ehs: getEhsModalStateValues(stateValues)
  };
}

function getSingleThreadEodModalStateValues(stateValues?: ModalState): SingleThreadEodModalStateValues {
  const parentTaskSelection =
    stateValues?.[CALLBACKS.singleThreadEodTaskBlock]?.[CALLBACKS.singleThreadEodTaskAction];

  return {
    taskKey:
      parentTaskSelection && "selected_option" in parentTaskSelection
        ? parentTaskSelection.selected_option?.value ?? undefined
        : undefined,
    taskLabel: getSelectedOptionLabel(parentTaskSelection),
    assetType: parseEodAssetType(
      getSelectedOptionValue(
        stateValues?.[CALLBACKS.singleThreadEodAssetTypeBlock]?.[CALLBACKS.singleThreadEodAssetTypeAction]
      )
    ),
    totalTubeCount: getPlainTextValue(
      stateValues,
      CALLBACKS.eodTotalTubeCountBlock,
      CALLBACKS.eodTotalTubeCountAction
    )
  };
}

function getDataOpsProgressModalStateValues(stateValues?: ModalState) {
  return {
    slug: getPlainTextValue(stateValues, CALLBACKS.dataOpsSlugBlock, CALLBACKS.dataOpsSlugAction),
    ownerSlackUserId: getSelectedUserValue(stateValues, CALLBACKS.dataOpsOwnerBlock, CALLBACKS.dataOpsOwnerAction),
    percentCaptured: getPlainTextValue(stateValues, CALLBACKS.dataOpsCapturedBlock, CALLBACKS.dataOpsCapturedAction),
    percentUploaded: getPlainTextValue(stateValues, CALLBACKS.dataOpsUploadedBlock, CALLBACKS.dataOpsUploadedAction),
    percentValidated: getPlainTextValue(stateValues, CALLBACKS.dataOpsValidatedBlock, CALLBACKS.dataOpsValidatedAction),
    percentPrep: getPlainTextValue(stateValues, CALLBACKS.dataOpsPrepBlock, CALLBACKS.dataOpsPrepAction),
    percentQa: getPlainTextValue(stateValues, CALLBACKS.dataOpsQaBlock, CALLBACKS.dataOpsQaAction)
  };
}

function getBoilerTubeCompletionPercent(
  context: Pick<EodThreadContext, "assetType" | "totalTubeCount">,
  scannedTubeCount: number
): number | undefined {
  if (!usesTubeCountForEod(context)) {
    return undefined;
  }

  if (typeof context.totalTubeCount !== "number" || !Number.isFinite(context.totalTubeCount) || context.totalTubeCount <= 0) {
    return undefined;
  }

  return (scannedTubeCount / context.totalTubeCount) * 100;
}

function hasReachedDataOperationsAlertThreshold(
  context: Pick<EodThreadContext, "assetType" | "totalTubeCount">,
  progressValue: number
): boolean {
  const boilerCompletionPercent = getBoilerTubeCompletionPercent(context, progressValue);

  if (usesTubeCountForEod(context)) {
    return typeof boilerCompletionPercent === "number" && boilerCompletionPercent >= 80;
  }

  return progressValue >= 80;
}

function isEodScopeComplete(
  context: Pick<EodThreadContext, "assetType" | "totalTubeCount">,
  progressValue: number
): boolean {
  const boilerCompletionPercent = getBoilerTubeCompletionPercent(context, progressValue);

  if (usesTubeCountForEod(context)) {
    return typeof boilerCompletionPercent === "number" && boilerCompletionPercent >= 100;
  }

  return progressValue >= 100;
}

function formatPercentValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function parsePercentInput(value?: string): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validatePercentField(
  rawValue: string | undefined,
  blockId: string,
  label: string,
  errors: Record<string, string>
): number | undefined {
  const value = parsePercentInput(rawValue);

  if (typeof value !== "number") {
    errors[blockId] = `${label} is required.`;
    return undefined;
  }

  if (value < 0 || value > 100) {
    errors[blockId] = `${label} must be between 0 and 100.`;
    return undefined;
  }

  return value;
}

function validateDataOpsProgressForm(values: ModalState | undefined):
  | { success: true; values: DataOpsProgressFormValues }
  | { success: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const slug = getPlainTextValue(values, CALLBACKS.dataOpsSlugBlock, CALLBACKS.dataOpsSlugAction)?.trim();
  const ownerSlackUserId = getSelectedUserValue(values, CALLBACKS.dataOpsOwnerBlock, CALLBACKS.dataOpsOwnerAction);

  if (!slug) {
    errors[CALLBACKS.dataOpsSlugBlock] = "Slug is required.";
  }

  if (!ownerSlackUserId) {
    errors[CALLBACKS.dataOpsOwnerBlock] = "Owner is required.";
  }

  const percentCaptured = validatePercentField(
    getPlainTextValue(values, CALLBACKS.dataOpsCapturedBlock, CALLBACKS.dataOpsCapturedAction),
    CALLBACKS.dataOpsCapturedBlock,
    "% Captured",
    errors
  );
  const percentUploaded = validatePercentField(
    getPlainTextValue(values, CALLBACKS.dataOpsUploadedBlock, CALLBACKS.dataOpsUploadedAction),
    CALLBACKS.dataOpsUploadedBlock,
    "% Uploaded",
    errors
  );
  const percentValidated = validatePercentField(
    getPlainTextValue(values, CALLBACKS.dataOpsValidatedBlock, CALLBACKS.dataOpsValidatedAction),
    CALLBACKS.dataOpsValidatedBlock,
    "% Validated",
    errors
  );
  const percentPrep = validatePercentField(
    getPlainTextValue(values, CALLBACKS.dataOpsPrepBlock, CALLBACKS.dataOpsPrepAction),
    CALLBACKS.dataOpsPrepBlock,
    "% Prep",
    errors
  );
  const percentQa = validatePercentField(
    getPlainTextValue(values, CALLBACKS.dataOpsQaBlock, CALLBACKS.dataOpsQaAction),
    CALLBACKS.dataOpsQaBlock,
    "% QA",
    errors
  );

  if (Object.keys(errors).length > 0 || !slug || !ownerSlackUserId) {
    return {
      success: false,
      errors
    };
  }

  return {
    success: true,
    values: {
      slug,
      ownerSlackUserId,
      percentCaptured: percentCaptured as number,
      percentUploaded: percentUploaded as number,
      percentValidated: percentValidated as number,
      percentPrep: percentPrep as number,
      percentQa: percentQa as number
    }
  };
}

function isLikelyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateDataOpsCloseoutForm(values: ModalState | undefined):
  | { success: true; values: DataOpsCloseoutFormValues }
  | { success: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const dataQuality = getPlainTextValue(values, CALLBACKS.dataOpsQualityBlock, CALLBACKS.dataOpsQualityAction)?.trim();
  const forecastUrl =
    getPlainTextValue(values, CALLBACKS.dataOpsForecastUrlBlock, CALLBACKS.dataOpsForecastUrlAction)?.trim();
  const cantileverUrl =
    getPlainTextValue(values, CALLBACKS.dataOpsCantileverUrlBlock, CALLBACKS.dataOpsCantileverUrlAction)?.trim();

  if (!dataQuality) {
    errors[CALLBACKS.dataOpsQualityBlock] = "Data quality is required.";
  }

  if (!forecastUrl) {
    errors[CALLBACKS.dataOpsForecastUrlBlock] = "Forecast URL is required.";
  } else if (!isLikelyUrl(forecastUrl)) {
    errors[CALLBACKS.dataOpsForecastUrlBlock] = "Forecast URL must start with http:// or https://.";
  }

  if (!cantileverUrl) {
    errors[CALLBACKS.dataOpsCantileverUrlBlock] = "Cantilever URL is required.";
  } else if (!isLikelyUrl(cantileverUrl)) {
    errors[CALLBACKS.dataOpsCantileverUrlBlock] = "Cantilever URL must start with http:// or https://.";
  }

  if (Object.keys(errors).length > 0 || !dataQuality || !forecastUrl || !cantileverUrl) {
    return {
      success: false,
      errors
    };
  }

  return {
    success: true,
    values: {
      dataQuality,
      forecastUrl,
      cantileverUrl
    }
  };
}

function getStoredDataOpsProgressValues(
  context: DataOpsValidationThreadContext
): DataOpsProgressFormValues | undefined {
  const dataOps = context.dataOps;

  if (
    !dataOps.slug ||
    !dataOps.ownerSlackUserId ||
    dataOps.percentCaptured === undefined ||
    dataOps.percentUploaded === undefined ||
    dataOps.percentValidated === undefined ||
    dataOps.percentPrep === undefined ||
    dataOps.percentQa === undefined
  ) {
    return undefined;
  }

  return {
    slug: dataOps.slug,
    ownerSlackUserId: dataOps.ownerSlackUserId,
    percentCaptured: dataOps.percentCaptured,
    percentUploaded: dataOps.percentUploaded,
    percentValidated: dataOps.percentValidated,
    percentPrep: dataOps.percentPrep,
    percentQa: dataOps.percentQa
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

async function resolveJiraParentKeyForSelectedInspection(input: {
  workflow: ReturnType<typeof getWorkflowByKey>;
  selectedInspectionKey: string;
}): Promise<string | undefined> {
  if (input.workflow.parentIssueType !== "Task") {
    return input.selectedInspectionKey;
  }

  const selectedIssue = await getIssueDetails(input.selectedInspectionKey);
  return selectedIssue.parent?.key;
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

function createSlackUserGroupMentionResolver(
  client: App["client"],
  logger: Pick<Console, "warn">
): (identifiers: readonly string[]) => Promise<string | undefined> {
  const cache = new Map<string, Promise<string | undefined>>();

  return (identifiers: readonly string[]) => {
    const normalizedIdentifiers = identifiers
      .map((identifier) => identifier.trim().replace(/^@/, ""))
      .filter((identifier) => identifier.length > 0);
    const cacheKey = normalizedIdentifiers.join("|");
    const cached = cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const pending = (async () => {
      try {
        const response = await client.usergroups.list({
          include_disabled: false,
          include_users: false
        });
        const exactHandles = new Set(normalizedIdentifiers.map((identifier) => identifier.toLowerCase()));
        const normalizedCandidates = new Set(
          normalizedIdentifiers.map((identifier) => identifier.toLowerCase().replace(/[^a-z0-9]/g, ""))
        );
        const userGroup = response.usergroups?.find((group) => {
          const handle = group.handle?.trim() ?? "";
          const normalizedHandle = handle.toLowerCase();
          const collapsedHandle = normalizedHandle.replace(/[^a-z0-9]/g, "");
          const groupName = typeof group.name === "string" ? group.name.trim().toLowerCase() : "";
          const collapsedName = groupName.replace(/[^a-z0-9]/g, "");

          return (
            exactHandles.has(normalizedHandle) ||
            normalizedCandidates.has(collapsedHandle) ||
            normalizedCandidates.has(collapsedName)
          );
        });

        if (!userGroup?.id) {
          const similarHandles = (response.usergroups ?? [])
            .map((group) => group.handle?.trim())
            .filter((handle): handle is string => Boolean(handle))
            .filter((handle) => handle.toLowerCase().includes("data"))
            .slice(0, 5);
          logger.warn(
            `Could not find Slack user group for identifiers ${normalizedIdentifiers.join(", ")}.${
              similarHandles.length > 0 ? ` Similar handles: ${similarHandles.join(", ")}.` : ""
            }`
          );
          return undefined;
        }

        return `<!subteam^${userGroup.id}>`;
      } catch (error) {
        logger.warn(
          `Could not resolve Slack user group identifiers ${normalizedIdentifiers.join(", ")}. ${formatSlackApiErrorDetails(error)}`
        );
        return undefined;
      }
    })();

    cache.set(cacheKey, pending);
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

function getParentInspectionSummary(context: Pick<EodThreadContext, "parentEpicKey" | "parentEpicLabel">): string {
  return getEpicSummaryFromLabel(context.parentEpicLabel, context.parentEpicKey) ?? getParentInspectionLabel(context);
}

function hasSeparateEodAssetTask(
  context: Pick<EodThreadContext, "parentTaskKey" | "parentTaskSummary">
): boolean {
  return Boolean(context.parentTaskKey?.trim() || context.parentTaskSummary?.trim());
}

function getParentTaskLabel(
  context: Pick<
    EodThreadContext,
    "parentEpicKey" | "parentEpicLabel" | "parentTaskKey" | "parentTaskLabel" | "parentTaskSummary"
  >
): string {
  return (
    context.parentTaskLabel?.trim() ||
    context.parentTaskSummary?.trim() ||
    context.parentTaskKey?.trim() ||
    getParentInspectionLabel(context)
  );
}

function getParentTaskSummary(
  context: Pick<
    EodThreadContext,
    "parentEpicKey" | "parentEpicLabel" | "parentTaskKey" | "parentTaskLabel" | "parentTaskSummary"
  >
): string {
  return context.parentTaskSummary?.trim() || getParentTaskLabel(context) || getParentInspectionSummary(context);
}

function getEodThreadLifecycleStatus(context: Pick<EodThreadContext, "status">): "active" | "closed" {
  return context.status === "closed" ? "closed" : "active";
}

function formatSlackDateTime(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  const epochSeconds = Math.floor(date.getTime() / 1000);

  if (Number.isNaN(epochSeconds)) {
    return escapeSlackText(value);
  }

  return `<!date^${String(epochSeconds)}^{date_short_pretty} at {time}|${escapeSlackText(value)}>`;
}

function buildEodThreadStartMessage(context: EodThreadContext) {
  const status = getEodThreadLifecycleStatus(context);
  const parentInspection = buildLinkedJiraLabel(context.parentEpicKey, getParentInspectionLabel(context));
  const assetTask = hasSeparateEodAssetTask(context)
    ? buildLinkedJiraLabel(context.parentTaskKey, getParentTaskLabel(context))
    : undefined;
  const progressFieldLabel = usesTubeCountForEod(context) ? "Last # of Tubes Scanned" : "Last % Coverage Update";
  const totalTubeCountLine =
    usesTubeCountForEod(context) && typeof context.totalTubeCount === "number"
      ? `*Total Tubes:* \`${String(context.totalTubeCount)}\``
      : undefined;
  const reportStatus = context.reportIssueKey
    ? `:white_check_mark: ${buildLinkedJiraLabel(context.reportIssueKey, context.reportIssueKey)}`
    : ":hourglass_flowing_sand: Pending";
  const coverageStatus =
    typeof context.lastCoveragePercent === "number"
      ? formatEodProgressCodeValue(context, context.lastCoveragePercent)
      : "Pending";
  const closeoutTimestamp = formatSlackDateTime(context.closedOutAt);
  const statusLines = [
    `*Thread Status:* ${status === "closed" ? ":white_check_mark: Closed Out" : ":large_green_circle: Active"}`,
    `*Scanning Scope:* ${status === "closed" ? ":white_check_mark: Completed" : ":hourglass_flowing_sand: In Progress"}`,
    ...(totalTubeCountLine ? [totalTubeCountLine] : []),
    `*${progressFieldLabel}:* ${coverageStatus}`,
    `*Last EOD Report:* ${reportStatus}`
  ];

  if (status === "closed") {
    statusLines.push(
      `*Closed Out By:* ${context.closedOutByUserId ? `<@${context.closedOutByUserId}>` : "Operator not recorded"}`
    );
  }

  if (status === "closed" && closeoutTimestamp) {
    statusLines.push(`*Closed Out At:* ${closeoutTimestamp}`);
  }

  const text =
    `*EOD Intake ${status === "closed" ? ":white_check_mark:" : ":thread:"}*\n` +
    `*Parent Inspection:* ${parentInspection}\n` +
    `${assetTask ? `*Asset:* ${assetTask}\n` : ""}` +
    `*Asset Type:* ${escapeSlackText(context.assetType)}\n` +
    `*Created by:* <@${context.requesterId}>`;

  return {
    text:
      status === "closed"
        ? `EOD intake closed out for ${context.parentEpicKey}.`
        : `EOD intake started for ${context.parentEpicKey}.`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text
        }
      },
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: statusLines.join("\n")
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
            value: JSON.stringify(context)
          },
          {
            type: "button" as const,
            action_id: CALLBACKS.eodCloseoutButton,
            text: {
              type: "plain_text" as const,
              text: status === "closed" ? "Reopen Thread" : "Mark Closed Out"
            },
            style: status === "closed" ? "danger" : "primary",
            value: JSON.stringify(context)
          }
        ]
      }
    ]
  };
}

async function updateEodThreadRootMessage(client: App["client"], context: EodThreadContext) {
  const message = buildEodThreadStartMessage(context);

  await client.chat.update({
    channel: context.channelId,
    ts: context.threadTs,
    text: message.text,
    blocks: message.blocks
  });
}

function buildSingleThreadEodAssetStatusLine(asset: SingleThreadEodAssetState): string {
  const assetTask = buildLinkedJiraLabel(
    asset.parentTaskKey,
    asset.parentTaskSummary.trim() || asset.parentTaskKey
  );
  const progressStatus =
    typeof asset.lastProgressValue === "number"
      ? usesTubeCountForEod(asset)
        ? typeof asset.totalTubeCount === "number"
          ? `\`${String(asset.lastProgressValue)}/${String(asset.totalTubeCount)}\` tubes scanned`
          : `\`${String(asset.lastProgressValue)}\` tubes scanned`
        : formatEodProgressCodeValue({ assetType: asset.assetType }, asset.lastProgressValue)
      : "Pending";
  const reportStatus = asset.reportIssueKey
    ? buildLinkedJiraLabel(asset.reportIssueKey, asset.reportIssueKey)
    : "Pending";

  return `• ${assetTask} | ${escapeSlackText(asset.assetType)} | ${progressStatus} | ${reportStatus}`;
}

function buildSingleThreadEodRootMessage(context: SingleThreadEodContext) {
  const parentInspection = buildLinkedJiraLabel(context.parentEpicKey, getParentInspectionLabel(context));
  const assetLines =
    context.assets.length > 0
      ? context.assets.map((asset) => buildSingleThreadEodAssetStatusLine(asset)).join("\n")
      : "_No asset reports submitted yet._";

  return {
    text: `[TEST] Single Thread EOD started for ${context.parentEpicKey}.`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text:
            "*[TEST] Single Thread EOD*\n" +
            `*Parent Inspection:* ${parentInspection}\n` +
            "Use this thread to file asset-level EOD reports for this parent inspection."
        }
      },
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text:
            "*Assets*\n" +
            "_Format: Asset | Asset Type | Latest Progress | Latest EOD Report_\n" +
            assetLines
        }
      },
      {
        type: "actions" as const,
        elements: [
          {
            type: "button" as const,
            action_id: CALLBACKS.singleThreadEodStartButton,
            text: {
              type: "plain_text" as const,
              text: "Generate EOD Report"
            },
            value: encodeSingleThreadEodContext(context)
          }
        ]
      }
    ]
  };
}

async function updateSingleThreadEodRootMessage(client: App["client"], context: SingleThreadEodContext) {
  const message = buildSingleThreadEodRootMessage(context);

  await client.chat.update({
    channel: context.channelId,
    ts: context.threadTs,
    text: message.text,
    blocks: message.blocks
  });
}

function buildDataOpsValidationThreadMessage(context: DataOpsValidationThreadContext) {
  const assetTask = buildLinkedJiraLabel(context.parentTaskKey, context.parentTaskSummary);
  const statusLabel = context.dataOps.closedOutAt ? "CLOSED" : context.dataOps.jiraIssueKey ? "IN REVIEW" : "Triage";
  const statusLines = [
    `*Slug:* ${escapeSlackText(context.dataOps.slug ?? "Pending")}`,
    `*% Captured:* ${context.dataOps.percentCaptured !== undefined ? `\`${formatPercentValue(context.dataOps.percentCaptured)}%\`` : "Pending"} | *% Uploaded:* ${context.dataOps.percentUploaded !== undefined ? `\`${formatPercentValue(context.dataOps.percentUploaded)}%\`` : "Pending"} | *% Validated:* ${context.dataOps.percentValidated !== undefined ? `\`${formatPercentValue(context.dataOps.percentValidated)}%\`` : "Pending"} | *% Prep:* ${context.dataOps.percentPrep !== undefined ? `\`${formatPercentValue(context.dataOps.percentPrep)}%\`` : "Pending"} | *% QA:* ${context.dataOps.percentQa !== undefined ? `\`${formatPercentValue(context.dataOps.percentQa)}%\`` : "Pending"}`,
    `*Status:* ${statusLabel}`
  ];

  return {
    text: `${context.parentTaskSummary} Data Ops Validation thread`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text:
            `*${escapeSlackText(context.parentTaskSummary)} Data Ops Validation Thread*\n` +
            `${assetTask} | ${escapeSlackText(context.assetType)}`
        }
      },
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: statusLines.join("\n")
        }
      },
      {
        type: "actions" as const,
        elements: [
          {
            type: "button" as const,
            action_id: CALLBACKS.dataOpsUpdateButton,
            text: {
              type: "plain_text" as const,
              text: "Update Progress"
            },
            value: encodeDataOpsValidationThreadContext(context)
          },
          {
            type: "button" as const,
            action_id: CALLBACKS.dataOpsCloseoutButton,
            text: {
              type: "plain_text" as const,
              text: context.dataOps.closedOutAt ? "Update Closeout" : "Close Out Thread"
            },
            style: "primary",
            value: encodeDataOpsValidationThreadContext(context)
          }
        ]
      }
    ]
  };
}

async function updateDataOpsValidationThreadRootMessage(
  client: App["client"],
  context: DataOpsValidationThreadContext
) {
  const message = buildDataOpsValidationThreadMessage(context);

  await client.chat.update({
    channel: context.channelId,
    ts: context.threadTs,
    text: message.text,
    blocks: message.blocks
  });
}

function upsertSingleThreadEodAssetState(
  context: SingleThreadEodContext,
  asset: SingleThreadEodAssetState
): SingleThreadEodContext {
  const existingAsset = context.assets.find((item) => item.parentTaskKey === asset.parentTaskKey);
  const remainingAssets = context.assets.filter((item) => item.parentTaskKey !== asset.parentTaskKey);

  return {
    ...context,
    assets: [
      {
        ...existingAsset,
        ...asset,
        dataOps: asset.dataOps ?? existingAsset?.dataOps
      },
      ...remainingAssets
    ]
  };
}

function syncDataOpsStateToSingleThreadContext(
  context: SingleThreadEodContext,
  parentTaskKey: string,
  dataOps: DataOpsValidationState
): SingleThreadEodContext {
  return {
    ...context,
    assets: context.assets.map((asset) =>
      asset.parentTaskKey === parentTaskKey
        ? {
            ...asset,
            dataOps
          }
        : asset
    )
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
  const progressFieldLabel = getEodProgressFieldLabel(input.context);
  const headerLines = [
    `*EOD Report Generated*`,
    `*EOD Report:* ${issueLink} - ${escapeSlackText(input.issueSummary)}`,
    `*Parent Inspection:* ${parentInspection}`,
    `*Asset Type:* ${escapeSlackText(input.context.assetType)}`,
    ...(usesTubeCountForEod(input.context) && typeof input.context.totalTubeCount === "number"
      ? [`*Total Tubes:* ${String(input.context.totalTubeCount)}`]
      : []),
    `*Submitted by:* <@${input.requesterId}>`,
    `*Date:* ${escapeSlackText(input.values.date)}`,
    `*JSA Submitted:* ${escapeSlackText(input.values.jsaSubmitted)}`,
    `*${progressFieldLabel}:* ${formatEodProgressCodeValue(input.context, input.values.numberOfScansCompleted)}`,
    `*Total Scanning Time (Hours):* ${String(input.values.totalScanningTimeHours)}`
  ];

  if (hasSeparateEodAssetTask(input.context)) {
    headerLines.splice(3, 0, `*Asset:* ${buildLinkedJiraLabel(input.context.parentTaskKey, getParentTaskLabel(input.context))}`);
  }

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

async function buildEodDataOperationsAlertMessage(input: {
  context: EodThreadContext;
  values: EodReportFormValues;
  resolveUserGroupMention: (identifiers: readonly string[]) => Promise<string | undefined>;
}) {
  if (!hasReachedDataOperationsAlertThreshold(input.context, input.values.numberOfScansCompleted)) {
    return undefined;
  }

  const dataOperationsMention = await input.resolveUserGroupMention(DATA_TEAM_USERGROUP_IDENTIFIERS);

  if (!dataOperationsMention) {
    return undefined;
  }

  const inspectionSummary = getParentInspectionSummary(input.context);
  const assetSummary = getParentTaskSummary(input.context);
  const asset = escapeSlackText(assetSummary);
  const inspection = escapeSlackText(inspectionSummary);
  const hasSeparateAsset = hasSeparateEodAssetTask(input.context);
  const isCoverageComplete = isEodScopeComplete(input.context, input.values.numberOfScansCompleted);
  const boilerCompletionPercent = getBoilerTubeCompletionPercent(input.context, input.values.numberOfScansCompleted);
  const header = isCoverageComplete
    ? ":rotating_light: *Inspection scope completed*"
    : ":rotating_light: *Inspection nearing completion*";
  const progressLine =
    typeof boilerCompletionPercent === "number" && typeof input.context.totalTubeCount === "number"
      ? `*Tube Progress:* \`${input.values.numberOfScansCompleted}/${input.context.totalTubeCount}\` tubes (\`${formatPercentValue(
          boilerCompletionPercent
        )}%\`)`
      : `*Coverage:* \`${input.values.numberOfScansCompleted}%\``;
  const body = isCoverageComplete
    ? hasSeparateAsset
      ? `${progressLine}\n${asset} for ${inspection} has completed inspection scope and should be available for review soon. ${dataOperationsMention}`
      : `${progressLine}\n${inspection} has completed inspection scope and should be available for review soon. ${dataOperationsMention}`
    : hasSeparateAsset
      ? `${progressLine}\n${asset} for ${inspection} is nearing completion. ${dataOperationsMention}`
      : `${progressLine}\n${inspection} is nearing completion. ${dataOperationsMention}`;

  return {
    text: isCoverageComplete
      ? hasSeparateAsset
        ? `${assetSummary} for ${inspectionSummary} has completed inspection scope.`
        : `${inspectionSummary} has completed inspection scope.`
      : hasSeparateAsset
        ? `${assetSummary} for ${inspectionSummary} is nearing completion.`
        : `${inspectionSummary} is nearing completion.`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: `${header}\n${body}`
        }
      }
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

async function syncAttachmentsForIssue(
  client: App["client"],
  input: {
    fileIds: string[];
    issueKey: string;
    slackChannelId: string;
    slackThreadTs?: string;
  },
  logger: Pick<Console, "warn">
) {
  if (input.fileIds.length === 0) {
    return {
      attempted: 0,
      downloadFailures: 0,
      jiraFailures: 0,
      slackFailures: 0
    };
  }

  const downloadResults = await Promise.allSettled(
    input.fileIds.map((fileId) => downloadSlackFile(client, fileId))
  );
  const files = downloadResults
    .filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof downloadSlackFile>>> =>
        result.status === "fulfilled"
    )
    .map((result) => result.value);
  const downloadFailures = downloadResults.length - files.length;
  let jiraFailures = 0;
  let slackFailures = 0;

  for (const result of downloadResults) {
    if (result.status === "rejected") {
      logger.warn(
        `Could not load a Slack attachment for issue ${input.issueKey}: ${
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        }`
      );
    }
  }

  for (const [index, file] of files.entries()) {
    const [jiraResult, slackResult] = await Promise.allSettled([
      uploadAttachmentToIssue({
        issueKey: input.issueKey,
        filename: file.filename,
        contentType: file.contentType,
        data: file.data
      }),
      shareSlackFile({
        client,
        file,
        channelId: input.slackChannelId,
        threadTs: input.slackThreadTs,
        initialComment:
          index === 0 ? `Attachments for ${input.issueKey}: ${buildJiraIssueUrl(input.issueKey)}` : undefined
      })
    ]);

    if (jiraResult.status === "rejected") {
      jiraFailures += 1;
      logger.warn(
        `Could not upload attachment ${file.filename} to Jira issue ${input.issueKey}: ${
          jiraResult.reason instanceof Error ? jiraResult.reason.message : String(jiraResult.reason)
        }`
      );
    }

    if (slackResult.status === "rejected") {
      slackFailures += 1;
      logger.warn(
        `Could not share attachment ${file.filename} in Slack for issue ${input.issueKey}: ${
          slackResult.reason instanceof Error ? slackResult.reason.message : String(slackResult.reason)
        }`
      );
    }
  }

  return {
    attempted: input.fileIds.length,
    downloadFailures,
    jiraFailures,
    slackFailures
  };
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
    threadTs: starter.ts,
    status: getEodThreadLifecycleStatus(context)
  };
  await updateEodThreadRootMessage(client, threadContext);

  return threadContext;
}

async function createSingleThreadEodRootThread(
  client: App["client"],
  context: Omit<SingleThreadEodContext, "threadTs" | "assets">
) {
  const starter = await client.chat.postMessage({
    channel: context.channelId,
    text: `[TEST] Single Thread EOD started for ${context.parentEpicKey}.`
  });

  if (!starter.ts) {
    throw new Error("Slack did not return a thread timestamp for the single-thread EOD intake.");
  }

  const threadContext: SingleThreadEodContext = {
    ...context,
    threadTs: starter.ts,
    assets: []
  };
  await updateSingleThreadEodRootMessage(client, threadContext);

  return threadContext;
}

async function createDataOpsValidationThread(
  client: App["client"],
  context: Omit<DataOpsValidationThreadContext, "threadTs">
) {
  const starter = await client.chat.postMessage({
    channel: context.channelId,
    text: `${context.parentTaskSummary} Data Ops Validation thread`
  });

  if (!starter.ts) {
    throw new Error("Slack did not return a thread timestamp for the Data Ops validation thread.");
  }

  const threadContext: DataOpsValidationThreadContext = {
    ...context,
    threadTs: starter.ts
  };
  await updateDataOpsValidationThreadRootMessage(client, threadContext);

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
  isSingleThreadEod: boolean;
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
    isSingleThreadEod: input.isSingleThreadEod,
    isEhsTask: input.isEhsTask
  });
}

function validateEodForm(
  values: ModalState | undefined,
  context: Pick<EodThreadContext, "assetType" | "totalTubeCount">
) {
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

  const progressFieldLabel = getEodProgressFieldLabel(context);
  const usesTubeCount = usesTubeCountForEod(context);

  if (!scansCompletedValue) {
    errors[CALLBACKS.eodScansCompletedBlock] = `${progressFieldLabel} is required.`;
  } else if (Number.isNaN(Number(scansCompletedValue))) {
    errors[CALLBACKS.eodScansCompletedBlock] = "Enter a valid number.";
  } else if (Number(scansCompletedValue) < 0 || (!usesTubeCount && Number(scansCompletedValue) > 100)) {
    errors[CALLBACKS.eodScansCompletedBlock] = usesTubeCount
      ? "Enter a number greater than or equal to 0."
      : "Enter a number from 0 to 100.";
  } else if (
    usesTubeCount &&
    typeof context.totalTubeCount === "number" &&
    Number(scansCompletedValue) > context.totalTubeCount
  ) {
    errors[CALLBACKS.eodScansCompletedBlock] = `Scanned tubes cannot exceed the total tube count of ${String(
      context.totalTubeCount
    )}.`;
  }

  if (!scanningTimeValue) {
    errors[CALLBACKS.eodScanningTimeBlock] = "Total Scanning Time is required.";
  } else if (Number.isNaN(Number(scanningTimeValue))) {
    errors[CALLBACKS.eodScanningTimeBlock] = "Enter a valid number.";
  } else if (Number(scanningTimeValue) < 0) {
    errors[CALLBACKS.eodScanningTimeBlock] = "Enter a number greater than or equal to 0.";
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

  app.action(CALLBACKS.eodAssetTypeAction, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("view" in body) || !body.view) {
      logger.error("EOD asset type action did not include a modal view.");
      return;
    }

    const workflowKey = getWorkflowKeyFromViewMetadata(body.view) ?? listWorkflows()[0].key;
    const workflow = getWorkflowByKey(workflowKey);
    const state = getModalStateValues(body.view.state.values);
    const selectedAssetType = parseEodAssetType(getSelectedOptionValue(body.actions[0]));
    const selectedIssueType = workflow.allowedIssueTypes.includes(state.selectedIssueType ?? "Bug")
      ? state.selectedIssueType
      : workflow.allowedIssueTypes[0];

    logger.info(
      `Attempting modal EOD asset type update for workflow ${workflow.key} to ${selectedAssetType ?? "n/a"} view=${body.view.id}`
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
              selectedIssueType,
              eodAssetType: selectedAssetType
            },
            {
              workflowKey: workflow.key,
              channelId: state.channelId ?? getChannelIdFromViewMetadata(body.view),
              requireChannelSelection: getRequireChannelSelectionFromViewMetadata(body.view)
            }
          )
        },
        logger,
        `Failed modal EOD asset type update for workflow ${workflow.key}`
      );
    } catch (error) {
      return;
    }

    logger.info(`Updated modal EOD asset type for workflow ${workflow.key} to ${selectedAssetType ?? "n/a"}`);
  });

  app.action(CALLBACKS.epicAction, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("view" in body) || !body.view) {
      logger.error("Epic selection action did not include a modal view.");
      return;
    }

    const workflowKey = getWorkflowKeyFromViewMetadata(body.view) ?? listWorkflows()[0].key;
    const workflow = getWorkflowByKey(workflowKey);

    if (!workflowRequiresSeparateEodAssetTask(workflow)) {
      logger.info(`Ignoring EOD task selection for workflow ${workflow.key} because no child asset task is required.`);
      return;
    }

    const state = getModalStateValues(body.view.state.values);
    const selectedParentEpicKey = getSelectedOptionValue(body.actions[0]);
    const selectedParentEpicLabel = getSelectedOptionLabel(body.actions[0]);
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
  app.action(CALLBACKS.singleThreadEodStartButton, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("trigger_id" in body)) {
      logger.error("Single-thread EOD start action did not include a trigger_id.");
      return;
    }

    if (!("actions" in body) || !Array.isArray(body.actions) || body.actions.length === 0) {
      logger.error("Single-thread EOD start action did not include any actions.");
      return;
    }

    const action = body.actions[0];
    const contextValue = action && "value" in action ? action.value : undefined;

    if (!contextValue) {
      logger.error("Single-thread EOD start action did not include thread context.");
      return;
    }

    const context = decodeSingleThreadEodContext(contextValue);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildSingleThreadEodReportModal(context)
    });

    logger.info(`Opened single-thread EOD intake modal for thread ${context.threadTs}`);
  });

  app.action(CALLBACKS.dataOpsUpdateButton, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("trigger_id" in body)) {
      logger.error("Data Ops update action did not include a trigger_id.");
      return;
    }

    if (!("actions" in body) || !Array.isArray(body.actions) || body.actions.length === 0) {
      logger.error("Data Ops update action did not include any actions.");
      return;
    }

    const action = body.actions[0];
    const contextValue = action && "value" in action ? action.value : undefined;

    if (!contextValue) {
      logger.error("Data Ops update action did not include thread context.");
      return;
    }

    const context = decodeDataOpsValidationThreadContext(contextValue);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildDataOpsProgressModal(context)
    });

    logger.info(`Opened Data Ops progress modal for thread ${context.threadTs}`);
  });

  app.action(CALLBACKS.dataOpsCloseoutButton, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("trigger_id" in body)) {
      logger.error("Data Ops closeout action did not include a trigger_id.");
      return;
    }

    if (!("actions" in body) || !Array.isArray(body.actions) || body.actions.length === 0) {
      logger.error("Data Ops closeout action did not include any actions.");
      return;
    }

    const action = body.actions[0];
    const contextValue = action && "value" in action ? action.value : undefined;

    if (!contextValue) {
      logger.error("Data Ops closeout action did not include thread context.");
      return;
    }

    const context = decodeDataOpsValidationThreadContext(contextValue);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildDataOpsCloseoutModal(context)
    });

    logger.info(`Opened Data Ops closeout modal for thread ${context.threadTs}`);
  });

  app.action(CALLBACKS.eodScansCompletedAction, async ({ ack, body, logger }) => {
    await ack();

    if (!("view" in body) || !body.view) {
      logger.error("EOD scans completed input action did not include a modal view.");
      return;
    }

    const action = body.actions[0];
    const actionValue = action && "value" in action ? action.value : undefined;
    const stateValue = getPlainTextValue(
      body.view.state.values,
      CALLBACKS.eodScansCompletedBlock,
      CALLBACKS.eodScansCompletedAction
    );
    const context = decodeEodContextForLogging(body.view.private_metadata);

    logger.info(
      `EOD scans completed input changed ${JSON.stringify({
        userId: body.user.id,
        workflowKey: context?.workflowKey,
        threadTs: context?.threadTs,
        assetType: context?.assetType,
        actionValue,
        stateValue,
        viewId: body.view.id
      })}`
    );
  });

  app.action(CALLBACKS.eodScanningTimeAction, async ({ ack, body, logger }) => {
    await ack();

    if (!("view" in body) || !body.view) {
      logger.error("EOD scanning time input action did not include a modal view.");
      return;
    }

    const action = body.actions[0];
    const actionValue = action && "value" in action ? action.value : undefined;
    const stateValue = getPlainTextValue(
      body.view.state.values,
      CALLBACKS.eodScanningTimeBlock,
      CALLBACKS.eodScanningTimeAction
    );
    const context = decodeEodContextForLogging(body.view.private_metadata);

    logger.info(
      `EOD scanning time input changed ${JSON.stringify({
        userId: body.user.id,
        workflowKey: context?.workflowKey,
        threadTs: context?.threadTs,
        assetType: context?.assetType,
        actionValue,
        stateValue,
        viewId: body.view.id
      })}`
    );
  });

  app.action(CALLBACKS.eodCloseoutButton, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("actions" in body) || !Array.isArray(body.actions) || body.actions.length === 0) {
      logger.error("EOD closeout action did not include any actions.");
      return;
    }

    const action = body.actions[0];
    const contextValue = action && "value" in action ? action.value : undefined;

    if (!contextValue) {
      logger.error("EOD closeout action did not include thread context.");
      return;
    }

    try {
      const context = decodeEodThreadContext(contextValue);
      const isClosed = getEodThreadLifecycleStatus(context) === "closed";
      const updatedContext: EodThreadContext = isClosed
        ? {
            ...context,
            status: "active",
            closedOutByUserId: undefined,
            closedOutAt: undefined
          }
        : {
            ...context,
            status: "closed",
            closedOutByUserId: body.user.id,
            closedOutAt: new Date().toISOString()
          };

      await updateEodThreadRootMessage(client, updatedContext);
      logger.info(
        `${isClosed ? "Reopened" : "Closed out"} EOD intake thread ${updatedContext.threadTs} for ${updatedContext.parentEpicKey}`
      );
    } catch (error) {
      logger.error(`Failed to toggle EOD thread closeout state. ${formatSlackApiErrorDetails(error)}`, error);
    }
  });

  app.options(CALLBACKS.epicAction, async ({ ack, body, logger }) => {
    try {
      const workflowKey = getSelectedWorkflowKeyFromSuggestion(body);
      const workflow = getWorkflowByKey(workflowKey);
      const query = (body.value ?? "").trim();

      logger.info(
        `Received parent issue lookup request for workflow ${workflow.key} with query="${query}" action=${body.action_id ?? "n/a"}`
      );

      const jql = buildParentSearchJql(workflow, query);
      const parentIssues = await searchParentIssues(workflow, query);

      await ack({
        options: parentIssues.map((issue) => ({
          ...buildIssueSelectOption(issue.key, issue.summary, query)
        }))
      });

      logger.info(`Returned ${parentIssues.length} parent issue options for workflow ${workflow.key} using JQL: ${jql}`);
    } catch (error) {
      logger.error(`Failed to load parent issue options for query "${body.value ?? ""}".`, error);
      await ack({ options: [] });
    }
  });

  app.options(CALLBACKS.eodTaskAction, async ({ ack, body, logger }) => {
    try {
      const workflowKey = getSelectedWorkflowKeyFromSuggestion(body);
      const workflow = getWorkflowByKey(workflowKey);
      if (!workflowRequiresSeparateEodAssetTask(workflow)) {
        await ack({ options: [] });
        return;
      }

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
          ...buildIssueSelectOption(task.key, task.summary, query)
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

  app.options(CALLBACKS.singleThreadEodTaskAction, async ({ ack, body, logger }) => {
    try {
      if (!body.view?.private_metadata) {
        await ack({ options: [] });
        return;
      }

      const context = decodeSingleThreadEodContext(body.view.private_metadata);
      const workflow = getWorkflowByKey(context.workflowKey);
      const query = (body.value ?? "").trim();
      const tasks = await searchChildTasks(workflow, context.parentEpicKey, query);

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
        `Returned ${tasks.length} single-thread child Task options for parent ${context.parentEpicKey} in workflow ${workflow.key}`
      );
    } catch (error) {
      logger.error(`Failed to load single-thread child Task options for query "${body.value ?? ""}".`, error);
      await ack({ options: [] });
    }
  });

  app.action(CALLBACKS.singleThreadEodTaskAction, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("view" in body) || !body.view?.private_metadata) {
      logger.error("Single-thread EOD task selection action did not include a modal view.");
      return;
    }

    let context: SingleThreadEodContext;

    try {
      context = decodeSingleThreadEodContext(body.view.private_metadata);
    } catch (error) {
      logger.error("Could not decode single-thread EOD context for task update.", error);
      return;
    }

    const state = getSingleThreadEodModalStateValues(body.view.state.values);
    const selectedTaskKey = getSelectedOptionValue(body.actions[0]);
    const selectedTaskLabel = getSelectedOptionLabel(body.actions[0]);
    const existingAsset = selectedTaskKey
      ? context.assets.find((asset) => asset.parentTaskKey === selectedTaskKey)
      : undefined;

    try {
      await updateModalView(
        client,
        {
          viewId: body.view.id,
          hash: body.view.hash,
          view: buildSingleThreadEodReportModal(context, {
            taskKey: selectedTaskKey,
            taskLabel: selectedTaskLabel,
            assetType: state.assetType ?? existingAsset?.assetType,
            totalTubeCount:
              state.totalTubeCount ??
              (existingAsset?.totalTubeCount ? String(existingAsset.totalTubeCount) : undefined)
          })
        },
        logger,
        `Failed single-thread EOD task update for thread ${context.threadTs}`
      );
    } catch {
      return;
    }

    logger.info(
      `Updated single-thread EOD task for thread ${context.threadTs} to ${selectedTaskKey ?? "n/a"}`
    );
  });

  app.action(CALLBACKS.singleThreadEodAssetTypeAction, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("view" in body) || !body.view?.private_metadata) {
      logger.error("Single-thread EOD asset type action did not include a modal view.");
      return;
    }

    let context: SingleThreadEodContext;

    try {
      context = decodeSingleThreadEodContext(body.view.private_metadata);
    } catch (error) {
      logger.error("Could not decode single-thread EOD context for asset type update.", error);
      return;
    }

    const state = getSingleThreadEodModalStateValues(body.view.state.values);
    const selectedAssetType = parseEodAssetType(getSelectedOptionValue(body.actions[0]));
    const existingAsset = state.taskKey ? context.assets.find((asset) => asset.parentTaskKey === state.taskKey) : undefined;

    try {
      await updateModalView(
        client,
        {
          viewId: body.view.id,
          hash: body.view.hash,
          view: buildSingleThreadEodReportModal(context, {
            ...state,
            assetType: selectedAssetType,
            totalTubeCount:
              selectedAssetType === "Boiler"
                ? state.totalTubeCount ??
                  (existingAsset?.totalTubeCount ? String(existingAsset.totalTubeCount) : undefined)
                : undefined
          })
        },
        logger,
        `Failed single-thread EOD asset type update for thread ${context.threadTs}`
      );
    } catch {
      return;
    }

    logger.info(
      `Updated single-thread EOD asset type for thread ${context.threadTs} to ${selectedAssetType ?? "n/a"}`
    );
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
    const selectedTaskLabel = getSelectedOptionLabel(body.actions[0]);
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
      getSelectedOptionLabel(values[CALLBACKS.epicBlock]?.[CALLBACKS.epicAction]);
    const parentEpicKey =
      values[CALLBACKS.epicBlock]?.[CALLBACKS.epicAction] &&
      "selected_option" in values[CALLBACKS.epicBlock][CALLBACKS.epicAction]
        ? values[CALLBACKS.epicBlock][CALLBACKS.epicAction].selected_option?.value
        : undefined;
    const parentTaskLabel =
      getSelectedOptionLabel(values[CALLBACKS.eodTaskBlock]?.[CALLBACKS.eodTaskAction]);
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
    const selectedTotalTubeCountValue =
      getPlainTextValue(values, CALLBACKS.eodTotalTubeCountBlock, CALLBACKS.eodTotalTubeCountAction) ?? "";
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
    const attachmentFileIds = getSelectedFileIds(
      values,
      CALLBACKS.bugAttachmentsBlock,
      CALLBACKS.bugAttachmentsAction
    );

    const selectedIssueType = issueTypeValue ? selectedIssueTypeFromValue(issueTypeValue) : undefined;
    const isThreadPerAssetEod = selectedIssueType ? shouldCollectEodInThread(selectedIssueType) : false;
    const isSingleThreadEod = selectedIssueType ? shouldUseSingleThreadEod(selectedIssueType) : false;
    const isEod = isThreadPerAssetEod || isSingleThreadEod;
    const isEhsTask = selectedIssueType ? usesEhsSpecificFields(workflow, selectedIssueType) : false;
    const requiresSeparateAssetTask = workflowRequiresSeparateEodAssetTask(workflow);
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
      isSingleThreadEod,
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
          ...(parentEpicKey
            ? {}
            : {
                [CALLBACKS.epicBlock]:
                  workflow.parentIssueType === "Task"
                    ? "Please choose a parent inspection."
                    : "Please choose a parent Epic."
              }),
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

    if (isThreadPerAssetEod && !selectedThreadAssetType) {
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

    if (isThreadPerAssetEod && requiresSeparateAssetTask && !parentTaskKey) {
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.eodTaskBlock]: "Please choose an asset task."
        }
      });
      return;
    }

    const requiresBoilerTubeCount = isEod && selectedThreadAssetType === "Boiler";

    if (requiresBoilerTubeCount) {
      const totalTubeCount = Number(selectedTotalTubeCountValue);

      if (!selectedTotalTubeCountValue) {
        await ack({
          response_action: "errors",
          errors: {
            [CALLBACKS.eodTotalTubeCountBlock]: "Please enter the total number of tubes for this boiler."
          }
        });
        return;
      }

      if (!Number.isInteger(totalTubeCount) || totalTubeCount <= 0) {
        await ack({
          response_action: "errors",
          errors: {
            [CALLBACKS.eodTotalTubeCountBlock]: "Enter a whole number greater than 0."
          }
        });
        return;
      }
    }

    if (requiresBugSpecificFields(workflow, selectedIssueType)) {
      const errors: Record<string, string> = {};
      const blockerTypeLabel =
        workflow.jiraProjectKey === "RB"
          ? "RUG Blocker Type"
          : workflow.jiraProjectKey === "UIM"
            ? "UAE Blocker Type"
            : "Blocker Type";

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
      if (isThreadPerAssetEod) {
        let selectedParentTaskKey: string | undefined;
        let resolvedParentTaskLabel: string | undefined;
        let parentTaskSummary: string | undefined;
        const jiraParentKey = await resolveJiraParentKeyForSelectedInspection({
          workflow,
          selectedInspectionKey: parentEpicKey
        });

        if (requiresSeparateAssetTask) {
          if (!parentTaskKey) {
            throw new Error("Asset task is required for EOD intake.");
          }

          selectedParentTaskKey = parentTaskKey;
          resolvedParentTaskLabel = parentTaskLabel;
          parentTaskSummary = await getIssueSummary(selectedParentTaskKey);
        }

        if (!requiresSeparateAssetTask && workflow.parentIssueType !== "Task") {
          throw new Error("Asset task is required for EOD intake.");
        }

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
          jiraParentKey,
          parentTaskKey: selectedParentTaskKey,
          parentTaskLabel: resolvedParentTaskLabel,
          parentTaskSummary,
          assetType: selectedThreadAssetType as EodAssetType,
          totalTubeCount: requiresBoilerTubeCount ? Number(selectedTotalTubeCountValue) : undefined,
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

      if (isSingleThreadEod) {
        logger.info(
          `Creating single-thread EOD intake root ${JSON.stringify({
            workflowKey: workflow.key,
            userId: body.user.id,
            parentEpicKey,
            channelId: getEodChannelId(channelId)
          })}`
        );
        const rootThreadContext = await createSingleThreadEodRootThread(client, {
          workflowKey: workflow.key,
          parentEpicKey,
          parentEpicLabel,
          channelId: getEodChannelId(channelId),
          enableDataOpsValidation: getModalStateValues(values).enableDataOpsValidation
        });

        await trySendDirectMessage(
          client,
          body.user.id,
          `Started [TEST] Single Thread EOD for ${parentEpicKey} in <#${rootThreadContext.channelId}>. Open the thread and click "Generate EOD Report" to file asset updates.`,
          undefined,
          logger
        );

        logger.info(
          `Started single-thread EOD intake root ${rootThreadContext.threadTs} for ${parentEpicKey}`
        );
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

      const jiraIssueType = selectedIssueType === "Task" ? "Task" : selectedIssueType === "Bug" ? "Bug" : "EOD Report";
      const issue = await createIssue({
        workflow,
        issueType: jiraIssueType,
        parentEpicKey,
        jiraParentKey: await resolveJiraParentKeyForSelectedInspection({
          workflow,
          selectedInspectionKey: parentEpicKey
        }),
        summary: issueSummary,
        details: issueDetails,
        descriptionContent,
        requesterName: body.user.id,
        blockerType: parseBlockerType(blockerTypeValue),
        opsDowntimeHours: downtimeValue ? Number(downtimeValue) : undefined
      });

      logger.info(`Created Jira issue ${issue.key}`);

      if (workflow.parentIssueType === "Task") {
        try {
          await linkIssuesByRelationship({
            issueKey: issue.key,
            relatedIssueKey: parentEpicKey,
            relationshipText: "Connects to"
          });
          logger.info(`Linked Jira issue ${issue.key} to inspection task ${parentEpicKey} as "Connects to".`);
        } catch (error) {
          logger.warn(
            `Could not link Jira issue ${issue.key} to inspection task ${parentEpicKey}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

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

      if (channelId && attachmentFileIds.length > 0) {
        try {
          const attachmentSync = await syncAttachmentsForIssue(
            client,
            {
              fileIds: attachmentFileIds,
              issueKey: issue.key,
              slackChannelId: channelId
            },
            logger
          );

          logger.info(
            `Synced attachments for Jira issue ${issue.key}: ${JSON.stringify({
              attempted: attachmentSync.attempted,
              downloadFailures: attachmentSync.downloadFailures,
              jiraFailures: attachmentSync.jiraFailures,
              slackFailures: attachmentSync.slackFailures
            })}`
          );

          if (
            attachmentSync.downloadFailures > 0 ||
            attachmentSync.jiraFailures > 0 ||
            attachmentSync.slackFailures > 0
          ) {
            await trySendDirectMessage(
              client,
              body.user.id,
              `Jira issue ${issue.key} was created, but ${String(
                attachmentSync.downloadFailures + attachmentSync.jiraFailures + attachmentSync.slackFailures
              )} attachment copy step(s) failed. Please review the Slack post and Jira ticket attachments.`,
              undefined,
              logger
            );
          }
        } catch (error) {
          logger.warn(
            `Unexpected attachment sync failure for Jira issue ${issue.key}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          await trySendDirectMessage(
            client,
            body.user.id,
            `Jira issue ${issue.key} was created, but the attachment sync did not finish. Please review the Slack post and Jira ticket attachments.`,
            undefined,
            logger
          );
        }
      }
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
    const attachmentFileIds = getSelectedFileIds(
      view.state.values,
      CALLBACKS.eodAttachmentsBlock,
      CALLBACKS.eodAttachmentsAction
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

    const validation = validateEodForm(view.state.values, context);

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
      const resolveSlackUserGroupMention = createSlackUserGroupMentionResolver(client, logger);
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
        jiraParentKey: context.jiraParentKey,
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

      const relatedInspectionIssueKey = context.parentTaskKey ?? (workflow.parentIssueType === "Task" ? context.parentEpicKey : undefined);

      if (relatedInspectionIssueKey) {
        try {
          await linkIssuesByRelationship({
            issueKey: issue.key,
            relatedIssueKey: relatedInspectionIssueKey,
            relationshipText: "Connects to"
          });
          logger.info(
            `Linked EOD Jira issue ${issue.key} to related inspection issue ${relatedInspectionIssueKey} as "Connects to".`
          );
        } catch (error) {
          logger.warn(
            `Could not link EOD Jira issue ${issue.key} to related inspection issue ${relatedInspectionIssueKey}: ${
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

      const updatedThreadContext: EodThreadContext = {
        ...context,
        reportIssueKey: issue.key,
        lastCoveragePercent: validation.values.numberOfScansCompleted
      };

      await updateEodThreadRootMessage(client, updatedThreadContext);

      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: context.threadTs,
        ...completionMessage
      });

      if (attachmentFileIds.length > 0) {
        try {
          const attachmentSync = await syncAttachmentsForIssue(
            client,
            {
              fileIds: attachmentFileIds,
              issueKey: issue.key,
              slackChannelId: context.channelId,
              slackThreadTs: context.threadTs
            },
            logger
          );

          logger.info(
            `Synced EOD attachments for Jira issue ${issue.key}: ${JSON.stringify({
              attempted: attachmentSync.attempted,
              downloadFailures: attachmentSync.downloadFailures,
              jiraFailures: attachmentSync.jiraFailures,
              slackFailures: attachmentSync.slackFailures
            })}`
          );

          if (
            attachmentSync.downloadFailures > 0 ||
            attachmentSync.jiraFailures > 0 ||
            attachmentSync.slackFailures > 0
          ) {
            await client.chat.postMessage({
              channel: context.channelId,
              thread_ts: context.threadTs,
              text:
                `Jira issue ${issue.key} was created, but ${String(
                  attachmentSync.downloadFailures + attachmentSync.jiraFailures + attachmentSync.slackFailures
                )} attachment copy step(s) failed. Please review the Slack thread and Jira ticket attachments.`
            });
          }
        } catch (error) {
          logger.warn(
            `Unexpected EOD attachment sync failure for Jira issue ${issue.key}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          await client.chat.postMessage({
            channel: context.channelId,
            thread_ts: context.threadTs,
            text:
              `Jira issue ${issue.key} was created, but the attachment sync did not finish. Please review the Slack thread and Jira ticket attachments.`
          });
        }
      }

      const dataOperationsAlert = await buildEodDataOperationsAlertMessage({
        context,
        values: validation.values,
        resolveUserGroupMention: resolveSlackUserGroupMention
      });

      if (
        hasReachedDataOperationsAlertThreshold(context, validation.values.numberOfScansCompleted) &&
        !dataOperationsAlert
      ) {
        logger.warn(
          `Skipping EOD data team alert for thread ${context.threadTs} because the data_team Slack user group could not be resolved.`
        );
      }

      if (dataOperationsAlert) {
        await client.chat.postMessage({
          channel: context.channelId,
          thread_ts: context.threadTs,
          ...dataOperationsAlert
        });
      }

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

  app.view(CALLBACKS.singleThreadEodReportView, async ({ ack, body, client, logger, view }) => {
    let context: SingleThreadEodContext;
    const fullDayOverviewValue = getRichTextValue(
      view.state.values,
      CALLBACKS.eodFullDayOverviewBlock,
      CALLBACKS.eodFullDayOverviewAction
    );
    const attachmentFileIds = getSelectedFileIds(
      view.state.values,
      CALLBACKS.eodAttachmentsBlock,
      CALLBACKS.eodAttachmentsAction
    );
    const parentTaskLabel =
      view.state.values[CALLBACKS.singleThreadEodTaskBlock]?.[CALLBACKS.singleThreadEodTaskAction] &&
      "selected_option" in view.state.values[CALLBACKS.singleThreadEodTaskBlock][CALLBACKS.singleThreadEodTaskAction]
        ? view.state.values[CALLBACKS.singleThreadEodTaskBlock][CALLBACKS.singleThreadEodTaskAction].selected_option
            ?.text?.text
        : undefined;
    const parentTaskKey =
      view.state.values[CALLBACKS.singleThreadEodTaskBlock]?.[CALLBACKS.singleThreadEodTaskAction] &&
      "selected_option" in view.state.values[CALLBACKS.singleThreadEodTaskBlock][CALLBACKS.singleThreadEodTaskAction]
        ? view.state.values[CALLBACKS.singleThreadEodTaskBlock][CALLBACKS.singleThreadEodTaskAction].selected_option
            ?.value
        : undefined;
    const assetType = parseEodAssetType(
      getSelectedOptionValue(
        view.state.values[CALLBACKS.singleThreadEodAssetTypeBlock]?.[CALLBACKS.singleThreadEodAssetTypeAction]
      )
    );
    const selectedTotalTubeCountValue =
      getPlainTextValue(view.state.values, CALLBACKS.eodTotalTubeCountBlock, CALLBACKS.eodTotalTubeCountAction) ?? "";

    try {
      context = decodeSingleThreadEodContext(view.private_metadata);
    } catch (error) {
      logger.error(error);
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.singleThreadEodTaskBlock]:
            "Could not load the thread context. Please start the single-thread EOD intake again."
        }
      });
      return;
    }

    const fieldErrors: Record<string, string> = {};

    if (!parentTaskKey) {
      fieldErrors[CALLBACKS.singleThreadEodTaskBlock] = "Please choose an asset task.";
    }

    if (!assetType) {
      fieldErrors[CALLBACKS.singleThreadEodAssetTypeBlock] = "Please choose an asset type.";
    }

    const requiresBoilerTubeCount = assetType === "Boiler";

    if (requiresBoilerTubeCount) {
      const totalTubeCount = Number(selectedTotalTubeCountValue);

      if (!selectedTotalTubeCountValue) {
        fieldErrors[CALLBACKS.eodTotalTubeCountBlock] =
          "Please enter the total number of tubes for this boiler.";
      } else if (!Number.isInteger(totalTubeCount) || totalTubeCount <= 0) {
        fieldErrors[CALLBACKS.eodTotalTubeCountBlock] = "Enter a whole number greater than 0.";
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      await ack({
        response_action: "errors",
        errors: fieldErrors
      });
      return;
    }

    const selectedParentTaskKey = parentTaskKey as string;
    const selectedAssetType = assetType as EodAssetType;
    const selectedTotalTubeCount =
      requiresBoilerTubeCount && Number.isInteger(Number(selectedTotalTubeCountValue))
        ? Number(selectedTotalTubeCountValue)
        : undefined;
    const validation = validateEodForm(view.state.values, {
      assetType: selectedAssetType,
      totalTubeCount: selectedTotalTubeCount
    });

    if (!validation.success) {
      logger.info(
        `Rejecting single-thread EOD report submission for validation errors ${JSON.stringify({
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
      `Accepted single-thread EOD report submission ${JSON.stringify({
        workflowKey: context.workflowKey,
        userId: body.user.id,
        threadTs: context.threadTs,
        channelId: context.channelId,
        parentEpicKey: context.parentEpicKey,
        parentTaskKey: selectedParentTaskKey
      })}`
    );

    try {
      const workflow = getWorkflowByKey(context.workflowKey);
      const parentTaskSummary = await getIssueSummary(selectedParentTaskKey);
      const existingAsset = context.assets.find((asset) => asset.parentTaskKey === selectedParentTaskKey);
      const assetContext: EodThreadContext = {
        workflowKey: context.workflowKey,
        parentEpicKey: context.parentEpicKey,
        parentEpicLabel: context.parentEpicLabel,
        parentTaskKey: selectedParentTaskKey,
        parentTaskLabel,
        parentTaskSummary,
        assetType: selectedAssetType,
        totalTubeCount: selectedTotalTubeCount,
        requesterId: body.user.id,
        channelId: context.channelId,
        threadTs: context.threadTs
      };
      const summary = buildEodReportSummary(assetContext, validation.values);
      const details = formatEodReportDetails(assetContext, validation.values);
      const resolveSlackUserMention = createSlackToJiraMentionResolver(client, logger);
      const resolveSlackUserGroupMention = createSlackUserGroupMentionResolver(client, logger);
      const resolvedFullDayOverviewContent = await richTextToResolvedJiraDocNodes(fullDayOverviewValue, {
        resolveUserMention: resolveSlackUserMention
      });
      const requesterContent = [await resolveSlackUserMention(body.user.id)];

      logger.info(
        `Creating single-thread EOD Jira issue ${JSON.stringify({
          workflowKey: workflow.key,
          jiraProjectKey: workflow.jiraProjectKey,
          userId: body.user.id,
          threadTs: context.threadTs,
          parentEpicKey: context.parentEpicKey,
          parentTaskKey: selectedParentTaskKey,
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
        descriptionContent: buildEodDescriptionContent(assetContext, {
          ...validation.values,
          fullDayOverviewContent:
            resolvedFullDayOverviewContent.length > 0
              ? resolvedFullDayOverviewContent
              : validation.values.fullDayOverviewContent
        }),
        requesterContent,
        requesterName: body.user.id
      });

      try {
        await linkIssuesByRelationship({
          issueKey: issue.key,
          relatedIssueKey: selectedParentTaskKey,
          relationshipText: "Connects to"
        });
        logger.info(
          `Linked single-thread EOD Jira issue ${issue.key} to asset task ${selectedParentTaskKey}.`
        );
      } catch (error) {
        logger.warn(
          `Could not link single-thread EOD Jira issue ${issue.key} to asset task ${selectedParentTaskKey}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      const updatedRootContext = upsertSingleThreadEodAssetState(context, {
        parentTaskKey: selectedParentTaskKey,
        parentTaskSummary,
        assetType: selectedAssetType,
        lastProgressValue: validation.values.numberOfScansCompleted,
        totalTubeCount: selectedTotalTubeCount,
        reportIssueKey: issue.key,
        dataOps: existingAsset?.dataOps
      });

      await updateSingleThreadEodRootMessage(client, updatedRootContext);

      if (context.enableDataOpsValidation && !existingAsset?.dataOps?.threadTs) {
        const dataOpsThreadContext = await createDataOpsValidationThread(client, {
          workflowKey: context.workflowKey,
          parentEpicKey: context.parentEpicKey,
          parentEpicLabel: context.parentEpicLabel,
          channelId: context.channelId,
          sourceThreadTs: context.threadTs,
          parentTaskKey: selectedParentTaskKey,
          parentTaskLabel,
          parentTaskSummary,
          assetType: selectedAssetType,
          reportIssueKey: issue.key,
          dataOps: {}
        });

        const rootContextWithDataOps = syncDataOpsStateToSingleThreadContext(updatedRootContext, selectedParentTaskKey, {
          threadTs: dataOpsThreadContext.threadTs
        });

        await updateSingleThreadEodRootMessage(client, rootContextWithDataOps);
        await client.chat.postMessage({
          channel: context.channelId,
          thread_ts: context.threadTs,
          text:
            `Started a Data Ops validation thread for ${parentTaskSummary}. ` +
            "Open the new channel thread to track validation progress."
        });
      }

      const completionMessage = buildEodCompletionMessage({
        issueKey: issue.key,
        issueSummary: summary,
        requesterId: body.user.id,
        context: assetContext,
        values: validation.values
      });

      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: context.threadTs,
        ...completionMessage
      });

      if (attachmentFileIds.length > 0) {
        try {
          const attachmentSync = await syncAttachmentsForIssue(
            client,
            {
              fileIds: attachmentFileIds,
              issueKey: issue.key,
              slackChannelId: context.channelId,
              slackThreadTs: context.threadTs
            },
            logger
          );

          logger.info(
            `Synced single-thread EOD attachments for Jira issue ${issue.key}: ${JSON.stringify({
              attempted: attachmentSync.attempted,
              downloadFailures: attachmentSync.downloadFailures,
              jiraFailures: attachmentSync.jiraFailures,
              slackFailures: attachmentSync.slackFailures
            })}`
          );

          if (
            attachmentSync.downloadFailures > 0 ||
            attachmentSync.jiraFailures > 0 ||
            attachmentSync.slackFailures > 0
          ) {
            await client.chat.postMessage({
              channel: context.channelId,
              thread_ts: context.threadTs,
              text:
                `Jira issue ${issue.key} was created, but ${String(
                  attachmentSync.downloadFailures + attachmentSync.jiraFailures + attachmentSync.slackFailures
                )} attachment copy step(s) failed. Please review the Slack thread and Jira ticket attachments.`
            });
          }
        } catch (error) {
          logger.warn(
            `Unexpected single-thread EOD attachment sync failure for Jira issue ${issue.key}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          await client.chat.postMessage({
            channel: context.channelId,
            thread_ts: context.threadTs,
            text:
              `Jira issue ${issue.key} was created, but the attachment sync did not finish. Please review the Slack thread and Jira ticket attachments.`
          });
        }
      }

      const dataOperationsAlert = await buildEodDataOperationsAlertMessage({
        context: assetContext,
        values: validation.values,
        resolveUserGroupMention: resolveSlackUserGroupMention
      });

      if (validation.values.numberOfScansCompleted >= 80 && !dataOperationsAlert) {
        logger.warn(
          `Skipping single-thread EOD data operations alert for thread ${context.threadTs} because the data operations Slack user group could not be resolved.`
        );
      }

      if (dataOperationsAlert) {
        await client.chat.postMessage({
          channel: context.channelId,
          thread_ts: context.threadTs,
          ...dataOperationsAlert
        });
      }

      await trySendDirectMessage(
        client,
        body.user.id,
        `Created Jira issue ${issue.key} in project ${workflow.jiraProjectKey}.`,
        undefined,
        logger
      );

      logger.info(`Created single-thread EOD Jira issue ${issue.key} for thread ${context.threadTs}`);
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

  app.view(CALLBACKS.dataOpsProgressView, async ({ ack, body, client, logger, view }) => {
    let context: DataOpsValidationThreadContext;

    try {
      context = decodeDataOpsValidationThreadContext(view.private_metadata);
    } catch (error) {
      logger.error(error);
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.dataOpsSlugBlock]: "Could not load the Data Ops thread context. Please try again."
        }
      });
      return;
    }

    const validation = validateDataOpsProgressForm(view.state.values);

    if (!validation.success) {
      await ack({
        response_action: "errors",
        errors: validation.errors
      });
      return;
    }

    await ack();

    try {
      const workflow = getWorkflowByKey(context.workflowKey);
      const updatedContext: DataOpsValidationThreadContext = {
        ...context,
        dataOps: {
          ...context.dataOps,
          slug: validation.values.slug,
          ownerSlackUserId: validation.values.ownerSlackUserId,
          percentCaptured: validation.values.percentCaptured,
          percentUploaded: validation.values.percentUploaded,
          percentValidated: validation.values.percentValidated,
          percentPrep: validation.values.percentPrep,
          percentQa: validation.values.percentQa
        }
      };
      const ownerContent = [await createSlackToJiraMentionResolver(client, logger)(validation.values.ownerSlackUserId)];
      const summary = buildDataOpsIssueSummary(updatedContext);
      const details = formatDataOpsIssueDetails(updatedContext, validation.values);

      if (!updatedContext.dataOps.jiraIssueKey) {
        const issue = await createIssue({
          workflow,
          issueType: "Data Ops",
          parentEpicKey: updatedContext.parentEpicKey,
          summary,
          details,
          descriptionContent: buildDataOpsDescriptionContent(updatedContext, validation.values, ownerContent),
          requesterContent: [await createSlackToJiraMentionResolver(client, logger)(body.user.id)],
          requesterName: body.user.id
        });

        updatedContext.dataOps.jiraIssueKey = issue.key;

        try {
          await linkIssuesByRelationship({
            issueKey: issue.key,
            relatedIssueKey: updatedContext.parentTaskKey,
            relationshipText: "Connects to"
          });
        } catch (error) {
          logger.warn(
            `Could not link Data Ops Jira issue ${issue.key} to asset task ${updatedContext.parentTaskKey}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }

        await trySendDirectMessage(
          client,
          body.user.id,
          `Created Jira issue ${issue.key} in project ${workflow.jiraProjectKey}.`,
          undefined,
          logger
        );
      } else {
        await updateIssue({
          issueKey: updatedContext.dataOps.jiraIssueKey,
          summary,
          details,
          descriptionContent: buildDataOpsDescriptionContent(updatedContext, validation.values, ownerContent)
        });
      }

      await updateDataOpsValidationThreadRootMessage(client, updatedContext);
      await client.chat.postMessage({
        channel: updatedContext.channelId,
        thread_ts: updatedContext.threadTs,
        text:
          `${updatedContext.dataOps.jiraIssueKey ? `Saved progress to ${updatedContext.dataOps.jiraIssueKey}.` : "Saved progress."}`
      });
    } catch (error) {
      logger.error(error);
      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: context.threadTs,
        text: `Could not save Data Ops progress: ${formatJiraErrorMessage(error)}`
      });
    }
  });

  app.view(CALLBACKS.dataOpsCloseoutView, async ({ ack, body, client, logger, view }) => {
    let context: DataOpsValidationThreadContext;

    try {
      context = decodeDataOpsValidationThreadContext(view.private_metadata);
    } catch (error) {
      logger.error(error);
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.dataOpsQualityBlock]: "Could not load the Data Ops thread context. Please try again."
        }
      });
      return;
    }

    const validation = validateDataOpsCloseoutForm(view.state.values);

    if (!validation.success) {
      await ack({
        response_action: "errors",
        errors: validation.errors
      });
      return;
    }

    await ack();

    try {
      const closedOutAt = new Date().toISOString();
      const updatedContext = applyDataOpsCloseoutToContext(
        context,
        validation.values,
        body.user.id,
        closedOutAt
      );

      if (updatedContext.dataOps.jiraIssueKey) {
        const progressValues = getStoredDataOpsProgressValues(updatedContext);

        if (progressValues) {
          const ownerContent = updatedContext.dataOps.ownerSlackUserId
            ? [await createSlackToJiraMentionResolver(client, logger)(updatedContext.dataOps.ownerSlackUserId)]
            : undefined;
          await updateIssue({
            issueKey: updatedContext.dataOps.jiraIssueKey,
            summary: buildDataOpsIssueSummary(updatedContext),
            details: formatDataOpsIssueDetails(updatedContext, progressValues),
            descriptionContent: buildDataOpsDescriptionContent(updatedContext, progressValues, ownerContent)
          });
        }
      }

      await updateDataOpsValidationThreadRootMessage(client, updatedContext);
      await client.chat.postMessage({
        channel: updatedContext.channelId,
        thread_ts: updatedContext.threadTs,
        text:
          updatedContext.dataOps.jiraIssueKey
            ? `Closed out the Data Ops validation thread and updated ${updatedContext.dataOps.jiraIssueKey}.`
            : "Closed out the Data Ops validation thread."
      });
    } catch (error) {
      logger.error(error);
      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: context.threadTs,
        text: `Could not close out the Data Ops thread: ${formatJiraErrorMessage(error)}`
      });
    }
  });
}
