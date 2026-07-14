import type { CreateIssueInput } from "../types/workflow.js";
import { jiraRequest } from "./client.js";

interface JiraCreateIssueResponse {
  key: string;
  self: string;
}

interface JiraCreateMetaResponse {
  projects: Array<{
    issuetypes: Array<{
      fields: Record<
        string,
        {
          name: string;
          allowedValues?: Array<{
            id: string;
            value: string;
          }>;
        }
      >;
    }>;
  }>;
}

async function getCreateFields(projectKey: string, issueType: string) {
  const result = await jiraRequest<JiraCreateMetaResponse>(
    `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&issuetypeNames=${encodeURIComponent(issueType)}&expand=projects.issuetypes.fields`
  );

  const fields = result.projects[0]?.issuetypes[0]?.fields;

  if (!fields) {
    throw new Error(`Could not load create metadata for ${projectKey} ${issueType}.`);
  }

  return fields;
}

function getBugFieldConfig(jiraProjectKey: string) {
  if (jiraProjectKey === "RB") {
    return {
      blockerTypeLabel: "RUG Blocker Type",
      downtimeLabel: "RUG Ops Downtime (hours)",
      blockerTypeFieldId: "customfield_16963",
      downtimeFieldId: "customfield_16964"
    };
  }

  if (jiraProjectKey === "UIM") {
    return {
      blockerTypeLabel: "UAE Blocker Type",
      downtimeLabel: "UAE Ops Downtime (hours)",
      blockerTypeFieldId: "customfield_18211",
      downtimeFieldId: "customfield_18210"
    };
  }

  return undefined;
}

export async function createIssue(input: CreateIssueInput): Promise<JiraCreateIssueResponse> {
  const descriptionContent = input.descriptionContent ?? [
    {
      type: "paragraph" as const,
      content: [
        {
          type: "text" as const,
          text: input.details
        }
      ]
    }
  ];

  const fields: Record<string, unknown> = {
    project: {
      key: input.workflow.jiraProjectKey
    },
    issuetype: {
      name: input.issueType
    },
    summary: input.summary,
    description: {
      type: "doc",
      version: 1,
      content: [
        ...descriptionContent,
        ...(input.requesterName || input.requesterContent?.length
          ? [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Requested from Slack by "
                  },
                  ...(input.requesterContent?.length
                    ? input.requesterContent
                    : [
                        {
                          type: "text",
                          text: input.requesterName as string
                        }
                      ])
                ]
              }
            ]
          : [])
      ]
    }
  };

  const jiraParentKey = input.workflow.parentIssueType === "Task" ? input.jiraParentKey : input.parentEpicKey;

  if (jiraParentKey) {
    fields.parent = {
      key: jiraParentKey
    };
  }

  const bugFieldConfig = input.issueType === "Bug" ? getBugFieldConfig(input.workflow.jiraProjectKey) : undefined;

  if (bugFieldConfig) {
    const { blockerTypeLabel, downtimeLabel, blockerTypeFieldId, downtimeFieldId } = bugFieldConfig;

    if (!input.blockerType) {
      throw new Error(`${blockerTypeLabel} is required for ${input.workflow.label} Bugs.`);
    }

    if (typeof input.opsDowntimeHours !== "number" || Number.isNaN(input.opsDowntimeHours)) {
      throw new Error(`${downtimeLabel} is required for ${input.workflow.label} Bugs.`);
    }

    const createFields = await getCreateFields(input.workflow.jiraProjectKey, input.issueType);

    const blockerTypeOption = createFields[blockerTypeFieldId]?.allowedValues?.find(
      (option) => option.value === input.blockerType
    );

    if (!blockerTypeOption) {
      throw new Error(`Could not map blocker type "${input.blockerType}" to a Jira option.`);
    }

    fields[blockerTypeFieldId] = { id: blockerTypeOption.id };
    fields[downtimeFieldId] = input.opsDowntimeHours;
  }

  const payload = {
    fields: {
      ...fields,
      ...(input.customFields ?? {})
    }
  };

  return jiraRequest<JiraCreateIssueResponse>("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
