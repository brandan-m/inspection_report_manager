import type { App } from "@slack/bolt";
import { env } from "../config/env.js";

type SlackClient = App["client"];

export interface DownloadedSlackFile {
  id: string;
  filename: string;
  title: string;
  contentType?: string;
  data: Buffer;
}

export async function downloadSlackFile(
  client: SlackClient,
  fileId: string
): Promise<DownloadedSlackFile> {
  const response = await client.files.info({
    file: fileId
  });
  const slackFile = response.file;
  const downloadUrl = slackFile?.url_private_download ?? slackFile?.url_private;

  if (!slackFile || !downloadUrl) {
    throw new Error(`Slack file ${fileId} is missing download metadata.`);
  }

  const downloadResponse = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`
    }
  });

  if (!downloadResponse.ok) {
    throw new Error(`Could not download Slack file ${fileId} (${downloadResponse.status}).`);
  }

  const arrayBuffer = await downloadResponse.arrayBuffer();
  const fallbackName = `${fileId}.bin`;

  return {
    id: fileId,
    filename: slackFile.name?.trim() || slackFile.title?.trim() || fallbackName,
    title: slackFile.title?.trim() || slackFile.name?.trim() || fallbackName,
    contentType: slackFile.mimetype ?? undefined,
    data: Buffer.from(arrayBuffer)
  };
}

export async function downloadSlackFiles(
  client: SlackClient,
  fileIds: string[]
): Promise<DownloadedSlackFile[]> {
  return Promise.all(fileIds.map((fileId) => downloadSlackFile(client, fileId)));
}

export async function shareSlackFile(input: {
  client: SlackClient;
  file: DownloadedSlackFile;
  channelId: string;
  threadTs?: string;
  initialComment?: string;
}): Promise<void> {
  if (input.threadTs) {
    await input.client.files.uploadV2({
      channel_id: input.channelId,
      thread_ts: input.threadTs,
      file: input.file.data,
      filename: input.file.filename,
      title: input.file.title,
      ...(input.initialComment ? { initial_comment: input.initialComment } : {})
    });
    return;
  }

  await input.client.files.uploadV2({
    channel_id: input.channelId,
    file: input.file.data,
    filename: input.file.filename,
    title: input.file.title,
    ...(input.initialComment ? { initial_comment: input.initialComment } : {})
  });
}
