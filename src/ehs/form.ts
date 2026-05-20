import type { KnownBlock, PlainTextOption } from "@slack/types";
import type { EhsFormValues, JiraDocNode, JiraTextNode } from "../types/workflow.js";

interface TextFieldDefinition {
  key: keyof EhsFormValues;
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

export interface EhsModalStateValues extends Partial<EhsFormValues> {}

const TOGGLE_OPTION = "Selected";
const DRUG_TESTING_OPTIONS = [TOGGLE_OPTION];
const BACKGROUND_CHECK_OPTIONS = [TOGGLE_OPTION];
const FORMS_OPTIONS = [TOGGLE_OPTION];
const ID_OPTIONS = ["Government Issued ID", "Passport", "TWIC"];
const PPE_OPTIONS = [
  "FR Clothing",
  "Hard Hat",
  "Hearing Protection",
  "Safety Glasses",
  "Safety Toed Boots",
  "Metatarsals",
  "Fall Protection",
  "Harness for Confined Space Rescue",
  "Gloves specific to task",
  "Monitors",
  "Other"
];
const MONITOR_OPTIONS = ["Confined Space Area", "4-Gas Personal", "Solo Gas", "5-Gas"];
const SOLO_GAS_OPTIONS = [
  "Carbon Monoxide (CO)",
  "Hydrogen Sulfide (H2S)",
  "Ammonia (NH3)",
  "Sulfur Dioxide (SO2)",
  "Chlorine Dioxide (CLO2)"
];
const FIVE_GAS_DETAIL_OPTIONS = ["Ammonia (NH3)", "Volatile Organic Compounds (VOC)"];
const JSA_OPTIONS = ["Gecko", "Customer"];
const SCAFFOLDING_TAG_OPTIONS = ["Green Tag", "Yellow Tag"];

const TEXT_FIELD_DEFINITIONS: TextFieldDefinition[] = [
  {
    key: "drugTestingInfo",
    label: "Drug Screen Info",
    placeholder: "Drug screen requirements",
    optional: true
  },
  {
    key: "formsInfo",
    label: "Form Info",
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
    key: "trainingRequirements",
    label: "Training Requirements",
    placeholder: "Training requirements",
    optional: true,
    multiline: true
  },
  {
    key: "ppeOther",
    label: "PPE Other",
    placeholder: "Other PPE requirements",
    optional: true
  },
  {
    key: "fiveGasOther",
    label: "5-Gas Other",
    placeholder: "Other 5-gas requirements",
    optional: true
  },
  {
    key: "generalRequirements",
    label: "General Requirements",
    placeholder: "General requirements",
    optional: true,
    multiline: true
  },
  {
    key: "vehicles",
    label: "Vehicles",
    placeholder: "Vehicle requirements",
    optional: true,
    multiline: true
  },
  {
    key: "loto",
    label: "LOTO",
    placeholder: "LOTO requirements",
    optional: true,
    multiline: true
  },
  {
    key: "confinedSpace",
    label: "Confined Space",
    placeholder: "Confined space requirements",
    optional: true,
    multiline: true
  },
  {
    key: "hazardAssessment",
    label: "Hazard Assessment",
    placeholder: "Hazard assessment requirements",
    optional: true,
    multiline: true
  },
  {
    key: "submitTo",
    label: "Submit To",
    placeholder: "Who to submit to",
    optional: true
  },
  {
    key: "electrical",
    label: "Electrical",
    placeholder: "Electrical requirements",
    optional: true,
    multiline: true
  },
  {
    key: "permits",
    label: "Permits",
    placeholder: "Permit requirements",
    optional: true,
    multiline: true
  },
  {
    key: "incidentReporting",
    label: "Incident Reporting",
    placeholder: "Incident reporting requirements",
    optional: true,
    multiline: true
  },
  {
    key: "heatStress",
    label: "Heat Stress",
    placeholder: "Heat stress requirements",
    optional: true,
    multiline: true
  },
  {
    key: "environmental",
    label: "Environmental",
    placeholder: "Environmental requirements",
    optional: true,
    multiline: true
  },
  {
    key: "housekeeping",
    label: "Housekeeping",
    placeholder: "Housekeeping requirements",
    optional: true,
    multiline: true
  },
  {
    key: "barricades",
    label: "Barricades",
    placeholder: "Barricade requirements",
    optional: true,
    multiline: true
  },
  {
    key: "droppedObjects",
    label: "Dropped Objects",
    placeholder: "Dropped object requirements",
    optional: true,
    multiline: true
  },
  {
    key: "jobSpecific",
    label: "Job Specific (Pertains to the specific asset)",
    placeholder: "Job-specific site requirements",
    optional: true,
    multiline: true
  },
  {
    key: "siteContact",
    label: "Site Contact",
    placeholder: "Site contact name"
  },
  {
    key: "sitePhoneNumber",
    label: "Site Contact Phone Number",
    placeholder: "Phone number"
  },
  {
    key: "siteEmail",
    label: "Site Contact Email",
    placeholder: "Email address"
  },
  {
    key: "safetyContact",
    label: "Safety Contact (optional)",
    placeholder: "Safety contact name",
    optional: true
  },
  {
    key: "safetyPhoneNumber",
    label: "Safety Contact Phone Number (optional)",
    placeholder: "Phone number",
    optional: true
  },
  {
    key: "safetyEmail",
    label: "Safety Contact Email (optional)",
    placeholder: "Email address",
    optional: true
  },
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

const CHECKBOX_FIELD_DEFINITIONS: CheckboxFieldDefinition[] = [
  {
    key: "drugTestingSelections",
    label: "Drug Testing",
    options: DRUG_TESTING_OPTIONS,
    optional: true
  },
  {
    key: "backgroundCheckSelections",
    label: "Background Check",
    options: BACKGROUND_CHECK_OPTIONS,
    optional: true
  },
  {
    key: "formsSelections",
    label: "Forms",
    options: FORMS_OPTIONS,
    optional: true
  },
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
    key: "monitorRequirements",
    label: "Monitors",
    options: MONITOR_OPTIONS,
    optional: true
  },
  {
    key: "soloGasRequirements",
    label: "Solo Gas",
    options: SOLO_GAS_OPTIONS,
    optional: true
  },
  {
    key: "fiveGasDetails",
    label: "5-Gas",
    options: FIVE_GAS_DETAIL_OPTIONS,
    optional: true
  },
  {
    key: "jsaRequirements",
    label: "JSA",
    options: JSA_OPTIONS,
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
    dispatch_action: true,
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

function getTextDefinition(key: keyof EhsFormValues): TextFieldDefinition {
  const definition = TEXT_FIELD_DEFINITIONS.find((field) => field.key === key);

  if (!definition) {
    throw new Error(`Unknown EHS text field: ${String(key)}`);
  }

  return definition;
}

function getCheckboxDefinition(key: keyof EhsFormValues): CheckboxFieldDefinition {
  const definition = CHECKBOX_FIELD_DEFINITIONS.find((field) => field.key === key);

  if (!definition) {
    throw new Error(`Unknown EHS checkbox field: ${String(key)}`);
  }

  return definition;
}

function isSelected(values: string[] | undefined): boolean {
  return Boolean(values?.length);
}

function includesValue(values: string[] | undefined, target: string): boolean {
  return values?.includes(target) ?? false;
}

function renderTextField(key: keyof EhsFormValues, state: EhsModalStateValues): KnownBlock {
  const definition = getTextDefinition(key);
  return plainTextInputBlock(definition, state[key] as string | undefined);
}

function renderCheckboxField(key: keyof EhsFormValues, state: EhsModalStateValues): KnownBlock {
  const definition = getCheckboxDefinition(key);
  return checkboxInputBlock(definition, state[key] as string[] | undefined);
}

export function buildEhsTaskBlocks(state: EhsModalStateValues = {}): KnownBlock[] {
  const showDrugTestingInfo = isSelected(state.drugTestingSelections);
  const showFormsInfo = isSelected(state.formsSelections);
  const showPpeOther = includesValue(state.ppeRequirements, "Other");
  const showMonitorsSection = includesValue(state.ppeRequirements, "Monitors");
  const showSoloGasSection = includesValue(state.monitorRequirements, "Solo Gas");
  const showFiveGasSection = includesValue(state.monitorRequirements, "5-Gas");

  const blocks: KnownBlock[] = [
    headingBlock("EHS Intake"),
    headingBlock("Pre-Job Requirements"),
    renderCheckboxField("drugTestingSelections", state),
    renderCheckboxField("backgroundCheckSelections", state),
    renderCheckboxField("formsSelections", state),
    headingBlock("ID Requirements"),
    renderCheckboxField("idRequirements", state),
    renderTextField("idOther", state),
    headingBlock("Training Requirements"),
    renderTextField("trainingRequirements", state),
    headingBlock("PPE Requirements"),
    renderCheckboxField("ppeRequirements", state)
  ];

  if (showDrugTestingInfo) {
    blocks.push(renderTextField("drugTestingInfo", state));
  }

  if (showFormsInfo) {
    blocks.push(renderTextField("formsInfo", state));
  }

  if (showPpeOther) {
    blocks.push(renderTextField("ppeOther", state));
  }

  if (showMonitorsSection) {
    blocks.push(headingBlock("Monitors"), renderCheckboxField("monitorRequirements", state));

    if (showSoloGasSection) {
      blocks.push(headingBlock("Solo Gas"), renderCheckboxField("soloGasRequirements", state));
    }

    if (showFiveGasSection) {
      blocks.push(
        headingBlock("5-Gas"),
        renderCheckboxField("fiveGasDetails", state),
        renderTextField("fiveGasOther", state)
      );
    }
  }

  blocks.push(
    headingBlock("Site Specific Requirements"),
    renderTextField("generalRequirements", state),
    renderTextField("vehicles", state),
    renderTextField("loto", state),
    renderTextField("confinedSpace", state),
    renderTextField("hazardAssessment", state),
    renderCheckboxField("jsaRequirements", state),
    renderTextField("submitTo", state),
    renderTextField("electrical", state),
    renderTextField("permits", state),
    renderTextField("incidentReporting", state),
    renderTextField("heatStress", state),
    renderTextField("environmental", state),
    renderTextField("housekeeping", state),
    renderTextField("barricades", state),
    renderCheckboxField("scaffoldingTags", state),
    renderTextField("droppedObjects", state),
    renderTextField("jobSpecific", state),
    headingBlock("Contacts and Hazards"),
    renderTextField("siteContact", state),
    renderTextField("sitePhoneNumber", state),
    renderTextField("siteEmail", state),
    renderTextField("safetyContact", state),
    renderTextField("safetyPhoneNumber", state),
    renderTextField("safetyEmail", state),
    renderTextField("additionalHazards", state),
    renderTextField("previousIncidents", state)
  );

  return blocks;
}

export function getEhsTextInputKeys(): Array<TextFieldDefinition["key"]> {
  return TEXT_FIELD_DEFINITIONS.map((field) => field.key);
}

export function getEhsCheckboxInputKeys(): Array<CheckboxFieldDefinition["key"]> {
  return CHECKBOX_FIELD_DEFINITIONS.map((field) => field.key);
}

export function getEhsReactiveCheckboxKeys(): Array<CheckboxFieldDefinition["key"]> {
  return ["drugTestingSelections", "formsSelections", "ppeRequirements", "monitorRequirements"];
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

function selectedLabel(values: string[] | undefined): string | undefined {
  return isSelected(values) ? "Selected" : undefined;
}

function buildEhsSections(values: EhsFormValues): Array<{ heading: string; rows: Array<[string, string | undefined]> }> {
  return [
    {
      heading: "Pre-Job Requirements",
      rows: [
        ["Drug Testing", selectedLabel(values.drugTestingSelections)],
        ["Drug Screen Info", presentValue(values.drugTestingInfo)],
        ["Background Check", selectedLabel(values.backgroundCheckSelections)],
        ["Forms", selectedLabel(values.formsSelections)],
        ["Form Info", presentValue(values.formsInfo)]
      ]
    },
    {
      heading: "ID Requirements",
      rows: [
        ["Selections", joinSelections(values.idRequirements)],
        ["Other", presentValue(values.idOther)]
      ]
    },
    {
      heading: "Training Requirements",
      rows: [["Requirements", presentValue(values.trainingRequirements)]]
    },
    {
      heading: "PPE Requirements",
      rows: [
        ["Selections", joinSelections(values.ppeRequirements)],
        ["Other", presentValue(values.ppeOther)]
      ]
    },
    {
      heading: "Monitors",
      rows: [["Selections", joinSelections(values.monitorRequirements)]]
    },
    {
      heading: "Solo Gas",
      rows: [["Selections", joinSelections(values.soloGasRequirements)]]
    },
    {
      heading: "5-Gas",
      rows: [
        ["Selections", joinSelections(values.fiveGasDetails)],
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
        ["JSA", joinSelections(values.jsaRequirements)],
        ["Submit To", presentValue(values.submitTo)],
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
}

function boldText(text: string): JiraTextNode {
  return {
    type: "text",
    text,
    marks: [{ type: "strong" }]
  };
}

function plainText(text: string): JiraTextNode {
  return {
    type: "text",
    text
  };
}

export function formatEhsTaskDetails(values: EhsFormValues): string {
  return buildEhsSections(values)
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

export function buildEhsTaskDescriptionContent(values: EhsFormValues): JiraDocNode[] {
  return buildEhsSections(values).flatMap((section) => {
    const rows = section.rows.filter(([, value]) => value);

    if (rows.length === 0) {
      return [];
    }

    return [
      {
        type: "heading",
        attrs: {
          level: 2
        },
        content: [plainText(section.heading)]
      } satisfies JiraDocNode,
      ...rows.map(
        ([label, value]) =>
          ({
            type: "paragraph",
            content: [boldText(`${label}: `), plainText(value as string)]
          }) satisfies JiraDocNode
      )
    ];
  });
}
