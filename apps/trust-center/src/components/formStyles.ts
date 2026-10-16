/**
 * Shared field styling for trust-center forms. Both the request-access
 * dialog and the NDA signing form render the same bordered inputs and
 * inline errors — one copy keeps them in sync.
 */
export const inputClassName =
  'min-h-10 w-full rounded-md border border-line bg-white px-3 text-[15px] outline-none transition-colors placeholder:text-muted focus:border-primary';

export const errorClassName = 'mt-1 text-[13px] text-danger';
