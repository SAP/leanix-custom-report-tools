/**
 * Parses a flag that needs three states: true, false, or undefined (not supplied).
 * minimist collapses boolean flags to false when absent, losing the "not supplied"
 * state that is needed to decide whether to prompt the user.
 *
 * @param args - The raw argv array (e.g. process.argv.slice(2))
 * @param name - The flag name without leading dashes (e.g. 'setupMcpServers')
 * @returns true if --name is present, false if --no-name is present, undefined otherwise
 */
export function parseTriStateBoolean(
  args: string[],
  name: string
): boolean | undefined {
  if (args.includes(`--${name}`)) return true;
  if (args.includes(`--no-${name}`)) return false;
  return undefined;
}
