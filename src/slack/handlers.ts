import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { getWorkflowByKey, listWorkflows } from "../config/workflows.js";
import { env } from "../config/env.js";
import { createIssue } from "../jira/createIssue.js";
import { searchEpics } from "../jira/searchEpics.js";
import { CALLBACKS } from "./constants.js";
import { buildCreateIssueModal, selectedIssueTypeFromValue } from "./modal.js";

function getSelectedWorkflowKey(payload: BlockAction | ViewSubmitAction): string {
  const selected =
    payload.view?.state.values?.[CALLBACKS.workflowBlock]?.[CALLBACKS.workflowAction] as
      | { selected_option?: { value?: string } }
      | undefined;

  return selected?.selected_option?.value ?? listWorkflows()[0].key;
}

export function registerSlackHandlers(app: App): void {
  app.shortcut(CALLBACKS.globalShortcut, async ({ ack, body, client, logger }) => {
    await ack();

    const defaultWorkflow = listWorkflows()[0];

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildCreateIssueModal(defaultWorkflow)
    });

    logger.info(`Opened modal for user ${body.user.id}`);
  });

  app.action(CALLBACKS.workflowAction, async ({ ack }) => {
    await ack();
  });

  app.options(CALLBACKS.epicAction, async ({ ack, body, logger }) => {
    const workflowKey = getSelectedWorkflowKey(body);
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

    const workflowKey = getSelectedWorkflowKey(body);
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
