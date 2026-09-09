import type { NetworkInterfaceInfo } from 'node:os';
export function selectLanAddress(interfaces: Record<string, NetworkInterfaceInfo[] | undefined>): string;
export function resolveDevOrigin(env?: Record<string, string | undefined>, interfaces?: Record<string, NetworkInterfaceInfo[] | undefined>): string;
