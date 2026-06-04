import type { KnownBlock } from "@slack/types";
import type {
  JiraBlockquoteNode,
  JiraBulletListNode,
  JiraCodeBlockNode,
  JiraDocNode,
  JiraInlineNode,
  JiraListItemNode,
  JiraOrderedListNode,
  JiraParagraphNode,
  JiraTextMark,
  JiraTextNode
} from "../types/workflow.js";

interface SlackPlainTextObject {
  type: "plain_text";
  text: string;
}

export interface SlackRichTextBlock {
  type: "rich_text";
  elements: SlackRichTextRootElement[];
}

interface SlackRichTextStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

interface SlackRichTextTextElement {
  type: "text";
  text: string;
  style?: SlackRichTextStyle;
}

interface SlackRichTextLinkElement {
  type: "link";
  url: string;
  text?: string;
  style?: SlackRichTextStyle;
}

interface SlackRichTextEmojiElement {
  type: "emoji";
  name: string;
}

interface SlackRichTextUserElement {
  type: "user";
  user_id: string;
}

interface SlackRichTextUserGroupElement {
  type: "usergroup";
  usergroup_id: string;
}

interface SlackRichTextChannelElement {
  type: "channel";
  channel_id: string;
}

interface SlackRichTextDateElement {
  type: "date";
  fallback?: string;
}

interface SlackRichTextBroadcastElement {
  type: "broadcast";
  range: "here" | "channel" | "everyone";
}

interface SlackRichTextColorElement {
  type: "color";
  value: string;
}

type SlackRichTextInlineElement =
  | SlackRichTextTextElement
  | SlackRichTextLinkElement
  | SlackRichTextEmojiElement
  | SlackRichTextUserElement
  | SlackRichTextUserGroupElement
  | SlackRichTextChannelElement
  | SlackRichTextDateElement
  | SlackRichTextBroadcastElement
  | SlackRichTextColorElement;

interface SlackRichTextSectionElement {
  type: "rich_text_section";
  elements: SlackRichTextInlineElement[];
}

interface SlackRichTextListElement {
  type: "rich_text_list";
  style: "bullet" | "ordered";
  elements: SlackRichTextSectionElement[];
  indent?: number;
  offset?: number;
}

interface SlackRichTextQuoteElement {
  type: "rich_text_quote";
  elements: SlackRichTextInlineElement[];
}

interface SlackRichTextPreformattedElement {
  type: "rich_text_preformatted";
  elements: SlackRichTextInlineElement[];
}

type SlackRichTextRootElement =
  | SlackRichTextSectionElement
  | SlackRichTextListElement
  | SlackRichTextQuoteElement
  | SlackRichTextPreformattedElement;

function textNode(text: string, marks?: JiraTextMark[]): JiraTextNode {
  return {
    type: "text",
    text,
    ...(marks?.length ? { marks } : {})
  };
}

function paragraph(content: JiraInlineNode[]): JiraParagraphNode | undefined {
  if (content.length === 0) {
    return undefined;
  }

  return {
    type: "paragraph",
    content
  };
}

function inlineElementToPlainText(element: SlackRichTextInlineElement): string {
  switch (element.type) {
    case "text":
      return element.text;
    case "link":
      return element.text ?? element.url;
    case "emoji":
      return `:${element.name}:`;
    case "user":
      return `<@${element.user_id}>`;
    case "usergroup":
      return `<!subteam^${element.usergroup_id}>`;
    case "channel":
      return `<#${element.channel_id}>`;
    case "date":
      return element.fallback ?? "";
    case "broadcast":
      return `<!${element.range}>`;
    case "color":
      return element.value;
  }
}

function sectionToPlainText(section: SlackRichTextSectionElement): string {
  return section.elements.map(inlineElementToPlainText).join("");
}

function rootElementToPlainText(element: SlackRichTextRootElement): string {
  switch (element.type) {
    case "rich_text_section":
      return sectionToPlainText(element);
    case "rich_text_quote": {
      const text = element.elements.map(inlineElementToPlainText).join("");
      return text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    case "rich_text_preformatted":
      return element.elements.map(inlineElementToPlainText).join("");
    case "rich_text_list": {
      const indent = "  ".repeat(element.indent ?? 0);

      return element.elements
        .map((section, index) => {
          const prefix =
            element.style === "ordered"
              ? `${(element.offset ?? 0) + index + 1}.`
              : "-";

          return `${indent}${prefix} ${sectionToPlainText(section)}`;
        })
        .join("\n");
    }
  }
}

function styleToJiraMarks(style?: SlackRichTextStyle): JiraTextMark[] {
  if (!style) {
    return [];
  }

  const marks: JiraTextMark[] = [];

  if (style.bold) {
    marks.push({ type: "strong" });
  }

  if (style.italic) {
    marks.push({ type: "em" });
  }

  if (style.strike) {
    marks.push({ type: "strike" });
  }

  if (style.code) {
    marks.push({ type: "code" });
  }

  return marks;
}

function inlineElementToJiraTextNodes(element: SlackRichTextInlineElement): JiraTextNode[] {
  switch (element.type) {
    case "text":
      return [textNode(element.text, styleToJiraMarks(element.style))];
    case "link": {
      const marks = [...styleToJiraMarks(element.style), { type: "link", attrs: { href: element.url } } satisfies JiraTextMark];
      return [textNode(element.text ?? element.url, marks)];
    }
    case "emoji":
      return [textNode(`:${element.name}:`)];
    case "user":
      return [textNode(`<@${element.user_id}>`)];
    case "usergroup":
      return [textNode(`<!subteam^${element.usergroup_id}>`)];
    case "channel":
      return [textNode(`<#${element.channel_id}>`)];
    case "date":
      return [textNode(element.fallback ?? "")];
    case "broadcast":
      return [textNode(`<!${element.range}>`)];
    case "color":
      return [textNode(element.value)];
  }
}

async function inlineElementToResolvedJiraInlineNodes(
  element: SlackRichTextInlineElement,
  options: {
    resolveUserMention?: (userId: string) => Promise<JiraInlineNode>;
  }
): Promise<JiraInlineNode[]> {
  switch (element.type) {
    case "user":
      if (options.resolveUserMention) {
        return [await options.resolveUserMention(element.user_id)];
      }

      return [textNode(`<@${element.user_id}>`)];
    default:
      return inlineElementToJiraTextNodes(element);
  }
}

function sectionToParagraph(section: SlackRichTextSectionElement): JiraParagraphNode | undefined {
  return paragraph(section.elements.flatMap(inlineElementToJiraTextNodes));
}

async function sectionToResolvedParagraph(
  section: SlackRichTextSectionElement,
  options: {
    resolveUserMention?: (userId: string) => Promise<JiraInlineNode>;
  }
): Promise<JiraParagraphNode | undefined> {
  const content = (
    await Promise.all(section.elements.map((element) => inlineElementToResolvedJiraInlineNodes(element, options)))
  ).flat();

  return paragraph(content);
}

function rootElementToJiraNodes(element: SlackRichTextRootElement): JiraDocNode[] {
  switch (element.type) {
    case "rich_text_section": {
      const node = sectionToParagraph(element);
      return node ? [node] : [];
    }
    case "rich_text_quote": {
      const quoteParagraph = paragraph(element.elements.flatMap(inlineElementToJiraTextNodes));

      if (!quoteParagraph) {
        return [];
      }

      return [
        {
          type: "blockquote",
          content: [quoteParagraph]
        } satisfies JiraBlockquoteNode
      ];
    }
    case "rich_text_preformatted": {
      const text = element.elements.map(inlineElementToPlainText).join("");

      if (!text.trim()) {
        return [];
      }

      return [
        {
          type: "codeBlock",
          content: [textNode(text)]
        } satisfies JiraCodeBlockNode
      ];
    }
    case "rich_text_list": {
      const items = element.elements
        .map((section) => sectionToParagraph(section))
        .filter((node): node is JiraParagraphNode => Boolean(node))
        .map(
          (node) =>
            ({
              type: "listItem",
              content: [node]
            }) satisfies JiraListItemNode
        );

      if (items.length === 0) {
        return [];
      }

      if (element.style === "ordered") {
        return [
          {
            type: "orderedList",
            ...(typeof element.offset === "number" ? { attrs: { order: element.offset + 1 } } : {}),
            content: items
          } satisfies JiraOrderedListNode
        ];
      }

      return [
        {
          type: "bulletList",
          content: items
        } satisfies JiraBulletListNode
      ];
    }
  }
}

async function rootElementToResolvedJiraNodes(
  element: SlackRichTextRootElement,
  options: {
    resolveUserMention?: (userId: string) => Promise<JiraInlineNode>;
  }
): Promise<JiraDocNode[]> {
  switch (element.type) {
    case "rich_text_section": {
      const node = await sectionToResolvedParagraph(element, options);
      return node ? [node] : [];
    }
    case "rich_text_quote": {
      const quoteParagraph = await sectionToResolvedParagraph(
        {
          type: "rich_text_section",
          elements: element.elements
        },
        options
      );

      if (!quoteParagraph) {
        return [];
      }

      return [
        {
          type: "blockquote",
          content: [quoteParagraph]
        } satisfies JiraBlockquoteNode
      ];
    }
    case "rich_text_preformatted": {
      const text = element.elements.map(inlineElementToPlainText).join("");

      if (!text.trim()) {
        return [];
      }

      return [
        {
          type: "codeBlock",
          content: [textNode(text)]
        } satisfies JiraCodeBlockNode
      ];
    }
    case "rich_text_list": {
      const sections = await Promise.all(
        element.elements.map((section) => sectionToResolvedParagraph(section, options))
      );
      const items = sections
        .filter((node): node is JiraParagraphNode => Boolean(node))
        .map(
          (node) =>
            ({
              type: "listItem",
              content: [node]
            }) satisfies JiraListItemNode
        );

      if (items.length === 0) {
        return [];
      }

      if (element.style === "ordered") {
        return [
          {
            type: "orderedList",
            ...(typeof element.offset === "number" ? { attrs: { order: element.offset + 1 } } : {}),
            content: items
          } satisfies JiraOrderedListNode
        ];
      }

      return [
        {
          type: "bulletList",
          content: items
        } satisfies JiraBulletListNode
      ];
    }
  }
}

export function richTextToPlainText(value?: SlackRichTextBlock): string {
  if (!value) {
    return "";
  }

  return value.elements
    .map(rootElementToPlainText)
    .filter((section) => section.trim().length > 0)
    .join("\n")
    .trim();
}

export function richTextToJiraDocNodes(value?: SlackRichTextBlock): JiraDocNode[] {
  if (!value) {
    return [];
  }

  return value.elements.flatMap(rootElementToJiraNodes);
}

export async function richTextToResolvedJiraDocNodes(
  value: SlackRichTextBlock | undefined,
  options: {
    resolveUserMention?: (userId: string) => Promise<JiraInlineNode>;
  } = {}
): Promise<JiraDocNode[]> {
  if (!value) {
    return [];
  }

  return (await Promise.all(value.elements.map((element) => rootElementToResolvedJiraNodes(element, options)))).flat();
}

export function richTextInputBlock(
  blockId: string,
  actionId: string,
  label: string,
  placeholder: string,
  optional = false
): KnownBlock {
  return {
    type: "input",
    block_id: blockId,
    optional,
    element: {
      type: "rich_text_input",
      action_id: actionId,
      placeholder: {
        type: "plain_text",
        text: placeholder
      } satisfies SlackPlainTextObject
    },
    label: {
      type: "plain_text",
      text: label
    }
  } as unknown as KnownBlock;
}
