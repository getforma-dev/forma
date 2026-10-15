export function commandInvocation(command: string, args: string[], options?: {
  platform?: string;
  executable?: string;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
}): { command: string; args: string[] };
