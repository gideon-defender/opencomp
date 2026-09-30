import { auth } from '@gideon-defender/trigger-local';

/** A cookie may outlive the runtime that originally issued its token. */
export async function getValidTriggerAccessToken(token?: string): Promise<string | undefined> {
  if (!token) return undefined;
  try {
    return (await auth.getPayloadFromJWT(token)) ? token : undefined;
  } catch {
    return undefined;
  }
}
