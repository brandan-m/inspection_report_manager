import workflowDefinitions from "../../config/workflows.json" with { type: "json" };
import type { WorkflowDefinition } from "../types/workflow.js";

const workflows = workflowDefinitions as WorkflowDefinition[];

export function listWorkflows(): WorkflowDefinition[] {
  return workflows;
}

export function getWorkflowByKey(key: string): WorkflowDefinition {
  const workflow = workflows.find((item) => item.key === key);

  if (!workflow) {
    throw new Error(`Unknown workflow key: ${key}`);
  }

  return workflow;
}
