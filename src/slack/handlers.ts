import type { App, BlockAction, BlockSuggestion, ViewSubmitAction } from "@slack/bolt";
import { getWorkflowByKey, listWorkflows } from "../config/workflows.js";
import { env } from "../config/env.js";
import {
  getEhsCheckboxActionId,
  getEhsCheckboxBlockId,
  getEhsCheckboxInputKeys,
  getEhsTextActionId,
  getEhsTextBlockId,
  getEhsTextInputKeys,
  type EhsModalStateValues
} from "../ehs/form.js";
import { createIssue } from "../jira/createIssue.js";
import { buildEpicSearchJql, searchEpics } from "../jira/searchEpics.js";
import type {
  BlockerType,
  EodAssetType,
  EodCoverageUnit,
  EhsFormValues,
  EodReportFormValues,
  EodStatus,
  EodThreadContext,
  EodYesNo
} from "../types/workflow.js";
import { CALLBACKS } from "./constants.js";
import {
  buildEodReportSummary,
  buildCreateIssueModal,
  buildEodReportModal,
  decodeEodThreadContext,
  formatEodReportDetails,
  formatEhsDetails,
  type ModalMetadata,
  requiresBugSpecificFields,
  selectedIssueTypeFromValue,
  shouldCollectEodInThread,
  usesEhsSpecificFields
} from "./modal.js";

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

function parseBlockerType(value?: string): BlockerType | undefined {
  return value === "Customer" ||
    value === "Operations" ||
    value === "Environmental" ||
    value === "Other"
    ? value
    : undefined;
}

function parseEodAssetType(value?: string): EodAssetType | undefined {
  return value === "Building" ||
    value === "Conveyor" ||
    value === "Crusher" ||
    value === "Stockpile" ||
    value === "Tank" ||
    value === "Other"
    ? value
    : undefined;
}

function parseEodYesNo(value?: string): EodYesNo | undefined {
  return value === "Yes" || value === "No" ? value : undefined;
}

function parseEodCoverageUnit(value?: string): EodCoverageUnit | undefined {
  return value === "ft^2" || value === "m^2" ? value : undefined;
}

function parseEodStatus(value?: string): EodStatus | undefined {
  return value === "Not Started" ||
    value === "In Progress" ||
    value === "Complete" ||
    value === "Blocked"
    ? value
    : undefined;
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
  const blockerTypeValue = getSelectedOptionValue(
    stateValues?.[CALLBACKS.blockerTypeBlock]?.[CALLBACKS.blockerTypeAction]
  );

  return {
    selectedIssueType: getSelectedIssueTypeFromState(stateValues),
    parentEpicKey:
      parentEpicSelection && "selected_option" in parentEpicSelection
        ? parentEpicSelection.selected_option?.value ?? undefined
        : undefined,
    parentEpicLabel:
      parentEpicSelection && "selected_option" in parentEpicSelection
        ? parentEpicSelection.selected_option?.text?.text ?? undefined
        : undefined,
    summary: getPlainTextValue(stateValues, CALLBACKS.summaryBlock, CALLBACKS.summaryAction),
    details: getPlainTextValue(stateValues, CALLBACKS.detailsBlock, CALLBACKS.detailsAction),
    blockerType: parseBlockerType(blockerTypeValue),
    opsDowntimeHours: getPlainTextValue(stateValues, CALLBACKS.downtimeBlock, CALLBACKS.downtimeAction),
    ehs: getEhsModalStateValues(stateValues)
  };
}

function formatJiraErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Could not create Jira issue.";
  }

  return error.message.replace(/^Jira request failed \(\d+\):\s*/, "");
}

function escapeSlackText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function buildJiraIssueUrl(issueKey: string): string {
  return new URL(`/browse/${issueKey}`, env.JIRA_BASE_URL).toString();
}

function buildLinkedJiraLabel(issueKey: string, label?: string): string {
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

function buildEodThreadStartMessage(context: EodThreadContext) {
  const parentInspection = buildLinkedJiraLabel(context.parentEpicKey, getParentInspectionLabel(context));
  const text =
    `*EOD Intake :thread:*\n` +
    `*Parent Inspection:* ${parentInspection}\n` +
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
              text: "Complete EOD Intake"
            },
            style: "primary" as const,
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
  const lines = [
    `*Complete EOD Intake*`,
    `*EOD Report:* ${issueLink} - ${escapeSlackText(input.issueSummary)}`,
    `*Parent Inspection:* ${parentInspection}`,
    `*Submitted by:* <@${input.requesterId}>`,
    `*Date:* ${escapeSlackText(input.values.date)}`,
    `*Asset Type:* ${escapeSlackText(input.values.assetType)}`,
    `*Asset Number:* ${escapeSlackText(input.values.assetNumber)}`,
    `*Crew On-Site:* ${escapeSlackText(input.values.crewOnSite)}`,
    `*JSA Submitted:* ${escapeSlackText(input.values.jsaSubmitted)}`,
    `*Permit Approved:* ${escapeSlackText(input.values.permitApproved)}`,
    `*Calibration Completed:* ${escapeSlackText(input.values.calibrationCompleted)}`,
    `*Number of Scans Completed:* ${String(input.values.numberOfScansCompleted)}`,
    `*Total Scanning Time (Hours):* ${String(input.values.totalScanningTimeHours)}`,
    `*Scanning Area Coverage:* ${String(input.values.scanningAreaCoverage)}`,
    `*Covered Area Units:* ${escapeSlackText(input.values.coveredAreaUnits)}`,
    `*Data Upload Status:* ${escapeSlackText(input.values.dataUploadStatus)}`,
    `*Data Validation Status:* ${escapeSlackText(input.values.dataValidationStatus)}`,
    `*Report Status:* ${escapeSlackText(input.values.reportStatus)}`,
    `*Crew Off-Site:* ${escapeSlackText(input.values.crewOffSite)}`
  ];

  if (input.values.notes?.trim()) {
    lines.push(`*Notes:* ${escapeSlackText(input.values.notes.trim())}`);
  }

  return {
    text: `Complete EOD Intake submitted: ${input.issueKey} for ${input.context.parentEpicKey}.`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: lines.join("\n")
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
  const resolvedChannelId = channelId ?? env.SLACK_EOD_CHANNEL_ID ?? env.SLACK_TEST_CHANNEL_ID;

  if (!resolvedChannelId) {
    throw new Error(
      "A source channel, SLACK_EOD_CHANNEL_ID, or SLACK_TEST_CHANNEL_ID must be configured for EOD intake threads."
    );
  }

  return resolvedChannelId;
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

function validateEodForm(values: ModalState | undefined) {
  const errors: Record<string, string> = {};
  const date = getDateValue(values, CALLBACKS.eodDateBlock, CALLBACKS.eodDateAction);
  const assetType = parseEodAssetType(
    getSelectedOptionValue(values?.[CALLBACKS.eodAssetTypeBlock]?.[CALLBACKS.eodAssetTypeAction])
  );
  const assetNumber = getPlainTextValue(values, CALLBACKS.eodAssetNumberBlock, CALLBACKS.eodAssetNumberAction);
  const crewOnSite = getPlainTextValue(values, CALLBACKS.eodCrewOnSiteBlock, CALLBACKS.eodCrewOnSiteAction);
  const jsaSubmitted = parseEodYesNo(
    getSelectedOptionValue(values?.[CALLBACKS.eodJsaSubmittedBlock]?.[CALLBACKS.eodJsaSubmittedAction])
  );
  const permitApproved = getPlainTextValue(
    values,
    CALLBACKS.eodPermitApprovedBlock,
    CALLBACKS.eodPermitApprovedAction
  );
  const calibrationCompleted = getPlainTextValue(
    values,
    CALLBACKS.eodCalibrationCompletedBlock,
    CALLBACKS.eodCalibrationCompletedAction
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
  const coverageValue = getPlainTextValue(values, CALLBACKS.eodCoverageBlock, CALLBACKS.eodCoverageAction);
  const coveredAreaUnits = parseEodCoverageUnit(
    getSelectedOptionValue(values?.[CALLBACKS.eodCoverageUnitsBlock]?.[CALLBACKS.eodCoverageUnitsAction])
  );
  const dataUploadStatus = parseEodStatus(
    getSelectedOptionValue(values?.[CALLBACKS.eodUploadStatusBlock]?.[CALLBACKS.eodUploadStatusAction])
  );
  const dataValidationStatus = parseEodStatus(
    getSelectedOptionValue(
      values?.[CALLBACKS.eodValidationStatusBlock]?.[CALLBACKS.eodValidationStatusAction]
    )
  );
  const reportStatus = parseEodStatus(
    getSelectedOptionValue(values?.[CALLBACKS.eodReportStatusBlock]?.[CALLBACKS.eodReportStatusAction])
  );
  const crewOffSite = getPlainTextValue(values, CALLBACKS.eodCrewOffSiteBlock, CALLBACKS.eodCrewOffSiteAction);
  const notes = getPlainTextValue(values, CALLBACKS.eodNotesBlock, CALLBACKS.eodNotesAction);

  if (!date) {
    errors[CALLBACKS.eodDateBlock] = "Date is required.";
  }

  if (!assetType) {
    errors[CALLBACKS.eodAssetTypeBlock] = "Choose an asset type.";
  }

  if (!assetNumber) {
    errors[CALLBACKS.eodAssetNumberBlock] = "Asset number is required.";
  }

  if (!crewOnSite) {
    errors[CALLBACKS.eodCrewOnSiteBlock] = "Crew On-Site is required.";
  }

  if (!jsaSubmitted) {
    errors[CALLBACKS.eodJsaSubmittedBlock] = "Choose whether JSA was submitted.";
  }

  if (!permitApproved) {
    errors[CALLBACKS.eodPermitApprovedBlock] = "Permit Approved is required.";
  }

  if (!calibrationCompleted) {
    errors[CALLBACKS.eodCalibrationCompletedBlock] = "Calibration Completed is required.";
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

  if (!coverageValue) {
    errors[CALLBACKS.eodCoverageBlock] = "Scanning Area Coverage is required.";
  } else if (Number.isNaN(Number(coverageValue))) {
    errors[CALLBACKS.eodCoverageBlock] = "Enter a valid number.";
  }

  if (!coveredAreaUnits) {
    errors[CALLBACKS.eodCoverageUnitsBlock] = "Choose area units.";
  }

  if (!dataUploadStatus) {
    errors[CALLBACKS.eodUploadStatusBlock] = "Choose data upload status.";
  }

  if (!dataValidationStatus) {
    errors[CALLBACKS.eodValidationStatusBlock] = "Choose data validation status.";
  }

  if (!reportStatus) {
    errors[CALLBACKS.eodReportStatusBlock] = "Choose report status.";
  }

  if (!crewOffSite) {
    errors[CALLBACKS.eodCrewOffSiteBlock] = "Crew Off-Site is required.";
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
      assetType: assetType as EodAssetType,
      assetNumber: assetNumber as string,
      crewOnSite: crewOnSite as string,
      jsaSubmitted: jsaSubmitted as EodYesNo,
      permitApproved: permitApproved as string,
      calibrationCompleted: calibrationCompleted as string,
      numberOfScansCompleted: Number(scansCompletedValue),
      totalScanningTimeHours: Number(scanningTimeValue),
      scanningAreaCoverage: Number(coverageValue),
      coveredAreaUnits: coveredAreaUnits as EodCoverageUnit,
      dataUploadStatus: dataUploadStatus as EodStatus,
      dataValidationStatus: dataValidationStatus as EodStatus,
      reportStatus: reportStatus as EodStatus,
      crewOffSite: crewOffSite as string,
      notes: notes?.trim() || undefined
    } satisfies EodReportFormValues
  };
}

function validateEhsForm(values: ModalState | undefined) {
  const errors: Record<string, string> = {};
  const taskSummary = getPlainTextValue(
    values,
    getEhsTextBlockId("taskSummary"),
    getEhsTextActionId("taskSummary")
  );
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
  const normalizedTaskSummary = taskSummary?.trim();

  if (!normalizedTaskSummary) {
    errors[getEhsTextBlockId("taskSummary")] = "Task Summary is required.";
  }

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
    summary: normalizedTaskSummary as string,
    values: {
      drugTesting: trim(ehsState.drugTesting),
      backgroundChecks: trim(ehsState.backgroundChecks),
      forms: trim(ehsState.forms),
      idRequirements: ehsState.idRequirements ?? [],
      idOther: trim(ehsState.idOther),
      trainingSiteSpecific: trim(ehsState.trainingSiteSpecific),
      trainingOther1: trim(ehsState.trainingOther1),
      trainingOther2: trim(ehsState.trainingOther2),
      trainingOther3: trim(ehsState.trainingOther3),
      ppeRequirements: ehsState.ppeRequirements ?? [],
      fourGasRequirements: ehsState.fourGasRequirements ?? [],
      fourGasOther: trim(ehsState.fourGasOther),
      fiveGasRequirements: ehsState.fiveGasRequirements ?? [],
      fiveGasOther: trim(ehsState.fiveGasOther),
      generalRequirements: trim(ehsState.generalRequirements),
      vehicles: trim(ehsState.vehicles),
      loto: trim(ehsState.loto),
      confinedSpace: trim(ehsState.confinedSpace),
      hazardAssessment: trim(ehsState.hazardAssessment),
      geckoJsa: trim(ehsState.geckoJsa),
      submitTo: trim(ehsState.submitTo),
      customerProvidedJsa: trim(ehsState.customerProvidedJsa),
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
    await openCreateIssueModal(client, body.trigger_id, logger, `Opened modal for user ${body.user.id}`);
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
      "channel" in body ? body.channel?.id : undefined
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
      await client.views.update({
        view_id: body.view.id,
        hash: body.view.hash,
        view: buildCreateIssueModal(
          workflow,
          {
            ...state,
            selectedIssueType: nextSelectedIssueType
          },
          {
            workflowKey: workflow.key,
            channelId: getChannelIdFromViewMetadata(body.view)
          }
        )
      });
    } catch (error) {
      logger.error(`Failed modal workflow update for workflow ${workflow.key}.`, error);
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
    const selectedIssueType = selectedIssueTypeFromValue(selectedIssueTypeValue ?? "Bug");

    logger.info(
      `Attempting modal issue type update for workflow ${workflow.key} to ${selectedIssueType} view=${body.view.id}`
    );

    try {
      await client.views.update({
        view_id: body.view.id,
        hash: body.view.hash,
        view: buildCreateIssueModal(
          workflow,
          {
            ...state,
            selectedIssueType
          },
          {
            workflowKey: workflow.key,
            channelId: getChannelIdFromViewMetadata(body.view)
          }
        )
      });
    } catch (error) {
      logger.error(
        `Failed modal issue type update for workflow ${workflow.key} to ${selectedIssueType}.`,
        error
      );
      return;
    }

    logger.info(`Updated modal issue type for workflow ${workflow.key} to ${selectedIssueType}`);
  });

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

  app.view(CALLBACKS.createIssueView, async ({ ack, body, client, logger, view }) => {
    const workflowKey =
      getWorkflowKeyFromViewMetadata(view) ?? getSelectedWorkflowKeyFromState(view.state.values);
    const channelId = getChannelIdFromViewMetadata(view);
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
    const issueTypeValue =
      values[CALLBACKS.issueTypeBlock]?.[CALLBACKS.issueTypeAction] &&
      "selected_option" in values[CALLBACKS.issueTypeBlock][CALLBACKS.issueTypeAction]
        ? values[CALLBACKS.issueTypeBlock][CALLBACKS.issueTypeAction].selected_option?.value
        : undefined;
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

    if (!parentEpicKey || !issueTypeValue || (!isEod && !isEhsTask && !summary)) {
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
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.issueTypeBlock]: "Please choose an issue type."
        }
      });
      return;
    }

    if (!isEod && !isEhsTask && !details) {
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.detailsBlock]: "Details are required."
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
        await ack({
          response_action: "errors",
          errors
        });
        return;
      }
    }

    const ehsValidation = isEhsTask ? validateEhsForm(values) : undefined;

    if (ehsValidation && !ehsValidation.success) {
      await ack({
        response_action: "errors",
        errors: ehsValidation.errors
      });
      return;
    }

    await ack();

    try {
      if (isEod) {
        const threadContext = await createEodThread(client, {
          workflowKey: workflow.key,
          parentEpicKey,
          parentEpicLabel,
          requesterId: body.user.id,
          channelId: getEodChannelId(channelId)
        });

        await trySendDirectMessage(
          client,
          body.user.id,
          `Started EOD intake thread for ${parentEpicKey} in <#${threadContext.channelId}>. Open the thread and click "Complete EOD Intake" to finish the Jira issue.`,
          undefined,
          logger
        );

        logger.info(`Started EOD intake thread ${threadContext.threadTs} for ${parentEpicKey}`);
        return;
      }

      let issueSummary = summary ?? "";
      let issueDetails = details ?? "";

      if (ehsValidation?.success) {
        issueSummary = ehsValidation.summary;
        issueDetails = formatEhsDetails(ehsValidation.values);
      }

      const issue = await createIssue({
        workflow,
        issueType: selectedIssueType,
        parentEpicKey,
        summary: issueSummary,
        details: issueDetails,
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
      await ack({
        response_action: "errors",
        errors: validation.errors
      });
      return;
    }

    await ack();

    try {
      const workflow = getWorkflowByKey(context.workflowKey);
      const summary = buildEodReportSummary(validation.values);
      const details = formatEodReportDetails(validation.values);
      const issue = await createIssue({
        workflow,
        issueType: "EOD Report",
        parentEpicKey: context.parentEpicKey,
        summary,
        details,
        requesterName: body.user.id
      });
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
