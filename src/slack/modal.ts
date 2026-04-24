import type { KnownBlock, PlainTextOption } from "@slack/types";
import { listWorkflows } from "../config/workflows.js";
import type { BlockerType, SelectableIssueType, SupportedIssueType, WorkflowDefinition } from "../types/workflow.js";
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

function blockerTypeOptions(): PlainTextOption[] {
  return ["Customer", "Operations", "Environmental", "Other"].map((value) => ({
    text: {
      type: "plain_text",
      text: value
    },
    value
  }));
}

export interface ModalStateValues {
  selectedIssueType?: SelectableIssueType;
  summary?: string;
  details?: string;
  blockerType?: BlockerType;
  opsDowntimeHours?: string;
}

function shouldShowReportingBugFields(
  workflow: WorkflowDefinition,
  issueType: SelectableIssueType
): boolean {
  return workflow.jiraProjectKey === "RB" && issueType === "Bug";
}

export function buildCreateIssueModal(
  defaultWorkflow: WorkflowDefinition,
  state: ModalStateValues = {}
) {
  const selectedIssueType = state.selectedIssueType ?? defaultWorkflow.allowedIssueTypes[0];
  const blocks: KnownBlock[] = [
    {
      type: "input",
      block_id: CALLBACKS.workflowBlock,
      dispatch_action: true,
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
      dispatch_action: true,
      element: {
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
        initial_value: state.summary,
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
        initial_value: state.details,
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

  if (shouldShowReportingBugFields(defaultWorkflow, selectedIssueType)) {
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
          text: "Required for Reporting/Job Board Bugs"
        },
        options: blockerTypeOptions()
      },
      label: {
        type: "plain_text",
        text: "RUG Blocker Type"
      }
    });

    blocks.splice(4, 0, {
      type: "input",
      block_id: CALLBACKS.downtimeBlock,
      element: {
        type: "plain_text_input",
        action_id: CALLBACKS.downtimeAction,
        initial_value: state.opsDowntimeHours,
        placeholder: {
          type: "plain_text",
          text: "Required for Reporting/Job Board Bugs"
        }
      },
      label: {
        type: "plain_text",
        text: "RUG Ops Downtime (hours)"
      }
    });
  }

  return {
    type: "modal" as const,
    callback_id: CALLBACKS.createIssueView,
    private_metadata: defaultWorkflow.key,
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

export function requiresReportingBugFields(
  workflow: WorkflowDefinition,
  issueType: Exclude<SupportedIssueType, "Epic">
): boolean {
  return shouldShowReportingBugFields(workflow, issueType);
}
