import type { KnownBlock, PlainTextOption } from "@slack/bolt";
import { listWorkflows } from "../config/workflows.js";
import type { SupportedIssueType, WorkflowDefinition } from "../types/workflow.js";
import { CALLBACKS } from "./constants.js";

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

export function buildCreateIssueModal(defaultWorkflow: WorkflowDefinition) {
  const blocks: KnownBlock[] = [
    {
      type: "input",
      block_id: CALLBACKS.workflowBlock,
      element: {
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
      },
      label: {
        type: "plain_text",
        text: "Workflow"
      }
    },
    {
      type: "input",
      block_id: CALLBACKS.epicBlock,
      element: {
        type: "external_select",
        action_id: CALLBACKS.epicAction,
        min_query_length: 0,
        placeholder: {
          type: "plain_text",
          text: "Search Jira Epics"
        }
      },
      label: {
        type: "plain_text",
        text: "Parent Epic"
      }
    },
    {
      type: "input",
      block_id: CALLBACKS.issueTypeBlock,
      element: {
        type: "static_select",
        action_id: CALLBACKS.issueTypeAction,
        initial_option: {
          text: {
            type: "plain_text",
            text: defaultWorkflow.allowedIssueTypes[0]
          },
          value: defaultWorkflow.allowedIssueTypes[0]
        },
        options: issueTypeOptions(defaultWorkflow)
      },
      label: {
        type: "plain_text",
        text: "Issue Type"
      }
    },
    {
      type: "input",
      block_id: CALLBACKS.summaryBlock,
      element: {
        type: "plain_text_input",
        action_id: CALLBACKS.summaryAction,
        placeholder: {
          type: "plain_text",
          text: "Short issue summary"
        }
      },
      label: {
        type: "plain_text",
        text: "Summary"
      }
    },
    {
      type: "input",
      block_id: CALLBACKS.detailsBlock,
      element: {
        type: "plain_text_input",
        action_id: CALLBACKS.detailsAction,
        multiline: true,
        placeholder: {
          type: "plain_text",
          text: "Add details for the Jira issue"
        }
      },
      label: {
        type: "plain_text",
        text: "Details"
      }
    }
  ];

  return {
    type: "modal" as const,
    callback_id: CALLBACKS.createIssueView,
    title: {
      type: "plain_text" as const,
      text: "Create Gecko Report"
    },
    submit: {
      type: "plain_text" as const,
      text: "Create"
    },
    close: {
      type: "plain_text" as const,
      text: "Cancel"
    },
    blocks
  };
}

export function selectedIssueTypeFromValue(value: string): Exclude<SupportedIssueType, "Epic"> {
  if (value !== "Bug" && value !== "EOD Report") {
    throw new Error(`Unsupported issue type: ${value}`);
  }

  return value;
}
