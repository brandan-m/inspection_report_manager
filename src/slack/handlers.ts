import type { App, BlockAction, BlockSuggestion, ViewSubmitAction } from "@slack/bolt";
import { getWorkflowByKey, listWorkflows } from "../config/workflows.js";
import { env } from "../config/env.js";
import { createIssue } from "../jira/createIssue.js";
import { searchEpics } from "../jira/searchEpics.js";
import type { BlockerType } from "../types/workflow.js";
import { CALLBACKS } from "./constants.js";
import {
  buildCreateIssueModal,
  requiresReportingBugFields,
  selectedIssueTypeFromValue
} from "./modal.js";

function getWorkflowKeyFromViewMetadata(view?: { private_metadata?: string }): string | undefined {
  return view?.private_metadata || undefined;
}

function getSelectedWorkflowKeyFromState(
  stateValues?: ViewSubmitAction["view"]["state"]["values"]
): string {
  const selected = stateValues?.[CALLBACKS.workflowBlock]?.[CALLBACKS.workflowAction] as
    | { selected_option?: { value?: string } }
    | undefined;

  return selected?.selected_option?.value ?? listWorkflows()[0].key;
}

function getSelectedWorkflowKeyFromSuggestion(body: BlockSuggestion): string {
  const metadataWorkflowKey = getWorkflowKeyFromViewMetadata(body.view);

  if (metadataWorkflowKey) {
    return metadataWorkflowKey;
  }

  const selected = body.view?.state.values?.[CALLBACKS.workflowBlock]?.[CALLBACKS.workflowAction] as
    | { selected_option?: { value?: string } }
    | undefined;

  return selected?.selected_option?.value ?? listWorkflows()[0].key;
}

function getSelectedIssueTypeFromState(
  stateValues?: ViewSubmitAction["view"]["state"]["values"]
): Exclude<"Bug" | "EOD Report" | "Epic", "Epic"> {
  const selected = stateValues?.[CALLBACKS.issueTypeBlock]?.[CALLBACKS.issueTypeAction] as
    | { selected_option?: { value?: string } }
    | undefined;

  return selectedIssueTypeFromValue(selected?.selected_option?.value ?? "Bug");
}

function getModalStateValues(stateValues?: ViewSubmitAction["view"]["state"]["values"]) {
  const blockerTypeValue =
    stateValues?.[CALLBACKS.blockerTypeBlock]?.[CALLBACKS.blockerTypeAction] &&
    "selected_option" in stateValues[CALLBACKS.blockerTypeBlock][CALLBACKS.blockerTypeAction]
      ? stateValues[CALLBACKS.blockerTypeBlock][CALLBACKS.blockerTypeAction].selected_option?.value
      : undefined;

  const blockerType: BlockerType | undefined =
    blockerTypeValue === "Customer" ||
    blockerTypeValue === "Operations" ||
    blockerTypeValue === "Environmental" ||
    blockerTypeValue === "Other"
      ? blockerTypeValue
      : undefined;

  return {
    selectedIssueType: getSelectedIssueTypeFromState(stateValues),
    summary:
      stateValues?.[CALLBACKS.summaryBlock]?.[CALLBACKS.summaryAction] &&
      "value" in stateValues[CALLBACKS.summaryBlock][CALLBACKS.summaryAction]
        ? stateValues[CALLBACKS.summaryBlock][CALLBACKS.summaryAction].value ?? undefined
        : undefined,
    details:
      stateValues?.[CALLBACKS.detailsBlock]?.[CALLBACKS.detailsAction] &&
      "value" in stateValues[CALLBACKS.detailsBlock][CALLBACKS.detailsAction]
        ? stateValues[CALLBACKS.detailsBlock][CALLBACKS.detailsAction].value ?? undefined
        : undefined,
    blockerType,
    opsDowntimeHours:
      stateValues?.[CALLBACKS.downtimeBlock]?.[CALLBACKS.downtimeAction] &&
      "value" in stateValues[CALLBACKS.downtimeBlock][CALLBACKS.downtimeAction]
        ? stateValues[CALLBACKS.downtimeBlock][CALLBACKS.downtimeAction].value ?? undefined
        : undefined
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
    const values = view.state.values;
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
      values[CALLBACKS.downtimeBlock]?.[CALLBACKS.downtimeAction] &&
      "value" in values[CALLBACKS.downtimeBlock][CALLBACKS.downtimeAction]
        ? values[CALLBACKS.downtimeBlock][CALLBACKS.downtimeAction].value
        : "";
    const details =
      values[CALLBACKS.detailsBlock]?.[CALLBACKS.detailsAction] &&
      "value" in values[CALLBACKS.detailsBlock][CALLBACKS.detailsAction]
        ? values[CALLBACKS.detailsBlock][CALLBACKS.detailsAction].value
        : "";

    if (!parentEpicKey || !issueTypeValue || !summary || !details) {
      await ack({
        response_action: "errors",
        errors: {
          ...(parentEpicKey ? {} : { [CALLBACKS.epicBlock]: "Please choose a parent Epic." }),
          ...(issueTypeValue ? {} : { [CALLBACKS.issueTypeBlock]: "Please choose an issue type." }),
          ...(summary ? {} : { [CALLBACKS.summaryBlock]: "Summary is required." }),
          ...(details ? {} : { [CALLBACKS.detailsBlock]: "Details are required." })
        }
      });
      return;
    }

    const selectedIssueType = selectedIssueTypeFromValue(issueTypeValue);
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
      const issue = await createIssue({
        workflow,
        issueType: selectedIssueType,
        parentEpicKey,
        summary,
        details,
        requesterName: body.user.id,
        blockerType:
          blockerTypeValue === "Customer" ||
          blockerTypeValue === "Operations" ||
          blockerTypeValue === "Environmental" ||
          blockerTypeValue === "Other"
            ? blockerTypeValue
            : undefined,
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
        `Could not create Jira issue: ${formatJiraErrorMessage(error)}`,
        logger
      );
    }
  });
}
