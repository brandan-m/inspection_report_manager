import type { App, BlockSuggestion, ViewSubmitAction } from "@slack/bolt";
import { getWorkflowByKey, listWorkflows } from "../config/workflows.js";
import { env } from "../config/env.js";
import { createIssue } from "../jira/createIssue.js";
import { searchEpics } from "../jira/searchEpics.js";
import type {
  BlockerType,
  EodAssetType,
  EodCoverageUnit,
  EodReportFormValues,
  EodStatus,
  EodThreadContext,
  EodYesNo
} from "../types/workflow.js";
import { CALLBACKS } from "./constants.js";
import {
  buildCreateIssueModal,
  buildEodReportModal,
  buildEodThreadStartBlocks,
  decodeEodThreadContext,
  formatEodReportDetails,
  requiresReportingBugFields,
  selectedIssueTypeFromValue,
  shouldCollectEodInThread
} from "./modal.js";

type ModalState = ViewSubmitAction["view"]["state"]["values"];

function getWorkflowKeyFromViewMetadata(view?: { private_metadata?: string }): string | undefined {
  return view?.private_metadata || undefined;
}

function getSelectedOptionValue(
  stateValues: ModalState | undefined,
  blockId: string,
  actionId: string
): string | undefined {
  const action = stateValues?.[blockId]?.[actionId];

  if (action && "selected_option" in action) {
    return action.selected_option?.value;
  }

  return undefined;
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

function getSelectedWorkflowKeyFromState(stateValues?: ModalState): string {
  return getSelectedOptionValue(stateValues, CALLBACKS.workflowBlock, CALLBACKS.workflowAction) ?? listWorkflows()[0].key;
}

function getSelectedWorkflowKeyFromSuggestion(body: BlockSuggestion): string {
  const metadataWorkflowKey = getWorkflowKeyFromViewMetadata(body.view);

  if (metadataWorkflowKey) {
    return metadataWorkflowKey;
  }

  return (
    getSelectedOptionValue(body.view?.state.values, CALLBACKS.workflowBlock, CALLBACKS.workflowAction) ??
    listWorkflows()[0].key
  );
}

function getSelectedIssueTypeFromState(stateValues?: ModalState) {
  return selectedIssueTypeFromValue(
    getSelectedOptionValue(stateValues, CALLBACKS.issueTypeBlock, CALLBACKS.issueTypeAction) ?? "Bug"
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
  return value === "sq ft" || value === "sq m" || value === "acres" || value === "hectares"
    ? value
    : undefined;
}

function parseEodStatus(value?: string): EodStatus | undefined {
  return value === "Not Started" ||
    value === "In Progress" ||
    value === "Complete" ||
    value === "Blocked"
    ? value
    : undefined;
}

function getModalStateValues(stateValues?: ModalState) {
  return {
    selectedIssueType: getSelectedIssueTypeFromState(stateValues),
    summary: getPlainTextValue(stateValues, CALLBACKS.summaryBlock, CALLBACKS.summaryAction),
    details: getPlainTextValue(stateValues, CALLBACKS.detailsBlock, CALLBACKS.detailsAction),
    blockerType: parseBlockerType(
      getSelectedOptionValue(stateValues, CALLBACKS.blockerTypeBlock, CALLBACKS.blockerTypeAction)
    ),
    opsDowntimeHours: getPlainTextValue(stateValues, CALLBACKS.downtimeBlock, CALLBACKS.downtimeAction)
  };
}

function formatJiraErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Could not create Jira issue.";
  }

  return error.message.replace(/^Jira request failed \(\d+\):\s*/, "");
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
            "*Gecko Reporting Workflow*\nCreate Jira reporting issues from Slack for the configured workflow."
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

function getEodChannelId(): string {
  const channelId = env.SLACK_EOD_CHANNEL_ID ?? env.SLACK_TEST_CHANNEL_ID;

  if (!channelId) {
    throw new Error("SLACK_EOD_CHANNEL_ID or SLACK_TEST_CHANNEL_ID must be configured for EOD intake threads.");
  }

  return channelId;
}

async function sendDirectMessage(client: App["client"], userId: string, text: string) {
  const conversation = await client.conversations.open({
    users: userId
  });

  if (!conversation.channel?.id) {
    throw new Error(`Could not open a DM conversation for user ${userId}.`);
  }

  await client.chat.postMessage({
    channel: conversation.channel.id,
    text
  });
}

async function trySendDirectMessage(
  client: App["client"],
  userId: string,
  text: string,
  logger: Pick<Console, "warn">
) {
  try {
    await sendDirectMessage(client, userId, text);
  } catch (error) {
    logger.warn("Could not send DM confirmation.", error);
  }
}

async function createEodThread(
  client: App["client"],
  context: Omit<EodThreadContext, "threadTs">
) {
  const starterText = `EOD intake started for ${context.parentEpicKey}: ${context.summary}`;
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

  await client.chat.update({
    channel: context.channelId,
    ts: starter.ts,
    text: starterText,
    blocks: buildEodThreadStartBlocks(threadContext)
  });

  return threadContext;
}

function validateEodForm(values: ModalState | undefined) {
  const errors: Record<string, string> = {};
  const date = getDateValue(values, CALLBACKS.eodDateBlock, CALLBACKS.eodDateAction);
  const assetType = parseEodAssetType(
    getSelectedOptionValue(values, CALLBACKS.eodAssetTypeBlock, CALLBACKS.eodAssetTypeAction)
  );
  const assetNumber = getPlainTextValue(values, CALLBACKS.eodAssetNumberBlock, CALLBACKS.eodAssetNumberAction);
  const crewOnSite = getPlainTextValue(values, CALLBACKS.eodCrewOnSiteBlock, CALLBACKS.eodCrewOnSiteAction);
  const jsaSubmitted = parseEodYesNo(
    getSelectedOptionValue(values, CALLBACKS.eodJsaSubmittedBlock, CALLBACKS.eodJsaSubmittedAction)
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
    getSelectedOptionValue(values, CALLBACKS.eodCoverageUnitsBlock, CALLBACKS.eodCoverageUnitsAction)
  );
  const dataUploadStatus = parseEodStatus(
    getSelectedOptionValue(values, CALLBACKS.eodUploadStatusBlock, CALLBACKS.eodUploadStatusAction)
  );
  const dataValidationStatus = parseEodStatus(
    getSelectedOptionValue(values, CALLBACKS.eodValidationStatusBlock, CALLBACKS.eodValidationStatusAction)
  );
  const reportStatus = parseEodStatus(
    getSelectedOptionValue(values, CALLBACKS.eodReportStatusBlock, CALLBACKS.eodReportStatusAction)
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

export function registerSlackHandlers(app: App): void {
  app.event("app_home_opened", async ({ event, client, logger }) => {
    await client.views.publish({
      user_id: event.user,
      view: buildHomeView()
    });

    logger.info(`Published App Home for user ${event.user}`);
  });

  app.shortcut(CALLBACKS.globalShortcut, async ({ ack, body, client, logger }) => {
    await ack();

    const defaultWorkflow = listWorkflows()[0];

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildCreateIssueModal(defaultWorkflow)
    });

    logger.info(`Opened modal for user ${body.user.id}`);
  });

  app.action(CALLBACKS.homeOpenButton, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("trigger_id" in body)) {
      logger.error("Home button interaction did not include a trigger_id.");
      return;
    }

    const defaultWorkflow = listWorkflows()[0];

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildCreateIssueModal(defaultWorkflow)
    });

    logger.info(`Opened modal from App Home for user ${body.user.id}`);
  });

  app.action(CALLBACKS.workflowAction, async ({ ack, body, client, logger }) => {
    await ack();

    if (!("view" in body) || !body.view) {
      logger.error("Workflow selection action did not include a modal view.");
      return;
    }

    const selectedWorkflowKey =
      body.actions[0] && "selected_option" in body.actions[0]
        ? body.actions[0].selected_option?.value
        : undefined;

    if (!selectedWorkflowKey) {
      logger.error("Workflow selection action did not include a selected workflow.");
      return;
    }

    const workflow = getWorkflowByKey(selectedWorkflowKey);

    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      view: buildCreateIssueModal(workflow, getModalStateValues(body.view.state.values))
    });

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

    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      view: buildCreateIssueModal(workflow, getModalStateValues(body.view.state.values))
    });

    logger.info(`Updated modal issue type for workflow ${workflow.key}`);
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
    const workflowKey = getSelectedWorkflowKeyFromSuggestion(body);
    const workflow = getWorkflowByKey(workflowKey);
    const query = body.value ?? "";
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

    logger.info(`Returned ${epics.length} Epic options for workflow ${workflow.key}`);
  });

  app.view(CALLBACKS.createIssueView, async ({ ack, body, client, logger, view }) => {
    const workflowKey =
      getWorkflowKeyFromViewMetadata(view) ?? getSelectedWorkflowKeyFromState(view.state.values);
    const workflow = getWorkflowByKey(workflowKey);
    const parentEpicKey = getSelectedOptionValue(view.state.values, CALLBACKS.epicBlock, CALLBACKS.epicAction);
    const issueTypeValue = getSelectedOptionValue(
      view.state.values,
      CALLBACKS.issueTypeBlock,
      CALLBACKS.issueTypeAction
    );
    const summary = getPlainTextValue(view.state.values, CALLBACKS.summaryBlock, CALLBACKS.summaryAction) ?? "";
    const blockerTypeValue = getSelectedOptionValue(
      view.state.values,
      CALLBACKS.blockerTypeBlock,
      CALLBACKS.blockerTypeAction
    );
    const downtimeValue =
      getPlainTextValue(view.state.values, CALLBACKS.downtimeBlock, CALLBACKS.downtimeAction) ?? "";
    const details = getPlainTextValue(view.state.values, CALLBACKS.detailsBlock, CALLBACKS.detailsAction) ?? "";

    if (!parentEpicKey || !issueTypeValue || !summary) {
      await ack({
        response_action: "errors",
        errors: {
          ...(parentEpicKey ? {} : { [CALLBACKS.epicBlock]: "Please choose a parent Epic." }),
          ...(issueTypeValue ? {} : { [CALLBACKS.issueTypeBlock]: "Please choose an issue type." }),
          ...(summary ? {} : { [CALLBACKS.summaryBlock]: "Summary is required." })
        }
      });
      return;
    }

    const selectedIssueType = selectedIssueTypeFromValue(issueTypeValue);

    if (!shouldCollectEodInThread(selectedIssueType) && !details) {
      await ack({
        response_action: "errors",
        errors: {
          [CALLBACKS.detailsBlock]: "Details are required."
        }
      });
      return;
    }

    if (requiresReportingBugFields(workflow, selectedIssueType)) {
      const errors: Record<string, string> = {};

      if (!blockerTypeValue) {
        errors[CALLBACKS.blockerTypeBlock] = "Choose a RUG Blocker Type.";
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

    await ack();

    try {
      if (shouldCollectEodInThread(selectedIssueType)) {
        const channelId = getEodChannelId();
        const threadContext = await createEodThread(client, {
          workflowKey: workflow.key,
          parentEpicKey,
          summary,
          requesterId: body.user.id,
          channelId
        });

        await trySendDirectMessage(
          client,
          body.user.id,
          `Started EOD intake thread for ${parentEpicKey} in <#${threadContext.channelId}>. Open the thread and click "Complete EOD Intake" to finish the Jira issue.`,
          logger
        );

        logger.info(`Started EOD intake thread ${threadContext.threadTs} for ${parentEpicKey}`);
        return;
      }

      const issue = await createIssue({
        workflow,
        issueType: selectedIssueType,
        parentEpicKey,
        summary,
        details,
        requesterName: body.user.id,
        blockerType: parseBlockerType(blockerTypeValue),
        opsDowntimeHours: downtimeValue ? Number(downtimeValue) : undefined
      });

      if (env.SLACK_TEST_CHANNEL_ID) {
        await client.chat.postMessage({
          channel: env.SLACK_TEST_CHANNEL_ID,
          text: `Created Jira issue ${issue.key} in ${workflow.label} under Epic ${parentEpicKey}.`
        });
      }

      await trySendDirectMessage(
        client,
        body.user.id,
        `Created Jira issue ${issue.key} in project ${workflow.jiraProjectKey}.`,
        logger
      );

      logger.info(`Created Jira issue ${issue.key}`);
    } catch (error) {
      logger.error(error);
      await trySendDirectMessage(
        client,
        body.user.id,
        `Could not continue the workflow: ${formatJiraErrorMessage(error)}`,
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
      const details = formatEodReportDetails(validation.values);
      const issue = await createIssue({
        workflow,
        issueType: "EOD Report",
        parentEpicKey: context.parentEpicKey,
        summary: context.summary,
        details,
        requesterName: body.user.id
      });

      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: context.threadTs,
        text: `Created Jira issue ${issue.key} for ${context.parentEpicKey}.`
      });

      await trySendDirectMessage(
        client,
        body.user.id,
        `Created Jira issue ${issue.key} in project ${workflow.jiraProjectKey}.`,
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
        logger
      );
    }
  });
}
