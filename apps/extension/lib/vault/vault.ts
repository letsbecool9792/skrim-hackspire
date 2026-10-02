import { formatPiiToken, type PiiCategory, type PiiToken } from "@skrim/schema";

export type VaultStats = Partial<Record<PiiCategory, number>>;

export class TokenVault {
  private readonly values = new Map<PiiToken, string>();
  private readonly tokensByValue = new Map<string, PiiToken>();
  private readonly nextIndex = new Map<PiiCategory, number>();

  set(category: PiiCategory, realValue: string): PiiToken {
    const valueKey = `${category}\u0000${realValue}`;
    const existingToken = this.tokensByValue.get(valueKey);
    if (existingToken) return existingToken;

    const index = this.nextIndex.get(category) ?? 1;
    const token = formatPiiToken(category, index);
    this.nextIndex.set(category, index + 1);
    this.values.set(token, realValue);
    this.tokensByValue.set(valueKey, token);
    return token;
  }

  resolve(token: PiiToken): string | undefined {
    return this.values.get(token);
  }

  clear(): void {
    this.values.clear();
    this.tokensByValue.clear();
    this.nextIndex.clear();
  }

  stats(): VaultStats {
    const counts: VaultStats = {};
    for (const token of this.values.keys()) {
      const category = token.slice(5, token.lastIndexOf(":")) as PiiCategory;
      counts[category] = (counts[category] ?? 0) + 1;
    }
    return counts;
  }
}