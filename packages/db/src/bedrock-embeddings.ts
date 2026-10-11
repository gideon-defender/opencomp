import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';

const responseSchema = z.object({
  embedding: z.array(z.number().finite()).length(1024),
});

/** Titan accepts one text per invocation; bound concurrency and preserve batch order. */
export async function embedBedrockTexts({
  texts,
  model,
}: {
  texts: string[];
  model: string;
}): Promise<number[][]> {
  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? process.env.APP_AWS_REGION,
  });
  const vectors: number[][] = [];
  try {
    for (let offset = 0; offset < texts.length; offset += 4) {
      const batch = await Promise.all(
        texts.slice(offset, offset + 4).map(async (inputText) => {
          const response = await client.send(
            new InvokeModelCommand({
              modelId: model,
              contentType: 'application/json',
              accept: 'application/json',
              body: JSON.stringify({ inputText, dimensions: 1024, normalize: true }),
            }),
            { abortSignal: AbortSignal.timeout(30_000) },
          );
          const data: unknown = JSON.parse(new TextDecoder().decode(response.body));
          const parsed = responseSchema.safeParse(data);
          if (!parsed.success) {
            throw new Error('Bedrock returned an invalid embedding; expected 1024 finite numbers');
          }
          return parsed.data.embedding;
        }),
      );
      vectors.push(...batch);
    }
    return vectors;
  } finally {
    client.destroy();
  }
}
