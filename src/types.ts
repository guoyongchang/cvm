export interface CvmConfig {
  active: string | null;
  registry: string | null;
  patches: PatchRecord[];
}

export interface PatchRecord {
  version: string;
  proxyUrl: string;
  appliedAt: string;
}

export interface VersionInfo {
  version: string;
  active: boolean;
  patched: boolean;
}
