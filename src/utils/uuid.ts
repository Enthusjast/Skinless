export function generateUserId(): string {
  return crypto.randomUUID();
}

export function generateProfileId(): string {
  return generateUserId().replaceAll('-', '');
}

export function isProfileId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}
