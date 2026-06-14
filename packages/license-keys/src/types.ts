export interface LicensePolicy {
  id: string;
  machineLimit: number;
  domainLimit?: number;
  expiresAt?: string;
}
