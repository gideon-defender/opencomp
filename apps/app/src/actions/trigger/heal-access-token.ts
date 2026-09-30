'use server';

import { auth, runs } from '@gideon-defender/trigger-local';
import { cookies } from 'next/headers';

// Server action that can set cookies (called from client components or forms)
export async function healAndSetAccessToken(triggerJobId: string): Promise<string | null> {
  try {
    // Loading the run initializes the shared DB state before token issuance.
    // Without it, a freshly restarted process issues only an in-memory token.
    await runs.retrieve(triggerJobId);
    const cookieStore = await cookies();

    const token = await auth.createPublicToken({
      scopes: {
        read: {
          runs: [triggerJobId],
        },
      },
    });

    cookieStore.set('publicAccessToken', token);

    return token;
  } catch (error) {
    console.error('Failed to heal and set access token:', error);
    return null;
  }
}
