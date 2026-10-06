import type { Logger } from '@nestjs/common';
import {
  AZURE_FIX_FORWARD_ACTIONS,
  AZURE_NEVER_ALLOW_ACTIONS,
  type AzureRemediationAssetClass,
} from '@gideon-defender/integration-platform';
import {
  decodeAzureTokenClaims,
  mintAzureSpToken,
  readAzureEffectiveActions,
} from './azure-remediation-identity';

export interface AzureTrustBinding {
  /** Canonical `Class:subscription` key (for error messages). */
  key: string;
  assetClass: AzureRemediationAssetClass;
  subscriptionId: string;
  /** Bound SP application (client) ID. */
  appId: string;
  /** Bound SP client secret (undefined when the binding omits it). */
  secret: string | undefined;
}

/**
 * Prove every bound remediator SP is usable by the BACKEND and confined to
 * fix-forward grants. Returns an error message for the first failing
 * binding, or null when all pass. An empty list passes trivially.
 *
 * Positive probe: a client-credentials token mints for the SP, and the
 * freshly minted JWT names the bound app ID in the bound tenant — a token
 * for anything else proves the binding points at the wrong identity.
 * Mint failures throw (inconclusive/refused visibly, never certified).
 *
 * Negative probe: the SP's effective ARM actions must contain no wildcard
 * and no never-allow grant, and must include at least one fix-forward
 * action for the pair's class (an SP with zero grants is a broken setup,
 * not a least-privilege one). A least-privilege SP is not expected to
 * read authorization state, so a 401/403 on the permissions read is
 * inconclusive — logged and passed, never treated as proof of safety.
 * The setup script (the control that keeps grants narrow) plus Phase C
 * detection cover that residual.
 */
export async function validateAzureRemediationTrust(params: {
  tenantId: string;
  bindings: AzureTrustBinding[];
  deps?: {
    mint?: typeof mintAzureSpToken;
    readActions?: typeof readAzureEffectiveActions;
  };
  logger: Pick<Logger, 'log' | 'warn'>;
}): Promise<string | null> {
  const mint = params.deps?.mint ?? mintAzureSpToken;
  const readActions = params.deps?.readActions ?? readAzureEffectiveActions;
  for (const binding of params.bindings) {
    if (!binding.secret) {
      return (
        `azureRemediationSecrets["${binding.key}"]: missing client secret ` +
        `for this binding — re-run the setup script and paste back the map and secrets together.`
      );
    }
    params.logger.log(
      `Validating Azure: remediator SP ${binding.appId} (${binding.key})...`,
    );
    const token = await mint({
      tenantId: params.tenantId,
      clientId: binding.appId,
      clientSecret: binding.secret,
    });

    const claims = decodeAzureTokenClaims(token.accessToken);
    if (
      !claims?.appid ||
      claims.appid.toLowerCase() !== binding.appId.toLowerCase()
    ) {
      return (
        `Remediator SP ${binding.appId} minted a token for a different ` +
        `application — the binding does not point at this SP.`
      );
    }
    if (
      !claims.tid ||
      claims.tid.toLowerCase() !== params.tenantId.toLowerCase()
    ) {
      return (
        `Remediator SP ${binding.appId} minted a token in a different ` +
        `tenant — bindings must live in the connection tenant.`
      );
    }

    const effective = await readActions({
      accessToken: token.accessToken,
      subscriptionId: binding.subscriptionId,
    });
    if ('denied' in effective) {
      params.logger.warn(
        `Validating Azure: SP ${binding.appId} cannot read its own grants ` +
          `(expected for least-privilege setups) — least-privilege could not ` +
          `be confirmed here; the setup script and executor detection remain the controls.`,
      );
      continue;
    }
    const granted = new Set(
      effective.actions.map((action) => action.toLowerCase()),
    );
    const wildcard = [...granted].find(
      (action) => action === '*' || action === '*/write',
    );
    if (wildcard) {
      return (
        `Remediator SP ${binding.appId} holds wildcard grant "${wildcard}" — ` +
        `rebind a least-privilege class SP from the setup script.`
      );
    }
    const forbidden = AZURE_NEVER_ALLOW_ACTIONS.find((action) =>
      granted.has(action.toLowerCase()),
    );
    if (forbidden) {
      return (
        `Remediator SP ${binding.appId} holds never-allow grant ` +
        `"${forbidden}" — rebind a least-privilege class SP from the setup script.`
      );
    }
    const fixForward = AZURE_FIX_FORWARD_ACTIONS[binding.assetClass].some(
      (action) => granted.has(action.toLowerCase()),
    );
    if (!fixForward) {
      return (
        `Remediator SP ${binding.appId} has no fix-forward grants for ` +
        `${binding.assetClass} — run the setup script for ${binding.key}.`
      );
    }
    params.logger.log(
      `Validating Azure: remediator SP ${binding.appId} token + least-privilege check passed`,
    );
  }
  return null;
}
