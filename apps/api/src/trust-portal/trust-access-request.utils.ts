/** Express-style network fields carried on the request object. */
interface RequestNetworkInfo {
  ip?: unknown;
  socket?: { remoteAddress?: unknown };
}

/** Authenticated user id attached by the auth layer. */
interface RequestUserInfo {
  userId?: unknown;
}

/** Best-effort client IP: `req.ip` with socket fallback, string-only. */
export function getRequestIp(req: Request): string | undefined {
  const candidate = req as unknown as RequestNetworkInfo;
  const ip = candidate.ip ?? candidate.socket?.remoteAddress;
  return typeof ip === 'string' ? ip : undefined;
}

/** Authenticated user id, string-only. */
export function getRequestUserId(req: Request): string | undefined {
  const candidate = req as unknown as RequestUserInfo;
  return typeof candidate.userId === 'string' ? candidate.userId : undefined;
}
