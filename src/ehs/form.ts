import type { KnownBlock, PlainTextOption } from "@slack/types";
import type { EhsFormValues } from "../types/workflow.js";

interface TextFieldDefinition {
  key: keyof EhsFormValues | "taskSummary";
  label: string;
  placeholder: string;
  multiline?: boolean;
  optional?: boolean;
}

interface CheckboxFieldDefinition {
  key: keyof EhsFormValues;
  label: string;
  options: string[];
  optional?: boolean;
}

export interface EhsModalStateValues extends Partial<EhsFormValues> {
  taskSummary?: string;
}

const ID_OPTIONS = ["Government Issued ID", "Passport", "TWIC"];
const PPE_OPTIONS = [
  "FR Clothing",
  "Hard Hat",
  "Hearing Protection",
  "Safety Glasses",
  "Safety Toed Boots",
  "Metatarsals",
  "Fall Protection",
  "Harness for Confined Space Rescue"
];
const FOUR_GAS_OPTIONS = [
  "Gloves specific to task",
  "Monitors",
  "Confined Space Area",
  "4-Gas Personal",
  "Solo Gas",
  "Carbon Monoxide (CO)",
  "Hydrogen Sulfide (H2S)",
  "Ammonia (NH3)",
  "Sulfur Dioxide (SO2)",
  "Chlorine Dioxide (CLO2)"
];
const FIVE_GAS_OPTIONS = ["Ammonia (NH3)", "Volatile Organic Compounds (VOC)"];
const SCAFFOLDING_TAG_OPTIONS = ["Green Tag", "Yellow Tag"];

const CORE_TEXT_FIELDS: TextFieldDefinition[] = [
  {
    key: "taskSummary",
    label: "Task Summary",
    placeholder: "Short Jira task summary"
  },
  {
    key: "drugTesting",
    label: "Drug Testing",
    placeholder: "Drug testing requirements",
    optional: true
  },
  {
    key: "backgroundChecks",
    label: "Background Checks",
    placeholder: "Background check requirements",
    optional: true
  },
  {
    key: "forms",
    label: "Forms",
    placeholder: "Required forms",
    optional: true
  },
  {
    key: "idOther",
    label: "ID Other",
    placeholder: "Other ID requirements",
    optional: true
  },
  {
    key: "trainingSiteSpecific",
    label: "Training Requirements: Site Specific",
    placeholder: "Site-specific training requirements",
    optional: true
  },
  {
    key: "trainingOther1",
    label: "Training Requirements: Other 1",
    placeholder: "Other training requirement",
    optional: true
  },
  {
    key: "trainingOther2",
    label: "Training Requirements: Other 2",
    placeholder: "Other training requirement",
    optional: true
  },
  {
    key: "trainingOther3",
    label: "Training Requirements: Other 3",
    placeholder: "Other training requirement",
    optional: true
  },
  {
    key: "fourGasOther",
    label: "Monitors Other",
    placeholder: "Other monitor requirements",
    optional: true
  },
  {
    key: "fiveGasOther",
    label: "5-Gas Other",
    placeholder: "Other 5-gas requirements",
    optional: true
  }
];

const SITE_REQUIREMENT_TEXT_FIELDS: TextFieldDefinition[] = [
  { key: "generalRequirements", label: "General Requirements", placeholder: "General requirements", optional: true, multiline: true },
  { key: "vehicles", label: "Vehicles", placeholder: "Vehicle requirements", optional: true, multiline: true },
  { key: "loto", label: "LOTO", placeholder: "LOTO requirements", optional: true, multiline: true },
  { key: "confinedSpace", label: "Confined Space", placeholder: "Confined space requirements", optional: true, multiline: true },
  { key: "hazardAssessment", label: "Hazard Assessment", placeholder: "Hazard assessment requirements", optional: true, multiline: true },
  { key: "geckoJsa", label: "Gecko JSA", placeholder: "Gecko JSA requirements", optional: true, multiline: true },
  { key: "submitTo", label: "Submit To", placeholder: "Who to submit to", optional: true },
  { key: "customerProvidedJsa", label: "Customer Provided JSA", placeholder: "Customer JSA requirements", optional: true, multiline: true },
  { key: "electrical", label: "Electrical", placeholder: "Electrical requirements", optional: true, multiline: true },
  { key: "permits", label: "Permits", placeholder: "Permit requirements", optional: true, multiline: true },
  { key: "incidentReporting", label: "Incident Reporting", placeholder: "Incident reporting requirements", optional: true, multiline: true },
  { key: "heatStress", label: "Heat Stress", placeholder: "Heat stress requirements", optional: true, multiline: true },
  { key: "environmental", label: "Environmental", placeholder: "Environmental requirements", optional: true, multiline: true },
  { key: "housekeeping", label: "Housekeeping", placeholder: "Housekeeping requirements", optional: true, multiline: true },
  { key: "barricades", label: "Barricades", placeholder: "Barricade requirements", optional: true, multiline: true },
  { key: "droppedObjects", label: "Dropped Objects", placeholder: "Dropped object requirements", optional: true, multiline: true },
  {
    key: "jobSpecific",
    label: "Job Specific (Pertains to the specific asset)",
    placeholder: "Job-specific site requirements",
    optional: true,
    multiline: true
  }
];

const CONTACT_TEXT_FIELDS: TextFieldDefinition[] = [
  { key: "siteContact", label: "Site Contact", placeholder: "Site contact name" },
  { key: "sitePhoneNumber", label: "Site Contact Phone Number", placeholder: "Phone number" },
  { key: "siteEmail", label: "Site Contact Email", placeholder: "Email address" },
  { key: "safetyContact", label: "Safety Contact (optional)", placeholder: "Safety contact name", optional: true },
  { key: "safetyPhoneNumber", label: "Safety Contact Phone Number (optional)", placeholder: "Phone number", optional: true },
  { key: "safetyEmail", label: "Safety Contact Email (optional)", placeholder: "Email address", optional: true },
  {
    key: "additionalHazards",
    label: "Additional Hazards",
    placeholder: "Additional hazards",
    optional: true,
    multiline: true
  },
  {
    key: "previousIncidents",
    label: "Previous Incidents / Near Misses",
    placeholder: "Previous incidents or near misses",
    optional: true,
    multiline: true
  }
];

const CHECKBOX_FIELDS: CheckboxFieldDefinition[] = [
  {
    key: "idRequirements",
    label: "ID Requirements",
    options: ID_OPTIONS,
    optional: true
  },
  {
    key: "ppeRequirements",
    label: "PPE Requirements",
    options: PPE_OPTIONS,
    optional: true
  },
  {
    key: "fourGasRequirements",
    label: "Monitors",
    options: FOUR_GAS_OPTIONS,
    optional: true
  },
  {
    key: "fiveGasRequirements",
    label: "5-Gas",
    options: FIVE_GAS_OPTIONS,
    optional: true
  },
  {
    key: "scaffoldingTags",
    label: "Scaffolding",
    options: SCAFFOLDING_TAG_OPTIONS,
    optional: true
  }
];

function textBlockId(key: string): string {
  return `ehs_${key}_block`;
}

function textActionId(key: string): string {
  return `ehs_${key}_input`;
}

function checkboxBlockId(key: string): string {
  return `ehs_${key}_block`;
}

function checkboxActionId(key: string): string {
  return `ehs_${key}_select`;
}

function headingBlock(text: string): KnownBlock {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${text}*`
    }
  };
}

function plainTextInputBlock(definition: TextFieldDefinition, value?: string): KnownBlock {
  return {
    type: "input",
    block_id: textBlockId(definition.key),
    optional: definition.optional ?? false,
    element: {
      type: "plain_text_input",
      action_id: textActionId(definition.key),
      multiline: definition.multiline ?? false,
      initial_value: value,
      placeholder: {
        type: "plain_text",
        text: definition.placeholder
      }
    },
    label: {
      type: "plain_text",
      text: definition.label
    }
  };
}

function selectedOptions(options: string[] | undefined): PlainTextOption[] | undefined {
  if (!options?.length) {
    return undefined;
  }

  return options.map((option) => ({
    text: {
      type: "plain_text",
      text: option
    },
    value: option
  }));
}

function checkboxInputBlock(definition: CheckboxFieldDefinition, selectedValues?: string[]): KnownBlock {
  return {
    type: "input",
    block_id: checkboxBlockId(definition.key),
    optional: definition.optional ?? false,
    element: {
      type: "checkboxes",
      action_id: checkboxActionId(definition.key),
      initial_options: selectedOptions(selectedValues),
      options: definition.options.map((option) => ({
        text: {
          type: "plain_text",
          text: option
        },
        value: option
      }))
    },
    label: {
      type: "plain_text",
      text: definition.label
    }
  };
}

export function buildEhsTaskBlocks(state: EhsModalStateValues = {}): KnownBlock[] {
  return [
    headingBlock("EHS Intake"),
    ...CORE_TEXT_FIELDS.map((field) => plainTextInputBlock(field, state[field.key] as string | undefined)),
    ...CHECKBOX_FIELDS.slice(0, 4).map((field) =>
      checkboxInputBlock(field, state[field.key] as string[] | undefined)
    ),
    headingBlock("Site Specific Requirements"),
    ...SITE_REQUIREMENT_TEXT_FIELDS.map((field) => plainTextInputBlock(field, state[field.key] as string | undefined)),
    checkboxInputBlock(CHECKBOX_FIELDS[4], state.scaffoldingTags),
    headingBlock("Contacts and Hazards"),
    ...CONTACT_TEXT_FIELDS.map((field) => plainTextInputBlock(field, state[field.key] as string | undefined))
  ];
}

export function getEhsTextInputKeys(): Array<TextFieldDefinition["key"]> {
  return [...CORE_TEXT_FIELDS, ...SITE_REQUIREMENT_TEXT_FIELDS, ...CONTACT_TEXT_FIELDS].map(
    (field) => field.key
  );
}

export function getEhsCheckboxInputKeys(): Array<CheckboxFieldDefinition["key"]> {
  return CHECKBOX_FIELDS.map((field) => field.key);
}

export function getEhsTextBlockId(key: TextFieldDefinition["key"]): string {
  return textBlockId(key);
}

export function getEhsTextActionId(key: TextFieldDefinition["key"]): string {
  return textActionId(key);
}

export function getEhsCheckboxBlockId(key: CheckboxFieldDefinition["key"]): string {
  return checkboxBlockId(key);
}

export function getEhsCheckboxActionId(key: CheckboxFieldDefinition["key"]): string {
  return checkboxActionId(key);
}

function presentValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function joinSelections(values: string[]): string | undefined {
  return values.length > 0 ? values.join(", ") : undefined;
}

export function formatEhsTaskDetails(values: EhsFormValues): string {
  const sections: Array<{ heading: string; rows: Array<[string, string | undefined]> }> = [
    {
      heading: "Pre-Job Requirements",
      rows: [
        ["Drug Testing", presentValue(values.drugTesting)],
        ["Background Checks", presentValue(values.backgroundChecks)],
        ["Forms", presentValue(values.forms)]
      ]
    },
    {
      heading: "ID",
      rows: [
        ["Requirements", joinSelections(values.idRequirements)],
        ["Other", presentValue(values.idOther)]
      ]
    },
    {
      heading: "Training Requirements",
      rows: [
        ["Site Specific", presentValue(values.trainingSiteSpecific)],
        ["Other 1", presentValue(values.trainingOther1)],
        ["Other 2", presentValue(values.trainingOther2)],
        ["Other 3", presentValue(values.trainingOther3)]
      ]
    },
    {
      heading: "PPE Requirements",
      rows: [["Selections", joinSelections(values.ppeRequirements)]]
    },
    {
      heading: "Monitors",
      rows: [
        ["Selections", joinSelections(values.fourGasRequirements)],
        ["Other", presentValue(values.fourGasOther)]
      ]
    },
    {
      heading: "5-Gas",
      rows: [
        ["Selections", joinSelections(values.fiveGasRequirements)],
        ["Other", presentValue(values.fiveGasOther)]
      ]
    },
    {
      heading: "Site Specific Requirements",
      rows: [
        ["General Requirements", presentValue(values.generalRequirements)],
        ["Vehicles", presentValue(values.vehicles)],
        ["LOTO", presentValue(values.loto)],
        ["Confined Space", presentValue(values.confinedSpace)],
        ["Hazard Assessment", presentValue(values.hazardAssessment)],
        ["Gecko JSA", presentValue(values.geckoJsa)],
        ["Submit To", presentValue(values.submitTo)],
        ["Customer Provided JSA", presentValue(values.customerProvidedJsa)],
        ["Electrical", presentValue(values.electrical)],
        ["Permits", presentValue(values.permits)],
        ["Incident Reporting", presentValue(values.incidentReporting)],
        ["Heat Stress", presentValue(values.heatStress)],
        ["Environmental", presentValue(values.environmental)],
        ["Housekeeping", presentValue(values.housekeeping)],
        ["Barricades", presentValue(values.barricades)],
        ["Scaffolding Tags", joinSelections(values.scaffoldingTags)],
        ["Dropped Objects", presentValue(values.droppedObjects)],
        ["Job Specific", presentValue(values.jobSpecific)]
      ]
    },
    {
      heading: "Contacts",
      rows: [
        ["Site Contact", presentValue(values.siteContact)],
        ["Site Phone Number", presentValue(values.sitePhoneNumber)],
        ["Site Email", presentValue(values.siteEmail)],
        ["Safety Contact", presentValue(values.safetyContact)],
        ["Safety Phone Number", presentValue(values.safetyPhoneNumber)],
        ["Safety Email", presentValue(values.safetyEmail)]
      ]
    },
    {
      heading: "Hazards",
      rows: [
        ["Additional Hazards", presentValue(values.additionalHazards)],
        ["Previous Incidents / Near Misses", presentValue(values.previousIncidents)]
      ]
    }
  ];

  return sections
    .map((section) => {
      const rows = section.rows
        .filter(([, value]) => value)
        .map(([label, value]) => `${label}: ${value as string}`);

      if (rows.length === 0) {
        return undefined;
      }

      return [`${section.heading}:`, ...rows].join("\n");
    })
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
}
