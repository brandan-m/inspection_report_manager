import { jiraRequest } from "./client.js";

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

interface JiraEditMetaResponse {
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
}

export interface DataOpsJiraFieldValues {
  slug?: string;
  assetType?: string;
  algorithm?: string;
  percentCaptured?: number;
  percentUploaded?: number;
  percentValidated?: number;
  percentPrep?: number;
  percentQa?: number;
  dataQuality?: string;
  forecastUrl?: string;
  cantileverUrl?: string;
}

type JiraCreateField = {
  name: string;
  allowedValues?: Array<{
    id: string;
    value: string;
  }>;
};

const fieldCache = new Map<string, Promise<Record<string, JiraCreateField>>>();
const editFieldCache = new Map<string, Promise<Record<string, JiraCreateField>>>();

async function getCreateFields(projectKey: string, issueType: string) {
  const cacheKey = `${projectKey}:${issueType}`;
  const cached = fieldCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const result = await jiraRequest<JiraCreateMetaResponse>(
      `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&issuetypeNames=${encodeURIComponent(issueType)}&expand=projects.issuetypes.fields`
    );

    const fields = result.projects[0]?.issuetypes[0]?.fields;

    if (!fields) {
      throw new Error(`Could not load create metadata for ${projectKey} ${issueType}.`);
    }

    return fields;
  })();

  fieldCache.set(cacheKey, pending);
  return pending;
}

async function getEditFields(issueKey: string) {
  const cached = editFieldCache.get(issueKey);

  if (cached) {
    return cached;
  }

  const pending = jiraRequest<JiraEditMetaResponse>(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/editmeta`
  ).then((result) => result.fields);

  editFieldCache.set(issueKey, pending);
  return pending;
}

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findFieldId(fields: Record<string, JiraCreateField>, candidateNames: string[]): string | undefined {
  const normalizedCandidates = new Set(candidateNames.map((name) => normalizeFieldName(name)));

  return Object.entries(fields).find(([, field]) => normalizedCandidates.has(normalizeFieldName(field.name)))?.[0];
}

function assignFieldValue(target: Record<string, unknown>, fieldId: string, field: JiraCreateField | undefined, value: unknown) {
  if (!field?.allowedValues?.length || typeof value !== "string") {
    target[fieldId] = value;
    return;
  }

  const normalizedValue = normalizeFieldName(value);
  const option = field.allowedValues.find((item) => normalizeFieldName(item.value) === normalizedValue);

  if (!option) {
    return;
  }

  target[fieldId] = { id: option.id };
}

function addFieldIfPresent(
  target: Record<string, unknown>,
  fields: Record<string, JiraCreateField>,
  candidateNames: string[],
  value: unknown,
  fallbackFieldId?: string
) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  const fieldId = findFieldId(fields, candidateNames) ?? fallbackFieldId;

  if (!fieldId) {
    return;
  }

  assignFieldValue(target, fieldId, fields[fieldId], value);
}

function addAssetTypeField(
  target: Record<string, unknown>,
  fields: Record<string, JiraCreateField>,
  value: string | undefined
) {
  addFieldIfPresent(target, fields, ["asset type", "component type"], value);
}

export async function buildEodJiraCustomFields(
  projectKey: string,
  values: Pick<DataOpsJiraFieldValues, "assetType">
): Promise<Record<string, unknown>> {
  const fields = await getCreateFields(projectKey, "EOD Report");
  const customFields: Record<string, unknown> = {};

  addAssetTypeField(customFields, fields, values.assetType);

  return customFields;
}

export async function buildDataOpsJiraCustomFields(
  projectKey: string,
  values: DataOpsJiraFieldValues
): Promise<Record<string, unknown>> {
  const fields = await getCreateFields(projectKey, "Data Ops");
  const customFields: Record<string, unknown> = {};

  addFieldIfPresent(customFields, fields, ["slug id", "slugid", "slug"], values.slug, "customfield_18220");
  addAssetTypeField(customFields, fields, values.assetType);
  addFieldIfPresent(customFields, fields, ["algorithm"], values.algorithm);
  addFieldIfPresent(customFields, fields, ["% capt", "% captured", "percent capt", "percent captured"], values.percentCaptured);
  addFieldIfPresent(customFields, fields, ["% upload", "% uploaded", "percent upload", "percent uploaded"], values.percentUploaded);
  addFieldIfPresent(customFields, fields, ["% validated", "percent validated"], values.percentValidated);
  addFieldIfPresent(customFields, fields, ["% prep", "percent prep"], values.percentPrep);
  addFieldIfPresent(customFields, fields, ["%qa", "% qa", "percent qa"], values.percentQa);
  addFieldIfPresent(customFields, fields, ["data quality"], values.dataQuality);
  addFieldIfPresent(customFields, fields, ["forecast url", "forecast link"], values.forecastUrl);
  addFieldIfPresent(customFields, fields, ["cantilever url", "cantilever link"], values.cantileverUrl);

  return customFields;
}

export async function buildAssetTaskProgressCustomFields(
  issueKey: string,
  values: Pick<
    DataOpsJiraFieldValues,
    "percentCaptured" | "percentUploaded" | "percentValidated" | "percentPrep" | "percentQa"
  >
): Promise<Record<string, unknown>> {
  const fields = await getEditFields(issueKey);
  const customFields: Record<string, unknown> = {};

  addFieldIfPresent(
    customFields,
    fields,
    ["% capt", "% captured", "percent capt", "percent captured"],
    values.percentCaptured
  );
  addFieldIfPresent(
    customFields,
    fields,
    ["% upload", "% uploaded", "percent upload", "percent uploaded"],
    values.percentUploaded
  );
  addFieldIfPresent(customFields, fields, ["% prep", "percent prep"], values.percentPrep);
  addFieldIfPresent(customFields, fields, ["%qa", "% qa", "percent qa"], values.percentQa);
  addFieldIfPresent(customFields, fields, ["% validated", "percent validated"], values.percentValidated);

  return customFields;
}
