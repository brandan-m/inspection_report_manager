import type { App, BlockAction, BlockSuggestion, ViewSubmitAction } from "@slack/bolt";
import { getWorkflowByKey, listWorkflows } from "../config/workflows.js";
import { env } from "../config/env.js";
import { createIssue } from "../jira/createIssue.js";
import { searchEpics } from "../jira/searchEpics.js";
import { CALLBACKS } from "./constants.js";
import { buildCreateIssueModal, selectedIssueTypeFromValue } from "./modal.js";

function getSelectedWorkflowKeyFromState(
  stateValues?: ViewSubmitAction["view"]["state"]["values"]
): string {
  const selected = stateValues?.[CALLBACKS.workflowBlock]?.[CALLBACKS.workflowAction] as
    | { selected_option?: { value?: string } }
    | undefined;

  return selected?.selected_option?.value ?? listWorkflows()[0].key;
}

function getSelectedWorkflowKeyFromSuggestion(body: BlockSuggestion): string {
  const selected = body.view?.state.values?.[CALLBACKS.workflowBlock]?.[CALLBACKS.workflowAction] as
    | { selected_option?: { value?: string } }
    | undefined;

  return selected?.selected_option?.value ?? listWorkflows()[0].key;
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

  app.action(CALLBACKS.workflowAction, async ({ ack }) => {
    await ack();
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
    await ack();

    const workflowKey = getSelectedWorkflowKeyFromState(view.state.values);
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
    const details =
      values[CALLBACKS.detailsBlock]?.[CALLBACKS.detailsAction] &&
      "value" in values[CALLBACKS.detailsBlock][CALLBACKS.detailsAction]
        ? values[CALLBACKS.detailsBlock][CALLBACKS.detailsAction].value
        : "";

    if (!parentEpicKey || !issueTypeValue || !summary || !details) {
      logger.error("Required modal fields were missing.");
      return;
    }

    const issue = await createIssue({
      workflow,
      issueType: selectedIssueTypeFromValue(issueTypeValue),
      parentEpicKey,
      summary,
      details,
      requesterName: body.user.id
    });

    if (env.SLACK_TEST_CHANNEL_ID) {
      await client.chat.postMessage({
        channel: env.SLACK_TEST_CHANNEL_ID,
        text: `Created Jira issue ${issue.key} in ${workflow.label} under Epic ${parentEpicKey}.`
      });
    }

    await client.chat.postMessage({
      channel: body.user.id,
      text: `Created Jira issue ${issue.key} in project ${workflow.jiraProjectKey}.`
    });

    logger.info(`Created Jira issue ${issue.key}`);
  });
}
